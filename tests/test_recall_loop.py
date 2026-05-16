"""Tests for the same-turn recall pipeline (parse → queue → drain → re-feed)."""

from __future__ import annotations


def test_recall_tag_parses_and_queues():
    from arz import inline_learn

    session_id = "test-recall-1"
    inline_learn.drain_recalls(session_id)  # reset
    text = "Let me check prior decisions.\n<recall>auth middleware approach</recall>\nThinking..."
    cleaned, extracted = inline_learn.parse(text)
    assert any(ex.kind == "recall" for ex in extracted)
    # Tag body is stripped from cleaned text.
    assert "<recall>" not in cleaned
    assert "auth middleware approach" not in cleaned

    counts = inline_learn.apply(extracted, session_id=session_id)
    assert counts["recall"] == 1

    pending = inline_learn.drain_recalls(session_id)
    assert pending == ["auth middleware approach"]
    # Second drain returns empty (queue cleared).
    assert inline_learn.drain_recalls(session_id) == []


def test_recall_tag_with_query_attr():
    from arz import inline_learn

    session_id = "test-recall-2"
    inline_learn.drain_recalls(session_id)
    text = '<recall query="db schema for users"></recall>'
    _, extracted = inline_learn.parse(text)
    inline_learn.apply(extracted, session_id=session_id)
    pending = inline_learn.drain_recalls(session_id)
    assert pending == ["db schema for users"]


def test_multiple_recalls_queued():
    from arz import inline_learn

    session_id = "test-recall-3"
    inline_learn.drain_recalls(session_id)
    text = "Two questions:\n<recall>first query</recall>\n<recall>second query</recall>\nDone."
    _, extracted = inline_learn.parse(text)
    inline_learn.apply(extracted, session_id=session_id)
    pending = inline_learn.drain_recalls(session_id)
    assert pending == ["first query", "second query"]


def test_recall_per_session_isolation():
    from arz import inline_learn

    inline_learn.drain_recalls("sess-a")
    inline_learn.drain_recalls("sess-b")
    _, ex_a = inline_learn.parse("<recall>for A</recall>")
    _, ex_b = inline_learn.parse("<recall>for B</recall>")
    inline_learn.apply(ex_a, session_id="sess-a")
    inline_learn.apply(ex_b, session_id="sess-b")
    assert inline_learn.drain_recalls("sess-a") == ["for A"]
    assert inline_learn.drain_recalls("sess-b") == ["for B"]


def test_recall_hint_present_in_widget_block():
    """build_prefix _widget_hint must advertise the recall mechanism so models
    on every provider know they can call it."""
    from arz.memory.context import _widget_hint

    hint = _widget_hint("medium")
    assert "<recall>" in hint
    assert "recall_result" in hint
    # Must say it's same-turn so model doesn't assume two-turn round-trip.
    assert "pauses" in hint.lower() or "re-enter" in hint.lower()


def test_recall_continuation_cap_constant_exists():
    """Sanity check: _RECALL_CONTINUATION_CAP wired in chat route."""
    import re
    from pathlib import Path

    src = Path("src/arz/dashboard/routes/chat.py").read_text()
    assert "_RECALL_CONTINUATION_CAP" in src
    # Cap value should be a small int — runaway loop guard.
    m = re.search(r"_RECALL_CONTINUATION_CAP\s*=\s*(\d+)", src)
    assert m is not None
    cap = int(m.group(1))
    assert 1 <= cap <= 10


def test_default_recall_k_bumped():
    from arz.config.schema import DashboardConfig

    cfg = DashboardConfig()
    assert cfg.recall_k >= 8
