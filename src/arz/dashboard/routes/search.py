"""Full-text search across session messages (FTS5)."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel

from arz.dashboard.search import SessionSearchIndex
from arz.dashboard.token_auth import require_token

router = APIRouter(dependencies=[Depends(require_token)])


class SearchHit(BaseModel):
    session_id: str
    session_title: str
    message_idx: int
    role: str
    provider: str
    updated_at: str
    snippet: str
    rank: float


@router.get("/api/search", response_model=list[SearchHit])
async def search(
    request: Request,
    q: Annotated[str, Query(description="FTS5 query string", min_length=1)],
    provider: str | None = None,
    since: str | None = Query(default=None, description="ISO datetime lower bound"),
    until: str | None = Query(default=None, description="ISO datetime upper bound"),
    limit: int = Query(default=50, ge=1, le=200),
) -> list[SearchHit]:
    index: SessionSearchIndex = request.app.state.search_index
    rows = index.search(q, provider=provider, since=since, until=until, limit=limit)
    return [SearchHit(**row) for row in rows]


@router.post("/api/search/reindex", response_model=dict)
async def reindex(request: Request) -> dict:
    index: SessionSearchIndex = request.app.state.search_index
    mgr = request.app.state.session_manager
    count = index.rebuild(mgr)
    return {"indexed": count}
