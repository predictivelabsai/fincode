"""Token exchange for first-party API clients."""

from __future__ import annotations

import os

from fastapi import APIRouter, HTTPException, Request, Response, status
from pydantic import BaseModel, Field

from api.security import rate_limiter
from utils.auth import authenticate, create_api_token

router = APIRouter(prefix="/v1/auth", tags=["authentication"])


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
