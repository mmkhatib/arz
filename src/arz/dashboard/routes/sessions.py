"""Session CRUD routes."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import shutil

from fastapi import APIRouter, Depends, HTTPException, Request, status

log = logging.getLogger(__name__)
from fastapi.responses import PlainTextResponse, Response

from arz.dashboard.token_auth import require_token
from arz.session.manager import SessionManager

router = APIRouter(dependencies=[Depends(require_token)])


def _get_manager(request: Request) -> SessionManager:
    return request.app.state.session_manager


def _session_to_dict(session: object) -> dict:
    from arz.dashboard.stream_registry import get_stream_registry
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
        "work_dir": session.work_dir,
        "provider": session.provider,
        "model": session.model,
        "agent": session.agent,
        "approval_mode": session.approval_mode,
        "streaming": get_stream_registry().is_streaming(session.id),
        "autonudge_goal": session.autonudge_goal,
        "autonudge_idle_s": session.autonudge_idle_s,
        "autonudge_iterations": session.autonudge_iterations,
        "autonudge_max_iterations": session.autonudge_max_iterations,
        "goal": getattr(session, "goal", None),
        "goal_status": getattr(session, "goal_status", "active"),
        "goal_set_at": getattr(session, "goal_set_at", 0.0),
        "goal_iterations": getattr(session, "goal_iterations", 0),
        "goal_max_iterations": getattr(session, "goal_max_iterations", 20),
        "goal_last_reason": getattr(session, "goal_last_reason", ""),
        "pinned": getattr(session, "pinned", False),
        "archived": getattr(session, "archived", False),
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


@router.patch("/api/sessions/{session_id}/autonudge", status_code=status.HTTP_204_NO_CONTENT)
async def set_autonudge(session_id: str, request: Request) -> None:
    """Configure AutoNudge for a session.

    Body fields (all optional, only provided ones are updated):
      goal: str | null   — set/clear the running goal
      idle_s: int        — seconds of idleness before a nudge fires; 0 = off
      max_iterations: int — safety cap; default 20
      reset_iterations: bool — zero out the iteration counter
    """
    mgr: SessionManager = _get_manager(request)
    session = mgr.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    body = await request.json()
    from arz.session.session import Session

    assert isinstance(session, Session)
    if "goal" in body:
        g = body.get("goal")
        session.autonudge_goal = (g or "").strip() or None
    if "idle_s" in body:
        try:
            session.autonudge_idle_s = max(0, int(body.get("idle_s") or 0))
        except (TypeError, ValueError):
            raise HTTPException(status_code=422, detail="idle_s must be int")
    if "max_iterations" in body:
        try:
            session.autonudge_max_iterations = max(1, int(body.get("max_iterations") or 20))
        except (TypeError, ValueError):
            raise HTTPException(status_code=422, detail="max_iterations must be int")
    if body.get("reset_iterations"):
        session.autonudge_iterations = 0
    mgr.save(session)


@router.put("/api/sessions/{session_id}/goal", status_code=status.HTTP_202_ACCEPTED)
async def set_session_goal(session_id: str, request: Request) -> dict:
    """Set or update the persistent goal for a session.

    Body: ``{"goal": "ship the auth refactor"}``. Setting an empty
    string clears the goal. The goal is injected as a `<goal>` block
    into every turn's memory prefix until cleared or marked done.

    Matches Claude Code's `/goal`: setting a goal IMMEDIATELY fires
    the first auto-turn with the goal as the directive — the user
    doesn't have to send a separate prompt. The auto-iteration loop
    (in chat.py) takes over from there.
    """
    import asyncio
    import time as _time

    mgr: SessionManager = _get_manager(request)
    session = mgr.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    body = await request.json()
    goal = (body.get("goal") or "").strip()
    from arz.session.session import Session

    assert isinstance(session, Session)
    fired = False
    if goal:
        session.goal = goal
        session.goal_status = "active"
        session.goal_set_at = _time.time()
        # Reset the iteration counter on each new/replaced goal so
        # the budget restarts fresh.
        session.goal_iterations = 0
        session.goal_last_reason = ""
        mgr.save(session)
        # Kick off the first turn so the model starts working
        # immediately — no separate user prompt required.
        chat_runner = getattr(request.app.state, "chat_runner", None)
        if chat_runner is not None:
            kickoff = (
                "[goal-start] Begin working toward this goal. "
                "Make tangible progress on each turn. "
                "Use tools as needed. "
                "If the goal is complete, end your reply with the "
                "literal token `goal:done`.\n\n"
                f"Goal:\n{goal}"
            )
            log.info(
                "goal kickoff scheduling",
                extra={"session_id": session_id, "goal_len": len(goal)},
            )

            async def _kickoff() -> None:
                log.info("goal kickoff posting", extra={"session_id": session_id})
                try:
                    await chat_runner(session_id, kickoff, extra_body={"_goal_auto": True})
                    log.info("goal kickoff posted ok", extra={"session_id": session_id})
                except TypeError:
                    try:
                        await chat_runner(session_id, kickoff)
                        log.info(
                            "goal kickoff posted ok (fallback)",
                            extra={"session_id": session_id},
                        )
                    except Exception:
                        log.exception("goal kickoff fallback failed")
                except Exception:
                    log.exception("goal kickoff failed")

            asyncio.create_task(_kickoff())
            # Yield once so the task actually starts before we return —
            # otherwise the response can race ahead of the task and the
            # frontend's reattach poll finds nothing in flight yet.
            await asyncio.sleep(0)
            fired = True
    else:
        session.goal = None
        session.goal_status = "active"
        session.goal_set_at = 0.0
        session.goal_iterations = 0
        session.goal_last_reason = ""
        mgr.save(session)
    return {"goal": session.goal, "kickoff_fired": fired}


@router.post("/api/sessions/{session_id}/goal/done", status_code=status.HTTP_204_NO_CONTENT)
async def mark_session_goal_done(session_id: str, request: Request) -> None:
    """Mark the current goal as done. Keeps the text so it's still
    visible in the audit trail; stops injecting it into the prefix."""
    mgr: SessionManager = _get_manager(request)
    session = mgr.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    from arz.session.session import Session

    assert isinstance(session, Session)
    session.goal_status = "done"
    mgr.save(session)


@router.delete("/api/sessions/{session_id}/goal", status_code=status.HTTP_204_NO_CONTENT)
async def clear_session_goal(session_id: str, request: Request) -> None:
    mgr: SessionManager = _get_manager(request)
    session = mgr.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    from arz.session.session import Session

    assert isinstance(session, Session)
    session.goal = None
    session.goal_status = "active"
    session.goal_set_at = 0.0
    mgr.save(session)


@router.patch(
    "/api/sessions/{session_id}/messages/{index}/version", status_code=status.HTTP_204_NO_CONTENT
)
async def select_message_version(session_id: str, index: int, request: Request) -> None:
    """Switch the visible text on an assistant message that has multiple
    regenerated versions. ``index`` is the position in ``session.messages``;
    body is ``{"version": N}`` (0-based into msg.versions)."""
    mgr: SessionManager = _get_manager(request)
    session = mgr.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    body = await request.json()
    v = body.get("version")
    if not isinstance(v, int):
        raise HTTPException(status_code=422, detail="version must be int")
    if index < 0 or index >= len(session.messages):
        raise HTTPException(status_code=404, detail="message index out of range")
    msg = session.messages[index]
    if not msg.versions:
        raise HTTPException(status_code=400, detail="message has no versions")
    if v < 0 or v >= len(msg.versions):
        raise HTTPException(status_code=422, detail="version index out of range")
    msg.text = msg.versions[v]
    msg.version_index = v
    mgr.save(session)


@router.post("/api/sessions/{session_id}/fork", status_code=status.HTTP_201_CREATED)
async def fork_session(session_id: str, request: Request) -> dict:
    """Duplicate a session into a new one.

    Body:
      ``up_to_index`` (int, optional) — keep only the first N messages of
      the source. Default is the full history.
      ``initial_prompt`` (str, optional) — append this as a fresh user
      message to the new fork.
    """
    mgr: SessionManager = _get_manager(request)
    src = mgr.get(session_id)
    if not src:
        raise HTTPException(status_code=404, detail="Source session not found")

    body = await request.json() if request.headers.get("content-type") == "application/json" else {}
    up_to = body.get("up_to_index")
    initial_prompt = (body.get("initial_prompt") or "").strip() or None

    from arz.session.session import Message, Session

    assert isinstance(src, Session)

    fork = mgr.create(
        surface=src.surface,
        chat_id=src.chat_id,
        thread_id=None,
    )
    fork.title = f"{src.title} (fork)"
    fork.provider = src.provider
    fork.model = src.model
    fork.agent = src.agent
    fork.approval_mode = src.approval_mode
    fork.work_dir = src.work_dir
    fork.color = src.color

    msgs = list(src.messages)
    if isinstance(up_to, int) and 0 <= up_to <= len(msgs):
        msgs = msgs[:up_to]
    # Deep-copy each message so edits to the fork don't mutate the source.
    fork.messages = [
        Message(**m.to_dict_for_clone())
        if hasattr(m, "to_dict_for_clone")
        else Message(
            role=m.role,
            text=m.text,
            created_at=m.created_at,
            usage=m.usage,
            model=m.model,
            elapsed_ms=m.elapsed_ms,
            tool_calls=list(m.tool_calls) if m.tool_calls else None,
        )
        for m in msgs
    ]
    if initial_prompt:
        fork.add_message("user", initial_prompt)
    mgr.save(fork)
    return _session_to_dict(fork)


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

    NOTE — destroy vs sleep: this is the only place the SessionMap entry
    (native CLI session ID) is forcibly cleared. Process-only teardown
    (pool eviction, idle kill) must NEVER touch SessionMap, otherwise
    conversation history can't be resumed on the next user message.
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
    request.app.state.session_map.remove(session_id) if hasattr(
        request.app.state, "session_map"
    ) else None
    pool = getattr(request.app.state, "provider_pool", None)
    if pool is not None:
        try:
            await pool.deactivate(session_id)
        except Exception:
            pass


@router.patch("/api/sessions/{session_id}/pin", status_code=status.HTTP_204_NO_CONTENT)
async def set_session_pin(session_id: str, request: Request) -> None:
    mgr: SessionManager = _get_manager(request)
    session = mgr.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    body = await request.json()
    from arz.session.session import Session

    assert isinstance(session, Session)
    session.pinned = bool(body.get("pinned", False))
    mgr.save(session)


@router.patch("/api/sessions/{session_id}/archive", status_code=status.HTTP_204_NO_CONTENT)
async def set_session_archive(session_id: str, request: Request) -> None:
    mgr: SessionManager = _get_manager(request)
    session = mgr.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    body = await request.json()
    from arz.session.session import Session

    assert isinstance(session, Session)
    session.archived = bool(body.get("archived", True))
    mgr.save(session)


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

    # Title generation is a tiny task — prefer a cheap model over the
    # session's working model. Order: smallest local Ollama → claude
    # haiku → session model fallback.
    cfg = request.app.state.config
    from arz.session.session import Session

    assert isinstance(session, Session)
    provider_name, model_name = await _pick_cheap_model(
        fallback_provider=session.provider or cfg.provider.name,
        fallback_model=session.model or "",
    )

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
                    claude_bin,
                    "-p",
                    prompt,
                    "--no-markdown",
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.DEVNULL,
                )
                stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=15.0)
                title = (
                    stdout.decode(errors="replace")
                    .strip()
                    .strip("\"'")
                    .replace("\n", " ")
                    .strip()[:80]
                )
            except Exception:
                pass
        if not title:
            raise HTTPException(status_code=500, detail=f"Title generation failed: {e}")

    if title:
        session.title = title
        mgr.save(session)
    return {"title": session.title}


@router.post("/api/prompts/improve")
async def improve_prompt(request: Request) -> dict:
    """Rewrite a user draft into a sharper version of itself via a cheap
    one-shot LLM call. Used by the chat composer's "Improve with AI"
    button so the user can refine fuzzy asks before sending.

    Body: { text: str, session_id?: str }
    Returns: { improved: str, model: str }
    """
    body = {}
    try:
        body = await request.json()
    except Exception:
        pass
    draft = (body.get("text") or "").strip()
    session_id = (body.get("session_id") or "").strip()
    if not draft:
        raise HTTPException(status_code=422, detail="text required")
    if len(draft) > 4000:
        raise HTTPException(status_code=422, detail="text too long (max 4000 chars)")

    # Pull the session's provider/model as the fallback so the rewrite
    # mirrors whatever model the user is talking to.
    cfg = request.app.state.config
    fallback_provider = cfg.provider.name
    fallback_model = cfg.provider.model or ""
    if session_id:
        mgr: SessionManager = _get_manager(request)
        s = mgr.get(session_id)
        if s is not None:
            fallback_provider = s.provider or fallback_provider
            fallback_model = s.model or fallback_model

    provider_name, model_name = await _pick_cheap_model(
        fallback_provider=fallback_provider, fallback_model=fallback_model
    )

    prompt = (
        "Rewrite the following message to be a sharper, more effective prompt for an "
        "autonomous coding assistant. Preserve the user's intent and any specific "
        "names / paths / numbers exactly. Make it concrete, action-oriented, and tight. "
        "Reply with ONLY the rewritten prompt — no commentary, no preface, no quotes, "
        "no markdown fences.\n\nORIGINAL:\n" + draft
    )

    try:
        improved = await _generate_title_via_provider(provider_name, model_name, prompt)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"improve failed: {e}") from e

    improved = (improved or "").strip().strip('"').strip("'").strip("`").strip()
    if not improved:
        raise HTTPException(status_code=500, detail="model returned empty rewrite")
    # Hard-cap so a runaway response doesn't drown the composer.
    if len(improved) > 6000:
        improved = improved[:6000]
    return {"improved": improved, "model": f"{provider_name}:{model_name}"}


async def _pick_cheap_model(*, fallback_provider: str, fallback_model: str) -> tuple[str, str]:
    """Pick the cheapest LLM available for a tiny task (title gen, etc.).

    Smallest local Ollama wins. Falls back to claude-code haiku, then to
    whatever the session is configured with.
    """
    import shutil

    try:
        from arz.installer import list_installed_ollama_models

        models = await list_installed_ollama_models()
    except Exception:
        models = []

    def _params(m: dict) -> float:
        # parameter_size is e.g. "1.7B" / "4B" / "70.6B"
        s = (m.get("parameter_size") or m.get("name") or "").upper()
        for tok in s.replace("(", " ").replace(")", " ").split():
            if tok.endswith("B"):
                try:
                    return float(tok[:-1])
                except Exception:
                    continue
        return 9999.0

    if models:
        smallest = min(models, key=_params)
        name = smallest.get("name") or smallest.get("model")
        if name:
            return ("ollama", name)

    if shutil.which("claude"):
        return ("claude-code", "claude-haiku-4-5")

    return (fallback_provider, fallback_model)


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
    title = text.strip().strip("\"'").replace("\n", " ").strip()
    # Strip any markdown / code fences the model may have added
    title = title.strip("`").strip()
    if title.lower().startswith(("title:", "answer:")):
        title = title.split(":", 1)[1].strip()
    return title[:80]
