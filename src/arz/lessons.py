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


def _norm(s: str) -> str:
    """Lowercase + strip punctuation + collapse whitespace for fuzzy-dedup."""
    out = re.sub(r"[^a-z0-9 ]+", " ", (s or "").lower())
    return re.sub(r"\s+", " ", out).strip()


class LessonStore:
    def __init__(self, path: Path | None = None) -> None:
        self._path = path or _DEFAULT_PATH
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = Lock()
        self._lessons: list[Lesson] = []
        self._next_id = 1
        self._mtime: float = 0.0
        self._load()

    # ── persistence ─────────────────────────────────────────────────────────

    def _load(self) -> None:
        if not self._path.exists():
            self._mtime = 0.0
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
        try:
            self._mtime = self._path.stat().st_mtime
        except OSError:
            self._mtime = 0.0

    def _reload_if_changed(self) -> None:
        """Re-read the JSONL if its mtime has moved.

        Covers the case where another process (a script, a manual file
        edit, the consolidator running in a subagent) wrote to the
        store. Cheap when nothing changed — one stat() call.
        """
        try:
            mtime = self._path.stat().st_mtime if self._path.exists() else 0.0
        except OSError:
            return
        if mtime and mtime != self._mtime:
            self._load()

    def _persist(self) -> None:
        tmp = self._path.with_suffix(".jsonl.tmp")
        with tmp.open("w", encoding="utf-8") as f:
            for l in self._lessons:
                f.write(l.model_dump_json() + "\n")
        tmp.replace(self._path)
        # Stamp mtime so _reload_if_changed doesn't re-read our own write.
        try:
            self._mtime = self._path.stat().st_mtime
        except OSError:
            pass

    # ── public API ──────────────────────────────────────────────────────────

    def list(self) -> list[Lesson]:
        with self._lock:
            self._reload_if_changed()
            return list(self._lessons)

    def add(self, category: str, text: str, pinned: bool = False) -> Lesson:
        category = category if category in _VALID_CATEGORIES else "knowledge"
        text = (text or "").strip()
        if not text:
            raise ValueError("lesson text is empty")
        with self._lock:
            self._reload_if_changed()
            # Fuzzy-dedup against existing lessons in the same category so
            # the model emitting the same fact in three sessions doesn't
            # produce three rows.
            target = _norm(text)
            for existing in self._lessons:
                if existing.category != category:
                    continue
                e_norm = _norm(existing.text)
                if (
                    e_norm == target
                    or (e_norm and target and e_norm in target and len(e_norm) >= 0.9 * len(target))
                    or (e_norm and target and target in e_norm and len(target) >= 0.9 * len(e_norm))
                ):
                    # Promote pinned if either copy is pinned.
                    if pinned and not existing.pinned:
                        existing.pinned = True
                        self._persist()
                    return existing
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

    def update(
        self, lesson_id: int, *, category: str | None = None, text: str | None = None
    ) -> Lesson | None:
        with self._lock:
            self._reload_if_changed()
            for l in self._lessons:
                if l.id != lesson_id:
                    continue
                if category is not None:
                    l.category = category if category in _VALID_CATEGORIES else "knowledge"
                if text is not None:
                    t = (text or "").strip()
                    if not t:
                        raise ValueError("lesson text is empty")
                    l.text = t
                self._persist()
                return l
            return None

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
            self._reload_if_changed()
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
        try:
            migrate_legacy_sqlite_lessons(_singleton)
        except Exception:
            pass
    return _singleton


_LEGACY_DB = Path.home() / ".arz" / "memory.db"


def migrate_legacy_sqlite_lessons(store: LessonStore, db_path: Path | None = None) -> int:
    """Move rows from the retired SQLite ``lessons`` table into the JSONL store.

    That table was written by the old ``/api/memory/lessons`` endpoints but
    never injected into prompts, so anything saved there was invisible to
    the model. Rows are added (deduped) and the table is renamed so this
    runs once. Returns the number of rows migrated.
    """
    import sqlite3

    db = db_path or _LEGACY_DB
    if not db.exists():
        return 0
    with sqlite3.connect(str(db)) as conn:
        has = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='lessons'"
        ).fetchone()
        if not has:
            return 0
        rows = conn.execute("SELECT content, tags FROM lessons ORDER BY id").fetchall()
        n = 0
        for content, tags in rows:
            tag_set = {t.strip() for t in (tags or "").split(",") if t.strip()}
            category = next((t for t in tag_set if t in _VALID_CATEGORIES), "knowledge")
            try:
                store.add(category, content)
                n += 1
            except ValueError:
                continue
        conn.execute("ALTER TABLE lessons RENAME TO lessons_legacy_migrated")
    return n
