"""Action items — TODOs surfaced on the Operations page.

Source can be the user (manual add) or an agent/LLM that emitted a
``<todo>`` tag in a turn. Stored as one JSON file in ~/.arz/.
"""

from __future__ import annotations

import json
import time
import uuid
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from arz.dashboard.token_auth import require_token

router = APIRouter(dependencies=[Depends(require_token)])

_STORE = Path.home() / ".arz" / "action_items.json"


class ActionItem(BaseModel):
    id: str
    text: str
    status: Literal["open", "done", "dismissed"] = "open"
    source_kind: Literal["user", "agent"] = "user"
    session_id: str | None = None
    created_at: float = 0.0
    updated_at: float = 0.0


class ActionItemCreate(BaseModel):
    text: str
    source_kind: Literal["user", "agent"] = "user"
    session_id: str | None = None


class ActionItemPatch(BaseModel):
    text: str | None = None
    status: Literal["open", "done", "dismissed"] | None = None


def _load() -> list[ActionItem]:
    if not _STORE.exists():
        return []
    try:
        raw = json.loads(_STORE.read_text(encoding="utf-8"))
        return [ActionItem(**x) for x in raw if isinstance(x, dict)]
    except Exception:
        return []


def _save(items: list[ActionItem]) -> None:
    _STORE.parent.mkdir(parents=True, exist_ok=True)
    _STORE.write_text(
        json.dumps([i.model_dump() for i in items], indent=2),
        encoding="utf-8",
    )


@router.get("/api/action-items", response_model=list[ActionItem])
async def list_items() -> list[ActionItem]:
    return _load()


@router.post("/api/action-items", response_model=ActionItem, status_code=201)
async def create_item(body: ActionItemCreate) -> ActionItem:
    text = (body.text or "").strip()
    if not text:
        raise HTTPException(status_code=422, detail="text required")
    items = _load()
    now = time.time()
    item = ActionItem(
        id=uuid.uuid4().hex[:12],
        text=text[:500],
        source_kind=body.source_kind,
        session_id=body.session_id,
        created_at=now,
        updated_at=now,
    )
    items.append(item)
    _save(items)
    return item


@router.patch("/api/action-items/{item_id}", response_model=ActionItem)
async def patch_item(item_id: str, body: ActionItemPatch) -> ActionItem:
    items = _load()
    for i, it in enumerate(items):
        if it.id == item_id:
            if body.text is not None:
                it.text = body.text.strip()[:500]
            if body.status is not None:
                it.status = body.status
            it.updated_at = time.time()
            items[i] = it
            _save(items)
            return it
    raise HTTPException(status_code=404, detail="not found")


@router.delete("/api/action-items/{item_id}", status_code=204)
async def delete_item(item_id: str) -> None:
    items = _load()
    new_items = [i for i in items if i.id != item_id]
    if len(new_items) == len(items):
        raise HTTPException(status_code=404, detail="not found")
    _save(new_items)


def add_from_agent(text: str, *, session_id: str | None = None) -> ActionItem | None:
    """Helper invoked by the inline-tag pipeline when an LLM emits a
    ``<todo>``-style tag. Dedupes by exact text-match on open items."""
    text = (text or "").strip()
    if not text:
        return None
    items = _load()
    for it in items:
        if it.status == "open" and it.text.strip().lower() == text.lower()[:500]:
            return it
    now = time.time()
    item = ActionItem(
        id=uuid.uuid4().hex[:12],
        text=text[:500],
        source_kind="agent",
        session_id=session_id,
        created_at=now,
        updated_at=now,
    )
    items.append(item)
    _save(items)
    return item
