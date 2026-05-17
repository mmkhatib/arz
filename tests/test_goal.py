"""Tests for the /goal evaluator + auto-iteration decision logic."""

from __future__ import annotations

import pytest

# ── _parse_decision ──────────────────────────────────────────────────────


def test_parse_clean_json():
    from arz.goal import _parse_decision

    d = _parse_decision('{"met": true, "reason": "tests pass"}')
    assert d.met is True
    assert d.reason == "tests pass"


def test_parse_strips_code_fence():
    from arz.goal import _parse_decision

    d = _parse_decision('```json\n{"met": false, "reason": "still 3 failing"}\n```')
    assert d.met is False
    assert "failing" in d.reason


def test_parse_extracts_object_from_prose():
    from arz.goal import _parse_decision

    raw = 'Here is my answer: {"met": false, "reason": "build broke"} thanks'
    d = _parse_decision(raw)
    assert d.met is False
    assert "build broke" in d.reason


def test_parse_empty_input_returns_not_met():
    from arz.goal import _parse_decision

    d = _parse_decision("")
    assert d.met is False


def test_parse_garbage_falls_back_to_keyword_sniff():
    from arz.goal import _parse_decision

    d = _parse_decision("Goal achieved finally")
    assert d.met is True


# ── should_auto_iterate ──────────────────────────────────────────────────


def test_no_iter_when_goal_empty():
    from arz.goal import should_auto_iterate

    assert (
        should_auto_iterate(
            goal="",
            status="active",
            iterations=0,
            max_iterations=20,
            last_assistant_text="hi",
        )
        is False
    )


def test_no_iter_when_status_done():
    from arz.goal import should_auto_iterate

    assert (
        should_auto_iterate(
            goal="ship it",
            status="done",
            iterations=0,
            max_iterations=20,
            last_assistant_text="hi",
        )
        is False
    )


def test_no_iter_when_cap_reached():
    from arz.goal import should_auto_iterate

    assert (
        should_auto_iterate(
            goal="ship it",
            status="active",
            iterations=20,
            max_iterations=20,
            last_assistant_text="hi",
        )
        is False
    )


def test_no_iter_when_assistant_emitted_done_token():
    from arz.goal import should_auto_iterate

    assert (
        should_auto_iterate(
            goal="ship it",
            status="active",
            iterations=5,
            max_iterations=20,
            last_assistant_text="all green. goal:done",
        )
        is False
    )


def test_yes_iter_when_active_under_cap():
    from arz.goal import should_auto_iterate

    assert (
        should_auto_iterate(
            goal="ship it",
            status="active",
            iterations=5,
            max_iterations=20,
            last_assistant_text="ran tests",
        )
        is True
    )


# ── build_followup_prompt ────────────────────────────────────────────────


def test_followup_prompt_includes_goal_and_reason():
    from arz.goal import build_followup_prompt

    p = build_followup_prompt(
        goal="all tests pass",
        reason="2 still failing",
        iteration=3,
        cap=20,
    )
    assert "all tests pass" in p
    assert "2 still failing" in p
    assert "3/20" in p
    assert "goal:done" in p  # the done-token instruction


# ── evaluate (async, runner-mocked) ──────────────────────────────────────


@pytest.mark.asyncio
async def test_evaluate_returns_met_when_runner_says_so():
    from arz.goal import evaluate

    async def fake_runner(agent: str, prompt: str) -> str:
        return '{"met": true, "reason": "build passes"}'

    d = await evaluate("ship it", [{"role": "user", "text": "go"}], fake_runner)
    assert d.met is True


@pytest.mark.asyncio
async def test_evaluate_handles_runner_exception():
    from arz.goal import evaluate

    async def boom(agent: str, prompt: str) -> str:
        raise RuntimeError("model down")

    d = await evaluate("ship it", [], boom)
    assert d.met is False
    assert "evaluator unavailable" in d.reason


@pytest.mark.asyncio
async def test_evaluate_empty_goal_short_circuits():
    from arz.goal import evaluate

    async def must_not_be_called(*a, **kw):
        raise AssertionError("runner should not be called for empty goal")

    d = await evaluate("", [], must_not_be_called)
    assert d.met is False


# ── Session field round-trip ─────────────────────────────────────────────


def test_session_persists_goal_iteration_fields():
    from arz.session.session import Session

    s = Session()
    s.goal = "ship it"
    s.goal_iterations = 5
    s.goal_max_iterations = 25
    s.goal_last_reason = "still 2 tests failing"
    d = s.to_dict()
    assert d["goal_iterations"] == 5
    assert d["goal_max_iterations"] == 25
    assert d["goal_last_reason"] == "still 2 tests failing"
    s2 = Session.from_dict(d)
    assert s2.goal_iterations == 5
    assert s2.goal_max_iterations == 25
    assert s2.goal_last_reason == "still 2 tests failing"


def test_session_legacy_load_defaults():
    from arz.session.session import Session

    d = {
        "id": "x",
        "title": "t",
        "messages": [],
        "created_at": "2025-01-01T00:00:00",
        "updated_at": "2025-01-01T00:00:00",
    }
    s = Session.from_dict(d)
    assert s.goal_iterations == 0
    assert s.goal_max_iterations == 20
    assert s.goal_last_reason == ""
