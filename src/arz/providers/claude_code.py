"""ClaudeCodeProvider — LLMProvider backed by the Claude Code CLI (persistent stream-json)."""

from __future__ import annotations

import shutil
from collections.abc import AsyncIterator
from pathlib import Path

import structlog

from arz.acp.claude_interactive import ClaudeInteractiveClient
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

    Maintains ONE persistent `claude --input-format stream-json` process per
    session. The process stays alive between turns, so conversation history
    is native and startup overhead is paid once.
    """

    name = "claude-code"

    def __init__(
        self,
        model: str | None = None,
        work_dir: str | Path | None = None,
        system_prompt: str | None = None,
        env_extra: dict[str, str] | None = None,
    ) -> None:
        self._client = ClaudeInteractiveClient(
            binary=_resolve_binary(),
            model=model,
            work_dir=work_dir,
            system_prompt=system_prompt,
            env_extra=env_extra,
        )

    async def start(self) -> None:
        await self._client.start()
        log.info("Claude Code provider started (persistent process)")

    async def shutdown(self) -> None:
        await self._client.shutdown()

    def is_alive(self) -> bool:
        return self._client.is_alive()

    def stream(self, message: str) -> AsyncIterator[LLMEvent]:
        return self._forward(message)

    async def _forward(self, message: str) -> AsyncIterator[LLMEvent]:
        async for acp_event in self._client.stream_events(message):
            yield LLMEvent(
                kind=acp_event.kind,
                text=acp_event.text or None,
                tool_call_id=acp_event.tool_call_id or None,
                tool_input={"raw": acp_event.tool_input} if acp_event.tool_input else None,
                tool_output=acp_event.tool_output or None,
                stop_reason=acp_event.stop_reason or None,
                request_id=acp_event.request_id or None,
                context_usage_pct=acp_event.context_usage_pct or None,
            )

    async def approve_tool(self, request_id: str | int) -> None:
        log.warning("approve_tool not yet supported in ClaudeCodeProvider")

    async def reject_tool(self, request_id: str | int) -> None:
        log.warning("reject_tool not yet supported in ClaudeCodeProvider")

    def context_usage_pct(self) -> float:
        return 0.0
