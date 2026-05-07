"""Tests for memory backends."""

from __future__ import annotations

from pathlib import Path

from arz.memory.lessons import LessonsStore
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


# ── LessonsStore ──────────────────────────────────────────────────────────────


def test_lessons_add_and_list(tmp_path: Path) -> None:
    store = LessonsStore(db_path=tmp_path / "test.db")
    l1 = store.add("Always use snake_case")
    l2 = store.add("Never hardcode secrets", tags=["security"])
    lessons = store.list()
    assert len(lessons) == 2
    assert lessons[0].id == l2.id  # newest first


def test_lessons_remove(tmp_path: Path) -> None:
    store = LessonsStore(db_path=tmp_path / "test.db")
    lesson = store.add("Temporary lesson")
    assert store.remove(lesson.id) is True
    assert len(store.list()) == 0


def test_lessons_remove_nonexistent(tmp_path: Path) -> None:
    store = LessonsStore(db_path=tmp_path / "test.db")
    assert store.remove(9999) is False


def test_lessons_format_for_context(tmp_path: Path) -> None:
    store = LessonsStore(db_path=tmp_path / "test.db")
    store.add("Use ruff not flake8")
    ctx = store.format_for_context()
    assert "Use ruff not flake8" in ctx


def test_lessons_empty_context(tmp_path: Path) -> None:
    store = LessonsStore(db_path=tmp_path / "test.db")
    assert store.format_for_context() == ""
