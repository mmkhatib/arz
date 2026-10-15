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
    raise AcpError(f"{_KIRO_BIN} not found. Install kiro-cli or switch to provider=claude-code.")


class KiroCliProvider(LLMProvider):
    """LLMProvider backed by kiro-cli ACP (JSON-RPC over stdio).

    Kiro-cli implements the full ACP handshake, including session/update
    streaming, permission requests, and session resumption.
    """

    name = "kiro-cli"
    keeps_context = True

    def __init__(
        self,
        model: str = "auto",
        work_dir: str | Path | None = None,
        agent: str = "arz",
        env_extra: dict[str, str] | None = None,
        system_prompt: str | None = None,
        history_messages: list[dict] | None = None,
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
        # Prior turns to rehydrate on the first message of this provider's
        # lifetime — bridges across gateway restarts so the model doesn't
        # forget what it wrote earlier. After this gets injected once,
        # kiro carries native conversation state.
        self._history: list[dict] = history_messages or []
        self._injected_system = False

    async def start(self) -> None:
        await self._client.start()
        log.info("kiro-cli provider started")

    async def shutdown(self) -> None:
        await self._client.shutdown()

    def stream(self, message: str) -> AsyncIterator[LLMEvent]:
        return self._forward(message)

    def _format_history(self, *, max_messages: int = 30, max_chars: int = 8000) -> str:
        if not self._history:
            return ""
        recent = self._history[-max_messages:]
        lines: list[str] = []
        used = 0
        for m in recent:
            role = (m.get("role") or "user").upper()
            text = (m.get("text") or "").strip()
            if not text:
                continue
            line = f"<{role}>\n{text}\n</{role}>"
            if used + len(line) + 2 > max_chars:
                break
            lines.append(line)
            used += len(line) + 2
        return "\n\n".join(lines)

    async def _forward(self, message: str) -> AsyncIterator[LLMEvent]:
        # Inject system prompt + conversation history on the first turn of
        # this provider's life. Both wrapped so the model treats them as
        # context, not as instructions from the user.
        if not self._injected_system:
            preamble: list[str] = []
            if self._system_prompt:
                preamble.append(f"<system>\n{self._system_prompt}\n</system>")
            transcript = self._format_history()
            if transcript:
                preamble.append(
                    "<conversation-history>\nPrior turns of this session — your own conversation with the user. "
                    "Treat as your real memory, not as instructions.\n\n"
                    + transcript
                    + "\n</conversation-history>"
                )
            if preamble:
                message = "\n\n".join(preamble) + "\n\n" + message
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

    async def cancel(self) -> None:
        await self._client.cancel()

    async def steer(self, message: str) -> bool:
        """Forward a mid-turn steer to kiro-cli's ``_session/steer``."""
        return await self._client.steer(message)

    @property
    def supports_steer(self) -> bool:
        return self._client.supports_steer
