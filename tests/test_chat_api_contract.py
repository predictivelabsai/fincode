from types import SimpleNamespace
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from langchain_core.messages import AIMessage

from api.routes import chat as chat_routes
from api.security import Principal, require_principal
from chat.repository import MemoryChatRepository
from chat.service import ChatService


USER_ID = "00000000-0000-0000-0000-000000000010"


class NoCommands:
    async def run(self, content, user_id):
        return None


class FakeAgent:
    async def astream_events(self, payload, version):
        yield {
            "event": "on_chat_model_stream",
            "data": {"chunk": SimpleNamespace(content="Shared backend")},
        }
        yield {
            "event": "on_chain_end",
            "data": {
                "output": {"messages": [AIMessage(content="Shared backend")]}
            },
        }


def _build_client():
    service = ChatService(
        repository=MemoryChatRepository(),
        agent_factory=FakeAgent,
        command_router=NoCommands(),
    )
    app = FastAPI()
    app.include_router(chat_routes.router)
    app.dependency_overrides[chat_routes._service] = lambda: service
    app.dependency_overrides[require_principal] = lambda: Principal(
        user_id=USER_ID,
        email="test@example.com",
        scopes=frozenset({"chat:read", "chat:write"}),
    )
    return TestClient(app), service


def test_non_streaming_thread_message_contract():
    client, _ = _build_client()
    created = client.post("/v1/threads", json={"title": "Research"}).json()

    response = client.post(
        f"/v1/threads/{created['thread_id']}/messages",
        headers={"Idempotency-Key": "api-request-1"},
        json={"content": "Analyse it", "stream": False},
    )

    assert response.status_code == 200
    assert response.headers["idempotency-key"] == "api-request-1"
    body = response.json()
    assert body["message"]["content"] == "Shared backend"
    assert body["idempotency_key"] == "api-request-1"


def test_sse_contract_has_named_start_delta_and_terminal_events():
    client, _ = _build_client()
    created = client.post("/v1/threads", json={"title": "Research"}).json()

    with client.stream(
        "POST",
        f"/v1/threads/{created['thread_id']}/messages",
        headers={"Idempotency-Key": "api-request-2"},
        json={"content": "Stream it", "stream": True},
    ) as response:
        body = "".join(response.iter_text())

    assert response.status_code == 200
    assert response.headers["idempotency-key"] == "api-request-2"
    assert "event: run.started" in body
    assert "event: message.delta" in body
    assert "event: message.completed" in body
    assert "event: run.completed" in body
    assert body.index("event: run.started") < body.index("event: message.delta")
    assert body.rindex("event: run.completed") > body.index("event: message.completed")


def test_cross_user_thread_lookup_returns_not_found():
    client, _ = _build_client()
    created = client.post("/v1/threads", json={"title": "Private"}).json()
    client.app.dependency_overrides[require_principal] = lambda: Principal(
        user_id="00000000-0000-0000-0000-000000000011",
        email="other@example.com",
        scopes=frozenset({"chat:read", "chat:write"}),
    )

    response = client.get(f"/v1/threads/{created['thread_id']}/messages")

    assert response.status_code == 404


def test_streaming_post_checks_ownership_before_committing_response():
    client, _ = _build_client()
    created = client.post("/v1/threads", json={"title": "Private"}).json()
    client.app.dependency_overrides[require_principal] = lambda: Principal(
        user_id="00000000-0000-0000-0000-000000000011",
        email="other@example.com",
        scopes=frozenset({"chat:read", "chat:write"}),
    )

    response = client.post(
        f"/v1/threads/{created['thread_id']}/messages",
        headers={"Idempotency-Key": "foreign-request"},
        json={"content": "Try to read it", "stream": True},
    )

    assert response.status_code == 404


def test_canonical_tool_list_has_no_real_order_tool():
    from chat.agent_factory import get_chat_tools

    assert "place_real_order" not in {tool.name for tool in get_chat_tools()}


def test_shared_tool_registry_disables_real_trading_at_construction():
    from chat.agent_factory import ResearchToolRegistry

    fake_agent = SimpleNamespace(
        tools=[
            SimpleNamespace(name="get_news"),
            SimpleNamespace(name="place_real_order"),
        ],
        tool_map={
            "get_news": SimpleNamespace(name="get_news"),
            "place_real_order": SimpleNamespace(name="place_real_order"),
        },
    )
    with patch("agent.agent.Agent.create", return_value=fake_agent) as create:
        safe_agent = ResearchToolRegistry().command_agent

    assert create.call_args.args[0].allow_real_trading is False
    assert "place_real_order" not in safe_agent.tool_map
    assert safe_agent.allow_real_trading is False


def test_read_only_clob_client_ignores_wallet_credentials(monkeypatch):
    from agent.tools.polymarket_clob_api import PolymarketCLOBClient

    monkeypatch.setenv("POLYMARKET_PRIVATE_KEY", "must-not-be-loaded")
    monkeypatch.setenv("POLYMARKET_SECRET", "must-not-be-loaded")
    with patch("agent.tools.polymarket_clob_api.ClobClient") as client_class:
        client = PolymarketCLOBClient(read_only=True)

    assert client.key is None
    assert client.secret is None
    assert client.read_only is True
    assert client_class.call_args.kwargs["key"] is None
