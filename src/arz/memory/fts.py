"""SQLite FTS5 index over arz memory.

Indexes:
    - preferences.md, projects.md (whole-file rows)
    - history/YYYY-MM-DD.md (one row per day)
    - lessons (one row per lesson)
    - markdown notes (one row per note key)

Schema is intentionally simple: a single FTS5 virtual table with `source`,
`key`, `title`, `body` columns. Search returns ranked rows scoped by
source if requested.

The index lives at ``~/.arz/memory_fts.db``. Rebuild is mtime-driven —
files newer than the last-indexed mtime get re-ingested.
"""

from __future__ import annotations

import json
import sqlite3
import threading
import time
from pathlib import Path
from typing import Iterable

_DB_PATH = Path.home() / ".arz" / "memory_fts.db"
_MEMORY_DIR = Path.home() / ".arz" / "memory"
_LESSONS_PATH = Path.home() / ".arz" / "lessons.jsonl"
_MARKDOWN_DIR = Path.home() / ".arz" / "markdown"


_DDL = """
CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
    source UNINDEXED,
    key UNINDEXED,
    title,
    body,
    tokenize='porter unicode61'
);
CREATE TABLE IF NOT EXISTS memory_meta (
    source TEXT NOT NULL,
    key TEXT NOT NULL,
    mtime REAL NOT NULL,
    PRIMARY KEY (source, key)
);
"""


class MemoryFTS:
    """FTS5 index over memory files, lessons, and markdown notes."""

    def __init__(self, db_path: Path | None = None) -> None:
        self._db = db_path or _DB_PATH
        self._db.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._init_schema()

    def _connect(self) -> sqlite3.Connection:
        return sqlite3.connect(str(self._db))

    def _init_schema(self) -> None:
        with self._lock, self._connect() as conn:
            conn.executescript(_DDL)

    # ── public API ──────────────────────────────────────────────────────────

    def reindex(self, force: bool = False) -> dict[str, int]:
        """Walk all sources and (re)index anything newer than last mtime.

        Returns a count per source for visibility. With force=True, drops
        every row and rebuilds.
        """
        if force:
            with self._lock, self._connect() as conn:
                conn.execute("DELETE FROM memory_fts")
                conn.execute("DELETE FROM memory_meta")
                conn.commit()

        counts = {"memory_files": 0, "history": 0, "lessons": 0, "notes": 0}
        counts["memory_files"] = self._index_memory_files()
        counts["history"] = self._index_history()
        counts["lessons"] = self._index_lessons()
        counts["notes"] = self._index_markdown_notes()
        return counts

    def search(self, q: str, source: str | None = None, k: int = 10) -> list[dict]:
        """Ranked FTS5 search. Returns up to k {source, key, title, snippet, rank}.

        FTS5 query syntax is honored — wrap in quotes to do an exact phrase.
        Special characters that confuse the FTS5 parser are escaped.
        """
        if not q.strip():
            return []
        q_safe = self._sanitize_query(q)
        params: list = [q_safe]
        where = ""
        if source:
            where = "AND source = ?"
            params.append(source)
        sql = (
            "SELECT source, key, title, "
            "snippet(memory_fts, 3, '<mark>', '</mark>', '…', 16) AS snippet, "
            "bm25(memory_fts) AS rank "
            "FROM memory_fts "
            f"WHERE memory_fts MATCH ? {where} "
            "ORDER BY rank "
            "LIMIT ?"
        )
        params.append(k)
        with self._lock, self._connect() as conn:
            try:
                rows = conn.execute(sql, params).fetchall()
            except sqlite3.OperationalError:
                # Fall back to a literal token search on parser errors.
                tokens = " ".join(t for t in q_safe.split() if t)
                if not tokens:
                    return []
                rows = conn.execute(sql, [tokens, *params[1:]]).fetchall()
        return [
            {"source": s, "key": k, "title": t, "snippet": sn, "rank": float(r)}
            for (s, k, t, sn, r) in rows
        ]

    # ── per-source indexers ─────────────────────────────────────────────────

    def _index_memory_files(self) -> int:
        n = 0
        for fname in ("preferences.md", "projects.md"):
            path = _MEMORY_DIR / fname
            if not path.exists():
                continue
            mtime = path.stat().st_mtime
            if not self._needs_reindex("memory", fname, mtime):
                continue
            self._upsert(
                source="memory",
                key=fname,
                title=fname,
                body=path.read_text(encoding="utf-8"),
                mtime=mtime,
            )
            n += 1
        return n

    def _index_history(self) -> int:
        hd = _MEMORY_DIR / "history"
        if not hd.exists():
            return 0
        n = 0
        for path in sorted(hd.glob("*.md")):
            mtime = path.stat().st_mtime
            if not self._needs_reindex("history", path.name, mtime):
                continue
            self._upsert(
                source="history",
                key=path.name,
                title=f"history: {path.stem}",
                body=path.read_text(encoding="utf-8"),
                mtime=mtime,
            )
            n += 1
        return n

    def _index_lessons(self) -> int:
        if not _LESSONS_PATH.exists():
            return 0
        mtime = _LESSONS_PATH.stat().st_mtime
        if not self._needs_reindex("lessons", "all", mtime):
            return 0
        # Wipe and re-add — lessons.jsonl is append-only so we can't easily
        # diff individual rows.
        with self._lock, self._connect() as conn:
            conn.execute("DELETE FROM memory_fts WHERE source = 'lessons'")
            with _LESSONS_PATH.open("r", encoding="utf-8") as f:
                count = 0
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        l = json.loads(line)
                    except Exception:
                        continue
                    conn.execute(
                        "INSERT INTO memory_fts (source, key, title, body) VALUES (?, ?, ?, ?)",
                        (
                            "lessons",
                            str(l.get("id", "")),
                            f"[{l.get('category','knowledge')}] lesson #{l.get('id','')}",
                            l.get("text", ""),
                        ),
                    )
                    count += 1
            conn.execute(
                "INSERT INTO memory_meta (source, key, mtime) VALUES ('lessons', 'all', ?) "
                "ON CONFLICT(source, key) DO UPDATE SET mtime = excluded.mtime",
                (mtime,),
            )
            conn.commit()
        return count

    def _index_markdown_notes(self) -> int:
        if not _MARKDOWN_DIR.exists():
            return 0
        n = 0
        for path in _MARKDOWN_DIR.glob("*.md"):
            mtime = path.stat().st_mtime
            if not self._needs_reindex("notes", path.name, mtime):
                continue
            self._upsert(
                source="notes",
                key=path.stem,
                title=path.stem,
                body=path.read_text(encoding="utf-8"),
                mtime=mtime,
            )
            n += 1
        return n

    # ── helpers ─────────────────────────────────────────────────────────────

    def _needs_reindex(self, source: str, key: str, mtime: float) -> bool:
        with self._lock, self._connect() as conn:
            row = conn.execute(
                "SELECT mtime FROM memory_meta WHERE source = ? AND key = ?",
                (source, key),
            ).fetchone()
        return row is None or float(row[0]) < mtime - 0.001

    def _upsert(self, *, source: str, key: str, title: str, body: str, mtime: float) -> None:
        with self._lock, self._connect() as conn:
            conn.execute(
                "DELETE FROM memory_fts WHERE source = ? AND key = ?",
                (source, key),
            )
            conn.execute(
                "INSERT INTO memory_fts (source, key, title, body) VALUES (?, ?, ?, ?)",
                (source, key, title, body),
            )
            conn.execute(
                "INSERT INTO memory_meta (source, key, mtime) VALUES (?, ?, ?) "
                "ON CONFLICT(source, key) DO UPDATE SET mtime = excluded.mtime",
                (source, key, mtime),
            )
            conn.commit()

    @staticmethod
    def _sanitize_query(q: str) -> str:
        # Strip characters that the FTS5 parser hates outside of phrase quotes.
        bad = '()*"!:^'
        return "".join(c if c not in bad else " " for c in q).strip()


_singleton: MemoryFTS | None = None


def get_memory_fts() -> MemoryFTS:
    global _singleton
    if _singleton is None:
        _singleton = MemoryFTS()
        try:
            _singleton.reindex()
        except Exception:
            pass
    return _singleton
