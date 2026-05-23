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

{memory_block}

RECENT CONVERSATION (last {n} turns):
{transcript}

{artifacts_block}

Reply in this exact two-line format. EVIDENCE first, then JSON on the next line. Nothing else, no code fences, no extra prose.

EVIDENCE: <one sentence naming concrete proof in the transcript (tool output, file write, test pass, rendered artifact) — or naming the absence of such proof>
{{"met": true|false, "reason": "<one short sentence>"}}

Rules:
- The EVIDENCE line MUST come first. Cite a specific turn, tool name, file path, or command output — not a vague claim. If you cannot point at concrete proof, say "no concrete proof found".
- "met": true ONLY when the EVIDENCE line names real proof that the goal's end condition is satisfied. If unsure, choose false.
- "reason": If false, name the single most important thing still missing. If true, restate the proof in one short sentence.
- Be strict. The assistant's self-declaration of completion (including a literal `goal:done` token in its reply) is NOT proof — it is a hint at best. You must independently confirm.
- When an ARTIFACTS section is present, treat its file contents and captured tool output as the SOURCE OF TRUTH. Bigger source than the transcript.
- YOU HAVE TOOLS. You're running in the writer's workspace with the same provider's tool access (Read, Grep, Glob, WebSearch when reads are trusted; Bash / Edit when full trust is granted). USE THEM when verifying is faster + more reliable than reasoning from text — e.g. `Read` the file the writer claims to have written, `Bash: pytest --cov` to verify coverage, `Grep` for a specific pattern across the codebase. Then base EVIDENCE on what your tools observed, not on what the transcript hopes.
- Keep tool use focused. The user is paying a cheap fast model to judge — don't write code, don't refactor, don't make changes the writer didn't ask for. Verify and return.
"""


def _format_artifacts(artifacts: list[dict] | None) -> str:
    """Render the writer's recently-touched files as inline content
    blocks the judge can read. Empty when no artifacts. Caller is
    responsible for size-capping individual file contents — we still
    apply an outer cap here for safety.

    Total budget: 40K chars across all artifacts. Per-file cap: 16K.
    Bigger than the transcript cap because file goals (CSV dump, code
    file, table) are the case where transcript-only fails.
    """
    if not artifacts:
        return ""
    total = 0
    chunks: list[str] = ["ARTIFACTS (files the writer just created or modified):"]
    for art in artifacts[:8]:  # at most 8 files
        path = str(art.get("path") or "").strip()
        content = str(art.get("content") or "")
        if not path:
            continue
        if len(content) > 16000:
            content = (
                content[:12000]
                + f"\n\n…ELIDED {len(content) - 12000 - 4000} chars from middle…\n\n"
                + content[-4000:]
            )
        block = f"\n=== {path} ({len(content)} chars) ===\n{content}\n"
        if total + len(block) > 40000:
            chunks.append(f"\n(further artifacts elided — budget exhausted at {total} chars)")
            break
        chunks.append(block)
        total += len(block)
    return "\n".join(chunks) + "\n"


def _format_transcript(history: list[dict], n: int) -> str:
    """Trim transcript to last *n* turns. Per-message body cap is
    generous (12K) so the judge sees the actual artifact for goals
    that legitimately produce long output — e.g. a 50-row table or a
    full file dump. Smaller-than-cap messages pass through untouched;
    over-cap messages keep the head + tail so the structure (table
    delimiters, opening/closing braces, etc.) is preserved, with a
    short ELIDED marker between them.

    NOTE: We deliberately do NOT inject the literal phrase
    ``[truncated]`` — the judge was earlier rejecting otherwise-valid
    artifacts ("can't verify 50 rows because transcript shows
    truncated") since the cheap model treats that string as evidence
    of incompleteness instead of as a meta-marker about our context
    handling.
    """
    if not history:
        return "(empty)"
    tail = history[-n:]
    body_cap = 12000
    head_keep = 7000
    tail_keep = 4000
    lines: list[str] = []
    for m in tail:
        role = m.get("role", "?")
        text = (m.get("text") or "").strip()
        if len(text) > body_cap:
            text = (
                text[:head_keep]
                + f"\n\n…ELIDED {len(text) - head_keep - tail_keep} chars…\n\n"
                + text[-tail_keep:]
            )
        lines.append(f"[{role}] {text}")
    return "\n\n".join(lines)


def _format_memory(memory: dict | None) -> str:
    """Cumulative working memory across goal iterations.

    Shape: ``{"files_changed": [...], "decisions": [...], "blockers":
    [...]}``. Empty when nothing accumulated yet. The block lets the
    judge see what the writer has touched across the whole loop — for
    coverage-style goals where iteration 7 builds on iteration 3, the
    transcript alone misses the lineage.
    """
    if not memory:
        return ""
    files = (memory.get("files_changed") or [])[-30:]
    decisions = (memory.get("decisions") or [])[-15:]
    blockers = (memory.get("blockers") or [])[-10:]
    if not (files or decisions or blockers):
        return ""
    parts = ["WORKING MEMORY (cumulative across iterations):"]
    if files:
        parts.append("### Files Changed")
        parts.extend(f"- {f}" for f in files)
    if decisions:
        parts.append("### Decisions")
        parts.extend(f"- {d}" for d in decisions)
    if blockers:
        parts.append("### Blockers")
        parts.extend(f"- {b}" for b in blockers)
    return "\n".join(parts) + "\n"


async def evaluate(
    goal: str,
    history: list[dict],
    runner: GoalRunner,
    *,
    n_turns: int = 6,
    agent_name: str = "goal-evaluator",
    artifacts: list[dict] | None = None,
    memory: dict | None = None,
) -> GoalDecision:
    """Run the cheap evaluator. Always returns a decision — never raises.

    ``artifacts`` is an optional list of ``{path, content}`` dicts the
    caller pre-loaded (typically files the writer just created via
    Write/Edit tool calls). When supplied the judge can verify a
    file-output goal by reading the content directly instead of
    guessing from transcript chatter.

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
        artifacts_block=_format_artifacts(artifacts),
        memory_block=_format_memory(memory),
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
    "Make one concrete step. Use tools as needed. Output ONLY the artifact "
    "or the next concrete change — no 'plain-text fallback', no 'for the "
    "evaluator' duplicate. The judge has its own tools to verify. "
    "If the goal is now done, end your reply with the literal token `goal:done`."
)


def _attr_escape(s: str, *, cap: int = 200) -> str:
    """Quote-safe attribute encoding. Strips newlines + caps length so
    the wrapping tag stays well-formed even when the source string has
    quotes, line breaks, or is enormous.
    """
    return (s or "").replace('"', "'").replace("\n", " ").replace("\r", " ")[:cap]


FRUSTRATION_THRESHOLD = 3  # consecutive identical rejections before hard reset


def _normalize_reason(reason: str) -> str:
    """Compare-key for two evaluator reasons. Lowercased, whitespace
    collapsed, truncated to 120 chars so trailing EVIDENCE tail doesn't
    fool us into thinking each round was "different"."""
    import re as _re

    text = _re.sub(r"\s+", " ", (reason or "").strip().lower())
    return text[:120]


def is_same_reason(a: str, b: str) -> bool:
    """Two reasons are 'the same' if their normalised forms match."""
    return bool(a) and _normalize_reason(a) == _normalize_reason(b)


_HARD_RESET_TEMPLATE = (
    '<goal-auto iter="{n}" cap="{cap}" reason="hard-reset">\n'
    "[goal-auto {n}/{cap}] === HARD RESET — your last {streak} attempts were "
    "rejected for the SAME reason ===\n\n"
    "Stop. Discard whatever approach you have been using — it is clearly not "
    "working. The evaluator has rejected your last {streak} replies with the "
    "identical complaint:\n\n"
    "    {reason}\n\n"
    "DO NOT repeat the previous answer. DO NOT paraphrase it. Start over "
    "from the goal text and write a fundamentally different reply. If your "
    "previous reply was the wrong shape (countdown vs. count-up, wrong range, "
    "wrong subject), correct that NOW.\n\n"
    "Output ONLY the artifact. NO 'plain-text fallback', NO 'for the "
    "evaluator' duplicate, NO defensive belt-and-suspenders restatement. "
    "The judge has its own tools to verify your output directly.\n\n"
    "Goal:\n{goal}\n\n"
    "End with `goal:done` only if THIS attempt actually satisfies the goal.\n"
    "</goal-auto>"
)


def build_followup_prompt(
    goal: str,
    reason: str,
    iteration: int,
    cap: int,
    *,
    same_reason_streak: int = 0,
) -> str:
    """The user-message body posted back to /api/chat for an auto-iteration.

    Wrapped in a semantic ``<goal-auto>`` tag so the dashboard renderer
    can show it as a distinct card. Modern LLM providers (Claude, Codex,
    Gemini, Ollama) all parse XML-shaped attributes harmlessly — the
    tag is metadata; the writer reads the body inside.
    """
    # Frustration trip: writer has failed for the SAME reason N times
    # in a row. Send the hard-reset variant instead of the usual nudge
    # — keeps the loop honest when the writer's KV cache is sticky.
    if same_reason_streak >= FRUSTRATION_THRESHOLD:
        return _HARD_RESET_TEMPLATE.format(
            n=iteration,
            cap=cap,
            streak=same_reason_streak,
            reason=_attr_escape(reason or "no specific feedback", cap=400),
            goal=(goal or "").strip()[:4000],
        )

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
