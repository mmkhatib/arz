"""LessonsStore — persistent corrections and preferences in SQLite.

Lessons survive across sessions and are injected into the LLM context
so the agent doesn't repeat mistakes the user has corrected.
"""

from __future__ import annotations

import sqlite3
import time
from dataclasses import dataclass
from pathlib import Path

_DB_PATH = Path.home() / ".arz" / "memory.db"

_DDL = """
CREATE TABLE IF NOT EXISTS lessons (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    content   TEXT    NOT NULL,
    tags      TEXT    NOT NULL DEFAULT '',
    created_at REAL   NOT NULL
);
"""


@dataclass
class Lesson:
    id: int
    content: str
    tags: list[str]
    created_at: float


class LessonsStore:
    """CRUD for user-defined lessons stored in SQLite."""

    def __init__(self, db_path: Path | None = None) -> None:
        self._db = db_path or _DB_PATH
        self._db.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as conn:
            conn.executescript(_DDL)

    def _connect(self) -> sqlite3.Connection:
        return sqlite3.connect(self._db)

    def add(self, content: str, tags: list[str] | None = None) -> Lesson:
        """Insert a new lesson and return it."""
        now = time.time()
        tag_str = ",".join(tags or [])
        with self._connect() as conn:
            cur = conn.execute(
                "INSERT INTO lessons (content, tags, created_at) VALUES (?, ?, ?)",
                (content, tag_str, now),
            )
            lesson_id = cur.lastrowid
        return Lesson(id=lesson_id, content=content, tags=tags or [], created_at=now)

    def list(self, tag: str | None = None) -> list[Lesson]:
        """Return all lessons, optionally filtered by tag."""
        with self._connect() as conn:
            if tag:
                rows = conn.execute(
                    "SELECT id, content, tags, created_at FROM lessons "
                    "WHERE tags LIKE ? ORDER BY created_at DESC",
                    (f"%{tag}%",),
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT id, content, tags, created_at FROM lessons ORDER BY created_at DESC"
                ).fetchall()
        return [
            Lesson(
                id=r[0],
                content=r[1],
                tags=[t for t in r[2].split(",") if t],
                created_at=r[3],
            )
            for r in rows
        ]

    def remove(self, lesson_id: int) -> bool:
        """Delete a lesson. Returns True if a row was deleted."""
        with self._connect() as conn:
            cur = conn.execute("DELETE FROM lessons WHERE id = ?", (lesson_id,))
            return cur.rowcount > 0

    def format_for_context(self) -> str:
        """Format all lessons as a block to inject into LLM context."""
        lessons = self.list()
        if not lessons:
            return ""
        lines = ["## Lessons (user-defined preferences and corrections)\n"]
        for l in lessons:
            lines.append(f"- {l.content}")
        return "\n".join(lines)
