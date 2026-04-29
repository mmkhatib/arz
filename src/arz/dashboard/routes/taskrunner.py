"""Task runner API."""

from __future__ import annotations

from dataclasses import asdict

from fastapi import APIRouter, Depends, HTTPException, Request, status

from arz.dashboard.token_auth import require_token
from arz.taskrunner import get_task_runner

router = APIRouter(dependencies=[Depends(require_token)])


@router.get("/api/taskrun")
async def list_tasks() -> list[dict]:
    return [asdict(t) for t in get_task_runner().list()]


@router.get("/api/taskrun/{task_id}")
async def get_task(task_id: str) -> dict:
    t = get_task_runner().get(task_id)
    if t is None:
        raise HTTPException(status_code=404, detail="Task not found")
    return asdict(t)


@router.post("/api/taskrun", status_code=status.HTTP_201_CREATED)
async def kick_off(request: Request) -> dict:
    body = await request.json()
    spec = (body.get("spec") or "").strip()
    agent = (body.get("agent") or "general").strip()
    if not spec:
        raise HTTPException(status_code=422, detail="spec required")
    try:
        rec = await get_task_runner().kick_off(spec, agent)
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    return asdict(rec)
