"""Cron CRUD routes."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from arz.dashboard.token_auth import require_token

router = APIRouter(dependencies=[Depends(require_token)])


class CronCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    prompt: str = Field(min_length=1, max_length=10_000)
    schedule: str = Field(min_length=3, max_length=120, description="5-field cron expression")
    enabled: bool = True
    persistent_session: bool = False


class CronPatch(BaseModel):
    name: str | None = None
    prompt: str | None = None
    schedule: str | None = None
    enabled: bool | None = None
    persistent_session: bool | None = None


class CronResponse(BaseModel):
    id: int
    name: str
    prompt: str
    schedule: str
    enabled: bool
    created_at: float
    last_run_at: float | None = None
    last_status: str | None = None
    last_session_id: str | None = None
    persistent_session: bool = False


def _registry(request: Request):
    return request.app.state.cron_registry


@router.get("/api/cron", response_model=list[CronResponse])
async def list_crons(request: Request) -> list[CronResponse]:
    return [CronResponse(**e.to_dict()) for e in _registry(request).list()]


@router.post("/api/cron", response_model=CronResponse, status_code=201)
async def create_cron(body: CronCreate, request: Request) -> CronResponse:
    try:
        entry = _registry(request).create(
            name=body.name,
            prompt=body.prompt,
            schedule=body.schedule,
            enabled=body.enabled,
            persistent_session=body.persistent_session,
        )
    except ValueError as e:
        raise HTTPException(status_code=422, detail=f"invalid cron expression: {e}")
    return CronResponse(**entry.to_dict())


@router.patch("/api/cron/{cron_id}", response_model=CronResponse)
async def update_cron(cron_id: int, body: CronPatch, request: Request) -> CronResponse:
    try:
        entry = _registry(request).update(
            cron_id,
            name=body.name,
            prompt=body.prompt,
            schedule=body.schedule,
            enabled=body.enabled,
            persistent_session=body.persistent_session,
        )
    except ValueError as e:
        raise HTTPException(status_code=422, detail=f"invalid cron expression: {e}")
    if not entry:
        raise HTTPException(status_code=404, detail="cron not found")
    return CronResponse(**entry.to_dict())


@router.delete("/api/cron/{cron_id}", status_code=204)
async def delete_cron(cron_id: int, request: Request) -> None:
    if not _registry(request).delete(cron_id):
        raise HTTPException(status_code=404, detail="cron not found")


@router.post("/api/cron/{cron_id}/run", response_model=dict)
async def run_cron_now(cron_id: int, request: Request) -> dict:
    if not _registry(request).run_now(cron_id):
        raise HTTPException(status_code=404, detail="cron not found")
    return {"queued": True}
