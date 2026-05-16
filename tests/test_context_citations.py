"""Tests for build_prefix source-citation + semantic + skills integration."""

from __future__ import annotations

import pytest


@pytest.fixture
def isolated(monkeypatch, tmp_path):
    """Point semantic, memory files, and skills at a temp dir."""
    from arz.memory import files as memfiles
    from arz.memory import semantic

    monkeypatch.setattr(semantic, "_DB_PATH", tmp_path / "memory.db")
    # Memory files: stash a real dir at .arz/memory under tmp
    monkeypatch.setattr(
        memfiles,
        "_DEFAULT_DIR",
        tmp_path / "memory",
        raising=False,
    )
    yield {"tmp": tmp_path}


def test_build_prefix_includes_semantic_citation(isolated):
    from arz.memory import semantic
    from arz.memory.context import build_prefix

    semantic.upsert("prod.host", "db-1.internal")
    out = build_prefix("check the prod host", enable_recall=False)
    assert "<semantic-memory>" in out
    assert "_[source: ~/.arz/memory.db]_" in out
    assert "prod.host" in out


def test_build_prefix_omits_empty_semantic(isolated):
    from arz.memory.context import build_prefix

    out = build_prefix("any message", enable_recall=False)
    # No facts → no semantic block (and no citation for it)
    assert "<semantic-memory>" not in out


def test_widget_hint_injected_when_density_set(isolated):
    from types import SimpleNamespace

    from arz.memory.context import build_prefix

    cfg = SimpleNamespace(dashboard=SimpleNamespace(widget_density="more"))
    out = build_prefix("any", config=cfg, enable_recall=False)
    assert "<arz-runtime>" in out
    assert "widget_density=more" in out


def test_widget_hint_omitted_when_density_off(isolated):
    from types import SimpleNamespace

    from arz.memory.context import build_prefix

    cfg = SimpleNamespace(dashboard=SimpleNamespace(widget_density="off"))
    out = build_prefix("any", config=cfg, enable_recall=False)
    assert "<arz-runtime>" not in out
