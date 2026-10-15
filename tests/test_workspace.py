"""Tests for workspace scoping (Phase 4)."""

from __future__ import annotations

import pytest


@pytest.fixture(autouse=True)
def reset_workspace():
    from arz.memory import workspace

    workspace.set_active_workspace("default")
    yield
    workspace.set_active_workspace("default")


def test_default_workspace_is_default():
    from arz.memory import workspace

    assert workspace.get_active_workspace() == "default"


def test_switch_to_named():
    from arz.memory import workspace

    name = workspace.set_active_workspace("acme")
    assert name == "acme"
    assert workspace.get_active_workspace() == "acme"


def test_invalid_name_falls_back():
    from arz.memory import workspace

    name = workspace.set_active_workspace("WITH SPACES & symbols!")
    assert name == "default"


def test_empty_falls_back():
    from arz.memory import workspace

    assert workspace.set_active_workspace("") == "default"
    assert workspace.set_active_workspace("   ") == "default"


def test_default_paths_unchanged():
    from arz.memory import workspace

    workspace.set_active_workspace("default")
    md = workspace.memory_dir()
    db = workspace.db_path()
    assert str(md).endswith(".arz/memory")
    assert str(db).endswith(".arz/memory.db")


def test_named_paths_remap():
    from arz.memory import workspace

    workspace.set_active_workspace("acme")
    md = workspace.memory_dir()
    db = workspace.db_path()
    assert "/memory-workspaces/acme/memory" in str(md)
    assert "/memory-workspaces/acme/memory.db" in str(db)


def test_list_workspaces_includes_default():
    from arz.memory import workspace

    out = workspace.list_workspaces()
    assert "default" in out


def test_memory_files_re_resolves(monkeypatch, tmp_path):
    """get_memory_files().base_dir picks up workspace switches without
    rebuilding the singleton."""
    from arz.memory import files as memfiles
    from arz.memory import workspace

    monkeypatch.setattr(workspace, "_active", "default")

    # Force base path under tmp so test doesn't touch ~/.arz.
    monkeypatch.setattr(workspace, "memory_dir", lambda: tmp_path / "default-mem")
    files = memfiles.MemoryFiles()
    default_dir = files.base_dir
    assert "default-mem" in str(default_dir)

    monkeypatch.setattr(workspace, "memory_dir", lambda: tmp_path / "acme-mem")
    acme_dir = files.base_dir
    assert "acme-mem" in str(acme_dir)
    assert default_dir != acme_dir


# Hybrid retrieval


def test_keyword_score_weights_key_higher(monkeypatch, tmp_path):
    from arz.memory import semantic

    monkeypatch.setattr(semantic, "_DB_PATH", tmp_path / "memory.db")
    semantic.upsert("project.auth", "JWT migration in flight")
    semantic.upsert("project.auth.deadline", "ship by 2026-06-01")
    semantic.upsert("project.unrelated.thing", "something else entirely")
    out = semantic.render_for_prompt(query="when does auth ship?")
    assert "project.auth" in out


def test_high_confidence_facts_always_surface(monkeypatch, tmp_path):
    from arz.memory import semantic

    monkeypatch.setattr(semantic, "_DB_PATH", tmp_path / "memory.db")
    # Push to 1.0
    for _ in range(10):
        semantic.upsert("repo.default_branch", "main")
    semantic.upsert("project.something_low", "noise")
    out = semantic.render_for_prompt(query="totally unrelated query about pasta")
    assert "repo.default_branch" in out


def test_soft_delete_hides_from_reads(monkeypatch, tmp_path):
    from arz.memory import semantic

    monkeypatch.setattr(semantic, "_DB_PATH", tmp_path / "memory.db")
    semantic.upsert("project.x", "live value")
    assert semantic.get("project.x") is not None
    assert semantic.delete("project.x") is True
    assert semantic.get("project.x") is None
    # Tombstone still on disk
    out = semantic.render_for_prompt()
    assert "project.x" not in out


def test_purge_deleted_hard_removes(monkeypatch, tmp_path):
    import time as _t

    from arz.memory import semantic

    monkeypatch.setattr(semantic, "_DB_PATH", tmp_path / "memory.db")
    semantic.upsert("project.gone", "v")
    semantic.delete("project.gone")
    # Backdate the tombstone so the purge actually fires.
    with semantic._connect() as conn:
        conn.execute(
            "UPDATE semantic_memory SET updated_at = ? WHERE key = ?",
            (_t.time() - 200 * 86400, "project.gone"),
        )
    n = semantic.purge_deleted(older_than_days=90)
    assert n == 1
