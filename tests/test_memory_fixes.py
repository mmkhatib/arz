"""Regressions for the memory audit fixes (shared vector store, stats,
throttled FTS reindex)."""

from __future__ import annotations

import os
import time
from pathlib import Path

import pytest

from arz.memory import fts as fts_mod
from arz.memory import vector as vector_mod
from arz.memory.embedder import HashEmbedder
from arz.memory.vector import VectorStore


@pytest.fixture
def shared_store(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> VectorStore:
    store = VectorStore(db_path=tmp_path / "vec.db", embedder=HashEmbedder(dim=64))
    monkeypatch.setattr(vector_mod, "_shared", store)
    return store


def test_dashboard_routes_reuse_the_chat_vector_store(shared_store: VectorStore) -> None:
    """A second VectorStore with another embedder on the same DB drops the
    whole vec0 table — the dashboard must use the shared instance."""
    from fastapi.testclient import TestClient

    from arz.config.loader import load_config
    from arz.dashboard.server import create_app
    from arz.providers.pool import ProviderPool

    shared_store.add("lesson:x", "always run the linter before pushing")
    config = load_config()
    config.dashboard.token_auth = False
    client = TestClient(create_app(config, ProviderPool(max_size=1)))
    stats = client.get("/api/memory/stats").json()
    assert stats["vectors"] == 1
    hits = client.get("/api/memory/search", params={"q": "linter pushing"}).json()
    assert any(h["key"] == "vector:lesson:x" for h in hits)
    # Chat-side recall still finds it — nothing was wiped.
    assert shared_store.search("always run the linter before pushing", k=1)


def test_vector_store_count(tmp_path: Path) -> None:
    s = VectorStore(db_path=tmp_path / "v.db", embedder=HashEmbedder(dim=32))
    assert s.count() == 0
    s.add("a", "one")
    s.add("b", "two")
    s.add("a", "one again")
    assert s.count() == 2


def test_fts_maybe_reindex_is_throttled(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    notes = tmp_path / "markdown"
    notes.mkdir()
    monkeypatch.setattr(fts_mod, "_MARKDOWN_DIR", notes)
    for name in ("_MEMORY_DIR", "_SESSIONS_DIR"):
        monkeypatch.setattr(fts_mod, name, tmp_path / "none")
    monkeypatch.setattr(fts_mod, "_LESSONS_PATH", tmp_path / "none.jsonl")
    idx = fts_mod.MemoryFTS(db_path=tmp_path / "fts.db")

    (notes / "a.md").write_text("zebra crossing notes")
    idx.reindex()
    assert idx.search("zebra")

    note_b = notes / "b.md"
    note_b.write_text("quokka habitat")
    idx.maybe_reindex(min_interval_s=60)  # throttled: just indexed
    assert not idx.search("quokka")
    idx._last_reindex = time.monotonic() - 61
    idx.maybe_reindex(min_interval_s=60)
    assert idx.search("quokka")

    # Unchanged files are skipped via the in-memory mtime map; an edit is picked up.
    later = time.time() + 5
    note_b.write_text("quokka habitat and diet")
    os.utime(note_b, (later, later))
    assert idx.reindex()["notes"] == 1


def test_legacy_sqlite_lessons_migrate_once(tmp_path: Path) -> None:
    import sqlite3

    from arz.lessons import LessonStore, migrate_legacy_sqlite_lessons

    db = tmp_path / "memory.db"
    with sqlite3.connect(db) as conn:
        conn.execute(
            "CREATE TABLE lessons (id INTEGER PRIMARY KEY, content TEXT, tags TEXT, created_at REAL)"
        )
        conn.execute("INSERT INTO lessons VALUES (1, 'My name is Moos', '', 0)")
        conn.execute("INSERT INTO lessons VALUES (2, 'prefers terse replies', 'preference', 0)")
    store = LessonStore(path=tmp_path / "lessons.jsonl")
    assert migrate_legacy_sqlite_lessons(store, db) == 2
    by_text = {l.text: l.category for l in store.list()}
    assert by_text == {"My name is Moos": "knowledge", "prefers terse replies": "preference"}
    assert migrate_legacy_sqlite_lessons(store, db) == 0  # table renamed → no rerun
    assert len(store.list()) == 2
