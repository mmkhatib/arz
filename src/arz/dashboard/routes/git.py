"""Workspace browsing routes for the chat side panel.

- ``GET /api/sessions/{id}/tree`` — one directory level of the session's
  workspace (lazy tree), each entry tagged with its git status.
- ``GET /api/sessions/{id}/grep`` — plain-text search across the workspace.
- ``GET /api/sessions/{id}/git-status`` — branch + changed files.
- ``GET /api/files/diff`` — HEAD vs working copy for one file, as both a
  unified patch and the two full texts (for Monaco's diff editor).
- ``GET /api/sessions/{id}/context-trace`` — per-turn context breakdown.

Every session-scoped path is resolved and checked to stay inside the
session's workspace root so ``rel=../../etc`` can't walk out of it.
"""

from __future__ import annotations

import os
import subprocess
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from arz.dashboard import context_trace
from arz.dashboard.token_auth import require_token

router = APIRouter(dependencies=[Depends(require_token)])

_WORKSPACE_ROOT = Path.home() / ".arz" / "workspace"
_MAX_ENTRIES = 1000
_MAX_DIFF_BYTES = 2 * 1024 * 1024
_GREP_MAX_FILE_BYTES = 1024 * 1024
_GREP_MAX_HITS = 200
_GREP_MAX_FILES = 5000
_SKIP_DIRS = {".git", "node_modules", "__pycache__", ".venv", "venv", "dist", "build", ".next"}
_GIT_TIMEOUT_S = 5


def _session_root(request: Request, session_id: str) -> Path:
    session = request.app.state.session_manager.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    root = Path(session.work_dir) if session.work_dir else (_WORKSPACE_ROOT / session_id)
    return root.resolve()


def _inside(root: Path, rel: str) -> Path:
    target = (root / rel).resolve() if rel else root
    if target != root and root not in target.parents:
        raise HTTPException(status_code=400, detail="path escapes workspace")
    return target


def _git(cwd: Path, *args: str) -> subprocess.CompletedProcess[str] | None:
    try:
        return subprocess.run(
            ["git", "-C", str(cwd), *args],
            capture_output=True,
            text=True,
            timeout=_GIT_TIMEOUT_S,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return None


def _git_toplevel(cwd: Path) -> Path | None:
    if not cwd.exists():
        return None
    r = _git(cwd if cwd.is_dir() else cwd.parent, "rev-parse", "--show-toplevel")
    if not r or r.returncode != 0:
        return None
    return Path(r.stdout.strip()).resolve()


def _status_code(xy: str) -> str:
    """Collapse porcelain XY into a single letter the UI can badge."""
    if xy == "??":
        return "U"  # untracked
    for ch in xy:
        if ch in "MADRC":
            return "M" if ch in "RC" else ch
    return "M"


def _git_status_map(top: Path) -> dict[Path, str]:
    """Absolute path → status letter for every changed file in the repo."""
    r = _git(top, "status", "--porcelain=v1", "-z", "--untracked-files=all")
    if not r or r.returncode != 0:
        return {}
    out: dict[Path, str] = {}
    parts = r.stdout.split("\0")
    i = 0
    while i < len(parts):
        rec = parts[i]
        i += 1
        if len(rec) < 4:
            continue
        xy, path = rec[:2], rec[3:]
        if xy[0] in "RC":
            i += 1  # rename/copy: next field is the source path
        out[(top / path).resolve()] = _status_code(xy)
    return out


@router.get("/api/sessions/{session_id}/tree")
async def list_tree(session_id: str, request: Request, rel: str = Query("")) -> dict:
    root = _session_root(request, session_id)
    target = _inside(root, rel)
    if not target.exists() or not target.is_dir():
        return {"root": str(root), "rel": rel, "entries": [], "is_repo": False}
    top = _git_toplevel(root)
    status = _git_status_map(top) if top else {}
    entries: list[dict] = []
    try:
        children = sorted(target.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower()))
    except OSError:
        children = []
    for p in children:
        if p.name in (".git",):
            continue
        is_dir = p.is_dir()
        abs_p = p.resolve() if not p.is_symlink() else p
        if is_dir:
            # A folder is dirty when any changed file sits under it.
            prefix = str(abs_p) + os.sep
            st = "M" if any(str(k).startswith(prefix) for k in status) else None
        else:
            st = status.get(abs_p)
        entries.append(
            {
                "name": p.name,
                "path": str(p),
                "rel_path": str(p.relative_to(root)),
                "is_dir": is_dir,
                "size": 0 if is_dir else _safe_size(p),
                "status": st,
                "hidden": p.name.startswith(".") or p.name in _SKIP_DIRS,
            }
        )
        if len(entries) >= _MAX_ENTRIES:
            break
    return {"root": str(root), "rel": rel, "entries": entries, "is_repo": top is not None}


def _safe_size(p: Path) -> int:
    try:
        return p.stat().st_size
    except OSError:
        return 0


@router.get("/api/sessions/{session_id}/git-status")
async def git_status(session_id: str, request: Request) -> dict:
    root = _session_root(request, session_id)
    top = _git_toplevel(root)
    if not top:
        return {"is_repo": False, "branch": None, "files": []}
    br = _git(top, "rev-parse", "--abbrev-ref", "HEAD")
    branch = br.stdout.strip() if br and br.returncode == 0 else None
    files = []
    for path, st in sorted(_git_status_map(top).items()):
        if path != root and root not in path.parents:
            continue
        files.append({"path": str(path), "rel_path": str(path.relative_to(root)), "status": st})
    return {"is_repo": True, "branch": branch, "files": files}


@router.get("/api/sessions/{session_id}/grep")
async def grep_workspace(
    session_id: str,
    request: Request,
    q: str = Query(..., min_length=1, max_length=200),
    case: bool = Query(False),
) -> dict:
    root = _session_root(request, session_id)
    if not root.is_dir():
        return {"hits": [], "truncated": False}
    needle = q if case else q.lower()
    hits: list[dict] = []
    scanned = 0
    truncated = False
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = sorted(d for d in dirnames if d not in _SKIP_DIRS and not d.startswith("."))
        for name in sorted(filenames):
            if name.startswith("."):
                continue
            p = Path(dirpath) / name
            scanned += 1
            if scanned > _GREP_MAX_FILES:
                truncated = True
                break
            if _safe_size(p) > _GREP_MAX_FILE_BYTES:
                continue
            try:
                with open(p, encoding="utf-8", errors="strict") as f:
                    for lineno, line in enumerate(f, 1):
                        hay = line if case else line.lower()
                        if needle in hay:
                            hits.append(
                                {
                                    "path": str(p),
                                    "rel_path": str(p.relative_to(root)),
                                    "line": lineno,
                                    "text": line.rstrip("\n")[:300],
                                }
                            )
                            if len(hits) >= _GREP_MAX_HITS:
                                return {"hits": hits, "truncated": True}
            except (UnicodeDecodeError, OSError):
                continue  # binary or unreadable
        if truncated:
            break
    return {"hits": hits, "truncated": truncated}


@router.get("/api/files/diff")
async def file_diff(path: str = Query(...)) -> dict:
    """HEAD vs working copy for one file.

    ``original`` is the committed text (empty for untracked/new files),
    ``modified`` the current disk text (empty when deleted), ``diff`` the
    unified patch. ``is_repo`` is false outside a git checkout — the
    caller then falls back to the tool-call diff it already has.
    """
    if not os.path.isabs(path):
        raise HTTPException(status_code=400, detail="path must be absolute")
    p = Path(path)
    top = _git_toplevel(p.parent if not p.is_dir() else p)
    modified = ""
    if p.is_file():
        if p.stat().st_size > _MAX_DIFF_BYTES:
            raise HTTPException(status_code=413, detail="file too large to diff")
        modified = p.read_text(errors="replace")
    if not top:
        return {"path": path, "is_repo": False, "original": "", "modified": modified, "diff": ""}
    rel = os.path.relpath(p.resolve() if p.exists() else p, top)
    show = _git(top, "show", f"HEAD:{rel}")
    original = show.stdout if show and show.returncode == 0 else ""
    d = _git(top, "diff", "HEAD", "--", rel)
    patch = d.stdout if d and d.returncode == 0 else ""
    if not patch and not original and modified:
        # Untracked: git diff HEAD is silent, synthesise an all-added patch.
        lines = modified.splitlines()
        patch = f"--- /dev/null\n+++ b/{rel}\n@@ -0,0 +1,{len(lines)} @@\n" + "".join(
            f"+{ln}\n" for ln in lines
        )
    return {
        "path": path,
        "is_repo": True,
        "original": original,
        "modified": modified,
        "diff": patch,
    }


@router.get("/api/sessions/{session_id}/context-trace")
async def get_context_trace(session_id: str, request: Request) -> dict:
    if not request.app.state.session_manager.get(session_id):
        raise HTTPException(status_code=404, detail="Session not found")
    return {"turns": context_trace.load(session_id)}
