"""Approval resolution routes."""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel

from arz.dashboard.token_auth import require_token

router = APIRouter(dependencies=[Depends(require_token)])


@router.get("/api/approvals")
async def list_approvals(request: Request) -> list[dict]:
    """Pending tool approvals across all sessions — surfaced on the
    Operations board so the user can approve/deny without opening the
    session.
    """
    meta: dict[str, dict] = getattr(request.app.state, "pending_approval_meta", {}) or {}
    # Only include those whose future is still alive (defensive — should
    # always agree with pending_approvals).
    pending: dict[str, asyncio.Future] = request.app.state.pending_approvals
    out: list[dict] = []
    for rid, info in list(meta.items()):
        if rid not in pending:
            continue
        out.append(
            {
                "request_id": rid,
                "session_id": info.get("session_id") or "",
                "tool_name": info.get("tool_name") or "",
                "tool_input": (info.get("tool_input") or "")[:800],
                "title": info.get("title") or "",
                "created_at": info.get("created_at") or 0.0,
            }
        )
    out.sort(key=lambda r: r["created_at"])
    return out


def _drop_meta(request: Request, request_id: str) -> None:
    meta = getattr(request.app.state, "pending_approval_meta", None)
    if isinstance(meta, dict):
        meta.pop(request_id, None)


@router.post("/api/approvals/{request_id}/approve", status_code=status.HTTP_204_NO_CONTENT)
async def approve_tool(request_id: str, request: Request) -> None:
    pending: dict[str, asyncio.Future] = request.app.state.pending_approvals
    fut = pending.get(request_id)
    if not fut:
        raise HTTPException(status_code=404, detail="No pending approval for this request_id")
    if not fut.done():
        fut.set_result(True)
    pending.pop(request_id, None)
    _drop_meta(request, request_id)


@router.post("/api/approvals/{request_id}/reject", status_code=status.HTTP_204_NO_CONTENT)
async def reject_tool(request_id: str, request: Request) -> None:
    pending: dict[str, asyncio.Future] = request.app.state.pending_approvals
    fut = pending.get(request_id)
    if not fut:
        raise HTTPException(status_code=404, detail="No pending approval for this request_id")
    if not fut.done():
        fut.set_result(False)
    pending.pop(request_id, None)
    _drop_meta(request, request_id)


@router.post("/api/sessions/{session_id}/yolo")
async def toggle_yolo(session_id: str, request: Request) -> dict:
    yolo: set[str] = request.app.state.yolo_sessions
    if session_id in yolo:
        yolo.discard(session_id)
        return {"yolo": False}
    else:
        yolo.add(session_id)
        return {"yolo": True}


class ModeBody(BaseModel):
    mode: str


VALID_MODES = {"normal", "trust_reads", "trust", "yolo"}


@router.post("/api/sessions/{session_id}/evict", status_code=status.HTTP_204_NO_CONTENT)
async def evict_session(session_id: str, request: Request) -> None:
    """Shut down and remove the active provider for this session (model switch helper)."""
    from arz.providers.pool import ProviderPool

    pool: ProviderPool = request.app.state.provider_pool
    await pool.deactivate(session_id)


@router.post("/api/sessions/{session_id}/mode")
async def set_session_mode(session_id: str, body: ModeBody, request: Request) -> dict:
    if body.mode not in VALID_MODES:
        raise HTTPException(status_code=400, detail=f"Invalid mode: {body.mode}")
    mgr = request.app.state.session_manager
    session = mgr.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    # Persist on the session itself so it survives server restarts.
    from arz.session.session import Session

    assert isinstance(session, Session)
    session.approval_mode = body.mode
    mgr.save(session)
    # Mirror to in-memory dicts for the chat hot path.
    request.app.state.session_modes[session_id] = body.mode
    yolo: set[str] = request.app.state.yolo_sessions
    if body.mode == "yolo":
        yolo.add(session_id)
    else:
        yolo.discard(session_id)
    # Evict the pool entry so the next chat turn rebuilds the provider with the
    # right --permission-mode flag for claude-code.
    from arz.providers.pool import ProviderPool

    pool: ProviderPool = request.app.state.provider_pool
    await pool.deactivate(session_id)
    return {"mode": body.mode}
