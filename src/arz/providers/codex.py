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
        history_messages: list[dict] | None = None,
    ) -> None:
        self._binary: str | None = None  # resolved lazily in start()
        self._model = model or ""
        self._work_dir = Path(work_dir) if work_dir else Path.home()
        self._env_extra = env_extra or {}
        self._system_prompt = (system_prompt or "").strip()
        # Last N user/assistant turns. Used (a) as fallback context when we
        # don't yet have a codex thread to resume and (b) to bridge across
        # gateway restarts before resume kicks in.
        self._history: list[dict] = history_messages or []
        self._process: asyncio.subprocess.Process | None = None
        # Codex threads are persistent if we pass them through `exec resume`.
        # We capture the thread_id from the first run's `thread.started` event
        # and use it on every subsequent turn so codex remembers context.
        self._thread_id: str | None = None
        self._resume_thread_id: str | None = None

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

    @property
    def pid(self) -> int | None:
        return self._process.pid if self._process else None

    @property
    def session_id(self) -> str | None:
        return self._thread_id

    def set_resume_session_id(self, sid: str) -> None:
        self._resume_thread_id = sid

    def stream(self, message: str) -> AsyncIterator[LLMEvent]:
        return self._run(message)

    def _format_history(self, *, max_messages: int = 10, max_chars: int = 8000) -> str:
        """Render the last few turns as a compact transcript."""
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
            raise RuntimeError("CodexProvider.start() was not called")

        # Reuse a captured thread_id (this provider's own previous turns)
        # OR a thread_id we were told to resume across gateway restarts.
        thread_id = self._thread_id or self._resume_thread_id
        argv = [self._binary, "exec"]
        if thread_id:
            # `codex exec resume <id>` continues an existing thread —
            # codex picks up the prior conversation natively.
            argv += ["resume", thread_id]
        argv += [
            "--full-auto",
            "--json",
            "--color", "never",
            "--skip-git-repo-check",
            "-C", str(self._work_dir),
        ]
        if self._model and not self._model.startswith("claude-"):
            argv += ["-m", self._model]

        # Build the prompt. Strategy:
        #   - Always inject the system prompt.
        #   - Always inject a transcript of recent turns alongside the
        #     thread_id resume (codex's resume is documented as flaky).
        #   - On the FIRST turn (no thread_id yet), the transcript is the
        #     only source of context — keep it longer.
        parts: list[str] = []
        if self._system_prompt:
            parts.append(f"<system>\n{self._system_prompt}\n</system>")
        if thread_id:
            transcript = self._format_history(max_messages=4, max_chars=2000)
        else:
            transcript = self._format_history(max_messages=10, max_chars=8000)
        if transcript:
            parts.append(f"<recent-context>\n{transcript}\n</recent-context>")
        parts.append(message)
        prompt = "\n\n".join(parts)
        # Pass the prompt via STDIN, not argv. Windows caps a single
        # command-line argument around 8KB (CreateProcess ARG_MAX); our
        # prompt routinely exceeds that with the bundled system prompt +
        # memory + lessons + transcript, and codex would silently see a
        # truncated prefix and reply "I only received <system>".
        # `codex exec -` reads the prompt from stdin instead.
        argv.append("-")

        env = {**os.environ, **self._env_extra}
        process = await asyncio.create_subprocess_exec(
            *argv,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            limit=_STDOUT_LIMIT,
            env=env,
        )
        self._process = process

        # Write the prompt to stdin and close — codex reads to EOF.
        if process.stdin:
            try:
                process.stdin.write(prompt.encode("utf-8"))
                await process.stdin.drain()
                process.stdin.close()
            except Exception:
                pass

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

                if etype == "thread.started":
                    # Capture the codex thread id so subsequent turns can
                    # `exec resume <id>` and inherit the conversation.
                    tid = event.get("thread_id")
                    if isinstance(tid, str) and tid:
                        self._thread_id = tid
                elif etype == "item.completed":
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
