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
import shutil
import signal
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

from arz.acp.types import (
    EVENT_COMPLETE,
    EVENT_PERMISSION_REQUEST,
    EVENT_TEXT_CHUNK,
    EVENT_THINKING_CHUNK,
    EVENT_TOOL_CALL,
    EVENT_TOOL_RESULT,
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
    AcpEvent,
    JsonRpcMessage,
    JsonRpcRequest,
)

_KIRO_SESSIONS_DIR = Path.home() / ".kiro" / "sessions" / "cli"

logger = logging.getLogger(__name__)

_STDOUT_LIMIT = 10 * 1024 * 1024  # 10 MB — tool outputs can be large
_INIT_TIMEOUT = 60.0
_PROMPT_TIMEOUT = 7200.0  # 2 hours
_CLIENT_NAME = "arz"
_CLIENT_VERSION = "0.7.70"


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
        self._stderr_tail: list[str] = []

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
        """Send SIGTERM, then SIGKILL if the process doesn't exit.

        Cross-platform — uses asyncio's process methods (terminate/kill)
        rather than POSIX-only killpg/getpgid which crash on Windows.
        On POSIX we additionally signal the whole process group when we
        spawned with start_new_session=True, which is the behavior we
        actually want (kills any kiro/codex subprocesses spawned by the
        CLI). On Windows we fall back to plain terminate.
        """
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
        # POSIX: try to take down the whole process group (better cleanup
        # for CLIs that fork helpers). Windows doesn't have process groups
        # in the same way; fall back to terminate.
        is_posix = hasattr(os, "killpg") and hasattr(os, "getpgid")
        try:
            if is_posix:
                try:
                    os.killpg(os.getpgid(pid), signal.SIGTERM)
                except (ProcessLookupError, OSError):
                    self._process.terminate()
            else:
                self._process.terminate()
            await asyncio.wait_for(self._process.wait(), timeout=3.0)
        except (TimeoutError, ProcessLookupError, OSError):
            try:
                if is_posix:
                    try:
                        os.killpg(os.getpgid(pid), signal.SIGKILL)
                    except (ProcessLookupError, OSError):
                        self._process.kill()
                else:
                    self._process.kill()
            except (ProcessLookupError, OSError):
                pass

    async def stream_events(self, message: str) -> AsyncIterator[AcpEvent]:
        """Send a prompt and stream events until completion.

        ACP `session/prompt` requires ``sessionId`` and ``prompt`` (a list of
        content blocks), not a free-form ``message`` field — Kiro 2.x crashes
        the subprocess silently if the shape is wrong, surfacing as
        ``Process closed stdout mid-prompt`` to callers.
        """
        if not self._process or self._session_id is None:
            raise AcpError("Client not initialized — call start() first")

        prompt_id = self._next_req_id()
        await self._send(
            JsonRpcRequest(
                method=METHOD_PROMPT,
                params={
                    "sessionId": self._session_id,
                    "prompt": [{"type": "text", "text": message}],
                },
                id=prompt_id,
            )
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

    async def cancel(self) -> None:
        """Send ACP `session/cancel` notification.

        Best-effort cooperative stop. Caller should still wait briefly
        for the in-flight `session/prompt` to drain a final event, and
        fall back to hard kill if it doesn't.
        """
        from arz.acp.types import METHOD_CANCEL

        if not self._process or self._session_id is None:
            return
        try:
            await self._send_raw(
                {
                    "jsonrpc": "2.0",
                    "method": METHOD_CANCEL,
                    "params": {"sessionId": self._session_id},
                }
            )
        except Exception:
            logger.warning("ACP cancel failed", exc_info=True)

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

        # start_new_session is POSIX-only (it calls setsid). On Windows
        # we need a different mechanism — CREATE_NEW_PROCESS_GROUP via
        # creationflags — to detach the child so it doesn't inherit
        # Ctrl-C from the parent.
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
        logger.info("Spawned %s (PID %d)", " ".join(argv), self._process.pid)

        if self._process.stderr:
            self._stderr_task = asyncio.ensure_future(self._drain_stderr(self._process.stderr))

    def _died_reason(self, base: str) -> str:
        """Compose a death message including recent stderr lines."""
        if not self._stderr_tail:
            return base
        tail = "\n".join(self._stderr_tail[-10:])
        return f"{base}\n--- subprocess stderr (last 10 lines) ---\n{tail}"

    async def _drain_stderr(self, stderr: asyncio.StreamReader) -> None:
        while True:
            line = await stderr.readline()
            if not line:
                break
            text = line.decode(errors="replace").rstrip()
            logger.debug("ACP stderr: %s", text)
            # Retain a tail buffer so AcpProcessDied can include real diagnostics
            self._stderr_tail.append(text)
            if len(self._stderr_tail) > 40:
                self._stderr_tail.pop(0)

    # ── ACP handshake ─────────────────────────────────────────────────────────

    async def _initialize(self) -> None:
        """ACP handshake: initialize → session/load or session/new → set_model."""
        init_id = self._next_req_id()
        await self._send(
            JsonRpcRequest(
                method=METHOD_INITIALIZE,
                params={
                    "protocolVersion": PROTOCOL_VERSION,
                    "clientInfo": {"name": _CLIENT_NAME, "version": _CLIENT_VERSION},
                },
                id=init_id,
            )
        )
        init_response = await asyncio.wait_for(self._read_response(init_id), timeout=_INIT_TIMEOUT)
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
                    await self._send(
                        JsonRpcRequest(
                            method=METHOD_SESSION_LOAD,
                            params={
                                "sessionId": resume_sid,
                                "cwd": str(self._work_dir),
                                "mcpServers": [],
                                "_meta": {"_kiro.dev/session_file": str(session_file)},
                            },
                            id=load_id,
                        )
                    )
                    load_resp = await asyncio.wait_for(
                        self._read_response(load_id), timeout=_INIT_TIMEOUT
                    )
                    if "modes" in (load_resp.result or {}):
                        self._session_id = resume_sid
                        self._resumed = True
                        logger.info("kiro-cli session resumed: %s", resume_sid)
                except (TimeoutError, AcpError, AcpProcessDied):
                    logger.info(
                        "session/load failed for %s — falling back to session/new", resume_sid
                    )
            else:
                logger.info("kiro session file missing for %s — starting fresh", resume_sid)

        # Fall back to new session. ACP `session/new` takes {cwd, mcpServers}
        # and *returns* the sessionId — clients don't pick it. Sending a
        # client-supplied sessionId crashes kiro-cli silently.
        if not self._session_id:
            new_id = self._next_req_id()
            await self._send(
                JsonRpcRequest(
                    method=METHOD_SESSION_NEW,
                    params={"cwd": str(self._work_dir), "mcpServers": []},
                    id=new_id,
                )
            )
            new_resp = await asyncio.wait_for(self._read_response(new_id), timeout=_INIT_TIMEOUT)
            if new_resp.error:
                raise AcpError(f"ACP session/new failed: {new_resp.error}")
            sid = (new_resp.result or {}).get("sessionId")
            if not sid:
                raise AcpError(f"ACP session/new returned no sessionId: {new_resp.result}")
            self._session_id = sid
            logger.info("kiro-cli session created: %s", self._session_id)

        # session/set_model is per-session and takes {sessionId, modelId}.
        # Kiro 2.x rejects bare {model: …} and dies; skip it if the model is
        # "auto" (Kiro's default) so we don't tickle that path needlessly.
        if self._model and self._model != "auto":
            model_id = self._next_req_id()
            await self._send(
                JsonRpcRequest(
                    method=METHOD_SET_MODEL,
                    params={"sessionId": self._session_id, "modelId": self._model},
                    id=model_id,
                )
            )
            try:
                await asyncio.wait_for(self._read_response(model_id), timeout=_INIT_TIMEOUT)
            except (TimeoutError, AcpError):
                logger.warning(
                    "session/set_model failed for %s — proceeding with default", self._model
                )
        logger.info(
            "ACP session ready (id=%s model=%s resumed=%s)",
            self._session_id,
            self._model,
            self._resumed,
        )

    # ── I/O helpers ───────────────────────────────────────────────────────────

    async def _send(self, req: JsonRpcRequest) -> None:
        await self._send_raw(req.to_dict())

    async def _send_raw(self, obj: dict[str, Any]) -> None:
        if not self._process or not self._process.stdin:
            raise AcpError("Process not running")
        line = json.dumps(obj, separators=(",", ":")) + "\n"
        self._process.stdin.write(line.encode())
        await self._process.stdin.drain()

    async def _send_permission_response(self, request_id: Any, outcome: str, option: str) -> None:
        await self._send_raw(
            {
                "jsonrpc": "2.0",
                "id": request_id,
                "result": {"outcome": {"outcome": outcome, "optionId": option}},
            }
        )

    async def _read_line(self) -> JsonRpcMessage | None:
        """Read one line from stdout and parse it as a JSON-RPC message."""
        if not self._process or not self._process.stdout:
            return None
        try:
            raw = await asyncio.wait_for(self._process.stdout.readline(), timeout=30.0)
        except TimeoutError:
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
            except TimeoutError:
                break

    async def _read_until_complete(self, prompt_id: int) -> AsyncIterator[AcpEvent]:
        """Yield events from stdout until the session/prompt response arrives."""
        deadline = asyncio.get_event_loop().time() + _PROMPT_TIMEOUT
        # Per-prompt accumulators for vendor-extension metadata (Kiro emits
        # _kiro.dev/metadata mid-stream with credits + context% + turn time;
        # we attach the totals to the EVENT_COMPLETE event below).
        kiro_credits = 0.0
        kiro_credit_unit = ""
        kiro_context_pct = 0.0
        kiro_turn_ms = 0
        while asyncio.get_event_loop().time() < deadline:
            if not self._process or not self._process.stdout:
                raise AcpProcessDied(self._died_reason("Stdout closed mid-stream"))

            try:
                raw = await asyncio.wait_for(self._process.stdout.readline(), timeout=60.0)
            except TimeoutError:
                if not self.is_alive():
                    raise AcpProcessDied(
                        self._died_reason("Process exited while waiting for events")
                    )
                continue

            if not raw:
                raise AcpProcessDied(self._died_reason("Process closed stdout mid-prompt"))

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
                stop_reason = "end_turn"
                if isinstance(msg.result, dict):
                    stop_reason = msg.result.get("stopReason") or "end_turn"
                from arz.acp.types import Usage

                usage = None
                if kiro_credits or kiro_turn_ms:
                    usage = Usage(
                        credits=kiro_credits,
                        credit_unit=kiro_credit_unit,
                        turn_duration_ms=kiro_turn_ms,
                    )
                yield AcpEvent(
                    kind=EVENT_COMPLETE,
                    stop_reason=stop_reason,
                    context_usage_pct=kiro_context_pct,
                    usage=usage,
                )
                return

            # _kiro.dev/metadata: vendor extension, accumulate for COMPLETE
            if msg.is_notification("_kiro.dev/metadata"):
                params = msg.params or {}
                if isinstance(params, dict):
                    if isinstance(params.get("contextUsagePercentage"), (int, float)):
                        kiro_context_pct = float(params["contextUsagePercentage"])
                    metering = params.get("meteringUsage")
                    if isinstance(metering, list):
                        for m in metering:
                            if isinstance(m, dict) and isinstance(m.get("value"), (int, float)):
                                kiro_credits += float(m["value"])
                                if not kiro_credit_unit and isinstance(m.get("unit"), str):
                                    kiro_credit_unit = m["unit"]
                    if isinstance(params.get("turnDurationMs"), (int, float)):
                        kiro_turn_ms = int(params["turnDurationMs"])
                continue

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
        """Parse a session/update notification into zero or more AcpEvents.

        ACP spec wraps the actual payload under ``params.update`` and uses the
        field name ``sessionUpdate`` to discriminate. ``content`` is a content
        block ``{type:"text"|"thought", text:"..."}``. Older code paths sent a
        flat ``params.{type, content:str}`` shape; both are tolerated for
        backward compat with anything still emitting that.
        """
        raw = msg.params or {}
        # Spec form: { sessionId, update: { sessionUpdate, ... } }
        # Legacy/flat form: { type, content, ... }  (or a list of those)
        if isinstance(raw, list):
            updates = raw
        elif "update" in raw and isinstance(raw["update"], dict):
            updates = [raw["update"]]
        else:
            updates = [raw]

        for update in updates:
            update_type = update.get("sessionUpdate") or update.get("type")

            if update_type == UPDATE_AGENT_MESSAGE_CHUNK or update_type == "agent_thought_chunk":
                content = update.get("content")
                if isinstance(content, dict):
                    text = content.get("text", "")
                    block_type = content.get("type", "text")
                    if not text:
                        continue
                    if update_type == "agent_thought_chunk" or block_type == "thought":
                        yield AcpEvent(kind=EVENT_THINKING_CHUNK, text=text)
                    else:
                        yield AcpEvent(kind=EVENT_TEXT_CHUNK, text=text)
                elif isinstance(content, str) and content:
                    yield AcpEvent(kind=EVENT_TEXT_CHUNK, text=content)
                # Legacy/flat: separate `thinking` field
                legacy_thinking = update.get("thinking")
                if isinstance(legacy_thinking, str) and legacy_thinking:
                    yield AcpEvent(kind=EVENT_THINKING_CHUNK, text=legacy_thinking)

            elif update_type == UPDATE_TOOL_CALL:
                tool_id = update.get("toolCallId") or update.get("id", "")
                yield AcpEvent(
                    kind=EVENT_TOOL_CALL,
                    tool_call_id=tool_id,
                    title=update.get("title", "") or update.get("name", ""),
                    tool_input=json.dumps(update.get("rawInput") or update.get("input", {})),
                )

            elif update_type == "tool_call_update":
                tool_id = update.get("toolCallId") or update.get("id", "")
                # ACP packs tool output under `content` as a list of content blocks.
                contents = update.get("content", [])
                texts: list[str] = []
                if isinstance(contents, list):
                    for c in contents:
                        if not isinstance(c, dict):
                            continue
                        inner = c.get("content")
                        if isinstance(inner, dict) and isinstance(inner.get("text"), str):
                            texts.append(inner["text"])
                        elif isinstance(c.get("text"), str):
                            texts.append(c["text"])
                if texts:
                    yield AcpEvent(
                        kind=EVENT_TOOL_RESULT,
                        tool_call_id=tool_id,
                        tool_output="\n".join(texts),
                    )

            else:
                # Legacy fallback: bare `result` field
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
