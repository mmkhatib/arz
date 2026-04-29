"""Consolidator API — manual trigger + state inspection."""

from __future__ import annotations

import json
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request

from arz.consolidator import get_consolidator
from arz.dashboard.token_auth import require_token

router = APIRouter(dependencies=[Depends(require_token)])

_STATE_PATH = Path.home() / ".arz" / "consolidator_state.json"


@router.get("/api/consolidate/status")
async def status() -> dict:
    if _STATE_PATH.exists():
        try:
            return {"state": json.loads(_STATE_PATH.read_text(encoding="utf-8"))}
        except Exception:
            return {"state": {}}
    return {"state": {}}


@router.post("/api/consolidate")
async def run_consolidation(request: Request) -> dict:
    body = await request.json() if request.headers.get("content-type") == "application/json" else {}
    force = bool(body.get("force", False))
    try:
        consolidator = get_consolidator()
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    return await consolidator.consolidate_all(force=force)
