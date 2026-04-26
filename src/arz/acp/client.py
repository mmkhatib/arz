"""ACP client — JSON-RPC 2.0 over stdio.

Spawns a subprocess (kiro-cli or compatible binary) and communicates via
newline-delimited JSON on stdin/stdout.

Protocol handshake:
    initialize → session/new → session/set_model → [ready]

Per-turn:
    session/prompt → session/update* → session/prompt response (= complete)

Permission flow:
    ← session/request_permission (server REQUEST, has an id)
    → {id: <same>, result: {outcome: {outcome: "selected", optionId: "allow_once"}}}
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import signal
import shutil
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

from arz.acp.types import (
    AcpEvent,
    EVENT_COMPLETE,
    EVENT_PERMISSION_REQUEST,
    EVENT_TEXT_CHUNK,
    EVENT_THINKING_CHUNK,
    EVENT_TOOL_CALL,
    EVENT_TOOL_RESULT,
    JsonRpcMessage,
    JsonRpcRequest,
    METHOD_INITIALIZE,
    METHOD_PROMPT,
    METHOD_REQUEST_PERMISSION,
    METHOD_SESSION_LOAD,
    METHOD_SESSION_NEW,
    METHOD_SESSION_UPDATE,
    METHOD_SET_MODEL,
    OPTION_ALLOW_ONCE,
    OUTCOME_SELECTED,
    PROTOCOL_VERSION,
    UPDATE_AGENT_MESSAGE_CHUNK,
    UPDATE_TOOL_CALL,
)

_KIRO_SESSIONS_DIR = Path.home() / ".kiro" / "sessions" / "cli"

logger = logging.getLogger(__name__)

_STDOUT_LIMIT = 10 * 1024 * 1024  # 10 MB — tool outputs can be large
_INIT_TIMEOUT = 60.0
_PROMPT_TIMEOUT = 7200.0  # 2 hours
_CLIENT_NAME = "arz"
_CLIENT_VERSION = "0.1.0"


class AcpError(Exception):
    """Base ACP error."""


class AcpTimeoutError(AcpError):
    """Prompt or init timed out."""


class AcpProcessDied(AcpError):
    """Subprocess exited unexpectedly."""


class AcpClient:
    """JSON-RPC 2.0 client over subprocess stdio.

    Args:
        binary: Executable name or full path (e.g. "kiro-cli", "/usr/local/bin/kiro-cli").
        subcmd: Subcommand to pass after the binary (e.g. "acp").
        extra_args: Additional CLI arguments.
        work_dir: Working directory for the subprocess.
        model: LLM model identifier forwarded via session/set_model.
        agent: Agent identifier forwarded via --agent flag (if supported).
        env_extra: Extra environment variables merged into the subprocess env.
    """

    def __init__(
        self,
        binary: str,
        subcmd: str | None = None,
        extra_args: list[str] | None = None,
        work_dir: str | Path | None = None,
        model: str = "auto",
        agent: str = _CLIENT_NAME,
        env_extra: dict[str, str] | None = None,
    ) -> None:
        self._binary = binary
        self._subcmd = subcmd
        self._extra_args = extra_args or []
        self._work_dir = Path(work_dir) if work_dir else Path.home() / ".arz" / "workspace"
        self._model = model
        self._agent = agent
        self._env_extra = env_extra or {}

        self._process: asyncio.subprocess.Process | None = None
        self._session_id: str | None = None
        self._resume_session_id: str | None = None
        self._resumed: bool = False
        self._can_load_session: bool = False
        self._next_id = 1
        self._pending_permissions: dict[Any, asyncio.Event] = {}
        self._permission_outcomes: dict[Any, str] = {}
        self._stderr_task: asyncio.Task[None] | None = None

    # ── Public API ────────────────────────────────────────────────────────────

    def set_resume_session_id(self, sid: str) -> None:
        """Set a kiro-cli session ID to restore via session/load on next start()."""
        self._resume_session_id = sid

    @property
    def session_id(self) -> str | None:
        return self._session_id

    @property
    def resumed(self) -> bool:
        return self._resumed

    async def start(self) -> None:
        """Spawn the subprocess and complete the ACP handshake."""
        await self._spawn()
        await self._initialize()

    async def shutdown(self) -> None:
        """Send SIGTERM, then SIGKILL if the process doesn't exit."""
        if self._stderr_task:
            self._stderr_task.cancel()
        if not self._process or self._process.returncode is not None:
            return
        pid = self._process.pid
        for pipe in (self._process.stdin, self._process.stdout, self._process.stderr):
            try:
                if pipe:
                    pipe.close()  # type: ignore[union-attr]
            except Exception:
                pass
        try:
            os.killpg(os.getpgid(pid), signal.SIGTERM)
            await asyncio.wait_for(self._process.wait(), timeout=3.0)
        except (asyncio.TimeoutError, ProcessLookupError, OSError):
            try:
                os.killpg(os.getpgid(pid), signal.SIGKILL)
            except (ProcessLookupError, OSError):
                pass

    async def stream_events(self, message: str) -> AsyncIterator[AcpEvent]:
        """Send a prompt and stream events until completion."""
        if not self._process or self._session_id is None:
            raise AcpError("Client not initialized — call start() first")

        prompt_id = self._next_req_id()
        await self._send(
            JsonRpcRequest(method=METHOD_PROMPT, params={"message": message}, id=prompt_id)
        )

        async for event in self._read_until_complete(prompt_id):
            yield event

    async def approve_tool(self, request_id: str | int) -> None:
        """Approve a pending tool permission request."""
        await self._send_permission_response(
            request_id, outcome=OUTCOME_SELECTED, option=OPTION_ALLOW_ONCE
        )

    async def reject_tool(self, request_id: str | int) -> None:
        """Reject a pending tool permission request."""
        await self._send_raw(
            {"jsonrpc": "2.0", "id": request_id, "result": {"outcome": {"outcome": "cancelled"}}}
        )

    def is_alive(self) -> bool:
        return self._process is not None and self._process.returncode is None

    # ── Process management ────────────────────────────────────────────────────

    async def _spawn(self) -> None:
        resolved = shutil.which(self._binary) or self._binary
        argv: list[str] = [resolved]
        if self._subcmd:
            argv.append(self._subcmd)
        if self._agent:
            argv += ["--agent", self._agent]
        argv += self._extra_args

        env = {**os.environ, **self._env_extra}
        self._work_dir.mkdir(parents=True, exist_ok=True)

        self._process = await asyncio.create_subprocess_exec(
            *argv,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=str(self._work_dir),
            limit=_STDOUT_LIMIT,
            start_new_session=True,
            env=env,
        )
        logger.info("Spawned %s (PID %d)", " ".join(argv), self._process.pid)

        if self._process.stderr:
            self._stderr_task = asyncio.ensure_future(
                self._drain_stderr(self._process.stderr)
            )

    async def _drain_stderr(self, stderr: asyncio.StreamReader) -> None:
        while True:
            line = await stderr.readline()
            if not line:
                break
            logger.debug("ACP stderr: %s", line.decode(errors="replace").strip())

    # ── ACP handshake ─────────────────────────────────────────────────────────

    async def _initialize(self) -> None:
        """ACP handshake: initialize → session/load or session/new → set_model."""
        init_id = self._next_req_id()
        await self._send(JsonRpcRequest(
            method=METHOD_INITIALIZE,
            params={
                "protocolVersion": PROTOCOL_VERSION,
                "clientInfo": {"name": _CLIENT_NAME, "version": _CLIENT_VERSION},
            },
            id=init_id,
        ))
        init_response = await asyncio.wait_for(
            self._read_response(init_id), timeout=_INIT_TIMEOUT
        )
        if init_response.error:
            raise AcpError(f"ACP initialize failed: {init_response.error}")

        capabilities = (init_response.result or {}).get("agentCapabilities", {})
        self._can_load_session = bool(capabilities.get("loadSession", False))

        # Consume resume id — no retry loop
        resume_sid = self._resume_session_id
        self._resume_session_id = None
        self._resumed = False

        # Try session/load if supported and session file exists
        if resume_sid and self._can_load_session:
            session_file = _KIRO_SESSIONS_DIR / f"{resume_sid}.json"
            if session_file.exists():
                try:
                    load_id = self._next_req_id()
                    await self._send(JsonRpcRequest(
                        method=METHOD_SESSION_LOAD,
                        params={
                            "sessionId": resume_sid,
                            "cwd": str(self._work_dir),
                            "mcpServers": [],
                            "_meta": {"_kiro.dev/session_file": str(session_file)},
                        },
                        id=load_id,
                    ))
                    load_resp = await asyncio.wait_for(
                        self._read_response(load_id), timeout=_INIT_TIMEOUT
                    )
                    if "modes" in (load_resp.result or {}):
                        self._session_id = resume_sid
                        self._resumed = True
                        logger.info("kiro-cli session resumed: %s", resume_sid)
                except (AcpError, AcpProcessDied, asyncio.TimeoutError):
                    logger.info("session/load failed for %s — falling back to session/new", resume_sid)
            else:
                logger.info("kiro session file missing for %s — starting fresh", resume_sid)

        # Fall back to new session
        if not self._session_id:
            import uuid
            self._session_id = str(uuid.uuid4())
            new_id = self._next_req_id()
            await self._send(JsonRpcRequest(
                method=METHOD_SESSION_NEW,
                params={"sessionId": self._session_id},
                id=new_id,
            ))
            await self._drain_briefly(0.5)
            logger.info("kiro-cli session created: %s", self._session_id)

        model_id = self._next_req_id()
        await self._send(JsonRpcRequest(
            method=METHOD_SET_MODEL,
            params={"model": self._model},
            id=model_id,
        ))
        await self._drain_briefly(0.2)
        logger.info("ACP session ready (id=%s model=%s resumed=%s)", self._session_id, self._model, self._resumed)

    # ── I/O helpers ───────────────────────────────────────────────────────────

    async def _send(self, req: JsonRpcRequest) -> None:
        await self._send_raw(req.to_dict())

    async def _send_raw(self, obj: dict[str, Any]) -> None:
        if not self._process or not self._process.stdin:
            raise AcpError("Process not running")
        line = json.dumps(obj, separators=(",", ":")) + "\n"
        self._process.stdin.write(line.encode())
        await self._process.stdin.drain()

    async def _send_permission_response(
        self, request_id: Any, outcome: str, option: str
    ) -> None:
        await self._send_raw({
            "jsonrpc": "2.0",
            "id": request_id,
            "result": {"outcome": {"outcome": outcome, "optionId": option}},
        })

    async def _read_line(self) -> JsonRpcMessage | None:
        """Read one line from stdout and parse it as a JSON-RPC message."""
        if not self._process or not self._process.stdout:
            return None
        try:
            raw = await asyncio.wait_for(self._process.stdout.readline(), timeout=30.0)
        except asyncio.TimeoutError:
            return None
        if not raw:
            return None
        try:
            obj = json.loads(raw.decode(errors="replace"))
        except json.JSONDecodeError:
            logger.debug("Unparseable ACP line: %r", raw[:200])
            return None
        return JsonRpcMessage(
            id=obj.get("id"),
            method=obj.get("method"),
            result=obj.get("result"),
            error=obj.get("error"),
            params=obj.get("params"),
        )

    async def _read_response(self, req_id: int) -> JsonRpcMessage:
        """Read lines until we get the response for req_id."""
        while True:
            msg = await self._read_line()
            if msg is None:
                raise AcpProcessDied("Process closed stdout before response")
            if msg.is_response_for(req_id):
                return msg

    async def _drain_briefly(self, duration: float) -> None:
        """Read and discard lines for `duration` seconds (for fire-and-forget RPCs)."""
        deadline = asyncio.get_event_loop().time() + duration
        while asyncio.get_event_loop().time() < deadline:
            try:
                if not self._process or not self._process.stdout:
                    break
                raw = await asyncio.wait_for(self._process.stdout.readline(), timeout=0.1)
                if not raw:
                    break
            except asyncio.TimeoutError:
                break

    async def _read_until_complete(self, prompt_id: int) -> AsyncIterator[AcpEvent]:
        """Yield events from stdout until the session/prompt response arrives."""
        deadline = asyncio.get_event_loop().time() + _PROMPT_TIMEOUT
        while asyncio.get_event_loop().time() < deadline:
            if not self._process or not self._process.stdout:
                raise AcpProcessDied("Stdout closed mid-stream")

            try:
                raw = await asyncio.wait_for(
                    self._process.stdout.readline(), timeout=60.0
                )
            except asyncio.TimeoutError:
                if not self.is_alive():
                    raise AcpProcessDied("Process exited while waiting for events")
                continue

            if not raw:
                raise AcpProcessDied("Process closed stdout mid-prompt")

            try:
                obj = json.loads(raw.decode(errors="replace"))
            except json.JSONDecodeError:
                continue

            msg = JsonRpcMessage(
                id=obj.get("id"),
                method=obj.get("method"),
                result=obj.get("result"),
                error=obj.get("error"),
                params=obj.get("params"),
            )

            # session/prompt completion response
            if msg.is_response_for(prompt_id):
                yield AcpEvent(kind=EVENT_COMPLETE, stop_reason="end_turn")
                return

            # session/update notifications carry text chunks and tool calls
            if msg.is_notification(METHOD_SESSION_UPDATE):
                async for event in self._process_update(msg):
                    yield event
                continue

            # permission request — it's a REQUEST (has id), needs a reply
            if msg.is_request(METHOD_REQUEST_PERMISSION):
                params = msg.params or {}
                options = params.get("options", [])
                yield AcpEvent(
                    kind=EVENT_PERMISSION_REQUEST,
                    title=params.get("title", ""),
                    tool_input=params.get("input", ""),
                    request_id=msg.id,
                    options=options,
                )
                continue

        raise AcpTimeoutError()

    async def _process_update(self, msg: JsonRpcMessage) -> AsyncIterator[AcpEvent]:
        """Parse a session/update notification into zero or more AcpEvents."""
        params = msg.params or {}
        updates = params if isinstance(params, list) else [params]
        for update in updates:
            update_type = update.get("type")
            if update_type == UPDATE_AGENT_MESSAGE_CHUNK:
                content = update.get("content", "")
                thinking = update.get("thinking", "")
                if thinking:
                    yield AcpEvent(kind=EVENT_THINKING_CHUNK, text=thinking)
                if content:
                    yield AcpEvent(kind=EVENT_TEXT_CHUNK, text=content)
            elif update_type == UPDATE_TOOL_CALL:
                yield AcpEvent(
                    kind=EVENT_TOOL_CALL,
                    tool_call_id=update.get("id", ""),
                    title=update.get("name", ""),
                    tool_input=json.dumps(update.get("input", {})),
                )
            else:
                # Emit tool results and other update types as-is (for extensibility)
                result = update.get("result")
                if result is not None:
                    yield AcpEvent(
                        kind=EVENT_TOOL_RESULT,
                        tool_call_id=update.get("id", ""),
                        tool_output=str(result),
                    )

    def _next_req_id(self) -> int:
        rid = self._next_id
        self._next_id += 1
        return rid
