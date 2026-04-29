"""Heartbeat checklist file edit + status."""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request, status

from arz.dashboard.token_auth import require_token

router = APIRouter(dependencies=[Depends(require_token)])

_PATH = Path.home() / ".arz" / "HEARTBEAT.md"


@router.get("/api/heartbeat")
async def get_heartbeat() -> dict:
    if not _PATH.exists():
        return {"path": str(_PATH), "content": ""}
    return {"path": str(_PATH), "content": _PATH.read_text(encoding="utf-8")}


@router.put("/api/heartbeat", status_code=status.HTTP_204_NO_CONTENT)
async def put_heartbeat(request: Request) -> None:
    body = await request.json()
    content = body.get("content")
    if content is None:
        raise HTTPException(status_code=422, detail="content required")
    _PATH.parent.mkdir(parents=True, exist_ok=True)
    _PATH.write_text(content, encoding="utf-8")
