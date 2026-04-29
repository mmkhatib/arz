"""Subagent CRUD + spawn route."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status

from arz.dashboard.token_auth import require_token
from arz.subagents import get_subagent_manager

router = APIRouter(dependencies=[Depends(require_token)])


@router.get("/api/subagents")
async def list_subagents() -> list[dict]:
    mgr = get_subagent_manager()
    return [r.__dict__ for r in mgr.list_recent(limit=100)]


@router.get("/api/subagents/active")
async def list_active() -> list[dict]:
    return [r.__dict__ for r in get_subagent_manager().list_active()]


@router.post("/api/subagents", status_code=status.HTTP_201_CREATED)
async def spawn_subagent(request: Request) -> dict:
    body = await request.json()
    parent = (body.get("parent_session_id") or "").strip()
    agent = (body.get("agent_name") or "general").strip()
    prompt = (body.get("prompt") or "").strip()
    if not parent:
        raise HTTPException(status_code=422, detail="parent_session_id required")
    if not prompt:
        raise HTTPException(status_code=422, detail="prompt required")
    try:
        rec = get_subagent_manager().spawn(parent, agent, prompt)
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    return rec.__dict__


@router.get("/api/subagents/{sub_id}")
async def get_subagent(sub_id: str) -> dict:
    rec = get_subagent_manager().get(sub_id)
    if rec is None:
        raise HTTPException(status_code=404, detail="Subagent not found")
    return rec.__dict__
