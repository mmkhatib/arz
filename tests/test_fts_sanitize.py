"""FTS5 query sanitizer — handles backticks, paths, punctuation."""

from __future__ import annotations

from arz.memory.fts import MemoryFTS


def test_strips_backticks_in_code_fence() -> None:
    assert MemoryFTS._sanitize_query("```py\nprint(1)\n```") == "py print 1"


def test_windows_path_does_not_break() -> None:
    out = MemoryFTS._sanitize_query("C:\\Users\\mmkha\\.arz\\workspace")
    assert "C" in out
    assert ":" not in out
    assert "\\" not in out


def test_drops_fts_special_chars() -> None:
    out = MemoryFTS._sanitize_query("foo (bar) - baz: qux*")
    assert "(" not in out
    assert ":" not in out
    assert "*" not in out
    assert "foo" in out
    assert "qux" in out


def test_unicode_words_preserved() -> None:
    out = MemoryFTS._sanitize_query("hello عربي world")
    assert "hello" in out
    assert "world" in out
    assert "عربي" in out


def test_empty_after_sanitize() -> None:
    assert MemoryFTS._sanitize_query("```") == ""
    assert MemoryFTS._sanitize_query("...") == ""
