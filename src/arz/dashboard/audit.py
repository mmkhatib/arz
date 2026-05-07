"""Audit log — persistent record of tool calls, file ops, shell execs, and auth events.

Stored at ``~/.arz/audit.db``. The dashboard records events directly via
``log_event``; broader EventBus subscribers can pipe in later.
"""

from __future__ import annotations

import json
import logging
import sqlite3
import threading
import time
from dataclasses import dataclass
from pathlib import Path

log = logging.getLogger(__name__)

_DEFAULT_DB = Path.home() / ".arz" / "audit.db"

_DDL = """
CREATE TABLE IF NOT EXISTS audit (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    ts          REAL    NOT NULL,
    kind        TEXT    NOT NULL,
    session_id  TEXT,
    actor       TEXT,
    summary     TEXT    NOT NULL,
    details     TEXT    NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit(ts DESC);
CREATE INDEX IF NOT EXISTS idx_audit_kind ON audit(kind);
CREATE INDEX IF NOT EXISTS idx_audit_session ON audit(session_id);
"""


@dataclass
class AuditEvent:
    id: int
    ts: float
    kind: str
    session_id: str | None
    actor: str | None
    summary: str
    details: dict

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "ts": self.ts,
            "kind": self.kind,
            "session_id": self.session_id,
            "actor": self.actor,
            "summary": self.summary,
            "details": self.details,
        }


class AuditLog:
    """SQLite-backed append-only audit log with simple filtered reads."""

    def __init__(self, db_path: Path | None = None) -> None:
        self._db = db_path or _DEFAULT_DB
        self._db.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        with self._connect() as conn:
            conn.executescript(_DDL)

    def _connect(self) -> sqlite3.Connection:
        return sqlite3.connect(self._db)

    def log(
        self,
        kind: str,
        summary: str,
        *,
        session_id: str | None = None,
        actor: str | None = None,
        details: dict | None = None,
    ) -> None:
        try:
            with self._lock, self._connect() as conn:
                conn.execute(
                    "INSERT INTO audit (ts, kind, session_id, actor, summary, details) "
                    "VALUES (?, ?, ?, ?, ?, ?)",
                    (
                        time.time(),
                        kind,
                        session_id,
                        actor,
                        summary[:500],
                        json.dumps(details or {})[:8000],
                    ),
                )
        except Exception:
            log.exception("audit log write failed")

    def query(
        self,
        *,
        limit: int = 100,
        kind: str | None = None,
        session_id: str | None = None,
        since: float | None = None,
    ) -> list[AuditEvent]:
        sql = "SELECT id, ts, kind, session_id, actor, summary, details FROM audit WHERE 1=1"
        params: list = []
        if kind:
            sql += " AND kind = ?"
            params.append(kind)
        if session_id:
            sql += " AND session_id = ?"
            params.append(session_id)
        if since is not None:
            sql += " AND ts >= ?"
            params.append(since)
        sql += " ORDER BY ts DESC LIMIT ?"
        params.append(limit)
        with self._connect() as conn:
            rows = conn.execute(sql, params).fetchall()
        out: list[AuditEvent] = []
        for r in rows:
            try:
                details = json.loads(r[6])
            except Exception:
                details = {}
            out.append(
                AuditEvent(
                    id=r[0],
                    ts=r[1],
                    kind=r[2],
                    session_id=r[3],
                    actor=r[4],
                    summary=r[5],
                    details=details,
                )
            )
        return out

    def kinds(self) -> list[str]:
        with self._connect() as conn:
            return [
                r[0]
                for r in conn.execute("SELECT DISTINCT kind FROM audit ORDER BY kind").fetchall()
            ]
