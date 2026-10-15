"""Tests for embedder identity, backend fallback, and vector-space migration.

The bug these guard against: vectors produced by different embedders are not
comparable. Before ``embedder_id`` tracking, switching backends left the old
vectors in place — searches either failed silently (dim mismatch inside
sqlite-vec) or scored the query against a foreign vector space and returned
confident nonsense.
"""

from __future__ import annotations

import pytest

from arz.memory.embedder import (
    EmbedderNotReady,
    HashEmbedder,
    LocalEmbedder,
    active_status,
    embedder_from_config,
    embedder_id,
)
from arz.memory.vector import VectorStore


class ColdEmbedder:
    """Stands in for a local model that is still downloading."""

    def __init__(self, dim: int = 8) -> None:
        self._dim = dim
        self.ready = False

    @property
    def id(self) -> str:
        return f"cold-{self._dim}"

    @property
    def dim(self) -> int:
        return self._dim

    def encode(self, text: str) -> list[float]:
        if not self.ready:
            raise EmbedderNotReady("still downloading")
        # Deterministic, unit-norm-ish, and dependent on the text.
        v = [0.0] * self._dim
        for i, ch in enumerate(text[: self._dim]):
            v[i] = (ord(ch) % 17) / 17.0
        return v or [0.0] * self._dim


# ── identity ──────────────────────────────────────────────────────────────


def test_embedder_ids_are_stable_and_distinct():
    assert HashEmbedder(dim=256).id == HashEmbedder(dim=256).id
    assert HashEmbedder(dim=256).id != HashEmbedder(dim=128).id


def test_embedder_id_helper_tolerates_legacy_embedders():
    class Legacy:
        dim = 4

        def encode(self, text):
            return [0.0] * 4

    assert embedder_id(Legacy()) == "legacy-4"


# ── factory + status ──────────────────────────────────────────────────────


def test_hash_spec_is_marked_degraded():
    emb = embedder_from_config("hash")
    assert isinstance(emb, HashEmbedder)
    st = active_status()
    assert st["backend"] == "hash"
    assert st["degraded"] is True
    assert st["reason"]


def test_auto_falls_back_to_hash_and_records_why(monkeypatch):
    """No local extra, no Ollama → hash, but the degradation is visible.

    The silent fallback was the actual bug; the recorded reason is the fix.
    """
    monkeypatch.setattr(LocalEmbedder, "installed", staticmethod(lambda: False))
    monkeypatch.setattr("arz.memory.embedder.OllamaEmbedder.available", lambda self: False)
    emb = embedder_from_config("auto")
    assert isinstance(emb, HashEmbedder)
    st = active_status()
    assert st["degraded"] is True
    assert st["requested"] == "auto"
    assert "ollama" in st["reason"].lower() or "embeddings" in st["reason"].lower()


def test_local_spec_without_extra_degrades_with_install_hint(monkeypatch):
    monkeypatch.setattr(LocalEmbedder, "installed", staticmethod(lambda: False))
    emb = embedder_from_config("local")
    assert isinstance(emb, HashEmbedder)
    assert "arz[embeddings]" in active_status()["reason"]


def test_unknown_spec_is_treated_as_auto(monkeypatch):
    monkeypatch.setattr(LocalEmbedder, "installed", staticmethod(lambda: False))
    monkeypatch.setattr("arz.memory.embedder.OllamaEmbedder.available", lambda self: False)
    emb = embedder_from_config("wat")
    assert isinstance(emb, HashEmbedder)


# ── cold-start behaviour ──────────────────────────────────────────────────


def test_cold_embedder_stores_document_and_backfills(tmp_path):
    """A turn during model download must not lose the write, or block."""
    cold = ColdEmbedder()
    store = VectorStore(db_path=tmp_path / "v.db", embedder=cold)

    store.add("k1", "cedar trees grow in the mountains")
    assert store.pending_count() == 1
    # Search degrades to empty rather than raising.
    assert store.search("cedar") == []

    cold.ready = True
    assert store.reembed_pending() == 1
    assert store.pending_count() == 0
    assert [k for k, _c, _s in store.search("cedar trees grow in the mountains")] == ["k1"]


def test_reembed_stops_early_when_embedder_goes_cold(tmp_path):
    cold = ColdEmbedder()
    cold.ready = True
    store = VectorStore(db_path=tmp_path / "v.db", embedder=cold)
    store.add("a", "alpha document text")
    store.add("b", "beta document text")
    assert store.pending_count() == 0

    # Simulate the model unloading mid-backfill.
    store.add("c", "gamma document text")
    cold.ready = False
    store._embedder = cold  # noqa: SLF001
    # Nothing pending was embeddable, so nothing was embedded — and no raise.
    assert store.reembed_pending() == 0


# ── migration ─────────────────────────────────────────────────────────────


def test_switching_embedder_rebuilds_index_and_requeues(tmp_path):
    db = tmp_path / "v.db"
    s1 = VectorStore(db_path=db, embedder=HashEmbedder(dim=64))
    s1.add("doc", "the quick brown fox")
    assert s1.pending_count() == 0
    assert s1.search("the quick brown fox")

    # Different dimension → different vector space entirely.
    s2 = VectorStore(db_path=db, embedder=HashEmbedder(dim=32))
    assert s2.pending_count() == 1, "stale vectors must be requeued, not reused"
    assert s2.reembed_pending() == 1
    hits = s2.search("the quick brown fox")
    assert [k for k, _c, _s in hits] == ["doc"]


def test_same_embedder_does_not_requeue(tmp_path):
    db = tmp_path / "v.db"
    VectorStore(db_path=db, embedder=HashEmbedder(dim=64)).add("doc", "stable content")
    s2 = VectorStore(db_path=db, embedder=HashEmbedder(dim=64))
    assert s2.pending_count() == 0


# ── episodic ──────────────────────────────────────────────────────────────


@pytest.fixture
def isolated_episodic(monkeypatch, tmp_path):
    from arz.memory import context as ctx
    from arz.memory import episodic
    from arz.memory import vector as vector_mod

    monkeypatch.setattr(episodic, "_DB_PATH", tmp_path / "memory.db")
    store = VectorStore(db_path=tmp_path / "vec.db", embedder=HashEmbedder(dim=128))
    monkeypatch.setattr(vector_mod, "_shared", store)
    return episodic, ctx, store


def test_episodic_ignores_rows_from_a_stale_embedder(isolated_episodic, tmp_path, monkeypatch):
    episodic, ctx, _store = isolated_episodic
    text = "deployed the gateway behind the loopback interface"
    assert episodic.add(text, importance=0.9) is not None
    assert episodic.search(text, k=5), "sanity: findable with the original embedder"

    # Swap the shared embedder — the stored vector is now from a foreign space.
    swapped = VectorStore(db_path=tmp_path / "vec2.db", embedder=HashEmbedder(dim=64))
    from arz.memory import vector as vector_mod

    monkeypatch.setattr(vector_mod, "_shared", swapped)
    assert episodic.search(text, k=5) == [], "stale-space rows must not be scored"

    # Backfill re-embeds them into the new space.
    assert episodic.reembed_pending() == 1
    assert episodic.search(text, k=5), "row is findable again after backfill"


# ── relevance gates ───────────────────────────────────────────────────────


def test_gates_are_per_embedder():
    """Cosine distributions differ by model, so a single global gate starves
    recall on every backend but the one it was tuned against."""
    from arz.memory.embedder import relevance_gates

    assert relevance_gates(HashEmbedder()) == (0.55, 0.42)
    assert relevance_gates(LocalEmbedder()) == (0.30, 0.22)
    # Unknown/legacy embedders fall back to the historical constants.
    assert relevance_gates(object()) == (0.55, 0.42)


def test_episodic_uses_the_active_embedders_gates(isolated_episodic, monkeypatch):
    episodic, ctx, store = isolated_episodic
    from arz.memory import embedder as emb_mod

    seen: list[tuple[float, float]] = []
    real = emb_mod.relevance_gates
    monkeypatch.setattr(emb_mod, "relevance_gates", lambda e: seen.append(real(e)) or real(e))
    episodic.add("gateway binds the loopback interface by default", importance=0.5)
    episodic.search("loopback", k=3)
    assert seen and seen[-1] == (0.55, 0.42), "hash embedder gates should be used"
