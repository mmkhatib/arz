"""CodexProvider — LLMProvider backed by the OpenAI Codex CLI."""

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

_CODEX_BIN = "codex"
_STDOUT_LIMIT = 10 * 1024 * 1024
_TURN_TIMEOUT = 7200.0

# item.type values inside item.completed events that carry assistant text
_TEXT_ITEM_TYPES = {"agent_message", "assistant_message", "message"}


def _resolve_binary() -> str:
    found = shutil.which(_CODEX_BIN)
    if found:
        return found
    raise FileNotFoundError(
        "codex CLI not found. Install it: npm i -g @openai/codex"
    )


async def _drain_stderr(stream: asyncio.StreamReader) -> None:
    """Consume stderr so the pipe buffer never blocks the child process."""
    try:
        while True:
            line = await stream.readline()
            if not line:
                break
    except Exception:
        pass


class CodexProvider(LLMProvider):
    """LLMProvider backed by the OpenAI Codex CLI (`codex exec`).

    Spawns a fresh process per turn in --full-auto mode with --json output.
    Parses JSONL events from stdout; tool execution is handled by the CLI.
    """

    name = "codex"

    def __init__(
        self,
        model: str | None = None,
        work_dir: str | Path | None = None,
        env_extra: dict[str, str] | None = None,
        system_prompt: str | None = None,
    ) -> None:
        self._binary: str | None = None  # resolved lazily in start()
        self._model = model or ""
        self._work_dir = Path(work_dir) if work_dir else Path.home()
        self._env_extra = env_extra or {}
        self._system_prompt = (system_prompt or "").strip()
        self._process: asyncio.subprocess.Process | None = None

    async def start(self) -> None:
        self._binary = _resolve_binary()  # raises FileNotFoundError if not installed
        if self._work_dir != Path.home():
            self._work_dir.mkdir(parents=True, exist_ok=True)
        log.info("codex provider ready", model=self._model or "default")

    async def shutdown(self) -> None:
        if self._process and self._process.returncode is None:
            try:
                self._process.kill()
                await self._process.wait()
            except Exception:
                pass

    def is_alive(self) -> bool:
        return True

    def stream(self, message: str) -> AsyncIterator[LLMEvent]:
        return self._run(message)

    async def _run(self, message: str) -> AsyncIterator[LLMEvent]:  # type: ignore[return]
        if not self._binary:
            raise RuntimeError("CodexProvider.start() was not called")

        argv = [
            self._binary, "exec",
            "--full-auto",
            "--json",
            "--color", "never",
            "--skip-git-repo-check",
            "-C", str(self._work_dir),
        ]
        if self._model and not self._model.startswith("claude-"):
            argv += ["-m", self._model]
        # Codex has no native system-prompt flag, so prepend it as a wrapper.
        # The runtime treats `<system>…</system>` as instructions; modern
        # frontier models honor this.
        prompt = (
            f"<system>\n{self._system_prompt}\n</system>\n\n{message}"
            if self._system_prompt
            else message
        )
        argv.append(prompt)

        env = {**os.environ, **self._env_extra}
        process = await asyncio.create_subprocess_exec(
            *argv,
            stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            limit=_STDOUT_LIMIT,
            env=env,
        )
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

                etype = event.get("type", "")

                if etype == "item.completed":
                    item = event.get("item") or {}
                    if isinstance(item, dict) and item.get("type") in _TEXT_ITEM_TYPES:
                        text = item.get("text", "")
                        if text:
                            yield LLMEvent(kind="text_chunk", text=text)
                elif etype == "error":
                    emsg = event.get("message", "") or event.get("msg", "")
                    if emsg:
                        yield LLMEvent(kind="text_chunk", text=f"[codex error] {emsg}\n")

        finally:
            if process.returncode is None:
                process.kill()
            await process.wait()
            self._process = None

        yield LLMEvent(kind="complete", stop_reason="end_turn")

    async def approve_tool(self, request_id: str | int) -> None:
        pass  # codex runs autonomously

    async def reject_tool(self, request_id: str | int) -> None:
        pass

    def context_usage_pct(self) -> float:
        return 0.0

    @property
    def current_model(self) -> str | None:
        return self._model or None
