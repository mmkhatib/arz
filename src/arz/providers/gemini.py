"""GeminiProvider — LLMProvider backed by Google's Gemini CLI.

Gemini CLI supports both an ACP mode (stdio JSON-RPC, like kiro) and a
one-shot ``-p`` mode with ``--output-format stream-json``. We use the
one-shot mode here and lean on a defensive transcript per turn to keep
context, mirroring the codex provider. Auth is the user's responsibility
— Gemini CLI reads ``GEMINI_API_KEY`` (or one of the GOOGLE_GENAI_*
flags) from the environment and emits a clear error when neither is set.

Spawn-per-turn is intentional: Gemini CLI's session resume is by index
("--resume latest" or numeric), which doesn't compose well with our
multi-tab arz session model. Inline transcript is the simpler fix.
"""

from __future__ import annotations

import asyncio
import json
import os
import shutil
from collections.abc import AsyncIterator
from pathlib import Path

import structlog

from arz.providers.base import LLMEvent, LLMProvider

log = structlog.get_logger(__name__)

_GEMINI_BIN = "gemini"
_STDOUT_LIMIT = 10 * 1024 * 1024
_TURN_TIMEOUT = 7200.0


def _resolve_binary() -> str:
    found = shutil.which(_GEMINI_BIN)
    if found:
        return found
    raise FileNotFoundError(
        "gemini CLI not found. Install it: npm i -g @google/gemini-cli"
    )


async def _drain_stderr(stream: asyncio.StreamReader) -> None:
    try:
        while True:
            line = await stream.readline()
            if not line:
                break
    except Exception:
        pass


_APPROVAL_MAP = {
    "normal": "default",
    "trust_reads": "auto_edit",
    "trust": "yolo",
    "yolo": "yolo",
}


class GeminiProvider(LLMProvider):
    """One-shot Gemini CLI runner with stream-json output."""

    name = "gemini"

    def __init__(
        self,
        model: str | None = None,
        work_dir: str | Path | None = None,
        env_extra: dict[str, str] | None = None,
        system_prompt: str | None = None,
        history_messages: list[dict] | None = None,
        approval_mode: str = "normal",
    ) -> None:
        self._binary: str | None = None  # resolved lazily in start()
        self._model = model or ""
        self._work_dir = Path(work_dir) if work_dir else Path.home()
        self._env_extra = env_extra or {}
        self._system_prompt = (system_prompt or "").strip()
        self._history: list[dict] = history_messages or []
        self._approval_mode = approval_mode
        self._process: asyncio.subprocess.Process | None = None

    async def start(self) -> None:
        self._binary = _resolve_binary()
        if self._work_dir != Path.home():
            self._work_dir.mkdir(parents=True, exist_ok=True)
        log.info("gemini provider ready", model=self._model or "default")

    async def shutdown(self) -> None:
        if self._process and self._process.returncode is None:
            try:
                self._process.kill()
                await self._process.wait()
            except Exception:
                pass

    def is_alive(self) -> bool:
        return True

    async def cancel(self) -> None:
        if self._process and self._process.returncode is None:
            try:
                self._process.terminate()
            except Exception:
                pass

    @property
    def pid(self) -> int | None:
        return self._process.pid if self._process else None

    @property
    def current_model(self) -> str | None:
        return self._model or None

    def stream(self, message: str) -> AsyncIterator[LLMEvent]:
        return self._run(message)

    def _format_history(self, *, max_messages: int = 6, max_chars: int = 4000) -> str:
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
            line = f"{role}: {text}"
            if used + len(line) + 1 > max_chars:
                break
            lines.append(line)
            used += len(line) + 1
        return "\n".join(lines)

    async def _run(self, message: str) -> AsyncIterator[LLMEvent]:  # type: ignore[return]
        if not self._binary:
            raise RuntimeError("GeminiProvider.start() was not called")

        approval = _APPROVAL_MAP.get(self._approval_mode, "default")
        # No -p arg → gemini reads the prompt from stdin. Avoids the Windows
        # ARG_MAX truncation that bites long prompts when passed via argv.
        argv = [
            self._binary,
            "--output-format", "stream-json",
            "--approval-mode", approval,
            "--skip-trust",
        ]
        if self._model:
            argv += ["-m", self._model]

        # Build the prompt: system + recent transcript + current message.
        parts: list[str] = []
        if self._system_prompt:
            parts.append(f"<system>\n{self._system_prompt}\n</system>")
        transcript = self._format_history()
        if transcript:
            parts.append(f"<recent-context>\n{transcript}\n</recent-context>")
        parts.append(message)
        prompt = "\n\n".join(parts)

        env = {**os.environ, **self._env_extra}
        process = await asyncio.create_subprocess_exec(
            *argv,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            limit=_STDOUT_LIMIT,
            env=env,
            cwd=str(self._work_dir),
        )
        if process.stdin:
            try:
                process.stdin.write(prompt.encode("utf-8"))
                await process.stdin.drain()
                process.stdin.close()
            except Exception:
                pass
        self._process = process

        assert process.stderr
        asyncio.ensure_future(_drain_stderr(process.stderr))

        deadline = asyncio.get_event_loop().time() + _TURN_TIMEOUT
        assert process.stdout
        try:
            while asyncio.get_event_loop().time() < deadline:
                try:
                    line = await asyncio.wait_for(process.stdout.readline(), timeout=60.0)
                except asyncio.TimeoutError:
                    if process.returncode is not None:
                        break
                    continue
                if not line:
                    break
                line = line.strip()
                if not line:
                    continue

                try:
                    event = json.loads(line)
                except json.JSONDecodeError:
                    text = line.decode(errors="replace")
                    if text:
                        yield LLMEvent(kind="text_chunk", text=text + "\n")
                    continue

                # Gemini stream-json has roughly the same shape as Claude Code's
                # stream-json: events with a "type" and optional "message".
                etype = event.get("type", "")
                if etype in ("message", "assistant", "agent_message"):
                    msg = event.get("message") or event.get("content") or ""
                    if isinstance(msg, str) and msg:
                        yield LLMEvent(kind="text_chunk", text=msg)
                    elif isinstance(msg, list):
                        for block in msg:
                            if isinstance(block, dict) and block.get("type") == "text":
                                t = block.get("text", "")
                                if t:
                                    yield LLMEvent(kind="text_chunk", text=t)
                elif etype == "content" and event.get("delta"):
                    delta = event["delta"]
                    if isinstance(delta, str):
                        yield LLMEvent(kind="text_chunk", text=delta)
                elif etype == "tool_call":
                    name = event.get("name", "") or event.get("tool", "")
                    inp = event.get("input") or event.get("args") or {}
                    yield LLMEvent(
                        kind="tool_call",
                        text=name,
                        tool_input=inp if isinstance(inp, dict) else {"raw": str(inp)},
                        request_id=str(event.get("id", "")),
                    )
                elif etype == "error":
                    emsg = event.get("message", "") or event.get("error", "") or str(event)
                    if emsg:
                        yield LLMEvent(kind="text_chunk", text=f"[gemini error] {emsg}\n")
        finally:
            if process.returncode is None:
                process.kill()
            await process.wait()
            self._process = None

        yield LLMEvent(kind="complete", stop_reason="end_turn")

    async def approve_tool(self, request_id: str | int) -> None:
        pass  # gemini handles approval via its own --approval-mode flag

    async def reject_tool(self, request_id: str | int) -> None:
        pass

    def context_usage_pct(self) -> float:
        return 0.0
