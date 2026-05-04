"""Memory CRUD + search routes."""

from __future__ import annotations

import re
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field

from arz.dashboard.token_auth import require_token
from arz.memory.lessons import LessonsStore
from arz.memory.markdown import MarkdownStore
from arz.memory.vector import VectorStore

router = APIRouter(dependencies=[Depends(require_token)])

_KEY_RE = re.compile(r"^[a-zA-Z0-9_\-]{1,128}$")


def _markdown_store(request: Request) -> MarkdownStore:
    store = getattr(request.app.state, "markdown_store", None)
    if store is None:
        store = MarkdownStore()
        request.app.state.markdown_store = store
    return store


def _lessons_store(request: Request) -> LessonsStore:
    store = getattr(request.app.state, "lessons_store", None)
    if store is None:
        store = LessonsStore()
        request.app.state.lessons_store = store
    return store


def _vector_store(request: Request) -> VectorStore:
    store = getattr(request.app.state, "vector_store", None)
    if store is None:
        store = VectorStore()
        request.app.state.vector_store = store
    return store


# ── Markdown CRUD ──────────────────────────────────────────────────────────────


class MarkdownEntry(BaseModel):
    key: str
    content: str


class MarkdownPut(BaseModel):
    content: str = Field(min_length=0)


@router.get("/api/memory/markdown", response_model=list[str])
async def list_markdown(request: Request) -> list[str]:
    return _markdown_store(request).list()


@router.get("/api/memory/stats")
async def memory_stats(request: Request) -> dict:
    """Cheap counts for header indicator pills."""
    md = _markdown_store(request).list()
    try:
        lessons = len(_lessons_store(request).list())
    except Exception:
        lessons = 0
    try:
        vec = _vector_store(request)
        vec_count = vec.count() if hasattr(vec, "count") else 0
    except Exception:
        vec_count = 0
    return {"markdown": len(md), "lessons": lessons, "vectors": vec_count}


@router.get("/api/memory/markdown/{key}", response_model=MarkdownEntry)
async def read_markdown(key: str, request: Request) -> MarkdownEntry:
    if not _KEY_RE.match(key):
        raise HTTPException(status_code=422, detail="invalid key")
    content = _markdown_store(request).load(key)
    if content is None:
        raise HTTPException(status_code=404, detail="entry not found")
    return MarkdownEntry(key=key, content=content)


@router.put("/api/memory/markdown/{key}", response_model=MarkdownEntry)
async def write_markdown(key: str, body: MarkdownPut, request: Request) -> MarkdownEntry:
    if not _KEY_RE.match(key):
        raise HTTPException(status_code=422, detail="invalid key")
    _markdown_store(request).save(key, body.content)
    if body.content.strip():
        _vector_store(request).add(f"md:{key}", body.content, meta={"source": "markdown", "key": key})
    return MarkdownEntry(key=key, content=body.content)


@router.delete("/api/memory/markdown/{key}", status_code=204)
async def delete_markdown(key: str, request: Request) -> None:
    if not _KEY_RE.match(key):
        raise HTTPException(status_code=422, detail="invalid key")
    store = _markdown_store(request)
    path = store._path(key)  # noqa: SLF001 — internal helper, no public delete yet
    if not path.exists():
        raise HTTPException(status_code=404, detail="entry not found")
    path.unlink()
    _vector_store(request).remove(f"md:{key}")


# ── Lessons CRUD ───────────────────────────────────────────────────────────────


class LessonRow(BaseModel):
    id: int
    content: str
    tags: list[str]
    created_at: float


class LessonCreate(BaseModel):
    content: str = Field(min_length=1, max_length=4000)
    tags: list[str] = Field(default_factory=list)


@router.get("/api/memory/lessons", response_model=list[LessonRow])
async def list_lessons(
    request: Request,
    tag: str | None = None,
) -> list[LessonRow]:
    return [
        LessonRow(id=l.id, content=l.content, tags=l.tags, created_at=l.created_at)
        for l in _lessons_store(request).list(tag)
    ]


@router.post("/api/memory/lessons", response_model=LessonRow, status_code=201)
async def create_lesson(body: LessonCreate, request: Request) -> LessonRow:
    lesson = _lessons_store(request).add(body.content, body.tags)
    _vector_store(request).add(
        f"lesson:{lesson.id}",
        lesson.content,
        meta={"source": "lesson", "tags": lesson.tags},
    )
    return LessonRow(
        id=lesson.id, content=lesson.content, tags=lesson.tags, created_at=lesson.created_at
    )


@router.delete("/api/memory/lessons/{lesson_id}", status_code=204)
async def delete_lesson(lesson_id: int, request: Request) -> None:
    if not _lessons_store(request).remove(lesson_id):
        raise HTTPException(status_code=404, detail="lesson not found")
    _vector_store(request).remove(f"lesson:{lesson_id}")


# ── Vector / semantic search ───────────────────────────────────────────────────


class MemoryHit(BaseModel):
    key: str
    content: str
    score: float
    source: str  # "vector" | "markdown"


@router.get("/api/memory/search", response_model=list[MemoryHit])
async def search_memory(
    request: Request,
    q: Annotated[str, Query(min_length=1)],
    k: int = Query(default=10, ge=1, le=50),
    source: str | None = Query(default=None),
) -> list[MemoryHit]:
    """Ranked search over all memory sources via SQLite FTS5.

    The FTS index covers preferences/projects/history/lessons/notes. We
    augment with vector hits when available — vector adds semantic matches
    that pure FTS misses.
    """
    from arz.memory.fts import get_memory_fts
    fts = get_memory_fts()
    try:
        fts.reindex()  # cheap mtime scan
    except Exception:
        pass

    hits: list[MemoryHit] = []
    for row in fts.search(q, source=source, k=k):
        hits.append(MemoryHit(
            key=f"{row['source']}:{row['key']}",
            content=row["snippet"],
            score=-row["rank"],  # bm25 returns negative-better; flip for "higher = better"
            source=row["source"],
        ))
    # Backfill with vector hits for semantic recall.
    if len(hits) < k:
        seen = {h.key for h in hits}
        remaining = k - len(hits)
        for key, content, score in _vector_store(request).search(q, k=remaining):
            full = f"vector:{key}"
            if full in seen:
                continue
            hits.append(MemoryHit(key=full, content=content, score=score, source="vector"))
    return hits[:k]


@router.post("/api/memory/reindex")
async def reindex_memory() -> dict:
    """Force a full FTS rebuild — used after big edits or first-run setup."""
    from arz.memory.fts import get_memory_fts
    counts = get_memory_fts().reindex(force=True)
    return {"counts": counts}


# ── Memory files (preferences.md / projects.md / history) ───────────────────


@router.get("/api/memory/files")
async def list_memory_files() -> dict:
    from arz.memory.files import get_memory_files
    mf = get_memory_files()
    return {
        "preferences": mf.read("preferences.md"),
        "projects": mf.read("projects.md"),
        "history": mf.list_history(),
    }


@router.get("/api/memory/files/{name:path}")
async def read_memory_file(name: str) -> dict:
    from arz.memory.files import get_memory_files
    try:
        return {"name": name, "content": get_memory_files().read(name)}
    except ValueError as e:
        raise HTTPException(status_code=403, detail=str(e))


@router.put("/api/memory/files/{name:path}", status_code=204)
async def write_memory_file(name: str, request: Request) -> None:
    from arz.memory.files import get_memory_files
    body = await request.json()
    content = body.get("content")
    if content is None:
        raise HTTPException(status_code=422, detail="content required")
    try:
        get_memory_files().write(name, content)
    except ValueError as e:
        raise HTTPException(status_code=403, detail=str(e))
