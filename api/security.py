"""Authentication and lightweight abuse controls for the HTTP API."""

from __future__ import annotations

import asyncio
import os
import time
from collections import defaultdict, deque
from dataclasses import dataclass
from typing import Deque, Dict, FrozenSet, Optional
from uuid import UUID

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


NATIVE_RUN_SOURCE = "native"
ASSETHERO_RUN_SOURCE = "assethero"


@dataclass(frozen=True)
class RunAttribution:
    principal_id: str
    source: str


@dataclass(frozen=True)
class RunFilters:
    principal_id: Optional[str]
    source: Optional[str]


def _invalid_attribution(message: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail={"code": "invalid_run_attribution", "message": message},
    )


def _assethero_user_id(value: str) -> str:
    try:
        return str(UUID(value.strip()))
    except (AttributeError, ValueError) as exc:
        raise _invalid_attribution("AssetHero user ID must be a UUID.") from exc


def _is_assethero_service(principal: Principal) -> bool:
    configured_client_id = os.getenv("ASSETHERO_CLIENT_ID", "").strip()
    return (
        bool(configured_client_id)
        and principal.principal_type == "service"
        and principal.client_id == configured_client_id
    )


def resolve_run_attribution(
    principal: Principal,
    delegated_user_id: Optional[str] = None,
    delegated_source: Optional[str] = None,
) -> RunAttribution:
    """Resolve trusted delegation headers to the effective run owner."""
    if delegated_user_id is None and delegated_source is None:
        return RunAttribution(principal.user_id, NATIVE_RUN_SOURCE)
    if delegated_user_id is None or delegated_source is None:
        raise _invalid_attribution(
            "X-User-Id and X-User-Source must be supplied together."
        )
    if delegated_source.strip().lower() != ASSETHERO_RUN_SOURCE:
        raise _invalid_attribution("X-User-Source must be assethero.")
    if not _is_assethero_service(principal):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "assethero_delegation_forbidden",
                "message": "Only the authenticated AssetHero service may delegate a user.",
            },
        )
    return RunAttribution(
        principal_id=_assethero_user_id(delegated_user_id),
        source=ASSETHERO_RUN_SOURCE,
    )


def resolve_run_filters(
    principal: Principal,
    requested_principal_id: Optional[str] = None,
    requested_source: Optional[str] = None,
) -> RunFilters:
    """Authorize optional run filters without exposing another user's runs."""
    if "admin:read" in principal.scopes:
        source = requested_source.strip().lower() if requested_source else None
        if source not in {None, NATIVE_RUN_SOURCE, ASSETHERO_RUN_SOURCE}:
            raise _invalid_attribution("source must be native or assethero.")
        principal_id = requested_principal_id.strip() if requested_principal_id else None
        if source == ASSETHERO_RUN_SOURCE and principal_id is not None:
            principal_id = _assethero_user_id(principal_id)
        return RunFilters(principal_id=principal_id, source=source)

    if requested_principal_id is None and requested_source is None:
        return RunFilters(principal_id=principal.user_id, source=NATIVE_RUN_SOURCE)
    if requested_principal_id is None or requested_source is None:
        raise _invalid_attribution("principal_id and source must be supplied together.")

    principal_id = requested_principal_id.strip()
    source = requested_source.strip().lower()
    if source == NATIVE_RUN_SOURCE and principal_id == principal.user_id:
        return RunFilters(principal_id=principal_id, source=source)

    delegated = resolve_run_attribution(principal, principal_id, source)
    return RunFilters(principal_id=delegated.principal_id, source=delegated.source)


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


async def require_run_reader(
    principal: Principal = Depends(require_principal),
) -> Principal:
    if "admin:read" not in principal.scopes:
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
