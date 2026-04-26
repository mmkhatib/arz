"""Provider-agnostic LLM abstraction.

Every concrete LLM backend (Claude Code CLI, Kiro-cli, Anthropic SDK, etc.)
implements :class:`LLMProvider`. Consumers (session, surfaces, CLI) depend
only on this interface, never on a specific backend.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Any

EVENT_TEXT_CHUNK = "text_chunk"
EVENT_THINKING_CHUNK = "thinking_chunk"
EVENT_TOOL_CALL = "tool_call"
EVENT_TOOL_RESULT = "tool_result"
EVENT_PERMISSION_REQUEST = "permission_request"
EVENT_COMPACTION_STATUS = "compaction_status"
EVENT_COMPLETE = "complete"


@dataclass
class LLMEvent:
    """One streaming event emitted by an :class:`LLMProvider`."""

    kind: str
    text: str | None = None
    tool_call_id: str | None = None
    tool_input: dict[str, Any] | None = None
    tool_output: Any = None
    stop_reason: str | None = None
    request_id: str | int | None = None
    context_usage_pct: float | None = None
    extra: dict[str, Any] = field(default_factory=dict)


class LLMProvider(ABC):
    """Abstract LLM backend."""

    name: str = "unknown"

    @abstractmethod
    async def start(self) -> None:
        """Initialize the provider (spawn process, open client, etc.)."""

    @abstractmethod
    async def shutdown(self) -> None:
        """Gracefully shut down."""

    @abstractmethod
    def stream(self, message: str) -> AsyncIterator[LLMEvent]:
        """Send a user message and yield streaming events until completion."""

    @abstractmethod
    async def approve_tool(self, request_id: str | int) -> None:
        """Approve a pending tool permission request."""

    @abstractmethod
    async def reject_tool(self, request_id: str | int) -> None:
        """Reject a pending tool permission request."""

    @abstractmethod
    def context_usage_pct(self) -> float:
        """Return the last known context-window usage percentage (0.0–100.0)."""

    async def cancel(self) -> None:
        """Cancel the in-flight operation. No-op for providers without native support."""

    async def compact(self, context: str = "") -> None:
        """Trigger context compaction. No-op for providers without native support."""

    def is_alive(self) -> bool:
        """Return True if the backing process/connection is healthy."""
        return True

    @property
    def current_model(self) -> str | None:
        """Return the model this provider was started with, or None if unknown."""
        return None

    @property
    def session_id(self) -> str | None:
        """Return the provider's native session ID (for resume on restart)."""
        return None

    @property
    def resumed(self) -> bool:
        """True if this provider was resumed from a prior session."""
        return False

    def set_resume_session_id(self, sid: str) -> None:
        """Set the native session ID to resume. Must be called before start()."""
