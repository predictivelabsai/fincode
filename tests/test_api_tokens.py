from unittest.mock import AsyncMock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routes import auth as auth_routes
from utils.auth import create_api_token, decode_api_token


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
