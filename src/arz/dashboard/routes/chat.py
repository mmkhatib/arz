"""Chat route — POST message → SSE stream."""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path
from typing import AsyncIterator

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse

from arz.acp.types import EVENT_COMPLETE, EVENT_PERMISSION_REQUEST, EVENT_TEXT_CHUNK, EVENT_TOOL_CALL, EVENT_TOOL_RESULT
from arz.dashboard.sse import sse_chunk, sse_complete, sse_error, sse_permission_request, sse_tool_call, sse_tool_result
from arz.dashboard.token_auth import require_token
from arz.providers.base import LLMProvider
from arz.providers.pool import ProviderPool
from arz.session.manager import SessionManager

log = logging.getLogger(__name__)
router = APIRouter(dependencies=[Depends(require_token)])

_WORKSPACE_ROOT = Path.home() / ".arz" / "workspace"


def _make_provider(config: object, session_id: str, history: list[dict] | None) -> LLMProvider:
    """Factory: build the right provider for this session."""
    from arz.config.schema import ArzConfig
    assert isinstance(config, ArzConfig)

    provider_name = config.provider.name
    model = config.provider.model
    work_dir = _WORKSPACE_ROOT / session_id

    if provider_name == "claude-code":
        from arz.providers.claude_code import ClaudeCodeProvider
        return ClaudeCodeProvider(
            model=model,
            work_dir=work_dir,
            system_prompt=config.dashboard.system_prompt or None,
            history_messages=history,
        )

    if provider_name == "kiro-cli":
        from arz.providers.kiro_cli import KiroCliProvider
        return KiroCliProvider(model=model, work_dir=work_dir)

    raise ValueError(f"Unknown provider: {provider_name!r}")


async def _stream_response(
    provider: LLMProvider,
    session_id: str,
    message: str,
    mgr: SessionManager,
    pending_approvals: dict | None = None,
    yolo_sessions: set | None = None,
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

            elif event.kind == EVENT_TOOL_RESULT:
                yield sse_tool_result(
                    tool_call_id=event.tool_call_id or "",
                    content=event.tool_output or "",
                )

            elif event.kind == EVENT_TOOL_CALL:
                yield sse_tool_call(
                    tool_name=event.text or "",
                    tool_input=str(event.tool_input or ""),
                    request_id=event.request_id or "",
                )

            elif event.kind == EVENT_PERMISSION_REQUEST:
                request_id = str(event.request_id or "")
                if request_id:
                    # YOLO mode: auto-approve without surfacing to user
                    if yolo_sessions is not None and session_id in yolo_sessions:
                        await provider.approve_tool(request_id)
                    elif pending_approvals is not None:
                        loop = asyncio.get_event_loop()
                        fut: asyncio.Future = loop.create_future()
                        pending_approvals[request_id] = fut
                        yield sse_permission_request(
                            title=event.title or event.text or "",
                            tool_input=str(event.tool_input or ""),
                            request_id=request_id,
                        )
                        try:
                            approved = await asyncio.wait_for(fut, timeout=7200.0)
                        except asyncio.TimeoutError:
                            approved = False
                        finally:
                            pending_approvals.pop(request_id, None)
                        if approved:
                            await provider.approve_tool(request_id)
                        else:
                            await provider.reject_tool(request_id)

            elif event.kind == EVENT_COMPLETE:
                if session and full_reply:
                    session.add_message("assistant", full_reply)
                    mgr.save(session)
                yield sse_complete(
                    event.stop_reason or "end_turn",
                    context_pct=event.context_usage_pct or 0.0,
                )
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

    history: list[dict] | None = None
    if session and session.messages:
        history = [{"role": m.role, "text": m.text} for m in session.messages]

    provider = await pool.activate(
        session_id,
        lambda: _make_provider(request.app.state.config, session_id, history),
    )

    return StreamingResponse(
        _stream_response(provider, session_id, message, mgr, request.app.state.pending_approvals, request.app.state.yolo_sessions),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
