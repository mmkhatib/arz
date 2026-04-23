"""ClaudeCodeProvider — LLMProvider backed by the Claude Code CLI (stream-json)."""

from __future__ import annotations

import shutil
from collections.abc import AsyncIterator
from pathlib import Path

import structlog

from arz.acp.claude_pipe import ClaudePipeClient
from arz.providers.base import LLMEvent, LLMProvider

log = structlog.get_logger(__name__)

_CLAUDE_BIN = "claude"


def _resolve_binary() -> str:
    found = shutil.which(_CLAUDE_BIN)
    if found:
        return found
    raise FileNotFoundError(
        "claude CLI not found. Install Claude Code: https://claude.ai/code"
    )


class ClaudeCodeProvider(LLMProvider):
    """LLMProvider backed by the Claude Code CLI.

    Uses `claude --print --output-format stream-json` for non-interactive
    streaming. Each instance is pinned to a unique work_dir so the claude
    CLI stores and resumes its session there. Pass use_continue=True when
    the session already has prior history so --continue is added.
    """

    name = "claude-code"

    def __init__(
        self,
        model: str | None = None,
        work_dir: str | Path | None = None,
        use_continue: bool = False,
        env_extra: dict[str, str] | None = None,
        extra_args: list[str] | None = None,
    ) -> None:
        self._use_continue = use_continue
        self._client = ClaudePipeClient(
            binary=_resolve_binary(),
            model=model,
            work_dir=work_dir,
            env_extra=env_extra,
            extra_args=extra_args,
        )

    async def start(self) -> None:
        await self._client.start()
        log.info("Claude Code provider started")

    async def shutdown(self) -> None:
        await self._client.shutdown()

    def stream(self, message: str) -> AsyncIterator[LLMEvent]:
        return self._forward(message)

    async def _forward(self, message: str) -> AsyncIterator[LLMEvent]:
        async for acp_event in self._client.stream_events(message, use_continue=self._use_continue):
            # All messages after the first are continuations
            self._use_continue = True
            yield LLMEvent(
                kind=acp_event.kind,
                text=acp_event.text or None,
                tool_call_id=acp_event.tool_call_id or None,
                tool_input={"raw": acp_event.tool_input} if acp_event.tool_input else None,
                tool_output=acp_event.tool_output or None,
                stop_reason=acp_event.stop_reason or None,
                request_id=acp_event.request_id or None,
            )

    async def approve_tool(self, request_id: str | int) -> None:
        log.warning("approve_tool not yet supported in ClaudeCodeProvider (Phase 2)")

    async def reject_tool(self, request_id: str | int) -> None:
        log.warning("reject_tool not yet supported in ClaudeCodeProvider (Phase 2)")

    def context_usage_pct(self) -> float:
        return 0.0
