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
from collections.abc import Awaitable, Callable
from dataclasses import asdict, dataclass, field
from pathlib import Path

import structlog

log = structlog.get_logger(__name__)

_DIR = Path.home() / ".arz" / "tasks"
_DEFAULT_AGENT = "general"

# Stay-on-task #3 — separate retry counters by failure mode. The old
# single counter conflated process crashes (not the model's fault) with
# logic errors (where retry should drain the budget), so a flaky CLI
# burned 3 logic retries on what should've been 2 free recoveries.
_MAX_RETRIES = 3  # logic failures (model returned wrong answer)
_MAX_RECOVERIES = 2  # process crashes — don't tick the retry counter
_MAX_COMPACTIONS = 2  # context-overflow recoveries — same exemption
_SAME_ERROR_THRESHOLD = 2  # two consecutive identical errors → escalate early

SubagentRunner = Callable[[str, str], Awaitable[str]]


@dataclass
class TaskStep:
    n: int
    text: str
    status: str = "pending"  # pending | running | done | failed
    attempts: int = 0
    result: str = ""
    error: str = ""


# Stay-on-task #11 — WorkingMemory per Project. Survives compaction
# because we maintain it ourselves; re-injected into every task prompt.
@dataclass
class WorkingMemory:
    files_changed: list[str] = field(default_factory=list)
    decisions: list[str] = field(default_factory=list)
    blockers: list[str] = field(default_factory=list)

    def update_from_result(self, result: str) -> None:
        """Cheap regex extraction of file-touched lines from a task's
        output. Decisions + blockers are best surfaced explicitly by
        the worker (`DECISION: …` / `BLOCKER: …`) but we don't require
        it — the files list alone is enough to give the next task
        useful context after compaction.
        """
        for line in (result or "").splitlines():
            stripped = line.strip()
            if any(
                stripped.startswith(p)
                for p in ("Created ", "Modified ", "Updated ", "Deleted ", "Wrote ")
            ):
                self.files_changed.append(stripped[:200])
            elif stripped.startswith("DECISION:"):
                self.decisions.append(stripped[9:].strip()[:240])
            elif stripped.startswith("BLOCKER:"):
                self.blockers.append(stripped[8:].strip()[:240])

    def summary(self) -> str:
        if not (self.files_changed or self.decisions or self.blockers):
            return ""
        parts = ["## Working Memory"]
        if self.files_changed:
            parts.append("### Files Changed")
            parts.extend(f"- {f}" for f in self.files_changed[-20:])
        if self.decisions:
            parts.append("### Decisions")
            parts.extend(f"- {d}" for d in self.decisions[-10:])
        if self.blockers:
            parts.append("### Blockers")
            parts.extend(f"- {b}" for b in self.blockers[-5:])
        return "\n".join(parts)


@dataclass
class TaskRecord:
    id: str
    spec: str
    agent: str
    status: str = "pending"  # pending | decomposing | running | verifying | done | failed
    steps: list[TaskStep] = field(default_factory=list)
    verdict: str = ""
    started_at: float = 0.0
    finished_at: float = 0.0
    # Stay-on-task #11 — accumulated working memory across all steps.
    memory: WorkingMemory = field(default_factory=WorkingMemory)
    # Stay-on-task #9 — how many times we've called _try_replan.
    replan_count: int = 0


_MAX_REPLAN = 2  # stay-on-task #9 — cap on replan attempts


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


# Stay-on-task #10 — every step prompt opens with the full plan + a
# cursor (← YOU ARE HERE). MeshClaw's single biggest prompt-engineering
# win: the model sees what's done, what's pending, and where it is.
def _build_step_prompt(rec: TaskRecord, step: TaskStep, attempt: int) -> str:
    lines: list[str] = [
        "You are an autonomous execution agent in a multi-step plan.",
        "Execute the CURRENT STEP precisely. Do not skip ahead or combine steps.",
    ]
    if attempt > 1:
        lines.append(f"This is retry attempt {attempt}. Fix the previous error — don't restart.")
    mem_block = rec.memory.summary()
    if mem_block:
        lines.append("")
        lines.append(mem_block)
    lines.append("")
    lines.append("## Full Execution Plan (follow strictly)")
    lines.append(
        "Execute ONLY what your current step describes. Do not skip ahead or combine steps."
    )
    for s in rec.steps:
        if s.status == "done":
            icon = "✅"
            here = ""
        elif s.n == step.n:
            icon = "🔄"
            here = " ← YOU ARE HERE"
        else:
            icon = "⬜"
            here = ""
        lines.append(f"{icon} {s.n}. {s.text[:160]}{here}")
    lines.append("")
    lines.append(f"## Current Step ({step.n}/{len(rec.steps)})")
    lines.append(step.text)
    if attempt > 1 and step.error:
        lines.append("")
        lines.append(f"## Previous Attempt Failed (attempt {attempt - 1})")
        lines.append(f"Error: {step.error}")
        lines.append("")
        lines.append("Fix the error and try again. Do not start over.")
    lines.append("")
    lines.append(
        "When you write or change files, prefix each line with one of: Created/Modified/"
        "Updated/Deleted/Wrote. Surface key choices on a line beginning DECISION:. Surface "
        "blockers on a line beginning BLOCKER:. These tags drive the working-memory layer."
    )
    return "\n".join(lines)


_REPLAN_PROMPT = """\
You are replanning the REMAINING work for a multi-step task after a
step failed. Read the original spec, the completed steps (✅), the
failed step + its error, and the current working memory + git state.
Produce a NEW plan covering only what's left.

Output ONLY the new steps, one per line, prefixed `1. `, `2. `, etc.
No prose before or after.

ORIGINAL SPEC:
{spec}

COMPLETED STEPS:
{completed}

FAILED STEP (will be discarded):
{failed_step}
Error: {failed_error}

WORKING MEMORY:
{memory}

Aim for 1–6 new steps that finish the spec without revisiting what is
already done.
"""


async def _try_replan(rec: TaskRecord, failed: TaskStep, runner: SubagentRunner) -> bool:
    """Ask the LLM for a revised plan for the REMAINING work. Returns
    True when new steps were appended + the task can keep running."""
    if rec.replan_count >= _MAX_REPLAN:
        return False
    rec.replan_count += 1
    completed = "\n".join(f"✅ {s.n}. {s.text[:160]}" for s in rec.steps if s.status == "done")
    prompt = _REPLAN_PROMPT.format(
        spec=rec.spec.strip()[:4000],
        completed=completed or "(none)",
        failed_step=f"{failed.n}. {failed.text[:240]}",
        failed_error=(failed.error or failed.result)[:400] or "(no error captured)",
        memory=rec.memory.summary() or "(empty)",
    )
    try:
        raw = await runner(rec.agent, prompt)
    except Exception:
        log.exception("replan call failed", task_id=rec.id)
        return False
    new_steps: list[str] = []
    for line in (raw or "").splitlines():
        m = _STEP_LINE_RE.match(line)
        if m:
            new_steps.append(m.group(1).strip())
    if not new_steps:
        return False
    next_n = (rec.steps[-1].n if rec.steps else 0) + 1
    for i, text in enumerate(new_steps):
        rec.steps.append(TaskStep(n=next_n + i, text=text))
    log.info(
        "task replanned",
        task_id=rec.id,
        appended=len(new_steps),
        replan_count=rec.replan_count,
    )
    return True


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
        # Tracks running asyncio tasks so cancel() can target them.
        self._tasks: dict[str, asyncio.Task] = {}

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

    async def kick_off(
        self,
        spec: str,
        agent: str = _DEFAULT_AGENT,
        steps: list[str] | None = None,
    ) -> TaskRecord:
        """Start a task. If *steps* is provided, decomposition is skipped
        and the runner uses those step texts directly — that's the path
        the Autopilot UI uses after the user previewed/edited the plan."""
        if self._runner is None:
            raise RuntimeError("TaskRunner has no runner — set one at startup")
        initial_steps = (
            [TaskStep(n=i + 1, text=t) for i, t in enumerate(steps or []) if t.strip()]
            if steps
            else []
        )
        rec = TaskRecord(
            id=uuid.uuid4().hex,
            spec=spec.strip(),
            agent=agent or _DEFAULT_AGENT,
            status="running" if initial_steps else "decomposing",
            steps=initial_steps,
            started_at=time.time(),
        )
        self._persist(rec)
        task = asyncio.create_task(self._execute(rec))
        self._tasks[rec.id] = task
        return rec

    async def plan(self, spec: str, agent: str = _DEFAULT_AGENT) -> list[str]:
        """Generate a plan from a spec without running anything.

        Used by the Autopilot UI: user previews + edits before run.
        """
        if self._runner is None:
            raise RuntimeError("TaskRunner has no runner — set one at startup")
        decomposition = await self._runner(
            agent or _DEFAULT_AGENT, _DECOMPOSE_PROMPT.format(spec=spec.strip())
        )
        return _parse_steps(decomposition)

    def cancel(self, task_id: str) -> bool:
        """Cancel a running task. Returns True if a task was cancelled."""
        t = self._tasks.get(task_id)
        if t is None or t.done():
            return False
        t.cancel()
        rec = self.get(task_id)
        if rec and rec.status not in ("done", "failed"):
            rec.status = "failed"
            rec.verdict = "(cancelled by user)"
            rec.finished_at = time.time()
            self._persist(rec)
        return True

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
            # 1. decompose (skipped when caller supplied steps already —
            # that's the Autopilot path, where the user reviewed + edited
            # the plan before clicking Run).
            assert self._runner is not None
            if rec.steps:
                step_texts = [s.text for s in rec.steps]
            else:
                decomposition = await self._runner(
                    rec.agent, _DECOMPOSE_PROMPT.format(spec=rec.spec)
                )
                step_texts = _parse_steps(decomposition)
            if not step_texts:
                rec.status = "failed"
                rec.verdict = "decomposition produced no parseable steps"
                rec.finished_at = time.time()
                self._persist(rec)
                return
            if not rec.steps:
                rec.steps = [TaskStep(n=i + 1, text=t) for i, t in enumerate(step_texts)]
            rec.status = "running"
            self._persist(rec)

            # 2. execute each step with retries. Prior step results are
            # fed forward as context so later stages know what's done.
            # Iterate by index so we can pick up replan-appended steps
            # without restarting the loop.
            idx = 0
            while idx < len(rec.steps):
                step = rec.steps[idx]
                idx += 1
                if step.status == "done":
                    continue  # resume-aware: don't re-run finished steps
                attempt = 0
                recoveries = 0
                compactions = 0
                prev_error = ""
                same_error_count = 0
                while attempt < _MAX_RETRIES:
                    attempt += 1
                    # Stay-on-task #10 + #11 — Full Execution Plan
                    # prompt + WorkingMemory summary, rebuilt on every
                    # attempt so the model always sees the cursor +
                    # any accumulated files/decisions/blockers.
                    prompt = _build_step_prompt(rec, step, attempt)
                    step.status = "running"
                    step.attempts = attempt
                    self._persist(rec)
                    try:
                        out = await self._runner(rec.agent, prompt)
                        step.result = out or ""
                        step.status = "done"
                        rec.memory.update_from_result(step.result)
                        self._persist(rec)
                        break
                    except Exception as e:
                        err_str = f"{type(e).__name__}: {e}"
                        cls = type(e).__name__.lower()
                        log.exception("step failed", task_id=rec.id, step=step.n, attempt=attempt)
                        step.result = f"(error: {e})"
                        step.error = err_str
                        # Classify the failure: process death + context
                        # overflow get their own budgets so a flaky CLI
                        # doesn't burn the logic-retry budget.
                        if "processdied" in cls or "brokenpipe" in cls or "connectionreset" in cls:
                            if recoveries >= _MAX_RECOVERIES:
                                step.error = f"Process died {recoveries + 1} times — giving up"
                                break
                            recoveries += 1
                            attempt -= 1  # crash doesn't tick the logic counter
                            continue
                        if "contextoverflow" in cls or "context window" in str(e).lower():
                            if compactions >= _MAX_COMPACTIONS:
                                step.error = f"Context overflow {compactions + 1} times"
                                break
                            compactions += 1
                            attempt -= 1
                            continue
                        # Same-error twice → escalate early. No point
                        # burning the rest of the budget on a known-doomed
                        # retry pattern.
                        if err_str == prev_error:
                            same_error_count += 1
                            if same_error_count >= _SAME_ERROR_THRESHOLD:
                                break
                        else:
                            same_error_count = 1
                            prev_error = err_str
                if step.status != "done":
                    step.status = "failed"
                    # Stay-on-task #9 — _try_replan: ask the LLM for a
                    # revised plan for the REMAINING work. If new steps
                    # come back we append them + keep running. Capped
                    # so a pathological loop can't run forever.
                    replanned = await _try_replan(rec, step, self._runner)
                    if replanned:
                        self._persist(rec)
                        continue
                    rec.status = "failed"
                    rec.finished_at = time.time()
                    self._persist(rec)
                    return

            # 3. verify
            rec.status = "verifying"
            self._persist(rec)
            step_results = "\n\n".join(f"## Step {s.n}: {s.text}\n{s.result}" for s in rec.steps)
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
