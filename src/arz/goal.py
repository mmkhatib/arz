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


# Cheap model per provider — the evaluator is meant to be a SMALL fast
# judge, not another full Opus/Pro turn. Maps the session's main provider
# to the cheapest reliable counterpart for that family. Mirrors the
# Claude Code /goal design: Opus 4.7 writes; Haiku 4.5 judges.
#
#   claude-code → Haiku 4.5
#   codex       → GPT-5.4 Mini
#   gemini      → Gemini 2.5 Flash-Lite
#   kiro-cli    → Haiku 4.5 (Kiro routes to Anthropic underneath)
#   ollama      → "" (leave default; user picks; local models are already cheap)
#   anthropic   → Haiku 4.5
CHEAP_MODELS_BY_PROVIDER: dict[str, str] = {
    "claude-code": "claude-haiku-4-5-20251001",
    "codex": "gpt-5.4-mini",
    "gemini": "gemini-2.5-flash-lite",
    "kiro-cli": "claude-haiku-4.5",
    "ollama": "",
    "anthropic": "claude-haiku-4-5",
}


def cheap_model_for(provider: str | None) -> str:
    """Return the cheap-judge model id for a given main-chat provider.

    Empty string means "let the provider pick its own default" — used for
    Ollama where the user already chose a small local model and forcing
    one would be wrong.
    """
    if not provider:
        return ""
    return CHEAP_MODELS_BY_PROVIDER.get(provider, "")


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

Reply in this exact two-line format. EVIDENCE first, then JSON on the next line. Nothing else, no code fences, no extra prose.

EVIDENCE: <one sentence naming concrete proof in the transcript (tool output, file write, test pass, rendered artifact) — or naming the absence of such proof>
{{"met": true|false, "reason": "<one short sentence>"}}

Rules:
- The EVIDENCE line MUST come first. Cite a specific turn, tool name, or artifact title — not a vague claim. If you cannot point at concrete proof, say "no concrete proof found in transcript".
- "met": true ONLY when the EVIDENCE line names real proof that the goal's end condition is satisfied. If unsure, choose false.
- "reason": If false, name the single most important thing still missing. If true, restate the proof in one short sentence.
- Be strict. The assistant's self-declaration of completion (including a literal `goal:done` token in its reply) is NOT proof — it is a hint at best. You must independently confirm in the transcript.
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
    fences, leading prose (the EVIDENCE line we ask the cheap model
    to write before its JSON), and slightly malformed JSON.

    When EVIDENCE is present we fold it into the displayed reason so
    the user can see the proof the judge cited — e.g.
    ``no test output in turn -1 — EVIDENCE: no concrete proof found``.
    """
    if not raw:
        return GoalDecision(met=False, reason="empty evaluator reply", raw="")
    text = raw.strip()
    # Strip code fences if the model added them despite instructions.
    fence = re.match(r"```(?:json)?\s*(.+?)\s*```", text, re.DOTALL)
    if fence:
        text = fence.group(1).strip()

    # Pull the explicit EVIDENCE line — the model is asked to lead
    # with this so cheap models reason before they commit to a boolean.
    evidence = ""
    em = re.search(r"^EVIDENCE\s*:\s*(.+)$", text, re.IGNORECASE | re.MULTILINE)
    if em:
        evidence = em.group(1).strip()

    # Find the first JSON object.
    m = re.search(r"\{[^{}]*\}", text, re.DOTALL)
    candidate = m.group(0) if m else text
    try:
        data = json.loads(candidate)
    except Exception:
        # Fall back to a very-narrow met-detector so a totally off-format
        # reply doesn't permanently jam the loop as "met". Looking for
        # the exact `"met":true` substring (post whitespace strip) is the
        # only signal we trust — the previous "goal achieved" keyword
        # sniff caused false positives when that phrase appeared inside
        # the EVIDENCE line.
        normalized = text.lower().replace(" ", "")
        looks_met = '"met":true' in normalized
        reason = (evidence or text)[:200]
        return GoalDecision(met=looks_met, reason=reason, raw=raw)
    met = bool(data.get("met", False))
    reason_field = str(data.get("reason") or "").strip()
    # Prefer the JSON reason; append EVIDENCE when distinct so the user
    # sees both the verdict justification AND the proof the judge cited.
    if evidence and evidence.lower() not in reason_field.lower():
        reason = f"{reason_field} — EVIDENCE: {evidence}" if reason_field else evidence
    else:
        reason = reason_field or ("goal met" if met else "no reason given")
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


def _attr_escape(s: str, *, cap: int = 200) -> str:
    """Quote-safe attribute encoding. Strips newlines + caps length so
    the wrapping tag stays well-formed even when the source string has
    quotes, line breaks, or is enormous.
    """
    return (s or "").replace('"', "'").replace("\n", " ").replace("\r", " ")[:cap]


def build_followup_prompt(goal: str, reason: str, iteration: int, cap: int) -> str:
    """The user-message body posted back to /api/chat for an auto-iteration.

    Wrapped in a semantic ``<goal-auto>`` tag so the dashboard renderer
    can show it as a distinct card. Modern LLM providers (Claude, Codex,
    Gemini, Ollama) all parse XML-shaped attributes harmlessly — the
    tag is metadata; the writer reads the body inside.
    """
    body = _AUTO_TURN_TEMPLATE.format(
        n=iteration,
        cap=cap,
        reason=(reason or "no specific feedback").replace("\n", " ")[:400],
        goal=(goal or "").strip()[:4000],
    )
    return (
        f'<goal-auto iter="{iteration}" cap="{cap}" '
        f'reason="{_attr_escape(reason or "no specific feedback")}">\n'
        f"{body}\n"
        "</goal-auto>"
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
