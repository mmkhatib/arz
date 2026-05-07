"""SubagentManager — fire-and-collect background sessions.

A subagent is a single-turn isolated session: a parent session asks
`spawn_run(agent, prompt)`, the manager spawns a fresh provider with the
named agent's config, runs one turn, captures the assistant text, persists
the result to disk, and queues an injection into the parent on the next turn.

Limits:
    - max 3 concurrent across the gateway
    - per-subagent timeout: 30 minutes
"""

from __future__ import annotations

import asyncio
import json
import time
import uuid
from collections.abc import Callable
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

import structlog

log = structlog.get_logger(__name__)

_DIR = Path.home() / ".arz" / "subagents"
_MAX_CONCURRENT = 3
_TIMEOUT_S = 1800.0


@dataclass
class SubagentRecord:
    id: str
    parent_session_id: str
    agent_name: str
    prompt: str
    status: str = "pending"  # pending | running | completed | failed | timeout
    result: str = ""
    started_at: float = 0.0
    finished_at: float = 0.0


@dataclass
class _RunningTask:
    record: SubagentRecord
    task: asyncio.Task[Any]


# Type for the runner: takes (agent_name, prompt) → assistant text.
# Injected by the gateway at startup so this module stays import-cycle-safe.
SubagentRunner = Callable[[str, str], "asyncio.Future[str]"]


class SubagentManager:
    def __init__(self, runner: SubagentRunner | None = None) -> None:
        self._dir = _DIR
        self._dir.mkdir(parents=True, exist_ok=True)
        self._runner = runner
        self._running: dict[str, _RunningTask] = {}
        # parent_session_id → list of completed-but-not-yet-injected subagent ids
        self._pending_injections: dict[str, list[str]] = {}
        self._sem = asyncio.Semaphore(_MAX_CONCURRENT)

    def set_runner(self, runner: SubagentRunner) -> None:
        self._runner = runner

    # ── public API ──────────────────────────────────────────────────────────

    def spawn(self, parent_session_id: str, agent_name: str, prompt: str) -> SubagentRecord:
        if self._runner is None:
            raise RuntimeError("SubagentManager has no runner — set one at startup")
        rec = SubagentRecord(
            id=uuid.uuid4().hex,
            parent_session_id=parent_session_id,
            agent_name=agent_name,
            prompt=prompt.strip(),
            status="pending",
        )
        self._persist(rec)
        task = asyncio.create_task(self._execute(rec))
        self._running[rec.id] = _RunningTask(rec, task)
        return rec

    def get(self, sub_id: str) -> SubagentRecord | None:
        rt = self._running.get(sub_id)
        if rt is not None:
            return rt.record
        path = self._dir / f"{sub_id}.json"
        if not path.exists():
            return None
        try:
            return SubagentRecord(**json.loads(path.read_text(encoding="utf-8")))
        except Exception:
            return None

    def list_active(self) -> list[SubagentRecord]:
        return [rt.record for rt in self._running.values()]

    def list_recent(self, limit: int = 50) -> list[SubagentRecord]:
        records: list[SubagentRecord] = []
        files = sorted(self._dir.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True)
        for p in files[:limit]:
            try:
                records.append(SubagentRecord(**json.loads(p.read_text(encoding="utf-8"))))
            except Exception:
                continue
        return records

    def pop_pending_for(self, parent_session_id: str) -> list[SubagentRecord]:
        """Return + clear completed subagents whose parent hasn't seen them yet."""
        ids = self._pending_injections.pop(parent_session_id, [])
        out: list[SubagentRecord] = []
        for sid in ids:
            rec = self.get(sid)
            if rec is not None:
                out.append(rec)
        return out

    # ── internals ───────────────────────────────────────────────────────────

    def _persist(self, rec: SubagentRecord) -> None:
        path = self._dir / f"{rec.id}.json"
        path.write_text(json.dumps(asdict(rec), indent=2), encoding="utf-8")

    async def _execute(self, rec: SubagentRecord) -> None:
        async with self._sem:
            rec.started_at = time.time()
            rec.status = "running"
            self._persist(rec)
            try:
                assert self._runner is not None
                result_coro = self._runner(rec.agent_name, rec.prompt)
                text = await asyncio.wait_for(result_coro, timeout=_TIMEOUT_S)
                rec.result = text or ""
                rec.status = "completed"
            except TimeoutError:
                rec.status = "timeout"
                rec.result = "(subagent exceeded 30-min timeout)"
            except Exception as e:
                log.exception("Subagent failed", sub_id=rec.id)
                rec.status = "failed"
                rec.result = f"(subagent error: {e})"
            finally:
                rec.finished_at = time.time()
                self._persist(rec)
                self._pending_injections.setdefault(rec.parent_session_id, []).append(rec.id)
                self._running.pop(rec.id, None)


_singleton: SubagentManager | None = None


def get_subagent_manager() -> SubagentManager:
    global _singleton
    if _singleton is None:
        _singleton = SubagentManager()
    return _singleton
