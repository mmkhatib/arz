"""Tests for recency/frequency boost, intent tracker, and goal injection."""

from __future__ import annotations

import time

import pytest

# ── Recency / frequency boost ────────────────────────────────────────────


def test_recency_factor_tiers():
    from arz.memory.semantic import _recency_factor

    # Pick a "now" that's large enough that subtracting 200 days stays
    # positive. Real epoch values are ~1.7e9 today.
    now = 1_700_000_000.0
    # Tier breakpoints — exact boundary behaviour.
    assert _recency_factor(now - 6 * 86400, now=now) == 1.0
    assert _recency_factor(now - 20 * 86400, now=now) == 0.85
    assert _recency_factor(now - 60 * 86400, now=now) == 0.7
    assert _recency_factor(now - 200 * 86400, now=now) == 0.55


def test_recency_factor_zero_returns_default():
    """A fact with no updated_at gets the mid-tier so it doesn't get
    crushed."""
    from arz.memory.semantic import _recency_factor

    assert _recency_factor(0.0) == 0.7


def test_frequency_factor_monotonic():
    from arz.memory.semantic import _frequency_factor

    assert _frequency_factor(0) == 1.0
    assert _frequency_factor(1) > 1.0
    assert _frequency_factor(10) > _frequency_factor(1)
    # Saturates — should not exceed the cap even for very high counts.
    assert _frequency_factor(10_000) <= 1.6


def test_hybrid_score_prefers_recent_and_frequent(monkeypatch, tmp_path):
    """Two facts with the same base score: the newer + more-used one wins."""
    from arz.memory import semantic

    monkeypatch.setattr(semantic, "_DB_PATH", tmp_path / "memory.db")
    now = time.time()
    fresh = semantic.Fact(
        key="project.recent.note",
        value="alpha beta",
        confidence=0.8,
        source="t",
        created_at=now - 86400,
        updated_at=now - 86400,
        hit_count=20,
    )
    stale = semantic.Fact(
        key="project.recent.note",
        value="alpha beta",
        confidence=0.8,
        source="t",
        created_at=now - 200 * 86400,
        updated_at=now - 200 * 86400,
        hit_count=0,
    )
    scored = semantic._hybrid_score("alpha beta", [stale, fresh])
    # Fresh + frequent fact should be first.
    assert scored[0][1] is fresh
    assert scored[0][0] > scored[1][0]


# ── Intent tracker ───────────────────────────────────────────────────────


def test_intent_classify_returns_top_keywords():
    from arz.memory.intent import _classify

    intent = _classify(
        "Working on the auth refactor. "
        "Auth tokens need to be rotated. "
        "Migration script for auth users."
    )
    # 'auth' is the most-frequent meaningful token.
    assert "auth" in intent.keywords


def test_intent_classify_skips_stopwords():
    from arz.memory.intent import _classify

    intent = _classify("the and for with that this from have")
    assert intent.phrase == ""


def test_intent_update_and_render():
    from arz.memory.intent import clear, render_for_prompt, update_from_messages

    sid = "test-intent-1"
    clear(sid)
    msgs = [
        {"role": "user", "text": "let's debug the migration script"},
        {"role": "assistant", "text": "migration script crashed on index rebuild"},
        {"role": "user", "text": "yes, the migration always fails there"},
    ]
    intent = update_from_messages(sid, msgs)
    assert "migration" in intent.keywords or "script" in intent.keywords
    block = render_for_prompt(sid)
    assert "<intent>" in block
    assert "current focus:" in block
    clear(sid)
    assert render_for_prompt(sid) == ""


def test_intent_isolated_per_session():
    from arz.memory.intent import clear, get_intent, update_from_messages

    clear("a")
    clear("b")
    update_from_messages("a", [{"role": "user", "text": "authentication tokens"}])
    update_from_messages("b", [{"role": "user", "text": "database migration"}])
    a = get_intent("a")
    b = get_intent("b")
    assert a and b
    assert a.phrase != b.phrase


# ── Goal feature ─────────────────────────────────────────────────────────


def test_session_persists_goal_fields():
    from arz.session.session import Session

    s = Session()
    s.goal = "ship the auth refactor"
    s.goal_status = "active"
    s.goal_set_at = 123.45
    d = s.to_dict()
    assert d["goal"] == "ship the auth refactor"
    assert d["goal_status"] == "active"
    assert d["goal_set_at"] == pytest.approx(123.45)
    s2 = Session.from_dict(d)
    assert s2.goal == "ship the auth refactor"
    assert s2.goal_status == "active"


def test_session_goal_defaults_to_none():
    from arz.session.session import Session

    s = Session()
    assert s.goal is None
    assert s.goal_status == "active"
    assert s.goal_set_at == 0.0


def test_session_from_dict_handles_missing_goal_fields():
    """Legacy sessions saved before the goal feature should still load."""
    from arz.session.session import Session

    now_iso = "2025-01-01T00:00:00"
    legacy = {
        "id": "x",
        "title": "t",
        "messages": [],
        "created_at": now_iso,
        "updated_at": now_iso,
    }
    s = Session.from_dict(legacy)
    assert s.goal is None
    assert s.goal_status == "active"
