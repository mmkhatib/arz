"""OllamaProvider — chat via local Ollama (POST /api/chat, JSON-stream).

No persistent process: each turn opens an HTTP request to
127.0.0.1:11434/api/chat with stream=true and consumes the JSONL
response. Context is preserved by sending the full message history on
every turn, the same way the official Ollama clients do — there's no
server-side session concept to resume.

Auth: none (local). If Ollama isn't running we surface a 503-style
error event.
"""

from __future__ import annotations

import json
import logging
import os
from collections.abc import AsyncIterator
from pathlib import Path

import httpx

from arz.providers.base import LLMEvent, LLMProvider

log = logging.getLogger(__name__)

_DEFAULT_URL = "http://127.0.0.1:11434"
_TURN_TIMEOUT = 7200.0
_MAX_HISTORY_MESSAGES = 30  # tail-cap so prompts stay sane


class OllamaProvider(LLMProvider):
    """LLMProvider that talks to a local Ollama server."""

    name = "ollama"

    def __init__(
        self,
        model: str | None = None,
        work_dir: str | Path | None = None,
        env_extra: dict[str, str] | None = None,
        system_prompt: str | None = None,
        history_messages: list[dict] | None = None,
        base_url: str | None = None,
    ) -> None:
        self._model = (model or "").strip() or "gemma3:4b"
        self._work_dir = Path(work_dir) if work_dir else Path.home()
        self._env_extra = env_extra or {}
        self._system_prompt = (system_prompt or "").strip()
        self._history: list[dict] = history_messages or []
        self._base_url = (base_url or os.environ.get("OLLAMA_HOST") or _DEFAULT_URL).rstrip("/")
        self._cancel_flag = False

    async def start(self) -> None:
        log.info("ollama provider ready", extra={"model": self._model, "url": self._base_url})

    async def shutdown(self) -> None:
        # Stateless — nothing to clean up. We deliberately do NOT eject the
        # model from RAM here; users control that explicitly via the
        # Models page.
        pass

    def is_alive(self) -> bool:
        return True

    async def cancel(self) -> None:
        # No native abort — set a flag the streaming loop checks between
        # chunks. The active httpx response will be closed when the loop
        # exits its async-with block.
        self._cancel_flag = True

    @property
    def current_model(self) -> str | None:
        return self._model or None

    def stream(self, message: str) -> AsyncIterator[LLMEvent]:
        return self._run(message)

    def _build_messages(self, current_message: str) -> list[dict]:
        msgs: list[dict] = []
        if self._system_prompt:
            msgs.append({"role": "system", "content": self._system_prompt})
        # Last N turns from arz history. Skip the most-recent user message
        # if it duplicates `current_message` (the chat route saves user
        # messages immediately, so it's already in self._history).
        recent = self._history[-_MAX_HISTORY_MESSAGES:]
        if (
            recent
            and recent[-1].get("role") == "user"
            and (recent[-1].get("text") or "").strip() == current_message.strip()
        ):
            recent = recent[:-1]
        for m in recent:
            role = m.get("role") or "user"
            text = (m.get("text") or "").strip()
            if not text:
                continue
            # Ollama uses 'user' / 'assistant' / 'system' — same labels.
            msgs.append({"role": role, "content": text})
        msgs.append({"role": "user", "content": current_message})
        return msgs

    async def _run(self, message: str) -> AsyncIterator[LLMEvent]:  # type: ignore[return]
        url = f"{self._base_url}/api/chat"
        body = {
            "model": self._model,
            "messages": self._build_messages(message),
            "stream": True,
            "keep_alive": "30m",  # user can eject manually from Models page
        }
        timeout = httpx.Timeout(_TURN_TIMEOUT, connect=10.0, read=600.0)
        self._cancel_flag = False
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                async with client.stream("POST", url, json=body) as resp:
                    if resp.status_code >= 400:
                        text = (await resp.aread()).decode("utf-8", errors="replace").strip()
                        yield LLMEvent(
                            kind="text_chunk",
                            text=f"[ollama error {resp.status_code}] {text or 'request failed'}\n",
                        )
                        yield LLMEvent(kind="complete", stop_reason="error")
                        return

                    async for raw in resp.aiter_lines():
                        if self._cancel_flag:
                            yield LLMEvent(kind="complete", stop_reason="cancelled")
                            return
                        line = (raw or "").strip()
                        if not line:
                            continue
                        try:
                            event = json.loads(line)
                        except json.JSONDecodeError:
                            continue

                        msg = event.get("message") or {}
                        content = msg.get("content") if isinstance(msg, dict) else ""
                        if content:
                            yield LLMEvent(kind="text_chunk", text=content)

                        if event.get("done"):
                            usage = None
                            if "prompt_eval_count" in event or "eval_count" in event:
                                from arz.acp.types import Usage

                                try:
                                    usage = Usage(
                                        input_tokens=int(event.get("prompt_eval_count") or 0),
                                        output_tokens=int(event.get("eval_count") or 0),
                                    )
                                except Exception:
                                    usage = None
                            yield LLMEvent(
                                kind="complete",
                                stop_reason=event.get("done_reason") or "end_turn",
                                usage=usage,
                            )
                            return

        except httpx.ConnectError:
            yield LLMEvent(
                kind="text_chunk",
                text=(
                    f"[ollama unreachable] could not connect to {self._base_url}. "
                    "Is the Ollama server running?\n"
                ),
            )
            yield LLMEvent(kind="complete", stop_reason="error")
        except Exception as e:
            log.exception("ollama provider stream failed")
            yield LLMEvent(kind="text_chunk", text=f"[ollama error] {e}\n")
            yield LLMEvent(kind="complete", stop_reason="error")

    async def approve_tool(self, request_id: str | int) -> None:
        pass  # no native tool approval

    async def reject_tool(self, request_id: str | int) -> None:
        pass

    def context_usage_pct(self) -> float:
        return 0.0
