"""Tests for the semantic memory layer (Phase 2 — MeshClaw-grade memory)."""

from __future__ import annotations

from pathlib import Path

import pytest


@pytest.fixture
def isolated_semantic(monkeypatch, tmp_path):
    """Redirect semantic.py at a temp sqlite file so tests don't trample
    each other or the real ~/.arz/memory.db."""
    from arz.memory import semantic

    db = tmp_path / "memory.db"
    monkeypatch.setattr(semantic, "_DB_PATH", db)
    yield semantic


def test_upsert_creates_fact(isolated_semantic):
    sem = isolated_semantic
    f = sem.upsert("prod.db.host", "db-1.internal:5432", source="s1")
    assert f.key == "prod.db.host"
    assert f.value == "db-1.internal:5432"
    assert 0.65 < f.confidence < 0.75  # default 0.7
    assert f.source == "s1"


def test_upsert_reinforce_bumps_confidence(isolated_semantic):
    sem = isolated_semantic
    sem.upsert("k", "v1")  # insert @ 0.7
    sem.upsert("k", "v1")  # reinforce → 0.8
    sem.upsert("k", "v1")  # → 0.9
    sem.upsert("k", "v1")  # → 1.0 cap
    sem.upsert("k", "v1")  # stays at 1.0
    got = sem.get("k")
    assert got is not None
    assert got.confidence == pytest.approx(1.0, abs=0.01)


def test_upsert_value_change_updates(isolated_semantic):
    sem = isolated_semantic
    sem.upsert("k", "v1")
    sem.upsert("k", "v2")
    assert sem.get("k").value == "v2"


def test_contradict_drops_confidence(isolated_semantic):
    sem = isolated_semantic
    sem.upsert("k", "v")  # 0.7
    sem.contradict("k")  # 0.4
    got = sem.get("k")
    assert got is not None
    assert got.confidence == pytest.approx(0.4, abs=0.01)


def test_contradict_deletes_at_zero(isolated_semantic):
    sem = isolated_semantic
    sem.upsert("k", "v")  # 0.7
    sem.contradict("k")  # 0.4
    sem.contradict("k")  # 0.1
    sem.contradict("k")  # 0 → delete
    assert sem.get("k") is None


def test_delete_removes_row(isolated_semantic):
    sem = isolated_semantic
    sem.upsert("k", "v")
    assert sem.delete("k") is True
    assert sem.get("k") is None
    assert sem.delete("nonexistent") is False


def test_top_orders_by_confidence(isolated_semantic):
    sem = isolated_semantic
    sem.upsert("a", "1")  # 0.7
    sem.upsert("b", "2")  # 0.7
    sem.upsert("b", "2")  # 0.8
    sem.upsert("c", "3")  # 0.7
    sem.upsert("c", "3")  # 0.8
    sem.upsert("c", "3")  # 0.9
    top = sem.top(n=10)
    keys = [f.key for f in top]
    assert keys[0] == "c"
    assert keys[1] == "b"


def test_top_filters_by_min_confidence(isolated_semantic):
    sem = isolated_semantic
    sem.upsert("low", "x")
    sem.contradict("low")  # 0.4
    sem.upsert("high", "y")  # 0.7
    top = sem.top(n=10, min_confidence=0.5)
    assert [f.key for f in top] == ["high"]


def test_render_for_prompt_emits_block(isolated_semantic):
    sem = isolated_semantic
    sem.upsert("prod.db", "db-1.internal")
    sem.upsert("repo.default_branch", "main")
    rendered = sem.render_for_prompt()
    assert "<semantic-memory>" in rendered
    assert "prod.db" in rendered
    assert "repo.default_branch" in rendered
    assert "</semantic-memory>" in rendered


def test_render_empty_returns_empty_string(isolated_semantic):
    sem = isolated_semantic
    assert sem.render_for_prompt() == ""


def test_render_query_filters_relevant(isolated_semantic):
    sem = isolated_semantic
    sem.upsert("redis.host", "cache-1.internal")
    sem.upsert("postgres.host", "db-1.internal")
    rendered = sem.render_for_prompt(query="check the postgres connection")
    assert "postgres.host" in rendered
    # Low-confidence irrelevant fact should drop out
    # but high-confidence facts always shown
    assert "<semantic-memory>" in rendered


def test_render_query_keeps_high_confidence_anyway(isolated_semantic):
    sem = isolated_semantic
    # Push to high confidence
    for _ in range(5):
        sem.upsert("repo.default_branch", "main")
    sem.upsert("low.thing", "x")
    rendered = sem.render_for_prompt(query="unrelated query about widgets")
    assert "repo.default_branch" in rendered  # high conf kept
    # `low.thing` may or may not show — that's the relevance filter's call


def test_upsert_requires_key_and_value(isolated_semantic):
    sem = isolated_semantic
    with pytest.raises(ValueError):
        sem.upsert("", "v")
    with pytest.raises(ValueError):
        sem.upsert("k", "")


def test_stats_counts_facts(isolated_semantic):
    sem = isolated_semantic
    sem.upsert("a", "1")
    sem.upsert("b", "2")
    s = sem.stats()
    assert s["count"] == 2
    assert s["avg_confidence"] == pytest.approx(0.7, abs=0.01)


def test_render_bumps_hit_count(isolated_semantic):
    sem = isolated_semantic
    sem.upsert("k", "v")
    sem.render_for_prompt()  # surface it
    sem.render_for_prompt()  # surface again
    got = sem.get("k")
    assert got is not None
    assert got.hit_count >= 1
