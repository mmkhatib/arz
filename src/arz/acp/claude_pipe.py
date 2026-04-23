"""Claude Code CLI transport — stream-json over subprocess stdio.

Uses `claude --print --output-format stream-json` to drive the Claude Code
CLI non-interactively. This is the recommended scriptable interface for the
Claude Code CLI.

Event mapping from stream-json → AcpEvent:
    {"type":"assistant", "message":{"content":[{"type":"text","text":"..."}]}} → TEXT_CHUNK
    {"type":"result", "subtype":"success"} → COMPLETE
    {"type":"result", "subtype":"error"} → COMPLETE (with stop_reason="error")
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import shutil
from collections.abc import AsyncIterator
from pathlib import Path

from arz.acp.types import AcpEvent, EVENT_COMPLETE, EVENT_TEXT_CHUNK, EVENT_TOOL_CALL, EVENT_TOOL_RESULT

logger = logging.getLogger(__name__)

_STDOUT_LIMIT = 10 * 1024 * 1024
_PROMPT_TIMEOUT = 7200.0

CLAUDE_BIN = "claude"


class ClaudePipeClient:
    """Non-interactive Claude Code CLI client via --output-format stream-json.

    Each call to stream_events() spawns a fresh subprocess. This sidesteps
    session management complexity for Phase 1; persistent sessions land in Phase 2.
    """

    def __init__(
        self,
        binary: str = CLAUDE_BIN,
        model: str | None = None,
        work_dir: str | Path | None = None,
        env_extra: dict[str, str] | None = None,
        extra_args: list[str] | None = None,
    ) -> None:
        self._binary = binary
        self._model = model
        self._work_dir = Path(work_dir) if work_dir else Path.home() / ".arz" / "workspace"
        self._env_extra = env_extra or {}
        self._extra_args = extra_args or []
        self._current_process: asyncio.subprocess.Process | None = None

    async def start(self) -> None:
        self._work_dir.mkdir(parents=True, exist_ok=True)

    async def shutdown(self) -> None:
        if self._current_process and self._current_process.returncode is None:
            try:
                self._current_process.kill()
                await self._current_process.wait()
            except Exception:
                pass

    async def stream_events(self, message: str) -> AsyncIterator[AcpEvent]:
        """Spawn claude CLI and stream events for one message exchange."""
        resolved = shutil.which(self._binary) or self._binary
        argv: list[str] = [
            resolved,
            "--print",
            "--output-format", "stream-json",
            "--verbose",
            "--include-partial-messages",
        ]
        if self._model:
            argv += ["--model", self._model]
        argv += self._extra_args
        argv += [message]

        env = {**os.environ, **self._env_extra}
        self._work_dir.mkdir(parents=True, exist_ok=True)

        process = await asyncio.create_subprocess_exec(
            *argv,
            stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=str(self._work_dir),
            limit=_STDOUT_LIMIT,
            env=env,
        )
        self._current_process = process

        try:
            async for event in self._read_stream(process):
                yield event
        finally:
            if process.returncode is None:
                process.kill()
                await process.wait()
            self._current_process = None

    async def _read_stream(self, process: asyncio.subprocess.Process) -> AsyncIterator[AcpEvent]:
        assert process.stdout
        deadline = asyncio.get_event_loop().time() + _PROMPT_TIMEOUT

        while asyncio.get_event_loop().time() < deadline:
            try:
                raw = await asyncio.wait_for(process.stdout.readline(), timeout=60.0)
            except asyncio.TimeoutError:
                if process.returncode is not None:
                    break
                continue
            if not raw:
                break
            try:
                obj = json.loads(raw.decode(errors="replace"))
            except json.JSONDecodeError:
                continue

            async for event in self._parse_event(obj):
                yield event

            if obj.get("type") == "result":
                return

        yield AcpEvent(kind=EVENT_COMPLETE, stop_reason="end_turn")

    async def _parse_event(self, obj: dict) -> AsyncIterator[AcpEvent]:  # type: ignore[type-arg]
        """Map one stream-json object to zero or more AcpEvents."""
        event_type = obj.get("type")

        if event_type == "assistant":
            message = obj.get("message", {})
            for block in message.get("content", []):
                block_type = block.get("type")
                if block_type == "text":
                    text = block.get("text", "")
                    if text:
                        yield AcpEvent(kind=EVENT_TEXT_CHUNK, text=text)
                elif block_type == "tool_use":
                    yield AcpEvent(
                        kind=EVENT_TOOL_CALL,
                        tool_call_id=block.get("id", ""),
                        title=block.get("name", ""),
                        tool_input=json.dumps(block.get("input", {})),
                    )
            return

        if event_type == "tool_result":
            content = obj.get("content", "")
            yield AcpEvent(
                kind=EVENT_TOOL_RESULT,
                tool_output=content if isinstance(content, str) else json.dumps(content),
            )
            return

        if event_type == "result":
            stop_reason = "error" if obj.get("is_error") else "end_turn"
            yield AcpEvent(kind=EVENT_COMPLETE, stop_reason=stop_reason)
            return
