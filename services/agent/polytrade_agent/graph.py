from deepagents import (
    GeneralPurposeSubagentProfile,
    HarnessProfile,
    create_deep_agent,
    register_harness_profile,
)
from deepagents.backends import StateBackend
from langchain_core.language_models.chat_models import BaseChatModel
from langgraph.checkpoint.base import BaseCheckpointSaver

from .boundary import StrictToolAllowlistMiddleware
from .config import get_settings
from .context import AgentRunContext
from .model import build_model
from .tools import POLYMARKET_TOOLS

HIDDEN_DEEP_AGENT_TOOLS = frozenset(
    {"ls", "read_file", "write_file", "edit_file", "delete", "glob", "grep", "execute"}
)
ALLOWED_AGENT_TOOLS = frozenset(tool.name for tool in POLYMARKET_TOOLS)

register_harness_profile(
    "deepseek",
    HarnessProfile(
        excluded_tools=HIDDEN_DEEP_AGENT_TOOLS,
        general_purpose_subagent=GeneralPurposeSubagentProfile(enabled=False),
    ),
)

SYSTEM_PROMPT = """You are PolyTrade, a Polymarket-only research, backtesting, and
order-drafting agent.

You may use only the supplied Polymarket tools. Do not use or claim knowledge from weather
services, company news, general web search, equities, or any source outside the returned
Polymarket data. Clearly distinguish observed facts, calculations, and uncertainty.

You cannot submit or cancel an order. When the user asks to trade, first gather current market
and account data, then call propose_trading_action with exact identifiers and decimal strings.
Describe its output as an unsigned draft requiring explicit review and a wallet signature. Never
call it a paper order, never claim execution, and never promise a fill. If required market or
account data is missing or stale, do not draft the action.

Keep answers concise. Include the observation time for prices and order books. Warn that
Polymarket availability and market state are rechecked by the gateway at signing time.

You can queue deterministic momentum_v1 backtests for resolved binary CLOB V2 markets. Search
resolved markets before starting a run; that search is prefiltered to markets created on or after
the April 28, 2026 CLOB V2 cutover. If more than one candidate could match the request, present the
candidates and ask the user to choose; never guess a condition ID. Apply documented defaults
when parameters are omitted and state the exact configuration used. Describe results as
hypothetical,
not expected returns, and disclose that one-minute history does not reconstruct order-book depth,
partial fills, spreads, or queue position. Backtests never require a wallet and never place orders.
"""


def build_agent(
    *,
    model: BaseChatModel | None = None,
    checkpointer: BaseCheckpointSaver | None = None,
):
    return create_deep_agent(
        model=model or build_model(get_settings()),
        tools=POLYMARKET_TOOLS,
        middleware=[StrictToolAllowlistMiddleware(ALLOWED_AGENT_TOOLS)],
        system_prompt=SYSTEM_PROMPT,
        subagents=[],
        backend=StateBackend(),
        context_schema=AgentRunContext,
        checkpointer=checkpointer,
        name="polytrade_agent",
    )
