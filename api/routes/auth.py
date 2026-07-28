"""Token exchange for first-party API clients."""

from __future__ import annotations

import os
import secrets
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from pydantic import BaseModel, Field

from api.security import rate_limiter
from utils.auth import (
    authenticate,
    create_api_token,
    create_service_api_token,
    derive_service_user_id,
)

router = APIRouter(prefix="/v1/auth", tags=["authentication"])
service_basic = HTTPBasic(
    auto_error=False,
    scheme_name="AssetHero client credentials",
    description="Server-side client ID and secret. Never use these in browser code.",
)


class TokenRequest(BaseModel):
    email: str = Field(min_length=3, max_length=255)
    password: str = Field(min_length=1, max_length=512)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int = 3600


@router.post("/token", response_model=TokenResponse)
async def issue_token(body: TokenRequest, request: Request, response: Response):
    client_host = request.client.host if request.client else "unknown"
    await rate_limiter.check_key(
        f"auth:{client_host}",
        max(1, int(os.getenv("AUTH_RATE_LIMIT_PER_MINUTE", "10"))),
    )
    user = await authenticate(body.email, body.password)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "invalid_credentials", "message": "Invalid credentials."},
            headers={"WWW-Authenticate": "Bearer"},
        )
    token = create_api_token(user["user_id"], user["email"], expires_minutes=60)
    response.headers["Cache-Control"] = "no-store"
    response.headers["Pragma"] = "no-cache"
    return TokenResponse(access_token=token)


def _service_auth_config() -> tuple[str, str, str, int]:
    client_id = os.getenv("ASSETHERO_CLIENT_ID", "").strip()
    client_secret = os.getenv("ASSETHERO_CLIENT_SECRET", "")
    if not client_id or len(client_secret) < 32:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "code": "service_auth_unavailable",
                "message": "Service authentication is not configured.",
            },
        )

    configured_user_id = os.getenv("ASSETHERO_SERVICE_USER_ID", "").strip()
    try:
        user_id = str(
            UUID(configured_user_id)
            if configured_user_id
            else UUID(derive_service_user_id(client_id))
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "code": "service_auth_misconfigured",
                "message": "Service authentication is misconfigured.",
            },
        ) from exc

    try:
        expires_in = max(
            60,
            min(int(os.getenv("SERVICE_TOKEN_TTL_SECONDS", "900")), 3600),
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "code": "service_auth_misconfigured",
                "message": "Service authentication is misconfigured.",
            },
        ) from exc
    return client_id, client_secret, user_id, expires_in


@router.post("/service-token", response_model=TokenResponse)
async def issue_service_token(
    request: Request,
    response: Response,
    credentials: Optional[HTTPBasicCredentials] = Depends(service_basic),
):
    """Exchange AssetHero's backend credential for a short-lived chat token."""
    client_host = request.client.host if request.client else "unknown"
    await rate_limiter.check_key(
        f"service-auth:{client_host}",
        max(1, int(os.getenv("SERVICE_AUTH_RATE_LIMIT_PER_MINUTE", "10"))),
    )
    if request.headers.get("origin"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "server_side_only",
                "message": "Service credentials may only be exchanged server-side.",
            },
        )

    client_id, client_secret, user_id, expires_in = _service_auth_config()
    supplied_id = credentials.username if credentials else ""
    supplied_secret = credentials.password if credentials else ""
    valid_id = secrets.compare_digest(
        supplied_id.encode("utf-8"),
        client_id.encode("utf-8"),
    )
    valid_secret = secrets.compare_digest(
        supplied_secret.encode("utf-8"),
        client_secret.encode("utf-8"),
    )
    if not (valid_id and valid_secret):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "invalid_client", "message": "Invalid client credentials."},
            headers={"WWW-Authenticate": 'Basic realm="polytrade-service"'},
        )

    token = create_service_api_token(client_id, user_id, expires_in)
    response.headers["Cache-Control"] = "no-store"
    response.headers["Pragma"] = "no-cache"
    return TokenResponse(access_token=token, expires_in=expires_in)
