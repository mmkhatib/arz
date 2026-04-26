"""Session CRUD routes."""

from __future__ import annotations

import asyncio
import shutil

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
        "color": session.color,
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


@router.get("/api/sessions/search")
async def search_sessions(q: str, request: Request) -> list[dict]:
    mgr: SessionManager = _get_manager(request)
    query = q.strip().lower()
    if not query:
        return [_session_to_dict(s) for s in mgr.list_active()]
    results = []
    for session in mgr.list_active():
        from arz.session.session import Session
        assert isinstance(session, Session)
        if query in session.title.lower():
            results.append(_session_to_dict(session))
            continue
        if any(query in m.text.lower() for m in session.messages):
            results.append(_session_to_dict(session))
    return results


@router.delete("/api/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
async def close_session(session_id: str, request: Request) -> None:
    mgr: SessionManager = _get_manager(request)
    if not mgr.get(session_id):
        raise HTTPException(status_code=404, detail="Session not found")
    mgr.close(session_id)


@router.patch("/api/sessions/{session_id}/color", status_code=status.HTTP_204_NO_CONTENT)
async def set_session_color(session_id: str, request: Request) -> None:
    mgr: SessionManager = _get_manager(request)
    session = mgr.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    body = await request.json()
    color = body.get("color")
    if color is not None and (not isinstance(color, int) or color < 0 or color > 5):
        raise HTTPException(status_code=422, detail="color must be 0-5 or null")
    from arz.session.session import Session
    assert isinstance(session, Session)
    session.color = color
    mgr.save(session)


@router.post("/api/sessions/{session_id}/generate-title")
async def generate_title(session_id: str, request: Request) -> dict:
    mgr: SessionManager = _get_manager(request)
    session = mgr.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    body = await request.json()
    user_msg: str = body.get("user_msg", "")[:300]
    assistant_msg: str = body.get("assistant_msg", "")[:300]

    claude_bin = shutil.which("claude")
    if not claude_bin:
        raise HTTPException(status_code=503, detail="claude CLI not found")

    prompt = (
        f"Generate a concise 3-5 word title for this conversation. "
        f"Reply with ONLY the title, no punctuation, no quotes.\n\n"
        f"User: {user_msg}\nAssistant: {assistant_msg[:200]}"
    )
    try:
        proc = await asyncio.create_subprocess_exec(
            claude_bin, "-p", prompt, "--no-markdown",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=15.0)
        raw = stdout.decode(errors="replace").strip()
        title = raw.strip('"\'').replace("\n", " ").strip()[:80]
    except Exception:
        raise HTTPException(status_code=500, detail="Title generation failed")

    if title:
        from arz.session.session import Session
        assert isinstance(session, Session)
        session.title = title
        mgr.save(session)

    return {"title": session.title}
