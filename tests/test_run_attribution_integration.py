import os

import psycopg2
import pytest
from fastapi.testclient import TestClient

from api import main as api_main


TEST_DB_URL = os.getenv("RUN_ATTRIBUTION_TEST_DB_URL")
ASSETHERO_USER_ID = "44444444-4444-4444-8444-444444444444"
SERVICE_SECRET = "s" * 40


class FakeClosableClient:
    async def close(self) -> None:
        return None


class FakeBacktestEngine:
    def __init__(self, *_args, **_kwargs) -> None:
        pass

    async def run_backtest(self, **_kwargs):
        return {"diagnostics": {"provider": "integration-fake"}, "trades": []}


@pytest.mark.skipif(not TEST_DB_URL, reason="RUN_ATTRIBUTION_TEST_DB_URL not set")
def test_service_token_post_persists_assethero_run_attribution(monkeypatch):
    monkeypatch.setenv("POLYCODE_DB_URL", TEST_DB_URL)
    monkeypatch.setenv("JWT_SECRET", "j" * 40)
    monkeypatch.setenv("ASSETHERO_CLIENT_ID", "assethero")
    monkeypatch.setenv("ASSETHERO_CLIENT_SECRET", SERVICE_SECRET)
    monkeypatch.setenv("SERVICE_AUTH_RATE_LIMIT_PER_MINUTE", "1000")
    monkeypatch.setenv("SERVICE_CHAT_RATE_LIMIT_PER_MINUTE", "1000")
    monkeypatch.delenv("TOMORROWIO_API_KEY", raising=False)
    monkeypatch.setattr(api_main, "PolymarketClient", FakeClosableClient)
    monkeypatch.setattr(api_main, "VisualCrossingClient", FakeClosableClient)
    monkeypatch.setattr(api_main, "BacktestEngine", FakeBacktestEngine)

    with TestClient(api_main.app) as client:
        exchange = client.post(
            "/v1/auth/service-token",
            auth=("assethero", SERVICE_SECRET),
        )
        assert exchange.status_code == 200
        token = exchange.json()["access_token"]
        response = client.post(
            "/backtest",
            headers={
                "Authorization": f"Bearer {token}",
                "X-User-Id": ASSETHERO_USER_ID,
                "X-User-Source": "assethero",
            },
            json={"city": "Melbourne", "lookback_days": 1},
        )

        assert response.status_code == 200
        run_id = response.json()["run_id"]
        assert run_id is not None
        assert response.json()["diagnostics"] == {"provider": "integration-fake"}

        query = f"source=assethero&principal_id={ASSETHERO_USER_ID}"
        listed = client.get(
            f"/runs?{query}",
            headers={"Authorization": f"Bearer {token}"},
        )
        detailed = client.get(
            f"/runs/{run_id}?{query}",
            headers={"Authorization": f"Bearer {token}"},
        )
        other_user = client.get(
            "/runs?source=assethero&principal_id="
            "55555555-5555-4555-8555-555555555555",
            headers={"Authorization": f"Bearer {token}"},
        )

        assert listed.status_code == 200
        assert [item["run_id"] for item in listed.json()["runs"]] == [run_id]
        assert detailed.status_code == 200
        assert detailed.json()["run_id"] == run_id
        assert other_user.status_code == 200
        assert other_user.json()["runs"] == []

        with psycopg2.connect(TEST_DB_URL) as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT principal_id, source
                    FROM polycode.runs
                    WHERE run_id = %s
                    """,
                    (run_id,),
                )
                assert cursor.fetchone() == (ASSETHERO_USER_ID, "assethero")
                cursor.execute(
                    "DELETE FROM polycode.pnl_snapshots WHERE run_id = %s",
                    (run_id,),
                )
                cursor.execute(
                    "DELETE FROM polycode.trades WHERE run_id = %s",
                    (run_id,),
                )
                cursor.execute(
                    "DELETE FROM polycode.runs WHERE run_id = %s",
                    (run_id,),
                )
