"""CodexProvider — LLMProvider backed by the OpenAI Codex CLI."""

from __future__ import annotations

import asyncio
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


def _resolve_binary() -> str:
    found = shutil.which(_CODEX_BIN)
    if found:
        return found
    raise FileNotFoundError(
        "codex CLI not found. Install it: npm i -g @openai/codex"
    )


class CodexProvider(LLMProvider):
    """LLMProvider backed by the OpenAI Codex CLI.

    Spawns a fresh process per turn using --approval-mode full-auto.
    Tools are executed autonomously by the CLI; stdout is streamed as text.
    """

    name = "codex"

    def __init__(
        self,
        model: str | None = None,
        work_dir: str | Path | None = None,
        env_extra: dict[str, str] | None = None,
    ) -> None:
        self._binary: str | None = None  # resolved lazily in start()
        self._model = model or ""
        self._work_dir = Path(work_dir) if work_dir else Path.home()
        self._env_extra = env_extra or {}
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
        argv = [self._binary, "--full-auto", "-q"]
        if self._model and not self._model.startswith("claude-"):
            argv += ["--model", self._model]
        argv.append(message)

        env = {**os.environ, **self._env_extra}
        process = await asyncio.create_subprocess_exec(
            *argv,
            stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=str(self._work_dir),
            limit=_STDOUT_LIMIT,
            env=env,
        )
        self._process = process

        deadline = asyncio.get_event_loop().time() + _TURN_TIMEOUT
        assert process.stdout
        try:
            while asyncio.get_event_loop().time() < deadline:
                try:
                    raw = await asyncio.wait_for(process.stdout.read(512), timeout=60.0)
                except asyncio.TimeoutError:
                    if process.returncode is not None:
                        break
                    continue
                if not raw:
                    break
                text = raw.decode(errors="replace")
                if text:
                    yield LLMEvent(kind="text_chunk", text=text)
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
