from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

from api import main as api_main
from api.security import Principal, resolve_run_filters
from db import repository
from utils.auth import create_api_token


ASSETHERO_USER_ID = "11111111-1111-4111-8111-111111111111"
NATIVE_USER_ID = "22222222-2222-4222-8222-222222222222"
RUN_ID = "33333333-3333-4333-8333-333333333333"
SERVICE_SECRET = "s" * 40


class FakeClosableClient:
    async def close(self) -> None:
        return None


class FakeBacktestEngine:
    def __init__(self, *_args, **_kwargs) -> None:
        pass

    async def run_backtest(self, **_kwargs):
        return {"diagnostics": {"provider": "fake"}, "trades": []}


@pytest.fixture
def attribution_api(monkeypatch):
    monkeypatch.setenv("JWT_SECRET", "j" * 40)
    monkeypatch.setenv("ASSETHERO_CLIENT_ID", "assethero")
    monkeypatch.setenv("ASSETHERO_CLIENT_SECRET", SERVICE_SECRET)
    monkeypatch.setenv("SERVICE_AUTH_RATE_LIMIT_PER_MINUTE", "1000")
    monkeypatch.setenv("SERVICE_CHAT_RATE_LIMIT_PER_MINUTE", "1000")
    monkeypatch.setenv("CHAT_RATE_LIMIT_PER_MINUTE", "1000")
    monkeypatch.delenv("TOMORROWIO_API_KEY", raising=False)

    monkeypatch.setattr(api_main, "PolymarketClient", FakeClosableClient)
    monkeypatch.setattr(api_main, "VisualCrossingClient", FakeClosableClient)
    monkeypatch.setattr(api_main, "BacktestEngine", FakeBacktestEngine)

    mocks = SimpleNamespace(
        create_run=AsyncMock(return_value=RUN_ID),
        finish_run=AsyncMock(),
        save_backtest_trades=AsyncMock(return_value=0),
        save_pnl_snapshot=AsyncMock(return_value={}),
        get_runs=AsyncMock(return_value=[]),
        get_run=AsyncMock(return_value=None),
    )
    for name, value in vars(mocks).items():
        monkeypatch.setattr(repository, name, value)

    with TestClient(api_main.app) as client:
        yield client, mocks


def _service_token(client: TestClient) -> str:
    response = client.post(
        "/v1/auth/service-token",
        auth=("assethero", SERVICE_SECRET),
    )
    assert response.status_code == 200
    return response.json()["access_token"]


def test_assethero_headers_attribute_run_and_trades_to_user(attribution_api):
    client, mocks = attribution_api
    token = _service_token(client)

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
    assert response.json()["diagnostics"] == {"provider": "fake"}
    assert mocks.create_run.await_args.args[-2:] == (ASSETHERO_USER_ID, "assethero")
    assert mocks.save_backtest_trades.await_args.kwargs["user_id"] == ASSETHERO_USER_ID


def test_absent_headers_preserve_native_attribution(attribution_api):
    client, mocks = attribution_api
    token = create_api_token(NATIVE_USER_ID, "native@example.com")

    response = client.post(
        "/backtest",
        headers={"Authorization": f"Bearer {token}"},
        json={"city": "Melbourne", "lookback_days": 1},
    )

    assert response.status_code == 200
    assert mocks.create_run.await_args.args[-2:] == (NATIVE_USER_ID, "native")
    assert mocks.save_backtest_trades.await_args.kwargs["user_id"] == NATIVE_USER_ID


@pytest.mark.parametrize(
    ("headers", "expected_status"),
    [
        ({"X-User-Id": ASSETHERO_USER_ID}, 400),
        ({"X-User-Source": "assethero"}, 400),
        (
            {"X-User-Id": "not-a-uuid", "X-User-Source": "assethero"},
            400,
        ),
    ],
)
def test_invalid_assethero_delegation_headers_fail_closed(
    attribution_api, headers, expected_status
):
    client, mocks = attribution_api
    token = _service_token(client)

    response = client.post(
        "/backtest",
        headers={"Authorization": f"Bearer {token}", **headers},
        json={"city": "Melbourne", "lookback_days": 1},
    )

    assert response.status_code == expected_status
    mocks.create_run.assert_not_awaited()


def test_native_user_cannot_spoof_assethero_delegation(attribution_api):
    client, mocks = attribution_api
    token = create_api_token(NATIVE_USER_ID, "native@example.com")

    response = client.post(
        "/backtest",
        headers={
            "Authorization": f"Bearer {token}",
            "X-User-Id": ASSETHERO_USER_ID,
            "X-User-Source": "assethero",
        },
        json={"city": "Melbourne", "lookback_days": 1},
    )

    assert response.status_code == 403
    mocks.create_run.assert_not_awaited()


def test_assethero_can_filter_run_list_and_detail_by_delegated_user(attribution_api):
    client, mocks = attribution_api
    token = _service_token(client)
    run = {
        "run_id": RUN_ID,
        "principal_id": ASSETHERO_USER_ID,
        "source": "assethero",
    }
    mocks.get_runs.return_value = [run]
    mocks.get_run.return_value = run
    query = f"source=assethero&principal_id={ASSETHERO_USER_ID}"

    listed = client.get(
        f"/runs?{query}",
        headers={"Authorization": f"Bearer {token}"},
    )
    detailed = client.get(
        f"/runs/{RUN_ID}?{query}",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert listed.status_code == 200
    assert listed.json()["runs"] == [run]
    assert detailed.status_code == 200
    assert detailed.json() == run
    mocks.get_runs.assert_awaited_once_with(
        limit=20,
        principal_id=ASSETHERO_USER_ID,
        source="assethero",
    )
    mocks.get_run.assert_awaited_once_with(
        RUN_ID,
        principal_id=ASSETHERO_USER_ID,
        source="assethero",
    )


def test_native_run_reads_are_automatically_owner_scoped(attribution_api):
    client, mocks = attribution_api
    token = create_api_token(NATIVE_USER_ID, "native@example.com")

    response = client.get(
        "/runs",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 200
    mocks.get_runs.assert_awaited_once_with(
        limit=20,
        principal_id=NATIVE_USER_ID,
        source="native",
    )


def test_native_user_cannot_read_assethero_run_scope(attribution_api):
    client, mocks = attribution_api
    token = create_api_token(NATIVE_USER_ID, "native@example.com")

    response = client.get(
        f"/runs?source=assethero&principal_id={ASSETHERO_USER_ID}",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 403
    mocks.get_runs.assert_not_awaited()


def test_admin_run_reads_remain_unfiltered_by_default():
    filters = resolve_run_filters(
        Principal(
            user_id=NATIVE_USER_ID,
            email="admin@example.com",
            scopes=frozenset({"admin:read"}),
        )
    )

    assert filters.principal_id is None
    assert filters.source is None


class RecordingPool:
    def __init__(self):
        self.execute_call = None
        self.fetch_call = None
        self.fetchrow_call = None

    async def execute(self, query, *args):
        self.execute_call = (query, args)

    async def fetch(self, query, *args):
        self.fetch_call = (query, args)
        return []

    async def fetchrow(self, query, *args):
        self.fetchrow_call = (query, args)
        return None


@pytest.mark.asyncio
async def test_repository_persists_and_filters_run_attribution(monkeypatch):
    pool = RecordingPool()
    monkeypatch.setattr(repository, "get_pool", AsyncMock(return_value=pool))

    await repository.create_run(
        "prediction:Melbourne",
        "backtest_engine",
        "local",
        ASSETHERO_USER_ID,
        "assethero",
    )
    await repository.get_runs(
        limit=25,
        principal_id=ASSETHERO_USER_ID,
        source="assethero",
    )
    await repository.get_run(
        RUN_ID,
        principal_id=ASSETHERO_USER_ID,
        source="assethero",
    )

    insert_sql, insert_args = pool.execute_call
    list_sql, list_args = pool.fetch_call
    detail_sql, detail_args = pool.fetchrow_call
    assert "principal_id, source" in insert_sql
    assert insert_args[-2:] == (ASSETHERO_USER_ID, "assethero")
    assert "principal_id = $1" in list_sql
    assert "source = $2" in list_sql
    assert list_args == (ASSETHERO_USER_ID, "assethero", 25)
    assert "principal_id = $2" in detail_sql
    assert "source = $3" in detail_sql
    assert detail_args == (RUN_ID, ASSETHERO_USER_ID, "assethero")


def test_run_attribution_migration_is_additive_and_repeatable():
    migration = (
        Path(__file__).parents[1]
        / "db"
        / "migrations"
        / "002_assethero_run_attribution.sql"
    ).read_text()

    assert "ADD COLUMN IF NOT EXISTS principal_id TEXT" in migration
    assert "ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'native'" in migration
    assert "DROP " not in migration.upper()
