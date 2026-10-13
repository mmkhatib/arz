"""Turn recovery heuristics."""

from __future__ import annotations

import pytest

from arz.recovery import (
    COMPACTION_MSG,
    EMPTY_AFTER_ACTIVITY_MSG,
    PROMISE_ONLY_MSG,
    build_refusal_recovery_prompt,
    build_stall_recovery_prompt,
    is_promise_only_terminal,
    is_recovery_message,
    pick_recovery,
)


@pytest.mark.parametrize(
    "text",
    [
        "I fixed the tests. I'll open the PR now.",
        "Let me run the build right away",
        "I'm going to push the branch immediately.",
        "When you asked about X, I fixed it.\nI'll open the PR now.",
    ],
)
def test_promise_only_matches(text: str) -> None:
    assert is_promise_only_terminal(text)


@pytest.mark.parametrize(
    "text",
    [
        "",
        "Done — PR opened.",
        "I'll explain now: the cache was stale.",
        "I'll run these now:\n- a\n- b",
        "If that looks good, I'll push it now.",
        "Let me know if you want me to merge it now.",
        "I won't touch the config now.",
        "I'll leave it as-is for now.",
        "Want me to open the PR now?",
        "Once CI passes I'll merge it now.",
        "The deployment is going to start now.",
    ],
)
def test_promise_only_rejects(text: str) -> None:
    assert not is_promise_only_terminal(text)


def _pick(**kw):
    base = dict(
        final_segment_text="",
        full_reply_text="answer",
        tool_calls=0,
        compacted=False,
        stopped_by_user=False,
        errored=False,
        goal_loop_active=False,
        recoveries_used=0,
    )
    base.update(kw)
    return pick_recovery(**base)


def test_pick_promise() -> None:
    msg = _pick(final_segment_text="I'll run it now.", full_reply_text="I'll run it now.")
    assert msg == PROMISE_ONLY_MSG
    assert is_recovery_message(msg)


def test_pick_compaction_and_empty() -> None:
    assert _pick(full_reply_text="", compacted=True) == COMPACTION_MSG
    assert _pick(full_reply_text="  ", tool_calls=3) == EMPTY_AFTER_ACTIVITY_MSG
    # Empty with no activity is a genuine nothing — leave it alone.
    assert _pick(full_reply_text="", tool_calls=0) is None


@pytest.mark.parametrize(
    "guard",
    [
        {"stopped_by_user": True},
        {"errored": True},
        {"goal_loop_active": True},
        {"recoveries_used": 1},
    ],
)
def test_pick_guards(guard: dict) -> None:
    assert _pick(final_segment_text="I'll run it now.", **guard) is None


def test_normal_answer_no_recovery() -> None:
    assert _pick(final_segment_text="All done.", tool_calls=2) is None


def test_stall_prompt_mentions_open_tool() -> None:
    p = build_stall_recovery_prompt(
        idle_s=600, open_tool="Bash", open_tool_input="npm test\n" * 100
    )
    assert is_recovery_message(p)
    assert "`Bash`" in p and "10 minutes" in p and "…" in p
    assert "NOT a user cancel" in p


def test_refusal_prompt() -> None:
    assert build_refusal_recovery_prompt([], answered=False) == ""
    p = build_refusal_recovery_prompt([("Bash", "deny rule rm -rf")], answered=True)
    assert "deny rule" in p and "do NOT restate" in p
    assert not is_recovery_message("hello")
