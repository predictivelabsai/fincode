from unittest.mock import AsyncMock

from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from api.routes import auth as auth_routes
from api.security import Principal, require_principal
from utils.auth import (
    create_api_token,
    create_service_api_token,
    decode_api_token,
    derive_service_user_id,
)


SERVICE_SECRET = "service-secret-that-is-at-least-32-characters"


def test_api_token_has_required_scope_and_identity(monkeypatch):
    monkeypatch.setenv("JWT_SECRET", "test-secret-that-is-not-used-in-production")
    token = create_api_token(
        "00000000-0000-0000-0000-000000000020",
        "api@example.com",
    )

    payload = decode_api_token(token)

    assert payload["purpose"] == "api_access"
    assert payload["user_id"] == "00000000-0000-0000-0000-000000000020"
    assert "chat:write" in payload["scope"]


def test_token_exchange_returns_a_non_cacheable_access_token(monkeypatch):
    monkeypatch.setenv("JWT_SECRET", "test-secret-that-is-not-used-in-production")
    monkeypatch.setattr(
        auth_routes,
        "authenticate",
        AsyncMock(
            return_value={
                "user_id": "00000000-0000-0000-0000-000000000020",
                "email": "api@example.com",
            }
        ),
    )
    app = FastAPI()
    app.include_router(auth_routes.router)
    client = TestClient(app)

    response = client.post(
        "/v1/auth/token",
        json={"email": "api@example.com", "password": "correct-password"},
    )

    assert response.status_code == 200
    assert response.json()["token_type"] == "bearer"
    assert decode_api_token(response.json()["access_token"]) is not None
    assert response.headers["cache-control"] == "no-store"


def test_service_token_has_stable_identity_and_chat_only_scopes(monkeypatch):
    monkeypatch.setenv("JWT_SECRET", "test-secret-that-is-not-used-in-production")
    service_user_id = derive_service_user_id("assethero")

    token = create_service_api_token("assethero", service_user_id, 900)
    payload = decode_api_token(token)

    assert payload["sub"] == "service:assethero"
    assert payload["user_id"] == service_user_id
    assert payload["principal_type"] == "service"
    assert payload["client_id"] == "assethero"
    assert set(payload["scope"].split()) == {"chat:read", "chat:write"}
    assert payload["exp"] - payload["iat"] == 900


def _service_auth_client(monkeypatch):
    monkeypatch.setenv("JWT_SECRET", "test-secret-that-is-not-used-in-production")
    monkeypatch.setenv("ASSETHERO_CLIENT_ID", "assethero")
    monkeypatch.setenv("ASSETHERO_CLIENT_SECRET", SERVICE_SECRET)
    monkeypatch.delenv("ASSETHERO_SERVICE_USER_ID", raising=False)
    app = FastAPI()
    app.include_router(auth_routes.router)
    return TestClient(app)


def test_service_credentials_exchange_for_short_lived_token(monkeypatch):
    client = _service_auth_client(monkeypatch)

    response = client.post(
        "/v1/auth/service-token",
        auth=("assethero", SERVICE_SECRET),
    )

    assert response.status_code == 200
    assert response.json()["expires_in"] == 900
    payload = decode_api_token(response.json()["access_token"])
    assert payload["principal_type"] == "service"
    assert payload["client_id"] == "assethero"
    assert response.headers["cache-control"] == "no-store"


def test_service_token_authenticates_as_service_principal(monkeypatch):
    client = _service_auth_client(monkeypatch)

    @client.app.get("/whoami")
    async def whoami(principal: Principal = Depends(require_principal)):
        return {
            "user_id": principal.user_id,
            "principal_type": principal.principal_type,
            "client_id": principal.client_id,
        }

    exchange = client.post(
        "/v1/auth/service-token",
        auth=("assethero", SERVICE_SECRET),
    )
    response = client.get(
        "/whoami",
        headers={"Authorization": f"Bearer {exchange.json()['access_token']}"},
    )

    assert response.status_code == 200
    assert response.json() == {
        "user_id": derive_service_user_id("assethero"),
        "principal_type": "service",
        "client_id": "assethero",
    }


def test_service_credentials_are_rejected_when_invalid(monkeypatch):
    client = _service_auth_client(monkeypatch)

    response = client.post(
        "/v1/auth/service-token",
        auth=("assethero", "wrong-secret"),
    )

    assert response.status_code == 401
    assert response.json()["detail"]["code"] == "invalid_client"


def test_service_secret_exchange_is_rejected_from_browser(monkeypatch):
    client = _service_auth_client(monkeypatch)

    response = client.post(
        "/v1/auth/service-token",
        auth=("assethero", SERVICE_SECRET),
        headers={"Origin": "https://assethero.chat"},
    )

    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "server_side_only"


def test_service_auth_is_disabled_without_a_strong_secret(monkeypatch):
    monkeypatch.setenv("JWT_SECRET", "test-secret-that-is-not-used-in-production")
    monkeypatch.setenv("ASSETHERO_CLIENT_ID", "assethero")
    monkeypatch.setenv("ASSETHERO_CLIENT_SECRET", "too-short")
    app = FastAPI()
    app.include_router(auth_routes.router)
    client = TestClient(app)

    response = client.post(
        "/v1/auth/service-token",
        auth=("assethero", "too-short"),
    )

    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "service_auth_unavailable"
