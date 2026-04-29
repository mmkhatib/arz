"""Hooks config CRUD."""

from __future__ import annotations

import json
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request, status

from arz.dashboard.token_auth import require_token
from arz.hooks import get_hook_manager

router = APIRouter(dependencies=[Depends(require_token)])

_PATH = Path.home() / ".arz" / "hooks.json"


@router.get("/api/hooks")
async def get_hooks() -> dict:
    if not _PATH.exists():
        return {"auto_approve_tools": [], "auto_replies": [], "deny": []}
    try:
        return json.loads(_PATH.read_text(encoding="utf-8"))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"hooks.json malformed: {e}")


@router.put("/api/hooks", status_code=status.HTTP_204_NO_CONTENT)
async def put_hooks(request: Request) -> None:
    body = await request.json()
    if not isinstance(body, dict):
        raise HTTPException(status_code=422, detail="body must be a JSON object")
    _PATH.parent.mkdir(parents=True, exist_ok=True)
    _PATH.write_text(json.dumps(body, indent=2), encoding="utf-8")
    get_hook_manager().reload()
