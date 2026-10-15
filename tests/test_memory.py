"""Tests for memory backends."""

from __future__ import annotations

from pathlib import Path

from arz.memory.markdown import MarkdownStore

# ── MarkdownStore ──────────────────────────────────────────────────────────────


def test_markdown_save_and_load(tmp_path: Path) -> None:
    store = MarkdownStore(directory=tmp_path)
    store.save("my-note", "# Hello\nThis is a note.")
    content = store.load("my-note")
    assert content == "# Hello\nThis is a note."


def test_markdown_load_missing_returns_none(tmp_path: Path) -> None:
    store = MarkdownStore(directory=tmp_path)
    assert store.load("does-not-exist") is None


def test_markdown_list(tmp_path: Path) -> None:
    store = MarkdownStore(directory=tmp_path)
    store.save("alpha", "a")
    store.save("beta", "b")
    keys = store.list()
    assert set(keys) == {"alpha", "beta"}


def test_markdown_search(tmp_path: Path) -> None:
    store = MarkdownStore(directory=tmp_path)
    store.save("cedar", "Arz is the Lebanese cedar tree.")
    store.save("oak", "An oak is a different tree.")
    results = store.search("cedar Lebanese")
    assert results[0][0] == "cedar"


def test_markdown_safe_name(tmp_path: Path) -> None:
    store = MarkdownStore(directory=tmp_path)
    store.save("my note/with bad chars!", "content")
    assert store.load("my note/with bad chars!") == "content"
