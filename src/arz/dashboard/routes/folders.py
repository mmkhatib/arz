"""Folders — group sessions under named buckets, icons picked by the LLM.

Persisted to ~/.arz/folders.json. Frontend SessionList renders folders as
collapsible groups; sessions get a ``folder_id`` field via the move endpoint.

Icon picking uses the cheap-model picker from sessions.py so the user
doesn't burn frontier tokens on a one-shot icon classification.
"""

from __future__ import annotations

import asyncio
import json
import re
import time
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from arz.dashboard.token_auth import require_token

router = APIRouter(dependencies=[Depends(require_token)])

_STORE = Path.home() / ".arz" / "folders.json"

# Allowlist of lucide-react icon names. Cheap LLM picks one of these for
# each new folder. Keeping the list small + curated means it can't pick a
# typo or hallucinate an icon component the frontend doesn't have.
_ICONS: list[str] = [
    "Folder",
    "FolderOpen",
    "Briefcase",
    "Code",
    "Terminal",
    "BookOpen",
    "FileText",
    "PenTool",
    "Beaker",
    "Cpu",
    "Database",
    "Server",
    "Globe",
    "Cloud",
    "Zap",
    "Mail",
    "MessageSquare",
    "Users",
    "User",
    "Heart",
    "Star",
    "Bookmark",
    "Tag",
    "Hash",
    "Box",
    "Archive",
    "Inbox",
    "Calendar",
    "Clock",
    "Activity",
    "BarChart3",
    "PieChart",
    "TrendingUp",
    "Target",
    "Flag",
    "Coffee",
    "Home",
    "Building",
    "Map",
    "Compass",
    "Music",
    "Film",
    "Image",
    "Camera",
    "Video",
    "ShoppingCart",
    "DollarSign",
    "Wallet",
    "CreditCard",
    "Receipt",
    "Wrench",
    "Hammer",
    "Settings",
    "Sliders",
    "Filter",
    "Lock",
    "Shield",
    "Key",
    "Eye",
    "AlertTriangle",
    "Bug",
    "Sparkles",
    "Wand2",
    "Lightbulb",
    "Brain",
    "Rocket",
    "Plane",
    "Ship",
    "Car",
    "Truck",
    "Trees",
    "TreeDeciduous",
    "Mountain",
    "Sun",
    "Moon",
]


class Folder(BaseModel):
    id: str
    name: str
    icon: str
    session_ids: list[str] = []
    created_at: float


class FolderCreate(BaseModel):
    name: str
    icon: str | None = None


class FolderPatch(BaseModel):
    name: str | None = None
    icon: str | None = None


class MoveRequest(BaseModel):
    folder_id: str | None  # None = remove from any folder


def _load() -> list[Folder]:
    if not _STORE.exists():
        return []
    try:
        raw = json.loads(_STORE.read_text(encoding="utf-8"))
        return [Folder(**x) for x in raw if isinstance(x, dict)]
    except Exception:
        return []


def _save(folders: list[Folder]) -> None:
    _STORE.parent.mkdir(parents=True, exist_ok=True)
    _STORE.write_text(
        json.dumps([f.model_dump() for f in folders], indent=2),
        encoding="utf-8",
    )


async def _pick_icon(folder_name: str) -> str:
    """Ask the cheap model to pick the most fitting icon name from
    the allowlist. Falls back to "Folder" on any failure or timeout."""
    from arz.acp.types import EVENT_COMPLETE, EVENT_TEXT_CHUNK
    from arz.dashboard.routes.sessions import _pick_cheap_model

    try:
        provider_name, model_name = await _pick_cheap_model(
            fallback_provider="claude-code", fallback_model=""
        )
    except Exception:
        return "Folder"

    icon_list = ", ".join(_ICONS)
    prompt = (
        "Pick the single most appropriate icon name for a folder titled "
        f"{folder_name!r}. Reply with ONLY the icon name from this list, "
        f"nothing else, no quotes, no explanation:\n{icon_list}"
    )

    try:
        if provider_name == "claude-code":
            from arz.providers.claude_code import ClaudeCodeProvider

            provider = ClaudeCodeProvider(model=model_name or None)
        elif provider_name == "ollama":
            from arz.providers.ollama import OllamaProvider

            provider = OllamaProvider(model=model_name or None)
        elif provider_name == "kiro-cli":
            from arz.providers.kiro_cli import KiroCliProvider

            provider = KiroCliProvider(model=model_name or "auto")
        elif provider_name == "codex":
            from arz.providers.codex import CodexProvider

            provider = CodexProvider(model=model_name or None)
        elif provider_name == "gemini":
            from arz.providers.gemini import GeminiProvider

            provider = GeminiProvider(model=model_name or None)
        else:
            return "Folder"
    except Exception:
        return "Folder"

    text = ""
    try:
        await provider.start()
        async for ev in asyncio.wait_for(_drain(provider, prompt), timeout=15.0):
            if ev[0] == EVENT_TEXT_CHUNK and ev[1]:
                text += ev[1]
            elif ev[0] == EVENT_COMPLETE:
                break
            if len(text) > 200:
                break
    except Exception:
        pass
    finally:
        try:
            await provider.shutdown()
        except Exception:
            pass

    cleaned = re.sub(r"[^A-Za-z0-9]+", "", text).strip()
    # Match case-insensitive against allowlist.
    for name in _ICONS:
        if name.lower() == cleaned.lower():
            return name
    # Fall back: substring match (e.g. model emits "uses Folder icon").
    for name in _ICONS:
        if name.lower() in text.lower():
            return name
    return "Folder"


async def _drain(provider, prompt):
    async for ev in provider.stream(prompt):
        yield (ev.kind, ev.text)


@router.get("/api/folders", response_model=list[Folder])
async def list_folders() -> list[Folder]:
    return _load()


@router.post("/api/folders", response_model=Folder, status_code=201)
async def create_folder(body: FolderCreate) -> Folder:
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(status_code=422, detail="name required")

    icon = (body.icon or "").strip()
    if not icon or icon not in _ICONS:
        icon = await _pick_icon(name)

    folders = _load()
    folder = Folder(
        id=uuid.uuid4().hex[:12],
        name=name[:80],
        icon=icon,
        session_ids=[],
        created_at=time.time(),
    )
    folders.append(folder)
    _save(folders)
    return folder


@router.patch("/api/folders/{folder_id}", response_model=Folder)
async def update_folder(folder_id: str, body: FolderPatch) -> Folder:
    folders = _load()
    for i, f in enumerate(folders):
        if f.id == folder_id:
            if body.name is not None:
                new_name = body.name.strip()[:80]
                # If the user renamed, re-pick the icon if they didn't override.
                f.name = new_name
                if body.icon is None:
                    f.icon = await _pick_icon(new_name)
            if body.icon is not None:
                if body.icon in _ICONS:
                    f.icon = body.icon
            folders[i] = f
            _save(folders)
            return f
    raise HTTPException(status_code=404, detail="folder not found")


@router.delete("/api/folders/{folder_id}", status_code=204)
async def delete_folder(folder_id: str) -> None:
    folders = _load()
    new_folders = [f for f in folders if f.id != folder_id]
    if len(new_folders) == len(folders):
        raise HTTPException(status_code=404, detail="folder not found")
    _save(new_folders)


class MoveBody(BaseModel):
    session_id: str
    folder_id: str | None  # None = remove from any folder


@router.post("/api/folders/move", status_code=200)
async def move_session(body: MoveBody) -> dict:
    """Move a session into a folder, or remove it from any folder
    when ``folder_id`` is None. Idempotent."""
    folders = _load()
    sid = body.session_id
    target: str | None = body.folder_id

    # Remove from all folders first.
    for f in folders:
        f.session_ids = [s for s in f.session_ids if s != sid]

    # Then add to target if any.
    if target is not None:
        match = next((f for f in folders if f.id == target), None)
        if match is None:
            raise HTTPException(status_code=404, detail="target folder not found")
        if sid not in match.session_ids:
            match.session_ids.append(sid)

    _save(folders)
    return {"ok": True}


__all__ = ["router", "Folder", "_load", "_save"]
