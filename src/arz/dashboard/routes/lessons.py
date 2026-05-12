"""Lessons CRUD routes."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status

from arz.dashboard.token_auth import require_token
from arz.lessons import Lesson, get_lesson_store

router = APIRouter(dependencies=[Depends(require_token)])


@router.get("/api/lessons")
async def list_lessons() -> list[dict]:
    return [l.model_dump() for l in get_lesson_store().list()]


@router.post("/api/lessons", status_code=status.HTTP_201_CREATED)
async def add_lesson(request: Request) -> dict:
    body = await request.json()
    category = (body.get("category") or "knowledge").strip()
    text = (body.get("text") or "").strip()
    pinned = bool(body.get("pinned", False))
    if not text:
        raise HTTPException(status_code=422, detail="text is required")
    try:
        l: Lesson = get_lesson_store().add(category, text, pinned)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    return l.model_dump()


@router.patch("/api/lessons/{lesson_id}")
async def update_lesson(lesson_id: int, request: Request) -> dict:
    body = await request.json()
    category = body.get("category")
    text = body.get("text")
    if category is None and text is None:
        raise HTTPException(status_code=422, detail="category or text required")
    try:
        l = get_lesson_store().update(
            lesson_id,
            category=str(category) if category is not None else None,
            text=str(text) if text is not None else None,
        )
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    if l is None:
        raise HTTPException(status_code=404, detail="Lesson not found")
    return l.model_dump()


@router.delete("/api/lessons/{lesson_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_lesson(lesson_id: int) -> None:
    if not get_lesson_store().remove(lesson_id):
        raise HTTPException(status_code=404, detail="Lesson not found")


@router.post("/api/lessons/{lesson_id}/pin")
async def pin_lesson(lesson_id: int, request: Request) -> dict:
    body = await request.json() if request.headers.get("content-type") == "application/json" else {}
    pinned = bool(body.get("pinned", True))
    l = get_lesson_store().set_pinned(lesson_id, pinned)
    if l is None:
        raise HTTPException(status_code=404, detail="Lesson not found")
    return l.model_dump()
