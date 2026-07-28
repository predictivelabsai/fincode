"""Authentication and lightweight abuse controls for the HTTP API."""

from __future__ import annotations

import asyncio
import os
import time
from collections import defaultdict, deque
from dataclasses import dataclass
from typing import Deque, Dict, FrozenSet

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from utils.auth import decode_api_token


bearer_scheme = HTTPBearer(
    auto_error=False,
    scheme_name="PolyTrade access token",
    description=(
        "Bearer token issued by POST /v1/auth/token or "
        "POST /v1/auth/service-token"
    ),
)


@dataclass(frozen=True)
class Principal:
    user_id: str
    email: str
    scopes: FrozenSet[str]
    principal_type: str = "user"
    client_id: str = ""

    def require(self, scope: str) -> None:
        if scope not in self.scopes:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={"code": "insufficient_scope", "message": f"Missing {scope}"},
            )


async def require_principal(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
) -> Principal:
    if not credentials or credentials.scheme.lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "authentication_required", "message": "Bearer token required."},
            headers={"WWW-Authenticate": "Bearer"},
        )
    payload = decode_api_token(credentials.credentials)
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "invalid_token", "message": "Token is invalid or expired."},
            headers={"WWW-Authenticate": "Bearer"},
        )
    return Principal(
        user_id=str(payload["user_id"]),
        email=str(payload.get("email") or ""),
        scopes=frozenset(str(payload.get("scope") or "").split()),
        principal_type=str(payload.get("principal_type") or "user"),
        client_id=str(payload.get("client_id") or ""),
    )


class SlidingWindowRateLimiter:
    """Per-process limiter; production ingress should enforce a second global limit."""

    def __init__(self) -> None:
        self._requests: Dict[str, Deque[float]] = defaultdict(deque)
        self._lock = asyncio.Lock()

    async def check(self, principal: Principal) -> None:
        if principal.principal_type == "service":
            limit = max(
                1,
                int(os.getenv("SERVICE_CHAT_RATE_LIMIT_PER_MINUTE", "120")),
            )
            key = f"service:{principal.client_id or principal.user_id}"
        else:
            limit = max(1, int(os.getenv("CHAT_RATE_LIMIT_PER_MINUTE", "30")))
            key = f"user:{principal.user_id}"
        await self.check_key(key, limit)

    async def check_key(self, key: str, limit: int) -> None:
        cutoff = time.monotonic() - 60
        async with self._lock:
            bucket = self._requests[key]
            while bucket and bucket[0] < cutoff:
                bucket.popleft()
            if len(bucket) >= limit:
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail={
                        "code": "rate_limit_exceeded",
                        "message": "Too many requests; retry shortly.",
                    },
                    headers={"Retry-After": "60"},
                )
            bucket.append(time.monotonic())


rate_limiter = SlidingWindowRateLimiter()


async def require_chat_writer(
    principal: Principal = Depends(require_principal),
) -> Principal:
    principal.require("chat:write")
    await rate_limiter.check(principal)
    return principal


async def require_chat_reader(
    principal: Principal = Depends(require_principal),
) -> Principal:
    principal.require("chat:read")
    return principal


async def require_trade_reader(
    principal: Principal = Depends(require_principal),
) -> Principal:
    principal.require("trade:read")
    return principal


async def require_admin(
    principal: Principal = Depends(require_principal),
) -> Principal:
    principal.require("admin:read")
    return principal
