"""TaskRunner — autonomously decompose, execute, and verify a markdown spec.

Usage flow:
    1. POST /api/taskrun  body { spec, agent? }
    2. Runner asks the agent to decompose into ordered steps (one LLM turn).
    3. Each step is executed as a subagent run.
    4. After the last step, the runner asks the agent to verify acceptance
       against the spec.
    5. Progress is checkpointed to ~/.arz/tasks/<id>/PROGRESS.md so a crash +
       restart resumes from where it left off.
"""

from __future__ import annotations

import asyncio
import json
import re
import time
import uuid
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Any, Awaitable, Callable

import structlog

log = structlog.get_logger(__name__)

_DIR = Path.home() / ".arz" / "tasks"
_DEFAULT_AGENT = "general"
_MAX_RETRIES_PER_STEP = 3

SubagentRunner = Callable[[str, str], Awaitable[str]]


@dataclass
class TaskStep:
    n: int
    text: str
    status: str = "pending"   # pending | running | done | failed
    attempts: int = 0
    result: str = ""


@dataclass
class TaskRecord:
    id: str
    spec: str
    agent: str
    status: str = "pending"   # pending | decomposing | running | verifying | done | failed
    steps: list[TaskStep] = field(default_factory=list)
    verdict: str = ""
    started_at: float = 0.0
    finished_at: float = 0.0


_DECOMPOSE_PROMPT = """\
You are the planner for a task runner. Read the spec below and produce an
ordered list of execution steps. Each step must be self-contained — the
worker that executes it sees only the step text, not the rest of the spec.

Output ONLY the steps, one per line, prefixed `1. `, `2. `, etc. No prose
before or after. Aim for 3–10 steps. Do not number sub-steps.

SPEC:
{spec}
"""

_VERIFY_PROMPT = """\
You are the acceptance checker for a task runner. The original spec is
below, followed by the worker output for each step. Decide if the spec is
satisfied.

Reply with EXACTLY one of:
    ACCEPT — and one short sentence why.
    REJECT — and one short sentence on what's missing.

SPEC:
{spec}

STEP RESULTS:
{step_results}
"""

_STEP_LINE_RE = re.compile(r"^\s*\d+[.)]\s+(.+)$")


def _parse_steps(decomposition: str) -> list[str]:
    out: list[str] = []
    for line in decomposition.splitlines():
        m = _STEP_LINE_RE.match(line)
        if m:
            out.append(m.group(1).strip())
    return out


class TaskRunner:
    def __init__(self, runner: SubagentRunner | None = None) -> None:
        self._dir = _DIR
        self._dir.mkdir(parents=True, exist_ok=True)
        self._runner = runner

    def set_runner(self, runner: SubagentRunner) -> None:
        self._runner = runner

    def list(self) -> list[TaskRecord]:
        out: list[TaskRecord] = []
        for d in sorted(self._dir.iterdir(), reverse=True):
            if not d.is_dir():
                continue
            p = d / "task.json"
            if not p.exists():
                continue
            try:
                raw = json.loads(p.read_text(encoding="utf-8"))
                steps = [TaskStep(**s) for s in raw.pop("steps", [])]
                out.append(TaskRecord(steps=steps, **raw))
            except Exception:
                continue
        return out

    def get(self, task_id: str) -> TaskRecord | None:
        p = self._dir / task_id / "task.json"
        if not p.exists():
            return None
        try:
            raw = json.loads(p.read_text(encoding="utf-8"))
            steps = [TaskStep(**s) for s in raw.pop("steps", [])]
            return TaskRecord(steps=steps, **raw)
        except Exception:
            return None

    async def kick_off(self, spec: str, agent: str = _DEFAULT_AGENT) -> TaskRecord:
        if self._runner is None:
            raise RuntimeError("TaskRunner has no runner — set one at startup")
        rec = TaskRecord(
            id=uuid.uuid4().hex,
            spec=spec.strip(),
            agent=agent or _DEFAULT_AGENT,
            status="decomposing",
            started_at=time.time(),
        )
        self._persist(rec)
        # Run in background so the HTTP request returns immediately.
        asyncio.create_task(self._execute(rec))
        return rec

    # ── internals ───────────────────────────────────────────────────────────

    def _task_dir(self, task_id: str) -> Path:
        d = self._dir / task_id
        d.mkdir(parents=True, exist_ok=True)
        return d

    def _persist(self, rec: TaskRecord) -> None:
        d = self._task_dir(rec.id)
        data = asdict(rec)
        (d / "task.json").write_text(json.dumps(data, indent=2), encoding="utf-8")
        # Human-readable progress file
        lines = [f"# Task {rec.id} — {rec.status}", ""]
        for s in rec.steps:
            mark = {"done": "x", "failed": "!", "running": "~", "pending": " "}.get(s.status, " ")
            lines.append(f"- [{mark}] {s.text}")
        if rec.verdict:
            lines += ["", "## Verdict", rec.verdict]
        (d / "PROGRESS.md").write_text("\n".join(lines) + "\n", encoding="utf-8")

    async def _execute(self, rec: TaskRecord) -> None:
        try:
            # 1. decompose
            assert self._runner is not None
            decomposition = await self._runner(rec.agent, _DECOMPOSE_PROMPT.format(spec=rec.spec))
            step_texts = _parse_steps(decomposition)
            if not step_texts:
                rec.status = "failed"
                rec.verdict = "decomposition produced no parseable steps"
                rec.finished_at = time.time()
                self._persist(rec)
                return
            rec.steps = [TaskStep(n=i + 1, text=t) for i, t in enumerate(step_texts)]
            rec.status = "running"
            self._persist(rec)

            # 2. execute each step with retries
            for step in rec.steps:
                for attempt in range(1, _MAX_RETRIES_PER_STEP + 1):
                    step.status = "running"
                    step.attempts = attempt
                    self._persist(rec)
                    try:
                        out = await self._runner(rec.agent, step.text)
                        step.result = out or ""
                        step.status = "done"
                        self._persist(rec)
                        break
                    except Exception as e:
                        log.exception("step failed", task_id=rec.id, step=step.n, attempt=attempt)
                        step.result = f"(error: {e})"
                if step.status != "done":
                    step.status = "failed"
                    rec.status = "failed"
                    rec.finished_at = time.time()
                    self._persist(rec)
                    return

            # 3. verify
            rec.status = "verifying"
            self._persist(rec)
            step_results = "\n\n".join(
                f"## Step {s.n}: {s.text}\n{s.result}" for s in rec.steps
            )
            verdict_text = await self._runner(
                rec.agent,
                _VERIFY_PROMPT.format(spec=rec.spec, step_results=step_results),
            )
            rec.verdict = verdict_text.strip()
            rec.status = "done" if "ACCEPT" in verdict_text.upper() else "failed"
            rec.finished_at = time.time()
            self._persist(rec)

        except Exception as e:
            log.exception("task runner failed", task_id=rec.id)
            rec.status = "failed"
            rec.verdict = f"(runner crashed: {e})"
            rec.finished_at = time.time()
            self._persist(rec)


_singleton: TaskRunner | None = None


def get_task_runner() -> TaskRunner:
    global _singleton
    if _singleton is None:
        _singleton = TaskRunner()
    return _singleton
