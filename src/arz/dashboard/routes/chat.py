"""Chat route — POST message → SSE stream."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import AsyncIterator

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse

from arz.acp.types import EVENT_COMPLETE, EVENT_PERMISSION_REQUEST, EVENT_TEXT_CHUNK, EVENT_TOOL_CALL
from arz.dashboard.sse import sse_chunk, sse_complete, sse_error, sse_tool_call
from arz.dashboard.token_auth import require_token
from arz.providers.base import LLMProvider
from arz.providers.pool import ProviderPool
from arz.session.manager import SessionManager

log = logging.getLogger(__name__)
router = APIRouter(dependencies=[Depends(require_token)])

_WORKSPACE_ROOT = Path.home() / ".arz" / "workspace"


def _make_provider(config: object, session_id: str, has_history: bool) -> LLMProvider:
    """Factory: build the right provider for this session."""
    from arz.config.schema import ArzConfig
    assert isinstance(config, ArzConfig)

    provider_name = config.provider.name
    model = config.provider.model
    work_dir = _WORKSPACE_ROOT / session_id

    if provider_name == "claude-code":
        from arz.providers.claude_code import ClaudeCodeProvider
        return ClaudeCodeProvider(model=model, work_dir=work_dir, use_continue=has_history)

    if provider_name == "kiro-cli":
        from arz.providers.kiro_cli import KiroCliProvider
        return KiroCliProvider(model=model, work_dir=work_dir)

    raise ValueError(f"Unknown provider: {provider_name!r}")


async def _stream_response(
    provider: LLMProvider,
    session_id: str,
    message: str,
    mgr: SessionManager,
) -> AsyncIterator[str]:
    """Drive the provider, record history, yield SSE strings."""
    session = mgr.get(session_id)
    if session:
        session.add_message("user", message)

    full_reply = ""
    try:
        async for event in provider.stream(message):
            if event.kind == EVENT_TEXT_CHUNK and event.text:
                full_reply += event.text
                yield sse_chunk(event.text)

            elif event.kind == EVENT_TOOL_CALL:
                yield sse_tool_call(
                    tool_name=event.text or "",
                    tool_input=str(event.tool_input or ""),
                    request_id=event.request_id or "",
                )

            elif event.kind == EVENT_COMPLETE:
                if session and full_reply:
                    session.add_message("assistant", full_reply)
                    mgr.save(session)
                yield sse_complete(event.stop_reason or "end_turn")
                return

    except Exception as e:
        log.exception("Error streaming session %s", session_id)
        if session and full_reply:
            session.add_message("assistant", full_reply)
            mgr.save(session)
        yield sse_error(str(e))


@router.post("/api/chat/{session_id}")
async def chat(session_id: str, request: Request) -> StreamingResponse:
    mgr: SessionManager = request.app.state.session_manager
    pool: ProviderPool = request.app.state.provider_pool

    session = mgr.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    body = await request.json()
    message: str = body.get("message", "").strip()
    if not message:
        raise HTTPException(status_code=422, detail="message is required")

    has_history = any(m.role == "assistant" for m in session.messages)
    provider = await pool.activate(
        session_id,
        lambda: _make_provider(request.app.state.config, session_id, has_history),
    )

    return StreamingResponse(
        _stream_response(provider, session_id, message, mgr),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
