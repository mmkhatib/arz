"""Workspace switcher route.

Mirrors MeshClaw §1.7. The active workspace name controls which
``~/.arz/[workspace/<name>/]memory/`` directory the markdown memory
layer reads from. Sqlite memory.db remains shared until Phase 5
ports semantic + episodic onto a workspace-aware connect path.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request

from arz.dashboard.token_auth import require_token
from arz.memory.workspace import (
    get_active_workspace,
    list_workspaces,
    set_active_workspace,
)

router = APIRouter(dependencies=[Depends(require_token)])


@router.get("/api/workspace")
async def get_workspace() -> dict:
    return {"active": get_active_workspace(), "available": list_workspaces()}


@router.post("/api/workspace")
async def switch_workspace(request: Request) -> dict:
    body = await request.json()
    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(422, "name required")
    actual = set_active_workspace(name)
    return {"active": actual, "available": list_workspaces()}
