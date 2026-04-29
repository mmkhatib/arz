"""Lessons store — durable corrections that auto-inject into every turn.

Storage: ~/.arz/lessons.jsonl, append-only with a periodic compaction.
Hard cap: 200 lessons (oldest unpinned evicted first).

Each lesson is:
    { id: int, category: "preference"|"tool"|"knowledge", text: str,
      pinned: bool, created_at: float }

Auto-injection rules (see render_for_prompt):
    - Always include category=preference and pinned=True.
    - Include other lessons whose words overlap with the user message.
    - Total render cap: ~6k chars.
"""

from __future__ import annotations

import json
import re
import time
from pathlib import Path
from threading import Lock
from typing import Iterable

from pydantic import BaseModel

_DEFAULT_PATH = Path.home() / ".arz" / "lessons.jsonl"
_MAX_LESSONS = 200
_RENDER_BUDGET_CHARS = 6000
_TOKEN_RE = re.compile(r"[A-Za-z][A-Za-z0-9_]{2,}")
_VALID_CATEGORIES = {"preference", "tool", "knowledge"}


class Lesson(BaseModel):
    id: int
    category: str
    text: str
    pinned: bool = False
    created_at: float


def _tokens(s: str) -> set[str]:
    return {t.lower() for t in _TOKEN_RE.findall(s)}


class LessonStore:
    def __init__(self, path: Path | None = None) -> None:
        self._path = path or _DEFAULT_PATH
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = Lock()
        self._lessons: list[Lesson] = []
        self._next_id = 1
        self._load()

    # ── persistence ─────────────────────────────────────────────────────────

    def _load(self) -> None:
        if not self._path.exists():
            return
        out: list[Lesson] = []
        with self._path.open("r", encoding="utf-8") as f:
            for raw in f:
                raw = raw.strip()
                if not raw:
                    continue
                try:
                    out.append(Lesson(**json.loads(raw)))
                except Exception:
                    continue
        self._lessons = out
        if out:
            self._next_id = max(l.id for l in out) + 1

    def _persist(self) -> None:
        tmp = self._path.with_suffix(".jsonl.tmp")
        with tmp.open("w", encoding="utf-8") as f:
            for l in self._lessons:
                f.write(l.model_dump_json() + "\n")
        tmp.replace(self._path)

    # ── public API ──────────────────────────────────────────────────────────

    def list(self) -> list[Lesson]:
        with self._lock:
            return list(self._lessons)

    def add(self, category: str, text: str, pinned: bool = False) -> Lesson:
        category = category if category in _VALID_CATEGORIES else "knowledge"
        text = (text or "").strip()
        if not text:
            raise ValueError("lesson text is empty")
        with self._lock:
            l = Lesson(
                id=self._next_id,
                category=category,
                text=text,
                pinned=pinned,
                created_at=time.time(),
            )
            self._next_id += 1
            self._lessons.append(l)
            self._evict()
            self._persist()
            return l

    def remove(self, lesson_id: int) -> bool:
        with self._lock:
            before = len(self._lessons)
            self._lessons = [l for l in self._lessons if l.id != lesson_id]
            if len(self._lessons) == before:
                return False
            self._persist()
            return True

    def set_pinned(self, lesson_id: int, pinned: bool) -> Lesson | None:
        with self._lock:
            for l in self._lessons:
                if l.id == lesson_id:
                    l.pinned = pinned
                    self._persist()
                    return l
            return None

    def _evict(self) -> None:
        if len(self._lessons) <= _MAX_LESSONS:
            return
        unpinned = [l for l in self._lessons if not l.pinned]
        unpinned.sort(key=lambda x: x.created_at)
        to_drop = len(self._lessons) - _MAX_LESSONS
        drop_ids = {l.id for l in unpinned[:to_drop]}
        self._lessons = [l for l in self._lessons if l.id not in drop_ids]

    # ── prompt rendering ────────────────────────────────────────────────────

    def render_for_prompt(self, user_message: str) -> str:
        with self._lock:
            if not self._lessons:
                return ""
            picked: list[Lesson] = []
            seen: set[int] = set()
            # Always: pinned + preferences
            for l in self._lessons:
                if l.pinned or l.category == "preference":
                    picked.append(l)
                    seen.add(l.id)
            # Then: word-overlap with user message
            msg_tokens = _tokens(user_message)
            if msg_tokens:
                scored: list[tuple[int, Lesson]] = []
                for l in self._lessons:
                    if l.id in seen:
                        continue
                    overlap = len(_tokens(l.text) & msg_tokens)
                    if overlap > 0:
                        scored.append((overlap, l))
                scored.sort(key=lambda p: p[0], reverse=True)
                for _, l in scored:
                    picked.append(l)

            # Cap by budget
            lines: list[str] = []
            used = 0
            for l in picked:
                line = f"- [{l.category}] {l.text}"
                if used + len(line) + 1 > _RENDER_BUDGET_CHARS:
                    break
                lines.append(line)
                used += len(line) + 1
            if not lines:
                return ""
            return "<lessons>\n" + "\n".join(lines) + "\n</lessons>"


_singleton: LessonStore | None = None


def get_lesson_store() -> LessonStore:
    global _singleton
    if _singleton is None:
        _singleton = LessonStore()
    return _singleton
