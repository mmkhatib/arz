"""KiroCliProvider — LLMProvider backed by kiro-cli via ACP JSON-RPC."""

from __future__ import annotations

import shutil
from collections.abc import AsyncIterator
from pathlib import Path

import structlog

from arz.acp.client import AcpClient, AcpError
from arz.providers.base import LLMEvent, LLMProvider

log = structlog.get_logger(__name__)

_KIRO_BIN = "kiro-cli"
_KIRO_SUBCMD = "acp"


def _resolve_binary() -> str:
    """Find kiro-cli, preferring ~/.local/bin over PATH."""
    candidates = [Path.home() / ".local" / "bin" / _KIRO_BIN]
    for p in candidates:
        if p.is_file() and p.stat().st_mode & 0o111:
            return str(p)
    found = shutil.which(_KIRO_BIN)
    if found:
        return found
    raise AcpError(
        f"{_KIRO_BIN} not found. Install kiro-cli or switch to provider=claude-code."
    )


class KiroCliProvider(LLMProvider):
    """LLMProvider backed by kiro-cli ACP (JSON-RPC over stdio).

    Kiro-cli implements the full ACP handshake, including session/update
    streaming, permission requests, and session resumption.
    """

    name = "kiro-cli"

    def __init__(
        self,
        model: str = "auto",
        work_dir: str | Path | None = None,
        agent: str = "arz",
        env_extra: dict[str, str] | None = None,
        system_prompt: str | None = None,
    ) -> None:
        self._client = AcpClient(
            binary=_resolve_binary(),
            subcmd=_KIRO_SUBCMD,
            work_dir=work_dir,
            model=model,
            agent=agent,
            env_extra=env_extra,
        )
        # ACP doesn't define a clean way to push a system prompt mid-session,
        # so we prepend it to the very first user message of this provider's
        # lifetime as a `<system>...</system>` wrapper. After that, kiro
        # carries its own context, so we don't repeat it.
        self._system_prompt = (system_prompt or "").strip()
        self._injected_system = False

    async def start(self) -> None:
        await self._client.start()
        log.info("kiro-cli provider started")

    async def shutdown(self) -> None:
        await self._client.shutdown()

    def stream(self, message: str) -> AsyncIterator[LLMEvent]:
        return self._forward(message)

    async def _forward(self, message: str) -> AsyncIterator[LLMEvent]:
        # Inject system prompt on the first turn of this provider's life.
        if self._system_prompt and not self._injected_system:
            message = f"<system>\n{self._system_prompt}\n</system>\n\n{message}"
            self._injected_system = True
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
                usage=acp_event.usage,
                title=acp_event.title or None,
                options=list(acp_event.options or []),
            )

    async def approve_tool(self, request_id: str | int) -> None:
        await self._client.approve_tool(request_id)

    async def reject_tool(self, request_id: str | int) -> None:
        await self._client.reject_tool(request_id)

    def context_usage_pct(self) -> float:
        return 0.0

    @property
    def pid(self) -> int | None:
        proc = getattr(self._client, "_process", None)
        return proc.pid if proc else None

    @property
    def current_model(self) -> str | None:
        return self._client._model

    @property
    def session_id(self) -> str | None:
        return self._client.session_id

    @property
    def resumed(self) -> bool:
        return self._client.resumed

    def set_resume_session_id(self, sid: str) -> None:
        self._client.set_resume_session_id(sid)

    def is_alive(self) -> bool:
        return self._client.is_alive()
