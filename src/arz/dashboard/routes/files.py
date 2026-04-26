"""File read route — serves local file contents to the dashboard."""

from __future__ import annotations

import os
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import PlainTextResponse

from arz.dashboard.token_auth import require_token

router = APIRouter(dependencies=[Depends(require_token)])

_MAX_BYTES = 2 * 1024 * 1024  # 2 MB cap


@router.get("/api/files/read")
async def read_file(path: str = Query(...)) -> dict:
    """Return the content of a local file as a JSON payload.

    Args:
        path: Absolute filesystem path to read.

    Returns:
        {content, path, name, size}

    Raises:
        400 if path is not absolute.
        404 if file does not exist or cannot be read.
        413 if file exceeds 2 MB.
    """
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
