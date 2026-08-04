from collections.abc import Awaitable, Callable, Collection
from typing import Any

from langchain.agents.middleware import AgentMiddleware, ToolCallRequest
from langchain_core.messages import ToolMessage
from langgraph.types import Command


class StrictToolAllowlistMiddleware(AgentMiddleware[Any, Any, Any]):
    """Fail closed if any Deep Agents scaffold tool reaches execution."""

    def __init__(self, allowed: Collection[str]) -> None:
        self._allowed = frozenset(allowed)

    def wrap_tool_call(
        self,
        request: ToolCallRequest,
        handler: Callable[[ToolCallRequest], ToolMessage | Command[Any]],
    ) -> ToolMessage | Command[Any]:
        if request.tool_call["name"] not in self._allowed:
            return self._blocked(request)
        return handler(request)

    async def awrap_tool_call(
        self,
        request: ToolCallRequest,
        handler: Callable[
            [ToolCallRequest],
            Awaitable[ToolMessage | Command[Any]],
        ],
    ) -> ToolMessage | Command[Any]:
        if request.tool_call["name"] not in self._allowed:
            return self._blocked(request)
        return await handler(request)

    @staticmethod
    def _blocked(request: ToolCallRequest) -> ToolMessage:
        return ToolMessage(
            content="Tool execution denied by the PolyTrade allowlist",
            tool_call_id=request.tool_call["id"],
            name=request.tool_call["name"],
            status="error",
        )
