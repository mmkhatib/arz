"""Goal evaluator + auto-iteration loop.

Mirrors Claude Code's `/goal` mechanic: after every assistant turn, a
cheap fast model reads the goal + recent transcript and returns
``{met: bool, reason: short}``. If unmet, the chat route fires a
synthetic follow-up turn (capped) with the reason as guidance. If met,
the goal flips to ``status="done"`` and a transcript marker lands.

This module owns only the evaluator + cap logic. The actual turn
spawning lives in ``arz.dashboard.routes.chat`` so it reuses all the
regular streaming / tool / approval plumbing.
"""

from __future__ import annotations

import json
import logging
import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

log = logging.getLogger(__name__)


# Cheap-runner signature: (agent_name, prompt) -> reply text. Same shape
# used by the consolidator + suggestions paths.
GoalRunner = Callable[[str, str], Awaitable[str]]


@dataclass
class GoalDecision:
    met: bool
    reason: str
    raw: str = ""  # raw model text, for debugging


_EVAL_PROMPT = """You are a goal-completion judge. Decide whether the assistant's recent work has satisfied the user's stated goal.

GOAL:
{goal}

RECENT CONVERSATION (last {n} turns):
{transcript}

Reply with strict JSON in one line, no prose, no code fences:
{{"met": true|false, "reason": "<one short sentence>"}}

- "met": true ONLY if the goal's end condition is clearly satisfied in the conversation above. If unsure, choose false.
- "reason": If false, name the single most important thing still missing. If true, name what proves it (e.g. "tests pass in last bash output").
- Be strict. The assistant's claim of completion is not enough; look for evidence in tool output or concrete results.
"""


def _format_transcript(history: list[dict], n: int) -> str:
    """Trim transcript to last *n* turns, summarising older bulk."""
    if not history:
        return "(empty)"
    tail = history[-n:]
    lines: list[str] = []
    for m in tail:
        role = m.get("role", "?")
        text = (m.get("text") or "").strip()
        if len(text) > 1200:
            text = text[:600] + "\n…[truncated]…\n" + text[-400:]
        lines.append(f"[{role}] {text}")
    return "\n\n".join(lines)


async def evaluate(
    goal: str,
    history: list[dict],
    runner: GoalRunner,
    *,
    n_turns: int = 6,
    agent_name: str = "goal-evaluator",
) -> GoalDecision:
    """Run the cheap evaluator. Always returns a decision — never raises.

    Defaults to "not met, reason: evaluator failed" on any error so the
    auto-loop falls back to "keep going" rather than spuriously
    declaring success.
    """
    goal = (goal or "").strip()
    if not goal:
        return GoalDecision(met=False, reason="empty goal")
    prompt = _EVAL_PROMPT.format(
        goal=goal[:4000],
        n=n_turns,
        transcript=_format_transcript(history, n_turns),
    )
    try:
        raw = await runner(agent_name, prompt)
    except Exception as e:
        log.warning("goal evaluator runner failed: %s", e)
        return GoalDecision(met=False, reason="evaluator unavailable")
    return _parse_decision(raw)


def _parse_decision(raw: str) -> GoalDecision:
    """Pull `{met, reason}` out of the model's reply. Tolerates code
    fences, leading prose, and slightly malformed JSON."""
    if not raw:
        return GoalDecision(met=False, reason="empty evaluator reply", raw="")
    text = raw.strip()
    # Strip code fences if the model added them despite instructions.
    fence = re.match(r"```(?:json)?\s*(.+?)\s*```", text, re.DOTALL)
    if fence:
        text = fence.group(1).strip()
    # Find the first JSON object.
    m = re.search(r"\{[^{}]*\}", text, re.DOTALL)
    candidate = m.group(0) if m else text
    try:
        data = json.loads(candidate)
    except Exception:
        # Fall back to keyword sniff so a totally off-format reply
        # doesn't permanently jam the loop as "met".
        low = text.lower()
        looks_met = ('"met":true' in low.replace(" ", "")) or "goal achieved" in low
        return GoalDecision(met=looks_met, reason=text[:200], raw=raw)
    met = bool(data.get("met", False))
    reason = str(data.get("reason") or "").strip() or ("goal met" if met else "no reason given")
    return GoalDecision(met=met, reason=reason[:400], raw=raw)


# ── auto-loop helpers ────────────────────────────────────────────────────


_AUTO_TURN_TEMPLATE = (
    "[goal-auto {n}/{cap}] The goal is not yet complete. "
    "Continue working toward it. "
    'Evaluator feedback on the last turn: "{reason}"\n\n'
    "Goal:\n{goal}\n\n"
    "Make one concrete step. Use tools as needed. "
    "If the goal is now done, end your reply with the literal token `goal:done`."
)


def build_followup_prompt(goal: str, reason: str, iteration: int, cap: int) -> str:
    """The user-message body posted back to /api/chat for an auto-iteration."""
    return _AUTO_TURN_TEMPLATE.format(
        n=iteration,
        cap=cap,
        reason=(reason or "no specific feedback").replace("\n", " ")[:400],
        goal=(goal or "").strip()[:4000],
    )


def should_auto_iterate(
    *,
    goal: str,
    status: str,
    iterations: int,
    max_iterations: int,
    last_assistant_text: str,  # noqa: ARG001 — kept for API compat / future use
) -> bool:
    """Pure decision: should the chat route schedule the post-turn
    evaluator? Matches Claude Code's `/goal`: the evaluator is the
    sole authority on whether a goal is met. The model's self-declared
    "goal:done" is a HINT to the evaluator (still in its transcript),
    not a short-circuit.
    """
    if not (goal or "").strip():
        return False
    if status != "active":
        return False
    if iterations >= max_iterations:
        return False
    return True
