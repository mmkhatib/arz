"""File routes — read and list local files for the dashboard."""

from __future__ import annotations

import os
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from arz.dashboard.token_auth import require_token

router = APIRouter(dependencies=[Depends(require_token)])

_MAX_BYTES = 2 * 1024 * 1024  # 2 MB cap
_WORKSPACE_ROOT = Path.home() / ".arz" / "workspace"
_MAX_FILES = 500


@router.get("/api/files/read")
async def read_file(path: str = Query(...)) -> dict:
    """Return the content of a local file as a JSON payload."""
    if not os.path.isabs(path):
        raise HTTPException(status_code=400, detail="path must be absolute")

    p = Path(path)
    if not p.exists():
        raise HTTPException(status_code=404, detail="File not found")
    if not p.is_file():
        raise HTTPException(status_code=404, detail="Not a file")

    size = p.stat().st_size
    if size > _MAX_BYTES:
        raise HTTPException(status_code=413, detail=f"File too large ({size} bytes, max 2 MB)")

    try:
        content = p.read_text(errors="replace")
    except OSError as exc:
        raise HTTPException(status_code=404, detail=f"Cannot read file: {exc}") from exc

    return {
        "content": content,
        "path": str(p),
        "name": p.name,
        "size": size,
    }


@router.get("/api/sessions/{session_id}/files")
async def list_session_files(session_id: str, request: Request) -> list[dict]:
    """List all files in a session's workspace directory."""
    mgr = request.app.state.session_manager
    session = mgr.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    workspace = Path(session.work_dir) if session.work_dir else (_WORKSPACE_ROOT / session_id)
    if not workspace.exists() or not workspace.is_dir():
        return []

    results: list[dict] = []
    for p in sorted(workspace.rglob("*")):
        if not p.is_file():
            continue
        # skip hidden files and hidden directories anywhere in the path
        if any(part.startswith(".") for part in p.relative_to(workspace).parts):
            continue
        rel = p.relative_to(workspace)
        results.append({
            "path": str(p),
            "rel_path": str(rel),
            "name": p.name,
            "ext": p.suffix.lstrip(".").lower(),
            "size": p.stat().st_size,
        })
        if len(results) >= _MAX_FILES:
            break

    return results
