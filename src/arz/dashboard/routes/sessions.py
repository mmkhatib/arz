"""Session CRUD routes."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status

from arz.dashboard.token_auth import require_token
from arz.session.manager import SessionManager

router = APIRouter(dependencies=[Depends(require_token)])


def _get_manager(request: Request) -> SessionManager:
    return request.app.state.session_manager


def _session_to_dict(session: object) -> dict:
    from arz.session.session import Session
    assert isinstance(session, Session)
    return {
        "id": session.id,
        "title": session.title,
        "surface": session.surface,
        "chat_id": session.chat_id,
        "thread_id": session.thread_id,
        "message_count": len(session.messages),
        "created_at": session.created_at.isoformat(),
        "updated_at": session.updated_at.isoformat(),
        "active": session.active,
    }


@router.get("/api/sessions")
async def list_sessions(request: Request) -> list[dict]:
    mgr: SessionManager = _get_manager(request)
    return [_session_to_dict(s) for s in mgr.list_active()]


@router.post("/api/sessions", status_code=status.HTTP_201_CREATED)
async def create_session(request: Request) -> dict:
    body = await request.json() if request.headers.get("content-type") == "application/json" else {}
    mgr: SessionManager = _get_manager(request)
    session = mgr.create(
        surface=body.get("surface", "dashboard"),
        chat_id=body.get("chat_id", "web"),
        thread_id=body.get("thread_id"),
    )
    return _session_to_dict(session)


@router.get("/api/sessions/{session_id}")
async def get_session(session_id: str, request: Request) -> dict:
    mgr: SessionManager = _get_manager(request)
    session = mgr.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return {
        **_session_to_dict(session),
        "messages": [m.to_dict() for m in session.messages],
    }


@router.delete("/api/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
async def close_session(session_id: str, request: Request) -> None:
    mgr: SessionManager = _get_manager(request)
    if not mgr.get(session_id):
        raise HTTPException(status_code=404, detail="Session not found")
    mgr.close(session_id)
