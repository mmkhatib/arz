"""File routes — read, list, and upload local files for the dashboard."""

from __future__ import annotations

import asyncio
import json
import os
import re
import shutil
import subprocess
import sys
from collections.abc import AsyncIterator
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, Request, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from arz.dashboard.token_auth import require_token

router = APIRouter(dependencies=[Depends(require_token)])

_MAX_BYTES = 2 * 1024 * 1024  # 2 MB cap
_WORKSPACE_ROOT = Path.home() / ".arz" / "workspace"
_MAX_FILES = 500
_UPLOAD_MAX_BYTES = 25 * 1024 * 1024  # 25 MB per upload
_UPLOAD_ALLOWED_EXTS = {
    "txt",
    "md",
    "json",
    "yaml",
    "yml",
    "toml",
    "csv",
    "tsv",
    "py",
    "js",
    "ts",
    "tsx",
    "jsx",
    "html",
    "css",
    "sh",
    "go",
    "rs",
    "rb",
    "java",
    "c",
    "cpp",
    "h",
    "log",
    "png",
    "jpg",
    "jpeg",
    "gif",
    "webp",
    "svg",
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
async def read_file(
    request: Request,
    path: str = Query(...),
    session_id: str | None = Query(None),
) -> dict:
    """Return the content of a local file as a JSON payload.

    Cross-machine fallback: when the file isn't on the local disk but
    ``session_id`` is provided, scan that session's message history for
    a Write/Edit tool_call against the same path and return its
    captured content. Lets users re-open a file generated on another
    machine when only the session record (not the workspace) synced.
    Response carries ``source: "history"`` so the client can label it.
    """
    if not os.path.isabs(path):
        raise HTTPException(status_code=400, detail="path must be absolute")

    p = Path(path)
    if p.exists() and p.is_file():
        size = p.stat().st_size
        if size > _MAX_BYTES:
            raise HTTPException(
                status_code=413,
                detail=f"File too large ({size} bytes, max 2 MB)",
            )
        try:
            content = p.read_text(errors="replace")
        except OSError as exc:
            raise HTTPException(status_code=404, detail=f"Cannot read file: {exc}") from exc
        return {
            "content": content,
            "path": str(p),
            "name": p.name,
            "size": size,
            "source": "disk",
        }

    # Disk miss — try chat history before giving up.
    if session_id:
        recovered = _recover_from_history(request, session_id, path)
        if recovered is not None:
            return {
                "content": recovered,
                "path": str(p),
                "name": p.name,
                "size": len(recovered.encode("utf-8")),
                "source": "history",
            }

    raise HTTPException(status_code=404, detail="File not found")


def _recover_from_history(request: Request, session_id: str, path: str) -> str | None:
    """Walk the session's assistant turns for the most recent Write /
    Edit / MultiEdit / Create tool_call whose input targets *path* and
    return whatever content was captured. Returns None when nothing
    matches.

    The writer captures tool calls with a stringified JSON ``input``
    (see chat.py turn_tool_calls accumulator); we parse leniently and
    accept any of: ``content``, ``new_string``, ``text`` as the body.
    """
    mgr = getattr(request.app.state, "session_manager", None)
    if mgr is None:
        return None
    session = mgr.get(session_id)
    if session is None:
        return None

    artifact_tools = {"Write", "Edit", "MultiEdit", "Create", "fs_write", "fs_edit", "fs_create"}
    target = os.path.normpath(path)

    # Walk newest first so the latest write wins.
    for msg in reversed(getattr(session, "messages", []) or []):
        calls = getattr(msg, "tool_calls", None) or []
        for call in reversed(calls):
            if not isinstance(call, dict):
                continue
            name = call.get("name") or ""
            if name not in artifact_tools:
                continue
            raw_input = call.get("input")
            parsed: dict | None = None
            if isinstance(raw_input, dict):
                parsed = raw_input
            elif isinstance(raw_input, str):
                try:
                    parsed = json.loads(raw_input)
                except (ValueError, TypeError):
                    parsed = None
            if not isinstance(parsed, dict):
                continue
            call_path = (
                parsed.get("file_path") or parsed.get("path") or parsed.get("filename") or ""
            )
            if not call_path:
                continue
            if os.path.normpath(str(call_path)) != target:
                continue
            content = parsed.get("content") or parsed.get("new_string") or parsed.get("text")
            if isinstance(content, str):
                return content
    return None


_WATCH_POLL_S = 1.0
_WATCH_MAX_BYTES = _MAX_BYTES


@router.get("/api/files/watch")
async def watch_file(path: str = Query(...)) -> StreamingResponse:
    """SSE stream that re-emits the file's contents whenever its mtime
    changes. Powers the FileViewer live-reload: user can run a tool
    that rewrites the file and watch the panel update without
    refreshing.

    Symlink discipline: snapshot the resolved target on connect and
    re-check on every tick. If the symlink swaps after we validated
    the path, bail rather than serving content from an unexpected
    file (TOCTOU defense).
    """
    if not os.path.isabs(path):
        raise HTTPException(status_code=400, detail="path must be absolute")
    p = Path(path)
    if not p.exists() or not p.is_file():
        raise HTTPException(status_code=404, detail="file not found")

    async def stream() -> AsyncIterator[bytes]:
        try:
            initial_resolved = await asyncio.to_thread(os.path.realpath, str(p))
        except OSError:
            return
        last_mtime = 0.0
        last_content: str | None = None
        # Emit a hello so the client can flip its status to "connected".
        yield b"event: open\ndata: {}\n\n"

        while True:
            try:
                stat = await asyncio.to_thread(os.stat, str(p))
            except FileNotFoundError:
                await asyncio.sleep(_WATCH_POLL_S)
                continue
            except OSError:
                return
            if stat.st_mtime != last_mtime:
                last_mtime = stat.st_mtime
                # Re-validate target — symlink swap defense.
                try:
                    current = await asyncio.to_thread(os.path.realpath, str(p))
                except OSError:
                    return
                if current != initial_resolved:
                    return
                if stat.st_size > _WATCH_MAX_BYTES:
                    # File too big to ship — emit a truncate hint so the
                    # client can drop back to manual refresh.
                    yield (
                        f"event: truncated\ndata: {json.dumps({'size': stat.st_size})}\n\n"
                    ).encode()
                else:
                    try:
                        content = await asyncio.to_thread(_read_text, current, _WATCH_MAX_BYTES)
                    except OSError:
                        await asyncio.sleep(_WATCH_POLL_S)
                        continue
                    if content != last_content:
                        last_content = content
                        payload = json.dumps({"content": content, "mtime": stat.st_mtime})
                        yield f"data: {payload}\n\n".encode()
            # Heartbeat comment keeps the connection alive through
            # idle proxies even when no change has fired.
            else:
                yield b": tick\n\n"
            await asyncio.sleep(_WATCH_POLL_S)

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


def _read_text(path: str, cap: int) -> str:
    with open(path, encoding="utf-8", errors="replace") as f:
        return f.read(cap)


class WriteBody(BaseModel):
    path: str
    content: str


@router.post("/api/files/write")
async def write_file(body: WriteBody) -> dict:
    """Overwrite a file in place. Used by the FileViewer's Monaco
    edit-and-save flow. Refuses non-absolute paths + enforces the
    same 2MB cap as read.
    """
    raw = (body.path or "").strip()
    if not raw or not os.path.isabs(raw):
        raise HTTPException(status_code=422, detail="path must be absolute")
    if len(body.content.encode("utf-8")) > _MAX_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"content too large (max {_MAX_BYTES} bytes)",
        )
    p = Path(raw)
    # Auto-create missing parents so saving a history-recovered file
    # (file existed on another machine but not this one) materializes
    # the directory tree on first save instead of erroring.
    if not p.parent.exists():
        try:
            p.parent.mkdir(parents=True, exist_ok=True)
        except OSError as exc:
            raise HTTPException(
                status_code=500,
                detail=f"could not create parent dir: {exc}",
            ) from exc
    try:
        p.write_text(body.content, encoding="utf-8")
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"write failed: {exc}") from exc
    return {"path": str(p), "size": p.stat().st_size}


@router.post("/api/files/edit")
async def edit_file_with_comments(request: Request) -> dict:
    """Hand a file + a batch of inline comments to a subagent for editing.

    Body shape:
        {
          "path": "/abs/path/to/doc.md",
          "comments": [
              {"selection": "...", "comment": "make this terser"},
              {"selection": "...", "comment": "expand with an example"},
          ],
          "session_id": "..."   # parent session for the spawn
        }

    The subagent receives the comments as a single instruction prompt
    that says "edit the file in place per these comments". Returns
    the spawn record so the caller can poll it.
    """
    body = await request.json()
    path = (body.get("path") or "").strip()
    comments = body.get("comments") or []
    session_id = (body.get("session_id") or "").strip()
    agent = (body.get("agent") or "general").strip()
    if not path or not os.path.isabs(path):
        raise HTTPException(status_code=422, detail="path must be an absolute filename")
    if not isinstance(comments, list) or not comments:
        raise HTTPException(status_code=422, detail="comments must be a non-empty list")
    if not session_id:
        raise HTTPException(status_code=422, detail="session_id required")

    p = Path(path)
    if not p.exists() or not p.is_file():
        raise HTTPException(status_code=404, detail="file not found")

    blocks = []
    for i, c in enumerate(comments, 1):
        if not isinstance(c, dict):
            continue
        sel = (c.get("selection") or "").strip()
        com = (c.get("comment") or "").strip()
        if not com:
            continue
        if sel:
            blocks.append(f"### Comment {i}\nOn this text:\n```\n{sel}\n```\nFeedback: {com}")
        else:
            blocks.append(f"### Comment {i}\nGeneral feedback: {com}")
    if not blocks:
        raise HTTPException(status_code=422, detail="no usable comments")

    prompt = (
        f"Edit the file `{path}` in place per the inline comments below.\n"
        f"Make the smallest set of changes needed; preserve unrelated sections.\n"
        f"After editing, briefly summarise what you changed.\n\n" + "\n\n".join(blocks)
    )

    from arz.subagents import get_subagent_manager

    rec = get_subagent_manager().spawn(session_id, agent, prompt)
    return {"id": rec.id, "status": rec.status}


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
        results.append(
            {
                "path": str(p),
                "rel_path": str(rel),
                "name": p.name,
                "ext": p.suffix.lstrip(".").lower(),
                "size": p.stat().st_size,
            }
        )
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

        saved.append(
            {
                "path": str(dest),
                "rel_path": str(dest.relative_to(workspace)),
                "name": dest.name,
                "ext": dest.suffix.lstrip(".").lower(),
                "size": total,
            }
        )
    return saved


class RevealBody(BaseModel):
    path: str


@router.post("/api/files/reveal")
async def reveal_path(body: RevealBody) -> dict:
    """Open *path* in the OS file manager. Browsers refuse to follow
    ``file://`` links for security, so the dashboard hits this endpoint
    instead and the gateway shells out to the platform's reveal tool.
    """
    raw = (body.path or "").strip()
    if not raw:
        raise HTTPException(status_code=422, detail="path required")
    p = Path(raw).expanduser()
    if not p.exists():
        raise HTTPException(status_code=404, detail=f"path not found: {p}")
    target = str(p)
    try:
        if sys.platform == "darwin":
            subprocess.Popen(["open", target])
        elif sys.platform == "win32":
            # explorer wants backslashes and returns 1 on success — that
            # 1 is fine, we just need the process spawned.
            subprocess.Popen(["explorer", target.replace("/", "\\")])
        else:
            opener = shutil.which("xdg-open") or shutil.which("gio")
            if not opener:
                raise HTTPException(status_code=501, detail="no xdg-open / gio installed")
            subprocess.Popen([opener, target])
    except HTTPException:
        raise
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"reveal failed: {e}")
    return {"opened": target}
