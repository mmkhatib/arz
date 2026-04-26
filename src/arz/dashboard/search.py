"""SQLite FTS5 full-text search across session messages."""

from __future__ import annotations

import logging
import sqlite3
import threading
from pathlib import Path

from arz.session.manager import SessionManager
from arz.session.session import Session

log = logging.getLogger(__name__)


class SessionSearchIndex:
    """FTS5 index over (session_id, message_idx, role, content).

    Rebuilt from scratch on startup; the session count is small enough that
    incremental updates aren't worth the complexity yet. Call ``index_session``
    after a session is saved to refresh just that session's rows.
    """

    def __init__(self, db_path: Path | None = None) -> None:
        self._path = db_path or (Path.home() / ".arz" / "search_index.db")
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._init_schema()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self._path))
        conn.row_factory = sqlite3.Row
        return conn

    def _init_schema(self) -> None:
        try:
            with self._connect() as conn:
                conn.execute(
                    "CREATE VIRTUAL TABLE IF NOT EXISTS session_fts USING fts5("
                    "  session_id UNINDEXED,"
                    "  session_title UNINDEXED,"
                    "  message_idx UNINDEXED,"
                    "  role UNINDEXED,"
                    "  provider UNINDEXED,"
                    "  updated_at UNINDEXED,"
                    "  content,"
                    "  tokenize='porter unicode61'"
                    ")"
                )
        except sqlite3.DatabaseError as e:
            log.warning("FTS schema init failed (%s); rebuilding DB", e)
            for suffix in ("", "-wal", "-shm"):
                Path(str(self._path) + suffix).unlink(missing_ok=True)
            with self._connect() as conn:
                conn.execute(
                    "CREATE VIRTUAL TABLE session_fts USING fts5("
                    "  session_id UNINDEXED, session_title UNINDEXED,"
                    "  message_idx UNINDEXED, role UNINDEXED,"
                    "  provider UNINDEXED, updated_at UNINDEXED,"
                    "  content, tokenize='porter unicode61'"
                    ")"
                )

    def index_session(self, session: Session) -> None:
        with self._lock, self._connect() as conn:
            conn.execute("DELETE FROM session_fts WHERE session_id = ?", (session.id,))
            updated_at = session.updated_at.isoformat()
            for idx, msg in enumerate(session.messages):
                if not msg.text.strip():
                    continue
                conn.execute(
                    "INSERT INTO session_fts ("
                    "session_id, session_title, message_idx, role, provider, updated_at, content"
                    ") VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (
                        session.id,
                        session.title,
                        idx,
                        msg.role,
                        session.provider or "",
                        updated_at,
                        msg.text,
                    ),
                )

    def rebuild(self, mgr: SessionManager) -> int:
        with self._lock, self._connect() as conn:
            conn.execute("DELETE FROM session_fts")
        count = 0
        for session in list(mgr._sessions.values()):  # noqa: SLF001 — stable internal API
            self.index_session(session)
            count += 1
        return count

    def remove_session(self, session_id: str) -> None:
        with self._lock, self._connect() as conn:
            conn.execute("DELETE FROM session_fts WHERE session_id = ?", (session_id,))

    def search(
        self,
        query: str,
        *,
        provider: str | None = None,
        since: str | None = None,
        until: str | None = None,
        limit: int = 50,
    ) -> list[dict]:
        """Return up to ``limit`` ranked message hits.

        ``query`` is passed straight to FTS5 so users can use prefix (foo*),
        column filters, AND/OR/NOT. Empty/whitespace returns [].
        """
        q = query.strip()
        if not q:
            return []
        sql = (
            "SELECT session_id, session_title, message_idx, role, provider, updated_at, "
            "snippet(session_fts, 6, '<mark>', '</mark>', '...', 16) AS snippet, "
            "rank FROM session_fts "
            "WHERE session_fts MATCH ? "
        )
        params: list[object] = [_to_match(q)]
        if provider:
            sql += "AND provider = ? "
            params.append(provider)
        if since:
            sql += "AND updated_at >= ? "
            params.append(since)
        if until:
            sql += "AND updated_at <= ? "
            params.append(until)
        sql += "ORDER BY rank LIMIT ?"
        params.append(limit)

        try:
            with self._connect() as conn:
                rows = conn.execute(sql, params).fetchall()
        except sqlite3.OperationalError as e:
            # Bad FTS query (e.g. unbalanced quote) — return empty rather than 500
            log.debug("FTS search rejected query %r: %s", q, e)
            return []
        return [dict(row) for row in rows]


def _to_match(q: str) -> str:
    """Wrap user input into a lenient FTS5 match string.

    A bare token is OR'd with a prefix variant so 'rea' matches 'react'. Quoted
    phrases and explicit FTS5 operators are passed through untouched.
    """
    if any(c in q for c in '"*:()'):
        return q
    tokens = [t for t in q.split() if t]
    if not tokens:
        return q
    return " AND ".join(f'"{t}" OR {t}*' for t in tokens)
