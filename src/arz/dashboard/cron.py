"""Cron / scheduled session runner.

Stores cron entries in ``~/.arz/cron.db``; uses APScheduler (in-memory job
store) to fire them. On startup the registry rehydrates all enabled entries
into the scheduler. Each fire creates a fresh session, runs the prompt
through the configured provider, and records the result on the entry.
"""

from __future__ import annotations

import asyncio
import logging
import sqlite3
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

log = logging.getLogger(__name__)

_DEFAULT_DB = Path.home() / ".arz" / "cron.db"

_DDL = """
CREATE TABLE IF NOT EXISTS crons (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    prompt      TEXT    NOT NULL,
    schedule    TEXT    NOT NULL,
    enabled     INTEGER NOT NULL DEFAULT 1,
    created_at  REAL    NOT NULL,
    last_run_at REAL,
    last_status TEXT,
    last_session_id TEXT,
    persistent_session INTEGER NOT NULL DEFAULT 0
);
"""


def _migrate_add_persistent_session(conn: sqlite3.Connection) -> None:
    cols = {row[1] for row in conn.execute("PRAGMA table_info(crons)").fetchall()}
    if "persistent_session" not in cols:
        conn.execute("ALTER TABLE crons ADD COLUMN persistent_session INTEGER NOT NULL DEFAULT 0")


@dataclass
class CronEntry:
    id: int
    name: str
    prompt: str
    schedule: str
    enabled: bool
    created_at: float
    last_run_at: float | None
    last_status: str | None
    last_session_id: str | None
    persistent_session: bool = False

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "prompt": self.prompt,
            "schedule": self.schedule,
            "enabled": self.enabled,
            "created_at": self.created_at,
            "last_run_at": self.last_run_at,
            "last_status": self.last_status,
            "last_session_id": self.last_session_id,
            "persistent_session": self.persistent_session,
        }


class CronRegistry:
    """SQLite-backed cron entries plus an APScheduler instance.

    The runner callback is provided by the gateway at startup so we don't
    hard-couple this module to providers/sessions — it stays testable and
    swappable.
    """

    def __init__(
        self,
        runner: Callable[[CronEntry], asyncio.Future | asyncio.Task | None],
        db_path: Path | None = None,
    ) -> None:
        self._db = db_path or _DEFAULT_DB
        self._db.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as conn:
            conn.executescript(_DDL)
            _migrate_add_persistent_session(conn)
        self._lock = threading.Lock()
        self._runner = runner
        self._scheduler = AsyncIOScheduler()

    def _connect(self) -> sqlite3.Connection:
        return sqlite3.connect(self._db)

    # ── CRUD ─────────────────────────────────────────────────────────────────

    def list(self) -> list[CronEntry]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT id, name, prompt, schedule, enabled, created_at, "
                "last_run_at, last_status, last_session_id, persistent_session FROM crons "
                "ORDER BY created_at DESC"
            ).fetchall()
        return [self._row_to_entry(r) for r in rows]

    def get(self, cron_id: int) -> CronEntry | None:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT id, name, prompt, schedule, enabled, created_at, "
                "last_run_at, last_status, last_session_id, persistent_session FROM crons WHERE id = ?",
                (cron_id,),
            ).fetchone()
        return self._row_to_entry(row) if row else None

    def create(
        self,
        name: str,
        prompt: str,
        schedule: str,
        enabled: bool = True,
        persistent_session: bool = False,
    ) -> CronEntry:
        # Validate cron expression up-front
        CronTrigger.from_crontab(schedule)
        now = time.time()
        with self._lock, self._connect() as conn:
            cur = conn.execute(
                "INSERT INTO crons (name, prompt, schedule, enabled, created_at, persistent_session) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (name, prompt, schedule, 1 if enabled else 0, now, 1 if persistent_session else 0),
            )
            cron_id = cur.lastrowid
        entry = CronEntry(
            id=cron_id,
            name=name,
            prompt=prompt,
            schedule=schedule,
            enabled=enabled,
            created_at=now,
            last_run_at=None,
            last_status=None,
            last_session_id=None,
            persistent_session=persistent_session,
        )
        if entry.enabled:
            self._add_job(entry)
        return entry

    def update(
        self,
        cron_id: int,
        *,
        name: str | None = None,
        prompt: str | None = None,
        schedule: str | None = None,
        enabled: bool | None = None,
        persistent_session: bool | None = None,
    ) -> CronEntry | None:
        existing = self.get(cron_id)
        if not existing:
            return None
        if schedule is not None:
            CronTrigger.from_crontab(schedule)  # validate
        merged = CronEntry(
            id=existing.id,
            name=name if name is not None else existing.name,
            prompt=prompt if prompt is not None else existing.prompt,
            schedule=schedule if schedule is not None else existing.schedule,
            enabled=enabled if enabled is not None else existing.enabled,
            created_at=existing.created_at,
            last_run_at=existing.last_run_at,
            last_status=existing.last_status,
            last_session_id=existing.last_session_id,
            persistent_session=(
                persistent_session
                if persistent_session is not None
                else existing.persistent_session
            ),
        )
        with self._lock, self._connect() as conn:
            conn.execute(
                "UPDATE crons SET name=?, prompt=?, schedule=?, enabled=?, persistent_session=? "
                "WHERE id=?",
                (
                    merged.name,
                    merged.prompt,
                    merged.schedule,
                    1 if merged.enabled else 0,
                    1 if merged.persistent_session else 0,
                    cron_id,
                ),
            )
        # Reschedule
        self._remove_job(cron_id)
        if merged.enabled:
            self._add_job(merged)
        return merged

    def delete(self, cron_id: int) -> bool:
        with self._lock, self._connect() as conn:
            cur = conn.execute("DELETE FROM crons WHERE id = ?", (cron_id,))
            removed = cur.rowcount > 0
        if removed:
            self._remove_job(cron_id)
        return removed

    # ── Run-tracking ─────────────────────────────────────────────────────────

    def record_run(self, cron_id: int, status: str, session_id: str | None) -> None:
        with self._lock, self._connect() as conn:
            conn.execute(
                "UPDATE crons SET last_run_at=?, last_status=?, last_session_id=? WHERE id=?",
                (time.time(), status, session_id, cron_id),
            )

    # ── Scheduler glue ───────────────────────────────────────────────────────

    def start(self) -> None:
        """Register all enabled entries and start the scheduler."""
        for entry in self.list():
            if entry.enabled:
                self._add_job(entry)
        self._scheduler.start()

    def shutdown(self) -> None:
        if self._scheduler.running:
            self._scheduler.shutdown(wait=False)

    def run_now(self, cron_id: int) -> bool:
        entry = self.get(cron_id)
        if not entry:
            return False
        self._fire(entry)
        return True

    def _add_job(self, entry: CronEntry) -> None:
        try:
            trigger = CronTrigger.from_crontab(entry.schedule)
        except ValueError:
            log.exception("Invalid cron schedule for entry %s: %r", entry.id, entry.schedule)
            return
        self._scheduler.add_job(
            self._fire,
            trigger=trigger,
            args=[entry],
            id=f"cron-{entry.id}",
            replace_existing=True,
        )

    def _remove_job(self, cron_id: int) -> None:
        try:
            self._scheduler.remove_job(f"cron-{cron_id}")
        except Exception:
            pass

    def _fire(self, entry: CronEntry) -> None:
        """Invoke the runner. Re-fetches latest entry state so updates take effect."""
        latest = self.get(entry.id) or entry
        try:
            self._runner(latest)
        except Exception:
            log.exception("Cron runner failed for entry %s", entry.id)

    @staticmethod
    def _row_to_entry(row) -> CronEntry:
        return CronEntry(
            id=row[0],
            name=row[1],
            prompt=row[2],
            schedule=row[3],
            enabled=bool(row[4]),
            created_at=row[5],
            last_run_at=row[6],
            last_status=row[7],
            last_session_id=row[8],
            persistent_session=bool(row[9]) if len(row) > 9 else False,
        )


# Process-wide accessor — set by the gateway at startup so tools running
# in the same process can find the registry without lugging around app.state.
_singleton: CronRegistry | None = None


def set_cron_registry(registry: CronRegistry) -> None:
    global _singleton
    _singleton = registry


def get_cron_registry() -> CronRegistry:
    if _singleton is None:
        raise RuntimeError("CronRegistry not initialised")
    return _singleton
