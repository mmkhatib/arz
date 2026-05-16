"""Suggestions route — clickable prompt ideas for the dashboard new-session flow."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from arz.dashboard.token_auth import require_token
from arz.suggestions import get_cached, refresh_now, stats

router = APIRouter(dependencies=[Depends(require_token)])


@router.get("/api/suggestions")
async def list_suggestions() -> dict:
    return {"suggestions": get_cached(), **stats()}


@router.post("/api/suggestions/refresh")
async def force_refresh() -> dict:
    return {"suggestions": await refresh_now(), **stats()}
