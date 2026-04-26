"""Approval resolution routes."""
from __future__ import annotations
import asyncio
from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from arz.dashboard.token_auth import require_token

router = APIRouter(dependencies=[Depends(require_token)])


@router.post("/api/approvals/{request_id}/approve", status_code=status.HTTP_204_NO_CONTENT)
async def approve_tool(request_id: str, request: Request) -> None:
    pending: dict[str, asyncio.Future] = request.app.state.pending_approvals
    fut = pending.get(request_id)
    if not fut:
        raise HTTPException(status_code=404, detail="No pending approval for this request_id")
    if not fut.done():
        fut.set_result(True)
    pending.pop(request_id, None)


@router.post("/api/approvals/{request_id}/reject", status_code=status.HTTP_204_NO_CONTENT)
async def reject_tool(request_id: str, request: Request) -> None:
    pending: dict[str, asyncio.Future] = request.app.state.pending_approvals
    fut = pending.get(request_id)
    if not fut:
        raise HTTPException(status_code=404, detail="No pending approval for this request_id")
    if not fut.done():
        fut.set_result(False)
    pending.pop(request_id, None)


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


@router.post("/api/sessions/{session_id}/mode")
async def set_session_mode(session_id: str, body: ModeBody, request: Request) -> dict:
    if body.mode not in VALID_MODES:
        raise HTTPException(status_code=400, detail=f"Invalid mode: {body.mode}")
    modes: dict[str, str] = request.app.state.session_modes
    modes[session_id] = body.mode
    # Sync with yolo_sessions for backward compat
    yolo: set[str] = request.app.state.yolo_sessions
    if body.mode == "yolo":
        yolo.add(session_id)
    else:
        yolo.discard(session_id)
    return {"mode": body.mode}
