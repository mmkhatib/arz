"""File routes — read, list, and upload local files for the dashboard."""

from __future__ import annotations

import os
import re
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, Request, UploadFile

from arz.dashboard.token_auth import require_token

router = APIRouter(dependencies=[Depends(require_token)])

_MAX_BYTES = 2 * 1024 * 1024  # 2 MB cap
_WORKSPACE_ROOT = Path.home() / ".arz" / "workspace"
_MAX_FILES = 500
_UPLOAD_MAX_BYTES = 25 * 1024 * 1024  # 25 MB per upload
_UPLOAD_ALLOWED_EXTS = {
    "txt", "md", "json", "yaml", "yml", "toml", "csv", "tsv",
    "py", "js", "ts", "tsx", "jsx", "html", "css", "sh", "go", "rs",
    "rb", "java", "c", "cpp", "h", "log",
    "png", "jpg", "jpeg", "gif", "webp", "svg",
    "pdf",
}
_UNSAFE_NAME = re.compile(r"[^A-Za-z0-9._-]")


def _safe_filename(raw: str) -> str:
    """Strip directory parts and unsafe chars; fall back to 'upload'."""
    base = os.path.basename(raw or "").strip()
    if not base or base in (".", ".."):
        return "upload"
    cleaned = _UNSAFE_NAME.sub("_", base).lstrip(".")
    return cleaned or "upload"


def _ensure_unique(target_dir: Path, name: str) -> Path:
    """Return a path inside ``target_dir`` that doesn't collide with existing files."""
    candidate = target_dir / name
    if not candidate.exists():
        return candidate
    stem, dot, ext = name.partition(".")
    for i in range(2, 1000):
        suffix = f"-{i}"
        candidate = target_dir / (f"{stem}{suffix}{dot}{ext}" if dot else f"{stem}{suffix}")
        if not candidate.exists():
            return candidate
    raise HTTPException(status_code=409, detail="too many name collisions")


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


@router.post("/api/sessions/{session_id}/upload")
async def upload_files(
    session_id: str,
    request: Request,
    files: list[UploadFile],
) -> list[dict]:
    """Save uploaded files into the session's workspace.

    Files are stored under ``session.work_dir`` (or ``~/.arz/workspace/{id}/``
    when work_dir is unset) and become visible to providers on subsequent prompts.
    """
    mgr = request.app.state.session_manager
    session = mgr.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    workspace = Path(session.work_dir) if session.work_dir else (_WORKSPACE_ROOT / session_id)
    workspace.mkdir(parents=True, exist_ok=True)

    saved: list[dict] = []
    for upload in files:
        ext = (Path(upload.filename or "").suffix or "").lstrip(".").lower()
        if ext and ext not in _UPLOAD_ALLOWED_EXTS:
            raise HTTPException(status_code=415, detail=f"file type .{ext} not allowed")

        name = _safe_filename(upload.filename or "upload")
        dest = _ensure_unique(workspace, name)

        # Stream to disk; enforce size limit incrementally so a malicious
        # client can't allocate gigabytes before we notice.
        total = 0
        with dest.open("wb") as out:
            while True:
                chunk = await upload.read(64 * 1024)
                if not chunk:
                    break
                total += len(chunk)
                if total > _UPLOAD_MAX_BYTES:
                    out.close()
                    dest.unlink(missing_ok=True)
                    raise HTTPException(status_code=413, detail="file too large (max 25MB)")
                out.write(chunk)

        saved.append({
            "path": str(dest),
            "rel_path": str(dest.relative_to(workspace)),
            "name": dest.name,
            "ext": dest.suffix.lstrip(".").lower(),
            "size": total,
        })
    return saved
