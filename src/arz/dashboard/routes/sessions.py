"""Session CRUD routes."""

from __future__ import annotations

import asyncio
import json
import os
import re
import shutil

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import PlainTextResponse, Response

from arz.dashboard.token_auth import require_token
from arz.session.manager import SessionManager

router = APIRouter(dependencies=[Depends(require_token)])


def _get_manager(request: Request) -> SessionManager:
    return request.app.state.session_manager


def _session_to_dict(session: object) -> dict:
    from arz.session.session import Session
    from arz.dashboard.stream_registry import get_stream_registry
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
        "work_dir": session.work_dir,
        "provider": session.provider,
        "model": session.model,
        "agent": session.agent,
        "approval_mode": session.approval_mode,
        "streaming": get_stream_registry().is_streaming(session.id),
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
    from arz.session.session import Session
    assert isinstance(session, Session)
    dirty = False
    if body.get("provider"):
        session.provider = body["provider"]
        dirty = True
    if body.get("model"):
        session.model = body["model"]
        dirty = True
    if dirty:
        mgr.save(session)
    return _session_to_dict(session)


@router.get("/api/sessions/history")
async def list_history(request: Request) -> list[dict]:
    mgr: SessionManager = _get_manager(request)
    return [_session_to_dict(s) for s in mgr.list_inactive()]


@router.post("/api/sessions/{session_id}/reactivate")
async def reactivate_session(session_id: str, request: Request) -> dict:
    mgr: SessionManager = _get_manager(request)
    session = mgr.reactivate(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
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


_SLUG_RE = re.compile(r"[^a-zA-Z0-9-]+")


def _slugify(s: str) -> str:
    out = _SLUG_RE.sub("-", s.strip()).strip("-").lower()
    return out[:60] or "session"


@router.get("/api/sessions/{session_id}/export")
async def export_session(session_id: str, request: Request, format: str = "markdown"):
    """Download a session as Markdown or JSON."""
    mgr: SessionManager = _get_manager(request)
    session = mgr.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    fmt = format.lower()
    if fmt == "json":
        payload = {
            **_session_to_dict(session),
            "messages": [m.to_dict() for m in session.messages],
        }
        body = json.dumps(payload, indent=2)
        filename = f"{_slugify(session.title)}-{session.id[:8]}.json"
        return Response(
            content=body,
            media_type="application/json",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    if fmt == "markdown":
        lines: list[str] = [f"# {session.title}", ""]
        lines.append(f"- Session ID: `{session.id}`")
        lines.append(f"- Created: {session.created_at.isoformat()}")
        lines.append(f"- Updated: {session.updated_at.isoformat()}")
        if session.provider:
            lines.append(f"- Provider: {session.provider}")
        lines.append("")
        lines.append("---")
        lines.append("")
        for m in session.messages:
            heading = {"user": "🧑 User", "assistant": "🌲 Arzeh", "system": "🛠 System"}.get(
                m.role, m.role
            )
            lines.append(f"## {heading}  ·  {m.created_at.isoformat()}")
            lines.append("")
            lines.append(m.text)
            lines.append("")
        body = "\n".join(lines)
        filename = f"{_slugify(session.title)}-{session.id[:8]}.md"
        return PlainTextResponse(
            content=body,
            media_type="text/markdown",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    raise HTTPException(status_code=422, detail="format must be 'markdown' or 'json'")


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


@router.delete("/api/sessions/{session_id}/permanent", status_code=status.HTTP_204_NO_CONTENT)
async def delete_session_permanent(session_id: str, request: Request) -> None:
    """Hard-delete a session: removes the JSON file and clears in-memory state.

    Closing a session keeps the file so it can be resumed from history.
    This endpoint is the destructive variant — used by the history-purge UI.
    """
    mgr: SessionManager = _get_manager(request)
    session = mgr.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    # Drop in-memory references and the on-disk file
    key = (session.surface, session.chat_id, session.thread_id)
    mgr._surface_index.pop(key, None)  # noqa: SLF001
    mgr._sessions.pop(session_id, None)  # noqa: SLF001
    path = mgr._dir / f"{session_id}.json"  # noqa: SLF001
    try:
        path.unlink(missing_ok=True)
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"Failed to remove session file: {e}")

    # Clean ancillary state
    search_index = getattr(request.app.state, "search_index", None)
    if search_index is not None:
        try:
            search_index.remove_session(session_id)
        except Exception:
            pass
    request.app.state.session_map.remove(session_id) if hasattr(request.app.state, "session_map") else None
    pool = getattr(request.app.state, "provider_pool", None)
    if pool is not None:
        try:
            await pool.deactivate(session_id)
        except Exception:
            pass


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


@router.patch("/api/sessions/{session_id}/agent", status_code=status.HTTP_204_NO_CONTENT)
async def set_session_agent(session_id: str, request: Request) -> None:
    """Switch the agent (role) on an existing session.

    An agent is a role: system prompt + approval mode + tool allowlist. It
    does NOT change which LLM is running. The session's existing provider
    and model are preserved — picking 'writer' on a Kiro session keeps you
    on Kiro. The agent's `provider`/`model` fields are treated as preferred
    defaults used only when starting a brand-new session from the agent
    (handled elsewhere), never as overrides on an active session.
    """
    mgr = _get_manager(request)
    session = mgr.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    body = await request.json()
    agent_name = (body.get("agent") or "").strip() or None
    from arz.session.session import Session
    assert isinstance(session, Session)

    if agent_name:
        registry = getattr(request.app.state, "agent_registry", None)
        if registry is None:
            from arz.agents import AgentRegistry
            registry = AgentRegistry()
            request.app.state.agent_registry = registry
        agent = registry.get(agent_name)
        session.agent = agent_name
        if agent is not None and agent.approval_mode:
            session.approval_mode = agent.approval_mode
    else:
        session.agent = None
    mgr.save(session)
    pool = getattr(request.app.state, "provider_pool", None)
    if pool is not None:
        await pool.deactivate(session_id)


@router.post("/api/sessions/from-agent", status_code=status.HTTP_201_CREATED)
async def create_session_from_agent(request: Request) -> dict:
    """Create a fresh session pre-filled from an agent's full config.

    This is the one place where an agent's preferred provider/model DO
    apply — because there's no active session yet, "preferred" effectively
    becomes the default.
    """
    body = await request.json() if request.headers.get("content-type") == "application/json" else {}
    agent_name = (body.get("agent") or "").strip()
    if not agent_name:
        raise HTTPException(status_code=422, detail="agent required")
    registry = getattr(request.app.state, "agent_registry", None)
    if registry is None:
        from arz.agents import AgentRegistry
        registry = AgentRegistry()
        request.app.state.agent_registry = registry
    agent = registry.get(agent_name)
    if agent is None:
        raise HTTPException(status_code=404, detail=f"Agent '{agent_name}' not found")

    mgr: SessionManager = _get_manager(request)
    session = mgr.create(
        surface=body.get("surface", "dashboard"),
        chat_id=body.get("chat_id", "web"),
        thread_id=body.get("thread_id"),
    )
    from arz.session.session import Session
    assert isinstance(session, Session)
    session.agent = agent_name
    if agent.provider:
        session.provider = agent.provider
    if agent.model:
        session.model = agent.model
    if agent.approval_mode:
        session.approval_mode = agent.approval_mode
    if agent.work_dir:
        session.work_dir = agent.work_dir
    mgr.save(session)
    return _session_to_dict(session)


@router.patch("/api/sessions/{session_id}/model", status_code=status.HTTP_204_NO_CONTENT)
async def set_session_model(session_id: str, request: Request) -> None:
    mgr = _get_manager(request)
    session = mgr.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    body = await request.json()
    model = (body.get("model") or "").strip()
    from arz.session.session import Session
    assert isinstance(session, Session)
    session.model = model or None
    mgr.save(session)
    # Drop the existing provider so the next message rebuilds with the new model.
    pool = getattr(request.app.state, "provider_pool", None)
    if pool is not None:
        await pool.deactivate(session_id)


@router.patch("/api/sessions/{session_id}/workdir", status_code=status.HTTP_204_NO_CONTENT)
async def set_work_dir(session_id: str, request: Request) -> None:
    mgr = _get_manager(request)
    session = mgr.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    body = await request.json()
    path = (body.get("path") or "").strip()
    if path and not os.path.isabs(path):
        raise HTTPException(status_code=422, detail="path must be absolute")
    from arz.session.session import Session
    assert isinstance(session, Session)
    session.work_dir = path or None
    mgr.save(session)


@router.patch("/api/sessions/{session_id}/title", status_code=status.HTTP_204_NO_CONTENT)
async def rename_session(session_id: str, request: Request) -> None:
    """Manually rename a session."""
    mgr: SessionManager = _get_manager(request)
    session = mgr.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    body = await request.json()
    new_title = (body.get("title") or "").strip()
    if not new_title:
        raise HTTPException(status_code=422, detail="title must be non-empty")
    if len(new_title) > 200:
        raise HTTPException(status_code=422, detail="title must be ≤200 chars")
    from arz.session.session import Session
    assert isinstance(session, Session)
    session.title = new_title
    mgr.save(session)


@router.post("/api/sessions/{session_id}/generate-title")
async def generate_title(session_id: str, request: Request) -> dict:
    mgr: SessionManager = _get_manager(request)
    session = mgr.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    body = {}
    try:
        body = await request.json()
    except Exception:
        pass
    user_msg: str = (body.get("user_msg") or "")[:300]
    assistant_msg: str = (body.get("assistant_msg") or "")[:300]
    # Fall back to first user/assistant turn from history when omitted.
    if not user_msg or not assistant_msg:
        from arz.session.session import Session
        assert isinstance(session, Session)
        first_user = next((m for m in session.messages if m.role == "user"), None)
        first_asst = next((m for m in session.messages if m.role == "assistant"), None)
        if not user_msg and first_user:
            user_msg = first_user.text[:300]
        if not assistant_msg and first_asst:
            assistant_msg = first_asst.text[:300]
    if not user_msg:
        raise HTTPException(status_code=422, detail="session has no user messages to title from")

    prompt = (
        f"Generate a concise 3-5 word title for this conversation. "
        f"Reply with ONLY the title, no punctuation, no quotes, no markdown.\n\n"
        f"User: {user_msg}\nAssistant: {assistant_msg[:200]}"
    )

    # Use the session's actual provider + model. Falls back to global config.
    cfg = request.app.state.config
    from arz.session.session import Session
    assert isinstance(session, Session)
    provider_name = session.provider or cfg.provider.name
    model_name = session.model or ""

    title = ""
    try:
        title = await _generate_title_via_provider(provider_name, model_name, prompt)
    except Exception as e:
        # Last-ditch fallback: if claude is on PATH and the configured
        # provider failed, try claude. Title generation shouldn't be a
        # blocker.
        claude_bin = shutil.which("claude")
        if claude_bin:
            try:
                proc = await asyncio.create_subprocess_exec(
                    claude_bin, "-p", prompt, "--no-markdown",
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.DEVNULL,
                )
                stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=15.0)
                title = stdout.decode(errors="replace").strip().strip('"\'').replace("\n", " ").strip()[:80]
            except Exception:
                pass
        if not title:
            raise HTTPException(status_code=500, detail=f"Title generation failed: {e}")

    if title:
        session.title = title
        mgr.save(session)
    return {"title": session.title}


async def _generate_title_via_provider(provider_name: str, model: str, prompt: str) -> str:
    """One-shot run against the session's actual provider. Uses the same
    provider classes as the chat runtime so 'rename with current model'
    actually means the model the user picked."""
    from arz.acp.types import EVENT_COMPLETE, EVENT_TEXT_CHUNK
    from arz.providers.base import LLMProvider

    provider: LLMProvider
    if provider_name == "claude-code":
        from arz.providers.claude_code import ClaudeCodeProvider
        provider = ClaudeCodeProvider(model=model or None)
    elif provider_name == "kiro-cli":
        from arz.providers.kiro_cli import KiroCliProvider
        provider = KiroCliProvider(model=model or "auto")
    elif provider_name == "codex":
        from arz.providers.codex import CodexProvider
        provider = CodexProvider(model=model or None)
    elif provider_name == "gemini":
        from arz.providers.gemini import GeminiProvider
        provider = GeminiProvider(model=model or None)
    elif provider_name == "ollama":
        from arz.providers.ollama import OllamaProvider
        provider = OllamaProvider(model=model or None)
    else:
        raise RuntimeError(f"unsupported provider for title gen: {provider_name!r}")

    text = ""
    try:
        await provider.start()
        async for event in provider.stream(prompt):
            if event.kind == EVENT_TEXT_CHUNK and event.text:
                text += event.text
            elif event.kind == EVENT_COMPLETE:
                break
    finally:
        try:
            await provider.shutdown()
        except Exception:
            pass

    # Tighten the model's output into a clean title.
    title = text.strip().strip('"\'').replace("\n", " ").strip()
    # Strip any markdown / code fences the model may have added
    title = title.strip("`").strip()
    if title.lower().startswith(("title:", "answer:")):
        title = title.split(":", 1)[1].strip()
    return title[:80]
