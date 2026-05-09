"""Projects — group a brief, a task list, a memory namespace, and a
linked Channel under one umbrella.

Frontend hits these to render the /projects list and the right-rail
inside ChannelsPage when a channel has a project_id.
"""

from __future__ import annotations

import uuid
from dataclasses import asdict
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from arz.dashboard.token_auth import require_token
from arz.projects import Project, Task, TaskStatus, get_project_store

router = APIRouter(dependencies=[Depends(require_token)])


def _project_to_dict(p: Project) -> dict:
    return {
        "id": p.id,
        "name": p.name,
        "brief": p.brief,
        "repo_path": p.repo_path,
        "status": p.status,
        "channel_id": p.channel_id,
        "tasks": [asdict(t) for t in p.tasks],
        "open_tasks": p.open_tasks(),
        "created_at": p.created_at,
        "updated_at": p.updated_at,
        "autopilot_idle_s": p.autopilot_idle_s,
        "autopilot_max_iterations": p.autopilot_max_iterations,
        "autopilot_iterations": p.autopilot_iterations,
        "budget_tokens": p.budget_tokens,
        "budget_usd_cents": p.budget_usd_cents,
        "spent_tokens": p.spent_tokens,
        "spent_usd_cents": p.spent_usd_cents,
        "max_concurrent_subagents": p.max_concurrent_subagents,
    }


class CreateBody(BaseModel):
    name: str
    brief: str = ""
    repo_path: str = ""
    channel_id: str | None = None


class PatchBody(BaseModel):
    name: str | None = None
    brief: str | None = None
    repo_path: str | None = None
    status: Literal["active", "paused", "done", "archived"] | None = None
    channel_id: str | None = None
    autopilot_idle_s: int | None = None
    autopilot_max_iterations: int | None = None
    budget_tokens: int | None = None
    budget_usd_cents: int | None = None
    max_concurrent_subagents: int | None = None


class TaskCreateBody(BaseModel):
    title: str
    description: str = ""
    assignee: str | None = None
    depends_on: list[str] = []


class TaskPatchBody(BaseModel):
    title: str | None = None
    description: str | None = None
    assignee: str | None = None
    status: TaskStatus | None = None
    depends_on: list[str] | None = None
    artifacts: list[str] | None = None


@router.get("/api/projects")
async def list_projects() -> list[dict]:
    return [_project_to_dict(p) for p in get_project_store().list()]


@router.get("/api/projects/{project_id}")
async def get_project(project_id: str) -> dict:
    p = get_project_store().get(project_id)
    if not p:
        raise HTTPException(status_code=404, detail="project not found")
    return _project_to_dict(p)


@router.post("/api/projects", status_code=201)
async def create_project(body: CreateBody) -> dict:
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(status_code=422, detail="name required")
    store = get_project_store()
    p = store.create(name=name, brief=body.brief or "", repo_path=body.repo_path or "")
    if body.channel_id:
        p.channel_id = body.channel_id
        store.save(p)
    return _project_to_dict(p)


@router.patch("/api/projects/{project_id}")
async def patch_project(project_id: str, body: PatchBody) -> dict:
    store = get_project_store()
    p = store.get(project_id)
    if not p:
        raise HTTPException(status_code=404, detail="project not found")
    for field_name, val in body.model_dump(exclude_unset=True).items():
        if val is None:
            continue
        if hasattr(p, field_name):
            setattr(p, field_name, val)
    return _project_to_dict(store.save(p))


@router.delete("/api/projects/{project_id}", status_code=204)
async def delete_project(project_id: str) -> None:
    if not get_project_store().delete(project_id):
        raise HTTPException(status_code=404, detail="project not found")


# ── tasks ─────────────────────────────────────────────────────────


@router.post("/api/projects/{project_id}/tasks", status_code=201)
async def create_task(project_id: str, body: TaskCreateBody) -> dict:
    store = get_project_store()
    p = store.get(project_id)
    if not p:
        raise HTTPException(status_code=404, detail="project not found")
    task = Task(
        id=uuid.uuid4().hex[:10],
        title=(body.title or "").strip()[:200] or "Untitled",
        description=body.description or "",
        assignee=body.assignee or None,
        depends_on=list(body.depends_on or []),
    )
    p2 = store.add_task(project_id, task)
    if not p2:
        raise HTTPException(status_code=500, detail="add failed")
    return asdict(task)


@router.patch("/api/projects/{project_id}/tasks/{task_id}")
async def patch_task(project_id: str, task_id: str, body: TaskPatchBody) -> dict:
    store = get_project_store()
    changes = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
    p = store.update_task(project_id, task_id, **changes)
    if not p:
        raise HTTPException(status_code=404, detail="task not found")
    task = next((t for t in p.tasks if t.id == task_id), None)
    if task is None:
        raise HTTPException(status_code=404, detail="task not found after update")
    return asdict(task)


@router.delete("/api/projects/{project_id}/tasks/{task_id}", status_code=204)
async def delete_task(project_id: str, task_id: str) -> None:
    store = get_project_store()
    p = store.get(project_id)
    if not p:
        raise HTTPException(status_code=404, detail="project not found")
    new_tasks = [t for t in p.tasks if t.id != task_id]
    if len(new_tasks) == len(p.tasks):
        raise HTTPException(status_code=404, detail="task not found")
    p.tasks = new_tasks
    store.save(p)
