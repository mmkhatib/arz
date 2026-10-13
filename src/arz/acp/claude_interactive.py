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

from arz.acp.types import (
    EVENT_COMPLETE,
    EVENT_PERMISSION_REQUEST,
    EVENT_TEXT_CHUNK,
    EVENT_TOOL_CALL,
    EVENT_TOOL_RESULT,
    AcpEvent,
)

logger = logging.getLogger(__name__)

_CLAUDE_PROJECTS_DIR = Path.home() / ".claude" / "projects"
_STDOUT_LIMIT = 10 * 1024 * 1024
_READ_TIMEOUT = 20.0
_STARTUP_DRAIN = 8.0  # seconds to drain startup hook events
_TURN_TIMEOUT = 7200.0  # 2 hours per turn
_HISTORY_MAX_MSGS = 50
_HISTORY_MAX_CHARS = 8000


def _claude_session_file_exists(session_id: str) -> bool:
    """Check if a Claude Code session JSONL exists under ~/.claude/projects/."""
    if not _CLAUDE_PROJECTS_DIR.exists():
        return False
    for project_dir in _CLAUDE_PROJECTS_DIR.iterdir():
        if project_dir.is_dir() and (project_dir / f"{session_id}.jsonl").exists():
            return True
    return False


class ClaudeInteractiveClient:
    """Persistent claude CLI process using --input-format stream-json."""

    def __init__(
        self,
        binary: str = "claude",
        model: str | None = None,
        work_dir: str | Path | None = None,
        system_prompt: str | None = None,
        history_messages: list[dict] | None = None,
        env_extra: dict[str, str] | None = None,
        permission_mode: str | None = None,
    ) -> None:
        self._binary = shutil.which(binary) or binary
        self._model = model
        self._work_dir = Path(work_dir) if work_dir else Path.home() / ".arz" / "workspace"
        self._system_prompt = system_prompt
        self._history_messages = history_messages or []
        self._env_extra = env_extra or {}
        self._permission_mode = permission_mode
        self._process: asyncio.subprocess.Process | None = None
        self._session_id: str | None = None
        self._resume_session_id: str | None = None
        self._resumed: bool = False

    # ── Session resume ────────────────────────────────────────────────────────

    def set_resume_session_id(self, sid: str) -> None:
        """Set a Claude Code session ID to restore via --resume on next start()."""
        self._resume_session_id = sid

    @property
    def session_id(self) -> str | None:
        return self._session_id

    @property
    def resumed(self) -> bool:
        return self._resumed

    # ── Lifecycle ────────────────────────────────────────────────────────────

    async def start(self) -> None:
        self._work_dir.mkdir(parents=True, exist_ok=True)

        resume_sid = self._resume_session_id
        self._resume_session_id = None  # consume — no retry loop
        self._resumed = False

        argv = [
            self._binary,
            "--print",
            "--output-format",
            "stream-json",
            "--verbose",
            "--include-partial-messages",
            "--input-format",
            "stream-json",
        ]
        if self._system_prompt:
            # The steering prompt has to ride the CLI flag. A `{type:
            # "system"}` frame on stdin is silently dropped — stream-json
            # input takes user messages only — so for a long time base.md
            # never reached the model at all: it could not answer questions
            # about its own instructions, and ignored anything they asked
            # for. Append rather than replace, so Claude Code keeps its own
            # tool guidance underneath ours.
            argv += ["--append-system-prompt", self._system_prompt]
        if self._model:
            argv += ["--model", self._model]
        if getattr(self, "_permission_mode", None):
            argv += ["--permission-mode", self._permission_mode]
        if resume_sid and _claude_session_file_exists(resume_sid):
            argv += ["--resume", resume_sid]
            logger.info("Attempting Claude Code session resume: %s", resume_sid)

        env = {**os.environ, **self._env_extra}
        # start_new_session is POSIX-only. On Windows use
        # CREATE_NEW_PROCESS_GROUP via creationflags.
        spawn_kwargs: dict = {
            "stdin": asyncio.subprocess.PIPE,
            "stdout": asyncio.subprocess.PIPE,
            "stderr": asyncio.subprocess.PIPE,
            "cwd": str(self._work_dir),
            "limit": _STDOUT_LIMIT,
            "env": env,
        }
        if hasattr(os, "setsid"):
            spawn_kwargs["start_new_session"] = True
        else:
            try:
                import subprocess as _sp

                spawn_kwargs["creationflags"] = _sp.CREATE_NEW_PROCESS_GROUP
            except (ImportError, AttributeError):
                pass
        self._process = await asyncio.create_subprocess_exec(*argv, **spawn_kwargs)
        logger.info("Claude interactive process started (PID %d)", self._process.pid)

        await self._drain_startup()
        # If --resume was passed and the emitted session_id matches, we're resumed
        if resume_sid and self._session_id == resume_sid:
            self._resumed = True
            logger.info("Claude Code session resumed: %s", resume_sid)
        if not self._resumed:
            await self._inject_system_context()

    async def shutdown(self) -> None:
        if not self._process:
            return
        p = self._process
        self._process = None
        if p.returncode is not None:
            return
        is_posix = hasattr(os, "killpg") and hasattr(os, "getpgid")
        try:
            if is_posix:
                try:
                    os.killpg(os.getpgid(p.pid), signal.SIGTERM)
                except (ProcessLookupError, OSError):
                    p.terminate()
            else:
                p.terminate()
            await asyncio.wait_for(p.wait(), timeout=3.0)
        except Exception:
            try:
                p.kill()
                await asyncio.wait_for(p.wait(), timeout=1.0)
            except Exception:
                pass

    def is_alive(self) -> bool:
        return self._process is not None and self._process.returncode is None

    # ── Streaming ─────────────��──────────────────────────────���───────────────

    async def stream_events(self, message: str) -> AsyncIterator[AcpEvent]:
        """Run one turn, transparently absorbing any steer injected into it."""
        self._turn_active = True
        self._steer_pending = 0
        try:
            async for event in self._stream_events_inner(message):
                yield event
        finally:
            self._turn_active = False
            self._steer_pending = 0

    async def _stream_events_inner(self, message: str) -> AsyncIterator[AcpEvent]:
        if not self.is_alive():
            raise RuntimeError("Claude interactive process is not running")

        await self._write_json(
            {
                "type": "user",
                "message": {
                    "role": "user",
                    "content": [{"type": "text", "text": message}],
                },
            }
        )

        deadline = asyncio.get_event_loop().time() + _TURN_TIMEOUT
        if not (self._process and self._process.stdout):
            return  # nothing to read from — caller will see no events

        while asyncio.get_event_loop().time() < deadline:
            # Re-check each iteration: another task can call shutdown() and
            # null out self._process while we're streaming (e.g. user switches
            # agent or approval mode mid-turn, which evicts the pool entry).
            proc = self._process
            if proc is None or proc.stdout is None:
                logger.info("claude-code stream aborted — process gone (likely pool deactivation)")
                return
            try:
                raw = await asyncio.wait_for(proc.stdout.readline(), timeout=_READ_TIMEOUT)
            except TimeoutError:
                if not self.is_alive():
                    break
                continue
            except (BrokenPipeError, ConnectionResetError, AttributeError):
                logger.info("claude-code stream aborted — read failed mid-turn")
                return

            if not raw:
                break

            try:
                obj = json.loads(raw.decode(errors="replace"))
            except json.JSONDecodeError:
                continue

            # Capture session_id from any event that carries it
            if not self._session_id:
                sid = obj.get("session_id")
                if sid:
                    self._session_id = sid

            event_type = obj.get("type", "")

            if event_type == "assistant":
                for block in obj.get("message", {}).get("content", []):
                    btype = block.get("type")
                    if btype == "text" and block.get("text"):
                        yield AcpEvent(kind=EVENT_TEXT_CHUNK, text=block["text"])
                    elif btype == "tool_use":
                        yield AcpEvent(
                            kind=EVENT_TOOL_CALL,
                            text=block.get("name", ""),
                            tool_call_id=block.get("id", ""),
                            tool_input=json.dumps(block.get("input", {})),
                        )

            elif event_type == "user":
                for block in obj.get("message", {}).get("content", []):
                    if block.get("type") == "tool_result":
                        raw_content = block.get("content", "")
                        if isinstance(raw_content, list):
                            parts = [
                                b.get("text", "") for b in raw_content if b.get("type") == "text"
                            ]
                            content = "\n".join(parts)
                        else:
                            content = str(raw_content)
                        yield AcpEvent(
                            kind=EVENT_TOOL_RESULT,
                            tool_call_id=block.get("tool_use_id", ""),
                            tool_output=content,
                        )

            elif event_type == "result":
                if self._steer_pending > 0:
                    # A steer went in during this turn. The CLI finishes the
                    # work it was already doing, closes it with this result,
                    # then answers the steer as a SEPARATE result on the same
                    # stdout. Both belong to this turn — returning here would
                    # leave the steered reply in the pipe for the next turn to
                    # read, answering the wrong question.
                    self._steer_pending -= 1
                    continue
                stop = "error" if obj.get("is_error") else "end_turn"
                from arz.acp.types import Usage

                usage = Usage.from_dict(obj.get("usage"))
                input_tokens = usage.input_tokens if usage else 0
                context_pct = round(min(input_tokens / 200_000 * 100, 100.0), 1)
                yield AcpEvent(
                    kind=EVENT_COMPLETE,
                    stop_reason=stop,
                    context_usage_pct=context_pct,
                    usage=usage,
                )
                return

            elif event_type in ("system", "permission_request"):
                subtype = obj.get("subtype", "")
                if (
                    subtype in ("permission_request", "permission")
                    or event_type == "permission_request"
                ):
                    yield AcpEvent(
                        kind=EVENT_PERMISSION_REQUEST,
                        title=obj.get("tool", obj.get("title", "")),
                        tool_input=json.dumps(obj.get("input", obj.get("params", {}))),
                        request_id=str(obj.get("id", obj.get("request_id", ""))),
                    )

        yield AcpEvent(kind=EVENT_COMPLETE, stop_reason="end_turn")

    async def approve_tool(self, request_id: str) -> None:
        """Send approval for a permission request back to the claude process."""
        if self.is_alive():
            await self._write_json(
                {
                    "type": "user",
                    "message": {
                        "role": "user",
                        "content": [{"type": "text", "text": "[Tool approved]"}],
                    },
                }
            )

    async def reject_tool(self, request_id: str) -> None:
        """Send rejection for a permission request back to the claude process."""
        if self.is_alive():
            await self._write_json(
                {
                    "type": "user",
                    "message": {
                        "role": "user",
                        "content": [{"type": "text", "text": "[Tool rejected by user]"}],
                    },
                }
            )

    async def steer(self, message: str) -> bool:
        """Inject a mid-turn steer into the running turn.

        The CLI runs with ``--input-format stream-json`` and keeps reading
        stdin while it works, so an extra user frame written now is picked up
        at the next safe point of the turn instead of starting a new one. The
        text is wrapped so the model can tell a steer apart from a tool reply
        arriving on the same channel.

        Fire-and-forget: the steered reply streams back inside the SAME
        in-flight turn, so there is nothing to await. Returns False when the
        process is gone — the caller then falls back to the send queue.
        """
        text = (message or "").strip()
        if not text or not self.is_alive() or not self._turn_active:
            return False
        wrapped = f"<user_message>\n{text}\n</user_message>"
        try:
            await self._write_json(
                {
                    "type": "user",
                    "message": {
                        "role": "user",
                        "content": [{"type": "text", "text": wrapped}],
                    },
                }
            )
        except (BrokenPipeError, ConnectionResetError, AssertionError, AttributeError):
            logger.info("steer write failed — claude process gone")
            return False
        # Counted AFTER the successful write so a failed write never leaves
        # the reader waiting for a result that will not come.
        self._steer_pending += 1
        return True

    @property
    def supports_steer(self) -> bool:
        """True while the persistent stdin process is up to take the write."""
        return self.is_alive()

    # Set for the duration of a turn. A steer outside one has nothing to be
    # picked up by, and its reply would land in whichever turn reads next.
    _turn_active: bool = False
    # Extra `result` frames this turn still owes, one per accepted steer.
    _steer_pending: int = 0

    # ── Private ───���──────────────────────────────────────────────────────────

    async def _write_json(self, obj: dict) -> None:
        assert self._process and self._process.stdin
        line = json.dumps(obj) + "\n"
        self._process.stdin.write(line.encode())
        await self._process.stdin.drain()

    async def _drain_startup(self) -> None:
        """Read startup hook events until stdout goes quiet; capture session_id."""
        assert self._process and self._process.stdout
        deadline = asyncio.get_event_loop().time() + _STARTUP_DRAIN
        while asyncio.get_event_loop().time() < deadline:
            try:
                raw = await asyncio.wait_for(self._process.stdout.readline(), timeout=0.5)
                if not raw:
                    break
                if not self._session_id:
                    try:
                        obj = json.loads(raw)
                        sid = obj.get("session_id")
                        if sid:
                            self._session_id = sid
                    except (json.JSONDecodeError, AttributeError):
                        pass
            except TimeoutError:
                break  # quiet — startup complete

    async def _inject_system_context(self) -> None:
        """Rehydrate a fresh claude-code process with our prior turns.

        The steering prompt itself goes in on the command line
        (``--append-system-prompt``, see ``start()``); this replays history:

        Each prior conversation turn is replayed as a native
        ``{type: "user"}`` / ``{type: "assistant"}`` message. Previously we
        bundled history into ONE ``type: system`` text blob with
        ``<USER>...</USER>`` tags, and Claude read it as "instructions
        describing turns" rather than as its own conversation history:
        after a gateway restart the model would claim "this is the first
        exchange between us" even though we had injected all prior content.
        Sending each turn natively makes Claude carry the prior code it
        wrote, prior tool results, etc., as genuine memory.
        """
        if not self._history_messages:
            return

        recent = self._history_messages[-_HISTORY_MAX_MSGS:]
        for m in recent:
            role = (m.get("role") or "user").lower()
            text = m.get("text") or ""
            if not text.strip():
                continue
            if len(text) > _HISTORY_MAX_CHARS:
                text = text[:_HISTORY_MAX_CHARS] + "…"
            # Map every non-user role onto "assistant" so we don't ship
            # a sneaky third role (system / tool) that the protocol may
            # reject. Tool outputs surface inside assistant messages
            # anyway in claude-code's stream.
            if role == "user":
                await self._write_json(
                    {
                        "type": "user",
                        "message": {
                            "role": "user",
                            "content": [{"type": "text", "text": text}],
                        },
                    }
                )
            else:
                await self._write_json(
                    {
                        "type": "assistant",
                        "message": {
                            "role": "assistant",
                            "content": [{"type": "text", "text": text}],
                        },
                    }
                )
