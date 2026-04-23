"""VectorStore — semantic search via sqlite-vec.

Phase 2: stub that stores documents but returns empty search results.
Phase 4: full sqlite-vec integration with real ANN search.
"""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

_DB_PATH = Path.home() / ".arz" / "memory.db"

_DDL = """
CREATE TABLE IF NOT EXISTS vector_docs (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    key     TEXT    NOT NULL UNIQUE,
    content TEXT    NOT NULL,
    meta    TEXT    NOT NULL DEFAULT '{}'
);
"""


class VectorStore:
    """Document store with future semantic search support.

    Currently stores documents in SQLite and falls back to keyword search.
    sqlite-vec ANN indexing activates in Phase 4.
    """

    def __init__(self, db_path: Path | None = None) -> None:
        self._db = db_path or _DB_PATH
        self._db.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as conn:
            conn.executescript(_DDL)

    def _connect(self) -> sqlite3.Connection:
        return sqlite3.connect(self._db)

    def add(self, key: str, content: str, meta: dict | None = None) -> None:
        """Insert or replace a document."""
        with self._connect() as conn:
            conn.execute(
                "INSERT OR REPLACE INTO vector_docs (key, content, meta) VALUES (?, ?, ?)",
                (key, content, json.dumps(meta or {})),
            )

    def search(self, query: str, k: int = 5) -> list[tuple[str, str, float]]:
        """Return up to k (key, content, score) tuples.

        Phase 2: keyword scoring. Phase 4: replace with sqlite-vec ANN.
        """
        terms = query.lower().split()
        with self._connect() as conn:
            rows = conn.execute("SELECT key, content FROM vector_docs").fetchall()
        results: list[tuple[float, str, str]] = []
        for key, content in rows:
            score = sum(content.lower().count(t) for t in terms)
            if score > 0:
                results.append((float(score), key, content))
        results.sort(reverse=True)
        return [(key, content, score) for score, key, content in results[:k]]
