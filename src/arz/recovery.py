"""Automatic turn recovery — keep the agent on task when a turn ends early.

A turn can end without doing what it set out to do: the model promises
"I'll open the PR now" and yields, the context gets compacted mid-turn,
the reply comes back empty after tool calls, the watchdog cancels a
stalled turn, or a tool gets blocked by policy and the model reads the
rejection as a user cancel. Each case gets ONE system-authored
continuation. The prefixes mark the message as automatic so the
transcript (and the model) can tell it apart from the user.

Everything here is pure: the chat runner decides *when* to call these
and owns the retry budget.
"""

from __future__ import annotations

import re

PROMISE_ONLY_PREFIX = "[Unfinished action — automatic recovery]"
EMPTY_REPLY_PREFIX = "[Empty response — automatic recovery]"
COMPACTION_PREFIX = "[Context compacted — automatic recovery]"
STALL_PREFIX = "[Stalled turn — automatic recovery]"
REFUSAL_PREFIX = "[Tool refusal — automatic recovery]"

RECOVERY_PREFIXES = (
    PROMISE_ONLY_PREFIX,
    EMPTY_REPLY_PREFIX,
    COMPACTION_PREFIX,
    STALL_PREFIX,
    REFUSAL_PREFIX,
)

# Continuations allowed per user message. One is enough to rescue the
# common case; more risks a loop on a model that keeps promising.
MAX_RECOVERIES_PER_USER_TURN = 1

PROMISE_ONLY_MSG = (
    f"{PROMISE_ONLY_PREFIX}\n"
    "Your previous turn ended right after you said you would perform an action "
    "immediately, but the turn yielded before that action was carried out, so "
    "nothing actually happened. Carry out that action now by making the tool call "
    "you announced. If you were actually waiting on the user's approval or on a "
    "condition that is not yet satisfied, do NOT perform the action — say what you "
    "are waiting for instead. If you cannot do it, say what is blocking it. Do NOT "
    "re-run any tool that already completed successfully above."
)

EMPTY_AFTER_ACTIVITY_MSG = (
    f"{EMPTY_REPLY_PREFIX}\n"
    "Your previous turn did work — it called tools or reasoned — but ended without "
    "a closing reply, so the request looks unanswered. Everything above already "
    "happened and its results are in the conversation: answer now from what is "
    "there. Do NOT restart the request, and do NOT re-run any tool or step that "
    "already completed."
)

COMPACTION_MSG = (
    f"{COMPACTION_PREFIX}\n"
    "The conversation above was summarized mid-turn because the context window "
    "filled up, and your previous turn then ended without finishing the request. "
    "The summary is authoritative — work from what remains above. Continue the "
    "pending request now. Do NOT restart from scratch, and do NOT re-run any tool "
    "or step that already completed. If the summary left you without something you "
    "need, say what is missing instead of guessing."
)

# ── Promise-only detection ──────────────────────────────────────────────────
# Kept deliberately NARROW: a false positive dispatches an action the user
# didn't ask for, a false negative just lets the turn end normally.

_PROMISE_NOW_RE = re.compile(
    r"\b(?:i(?:'|’)?ll|i\s+will|let\s+me|i(?:'|’)?m\s+going\s+to)\b"
    r"[^.!?\n]*?"
    r"\b(?:now|right\s+away|right\s+now|immediately)\b"
    r"[^.!?\n]*[.!?]?\s*$",
    re.IGNORECASE,
)
# Colon-introduced content, a code fence, or a list after the promise means
# it was a lead-in to delivered content, not an unfulfilled action.
_HAS_FOLLOWING_CONTENT_RE = re.compile(r":\s*\S|```|\n\s*[-*\d]")
# Hand-offs and explicit non-actions ("let me know … now", "for now").
_NO_ACTION_CLOSER_RE = re.compile(
    r"\blet\s+me\s+know\b|\bfor\s+now\b|\bfor\s+the\s+moment\b|\bas[-\s]is\b"
    r"|\bstop\s+here\b|\bleave\s+(?:it|that|this)\b",
    re.IGNORECASE,
)
_NEGATED_PROMISE_RE = re.compile(
    r"\b(?:not\s+going\s+to|never\s+going\s+to|won(?:'|’)?t|will\s+not"
    r"|i(?:'|’)?ll\s+not|can(?:'|’)?t|cannot|not\s+able\s+to|unable\s+to"
    r"|do(?:es)?n(?:'|’)?t|do(?:es)?\s+not|no\s+longer)\b"
    r"[^.!?\n]*?\b(?:now|right\s+away|right\s+now|immediately)\b",
    re.IGNORECASE,
)
# Approval-gated or conditional closers keep the decision with the user
# ("If that looks good, I'll push it now"). Reject-biased on purpose.
_APPROVAL_GATED_RE = re.compile(
    r"\bif\b|\bjust\s+say\s+the\s+word\b|\bwant\s+me\s+to\b|\bshall\s+i\b"
    r"|\byour\s+(?:approval|go[-\s]?ahead|sign[-\s]?off|confirmation|permission|ok(?:ay)?)\b"
    r"|\bwait(?:ing)?\s+for\s+(?:you|your|approval|confirmation|permission)\b"
    r"|\bbefore\s+you\b|\byou\s+to\s+(?:approve|confirm|decide|review)\b"
    r"|\b(?:once|when|after|as\s+soon\s+as|until|unless)\b"
    r"|\b(?:as|so)\s+long\s+as\b",
    re.IGNORECASE,
)
_SENTENCE_BOUNDARY_RE = re.compile(r"[.!?\n]+")


def _terminal_sentence(text: str) -> str:
    parts = [p.strip() for p in _SENTENCE_BOUNDARY_RE.split(text) if p.strip()]
    return parts[-1] if parts else text


def is_promise_only_terminal(final_segment_text: str) -> bool:
    """True when the text after the turn's last tool call ends on a promise
    to act immediately, with nothing substantive following it.

    Pass only the post-last-tool text: a turn that DID call the tool and
    then summarised ends on a summary, not a promise, so it won't match.
    """
    text = (final_segment_text or "").strip()
    if not text:
        return False
    terminal = _terminal_sentence(text)
    if _NO_ACTION_CLOSER_RE.search(terminal):
        return False
    if _NEGATED_PROMISE_RE.search(terminal):
        return False
    if _APPROVAL_GATED_RE.search(terminal):
        return False
    if _HAS_FOLLOWING_CONTENT_RE.search(text):
        return False
    return bool(_PROMISE_NOW_RE.search(text))


def is_recovery_message(text: str) -> bool:
    """True for a continuation this module authored (not a user message)."""
    head = (text or "").lstrip()
    return any(head.startswith(p) for p in RECOVERY_PREFIXES)


def pick_recovery(
    *,
    final_segment_text: str,
    full_reply_text: str,
    tool_calls: int,
    compacted: bool,
    stopped_by_user: bool,
    errored: bool,
    goal_loop_active: bool,
    recoveries_used: int,
) -> str | None:
    """Decide which continuation (if any) a finished turn should get.

    Returns the message to send, or None. Guards first: never recover a turn
    the user stopped, one that errored (the error is the answer), one the goal
    loop will follow up anyway, or once the budget is spent.
    """
    if stopped_by_user or errored or goal_loop_active:
        return None
    if recoveries_used >= MAX_RECOVERIES_PER_USER_TURN:
        return None
    reply_empty = not (full_reply_text or "").strip()
    if compacted and reply_empty:
        return COMPACTION_MSG
    if reply_empty and tool_calls > 0:
        return EMPTY_AFTER_ACTIVITY_MSG
    # final_segment_text is post-last-tool, so this also covers a turn that
    # ran tools earlier and then promised a further action it never took.
    if is_promise_only_terminal(final_segment_text):
        return PROMISE_ONLY_MSG
    return None


def build_stall_recovery_prompt(
    *, idle_s: float, open_tool: str | None = None, open_tool_input: str | None = None
) -> str:
    """Continuation after the watchdog cancelled a turn that went silent."""
    mins = max(1, int(idle_s // 60))
    lines = [
        STALL_PREFIX,
        f"Your previous turn produced no output for about {mins} minutes and was "
        "cancelled by the stall watchdog. This was NOT a user cancel.",
    ]
    if open_tool:
        detail = f"`{open_tool}`"
        if open_tool_input:
            snippet = open_tool_input.strip().replace("\n", " ")
            if len(snippet) > 300:
                snippet = snippet[:300] + "…"
            detail += f" with input {snippet}"
        lines.append(
            f"The last tool still running was {detail}. It may have hung or be waiting "
            "on input. Do not re-run it blindly: check for partial results first (files "
            "it wrote, log output), and if it was a long command, re-run it in the "
            "background with output redirected to a log you can tail."
        )
    lines.append(
        "Continue the pending request from where it stopped. Do NOT restart from "
        "scratch and do NOT re-run steps that already completed."
    )
    return "\n".join(lines)


def build_refusal_notice(tool_name: str, reason: str) -> str:
    """In-band (steer) notice that a tool call was blocked by policy, not the user."""
    return (
        f"{REFUSAL_PREFIX}\n"
        f"The `{tool_name}` call was blocked by a system policy: {reason}. "
        "This was NOT a user cancellation. Use an allowed alternative to make "
        "progress, or explain what you need if there is none."
    )


def build_refusal_recovery_prompt(refusals: list[tuple[str, str]], *, answered: bool) -> str:
    """Fallback continuation after policy refusals the model never heard about."""
    if not refusals:
        return ""
    items = "\n".join(f"- `{name}`: {reason}" for name, reason in refusals)
    tail = (
        "You already replied to the user — do NOT restate that reply. Only continue "
        "if the blocked call left the request unfinished."
        if answered
        else "Pick up where you left off using an allowed alternative, or explain "
        "what is blocking you."
    )
    return (
        f"{REFUSAL_PREFIX}\n"
        "These tool calls were blocked by a system policy during your previous turn. "
        "The rejection you saw was NOT a user cancellation:\n"
        f"{items}\n{tail}"
    )
