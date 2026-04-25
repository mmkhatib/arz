"""Persistent Claude Code CLI client via --input-format stream-json.

Spawns ONE long-lived `claude` process per session (like MeshClaw's AcpClient
does with kiro-cli acp). Messages are written as JSON lines to stdin; responses
are read as stream-json events from stdout. The process stays alive between
turns, so startup overhead is paid once per session rather than once per message.

Protocol:
  stdin  ← {"type":"system","content":[{"type":"text","text":"..."}]}  (once)
  stdin  ← {"type":"user","message":{"role":"user","content":[...]}}   (each turn)
  stdout → {"type":"assistant","message":{...}}                         (streaming chunks)
  stdout → {"type":"result",...}                                        (turn complete)
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import shutil
import signal
from collections.abc import AsyncIterator
from pathlib import Path

from arz.acp.types import AcpEvent, EVENT_COMPLETE, EVENT_TEXT_CHUNK

logger = logging.getLogger(__name__)

_STDOUT_LIMIT = 10 * 1024 * 1024
_READ_TIMEOUT = 20.0
_STARTUP_DRAIN = 8.0    # seconds to drain startup hook events
_TURN_TIMEOUT = 7200.0  # 2 hours per turn


class ClaudeInteractiveClient:
    """Persistent claude CLI process using --input-format stream-json."""

    def __init__(
        self,
        binary: str = "claude",
        model: str | None = None,
        work_dir: str | Path | None = None,
        system_prompt: str | None = None,
        env_extra: dict[str, str] | None = None,
    ) -> None:
        self._binary = shutil.which(binary) or binary
        self._model = model
        self._work_dir = Path(work_dir) if work_dir else Path.home() / ".arz" / "workspace"
        self._system_prompt = system_prompt
        self._env_extra = env_extra or {}
        self._process: asyncio.subprocess.Process | None = None

    # ── Lifecycle ────────────────────────────────────────────────────────────

    async def start(self) -> None:
        self._work_dir.mkdir(parents=True, exist_ok=True)

        argv = [
            self._binary,
            "--print",
            "--output-format", "stream-json",
            "--verbose",
            "--include-partial-messages",
            "--input-format", "stream-json",
        ]
        if self._model:
            argv += ["--model", self._model]

        # Use an isolated config dir so ~/.claude/CLAUDE.md (PAI) is not loaded.
        # Auth remains in the macOS keychain so no credentials file needed.
        arz_config_dir = Path.home() / ".arz" / "claude-config"
        arz_config_dir.mkdir(parents=True, exist_ok=True)
        settings_file = arz_config_dir / "settings.json"
        if not settings_file.exists():
            settings_file.write_text('{"hooks":{}}')

        env = {**os.environ, "CLAUDE_CONFIG_DIR": str(arz_config_dir), **self._env_extra}
        self._process = await asyncio.create_subprocess_exec(
            *argv,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=str(self._work_dir),
            limit=_STDOUT_LIMIT,
            env=env,
            start_new_session=True,
        )
        logger.info("Claude interactive process started (PID %d)", self._process.pid)

        # Drain startup hook events before we're ready to use the process
        await self._drain_startup()

        # Inject system prompt as the first event
        if self._system_prompt:
            await self._write_json({
                "type": "system",
                "content": [{"type": "text", "text": self._system_prompt}],
            })

    async def shutdown(self) -> None:
        if not self._process:
            return
        p = self._process
        self._process = None
        if p.returncode is not None:
            return
        try:
            os.killpg(os.getpgid(p.pid), signal.SIGTERM)
            await asyncio.wait_for(p.wait(), timeout=3.0)
        except Exception:
            try:
                p.kill()
                await asyncio.wait_for(p.wait(), timeout=1.0)
            except Exception:
                pass

    def is_alive(self) -> bool:
        return self._process is not None and self._process.returncode is None

    # ── Streaming ────────────────────────────────────────────────────────────

    async def stream_events(self, message: str) -> AsyncIterator[AcpEvent]:
        if not self.is_alive():
            raise RuntimeError("Claude interactive process is not running")

        await self._write_json({
            "type": "user",
            "message": {
                "role": "user",
                "content": [{"type": "text", "text": message}],
            },
        })

        deadline = asyncio.get_event_loop().time() + _TURN_TIMEOUT
        assert self._process and self._process.stdout

        while asyncio.get_event_loop().time() < deadline:
            try:
                raw = await asyncio.wait_for(
                    self._process.stdout.readline(), timeout=_READ_TIMEOUT
                )
            except asyncio.TimeoutError:
                if not self.is_alive():
                    break
                continue

            if not raw:
                break

            try:
                obj = json.loads(raw.decode(errors="replace"))
            except json.JSONDecodeError:
                continue

            event_type = obj.get("type", "")

            if event_type == "assistant":
                for block in obj.get("message", {}).get("content", []):
                    if block.get("type") == "text" and block.get("text"):
                        yield AcpEvent(kind=EVENT_TEXT_CHUNK, text=block["text"])

            elif event_type == "result":
                stop = "error" if obj.get("is_error") else "end_turn"
                yield AcpEvent(kind=EVENT_COMPLETE, stop_reason=stop)
                return

        yield AcpEvent(kind=EVENT_COMPLETE, stop_reason="end_turn")

    # ── Private ──────────────────────────────────────────────────────────────

    async def _write_json(self, obj: dict) -> None:
        assert self._process and self._process.stdin
        line = json.dumps(obj) + "\n"
        self._process.stdin.write(line.encode())
        await self._process.stdin.drain()

    async def _drain_startup(self) -> None:
        """Read and discard startup hook events until stdout goes quiet."""
        assert self._process and self._process.stdout
        deadline = asyncio.get_event_loop().time() + _STARTUP_DRAIN
        while asyncio.get_event_loop().time() < deadline:
            try:
                raw = await asyncio.wait_for(
                    self._process.stdout.readline(), timeout=0.5
                )
                if not raw:
                    break
            except asyncio.TimeoutError:
                break  # quiet — startup complete
