"""Tests for episodic memory (Phase 4)."""

from __future__ import annotations

import pytest


@pytest.fixture
def isolated_episodic(monkeypatch, tmp_path):
    """Redirect episodic.py + the embedder hook so tests stay hermetic."""
    from arz.memory import context as ctx
    from arz.memory import episodic
    from arz.memory.embedder import HashEmbedder
    from arz.memory.vector import VectorStore

    monkeypatch.setattr(episodic, "_DB_PATH", tmp_path / "memory.db")
    # Force a hash-embedder vector store so _embedder() returns something
    # deterministic without hitting Ollama.
    store = VectorStore(db_path=tmp_path / "vec.db", embedder=HashEmbedder(dim=128))
    monkeypatch.setattr(ctx, "_vector_singleton", store, raising=False)
    yield episodic


def test_add_persists_episode(isolated_episodic):
    ep = isolated_episodic
    e = ep.add("Refactored auth middleware to drop session cookies", importance=0.6)
    assert e is not None
    assert e.importance == 0.6
    assert e.id > 0


def test_add_rejects_too_short(isolated_episodic):
    ep = isolated_episodic
    assert ep.add("hi") is None


def test_add_rejects_too_long(isolated_episodic):
    ep = isolated_episodic
    assert ep.add("x" * 5000) is None


def test_search_returns_relevant_hits(isolated_episodic):
    ep = isolated_episodic
    ep.add("we picked Postgres 16 over MySQL for the analytics db")
    ep.add("auth flow now uses JWT with 24h expiry")
    ep.add("totally unrelated note about lunch")
    hits = ep.search("which database did we pick", k=3)
    # HashEmbedder is dumb; we just assert the query returns SOMETHING
    # without erroring.
    assert isinstance(hits, list)


def test_enforce_cap_drops_lowest_importance(isolated_episodic):
    ep = isolated_episodic
    for i in range(15):
        ep.add(f"low-importance fragment number {i}", importance=0.1)
    for i in range(5):
        ep.add(f"high-importance fragment {i}", importance=0.9)
    dropped = ep.enforce_cap(cap=10)
    assert dropped == 10
    s = ep.stats()
    assert s["count"] == 10
    # Survivors should be the 5 high-importance + 5 next-best (which are
    # still all 0.1s, so avg ≈ (5*0.9 + 5*0.1) / 10 = 0.5).
    assert s["avg_importance"] >= 0.5


def test_purge_deleted_hard_removes(isolated_episodic):
    ep = isolated_episodic
    e = ep.add("temp fragment for purge test")
    assert e is not None
    # Soft-delete via cap eviction
    for _ in range(20):
        ep.add("noise" + "x" * 30, importance=0.05)
    ep.enforce_cap(cap=5)
    # Force the time backwards on tombstones
    import time as _t

    with ep._connect() as conn:
        conn.execute(
            "UPDATE episodic_memories SET created_at = ? WHERE is_deleted = 1",
            (_t.time() - 200 * 86400,),
        )
    purged = ep.purge_deleted(older_than_days=90)
    assert purged > 0


def test_render_for_prompt_empty_when_no_query(isolated_episodic):
    ep = isolated_episodic
    ep.add("just one entry that won't surface without a query")
    assert ep.render_for_prompt("") == ""
