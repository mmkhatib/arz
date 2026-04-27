"""Prompts — CRUD for reusable prompt templates stored in ~/.arz/prompts/."""

from __future__ import annotations

import json
import re
import time
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from arz.dashboard.token_auth import require_token

router = APIRouter(dependencies=[Depends(require_token)])

_PROMPTS_DIR = Path.home() / ".arz" / "prompts"


class PromptTemplate(BaseModel):
    slug: str
    title: str
    body: str
    tags: list[str] = []
    created_at: float = 0.0
    updated_at: float = 0.0


class PromptCreate(BaseModel):
    title: str
    body: str
    tags: list[str] = []


def _safe_slug(title: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_\-]", "_", title.strip().lower())[:64]


def _path(slug: str) -> Path:
    return _PROMPTS_DIR / f"{slug}.json"


def _load_all() -> list[PromptTemplate]:
    _PROMPTS_DIR.mkdir(parents=True, exist_ok=True)
    prompts = []
    for p in sorted(_PROMPTS_DIR.glob("*.json")):
        try:
            prompts.append(PromptTemplate(**json.loads(p.read_text(encoding="utf-8"))))
        except Exception:
            pass
    return prompts


@router.get("/api/prompts", response_model=list[PromptTemplate])
async def list_prompts() -> list[PromptTemplate]:
    return _load_all()


@router.post("/api/prompts", response_model=PromptTemplate, status_code=201)
async def create_prompt(body: PromptCreate) -> PromptTemplate:
    _PROMPTS_DIR.mkdir(parents=True, exist_ok=True)
    slug = _safe_slug(body.title)
    if not slug:
        raise HTTPException(400, "title produces empty slug")
    # Make slug unique
    base = slug
    suffix = 0
    while _path(slug).exists():
        suffix += 1
        slug = f"{base}_{suffix}"
    now = time.time()
    pt = PromptTemplate(slug=slug, title=body.title, body=body.body, tags=body.tags, created_at=now, updated_at=now)
    _path(slug).write_text(pt.model_dump_json(indent=2), encoding="utf-8")
    return pt


@router.put("/api/prompts/{slug}", response_model=PromptTemplate)
async def update_prompt(slug: str, body: PromptCreate) -> PromptTemplate:
    p = _path(slug)
    if not p.exists():
        raise HTTPException(404, f"Prompt '{slug}' not found")
    existing = PromptTemplate(**json.loads(p.read_text(encoding="utf-8")))
    updated = existing.model_copy(update={"title": body.title, "body": body.body, "tags": body.tags, "updated_at": time.time()})
    p.write_text(updated.model_dump_json(indent=2), encoding="utf-8")
    return updated


@router.delete("/api/prompts/{slug}", status_code=204)
async def delete_prompt(slug: str) -> None:
    p = _path(slug)
    if not p.exists():
        raise HTTPException(404, f"Prompt '{slug}' not found")
    p.unlink()
