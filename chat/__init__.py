"""Shared chat backend used by every PolyTrade chat surface."""

from .events import ChatEvent
from .service import ChatService, get_chat_service

__all__ = ["ChatEvent", "ChatService", "get_chat_service"]
