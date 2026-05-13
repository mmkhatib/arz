"""Skills routes — list / get / delete / promote auto-skills + audit."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from arz.dashboard.token_auth import require_token
from arz.skills import Skill, SkillStore, get_skill_store

router = APIRouter(dependencies=[Depends(require_token)])


def _store() -> SkillStore:
    return get_skill_store()


@router.get("/api/skills")
async def list_skills() -> list[dict]:
    return [
        {
            "name": s.name,
            "title": s.title,
            "namespace": s.namespace,
            "body": s.body,
            "created": s.created,
            "updated": s.updated,
            "source_session": s.source_session,
            "version": s.version,
            "tool_calls": s.tool_calls,
            "tags": s.tags,
        }
        for s in _store().list()
    ]


@router.get("/api/skills/{namespace}/{name}")
async def get_skill(namespace: str, name: str) -> dict:
    if namespace not in {"auto", "curated"}:
        raise HTTPException(400, "namespace must be 'auto' or 'curated'")
    s = _store().get(name, namespace)
    if not s:
        raise HTTPException(404, "Skill not found")
    return {
        "name": s.name,
        "title": s.title,
        "namespace": s.namespace,
        "body": s.body,
        "created": s.created,
        "updated": s.updated,
        "source_session": s.source_session,
        "version": s.version,
        "tool_calls": s.tool_calls,
        "tags": s.tags,
    }


@router.delete("/api/skills/{namespace}/{name}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_skill(namespace: str, name: str) -> None:
    if namespace not in {"auto", "curated"}:
        raise HTTPException(400, "namespace must be 'auto' or 'curated'")
    if not _store().delete(name, namespace):
        raise HTTPException(404, "Skill not found")


@router.post("/api/skills/auto/{name}/promote")
async def promote_skill(name: str) -> dict:
    s = _store().promote(name)
    if not s:
        raise HTTPException(409, "Cannot promote — not found or curated copy already exists")
    return {"name": s.name, "namespace": s.namespace}


@router.post("/api/skills/curated")
async def create_curated(body: dict) -> dict:
    """Hand-written skill — bypasses the auto pipeline entirely."""
    import time as _time

    title = (body.get("title") or "").strip()
    md = (body.get("body") or "").strip()
    if not title or not md:
        raise HTTPException(422, "title and body required")
    skill = Skill(
        name=title,
        title=title,
        namespace="curated",
        body=md,
        created=_time.time(),
        updated=_time.time(),
        tags=[t.strip() for t in (body.get("tags") or []) if isinstance(t, str)],
    )
    _store().save(skill)
    return {"name": skill.name, "namespace": skill.namespace}


@router.get("/api/skills/audit")
async def skill_audit(limit: int = 50) -> list[dict]:
    return _store().recent_audit(limit=max(1, min(limit, 500)))
