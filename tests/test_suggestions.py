"""Tests for the background suggestions generator (Phase 3)."""

from __future__ import annotations

import pytest


@pytest.fixture(autouse=True)
def reset_suggestions_state(monkeypatch, tmp_path):
    """Each test gets a fresh cache + temp memory dir so we don't read
    the developer's actual ~/.arz/memory."""
    from arz import suggestions
    from arz.memory import workspace as ws

    suggestions._cache.suggestions = list(suggestions._FALLBACK)
    suggestions._cache.generated_at = 0.0
    suggestions._cache.last_error = ""
    suggestions._runner = None
    suggestions._session_manager = None
    monkeypatch.setattr(ws, "memory_dir", lambda: tmp_path / "memory")


def test_get_cached_returns_fallback_initially():
    from arz import suggestions

    out = suggestions.get_cached()
    assert isinstance(out, list)
    assert len(out) >= 4


def test_fallback_suggestions_is_a_copy():
    from arz import suggestions

    a = suggestions.fallback_suggestions()
    a.append("mutated")
    b = suggestions.fallback_suggestions()
    assert "mutated" not in b


def test_parse_array_strips_fence():
    from arz.suggestions import _parse_array

    raw = '```json\n["one", "two", "three"]\n```'
    assert _parse_array(raw) == ["one", "two", "three"]


def test_parse_array_handles_trailing_commentary():
    from arz.suggestions import _parse_array

    raw = 'Sure! Here are: ["a", "b"] — let me know if you want more.'
    assert _parse_array(raw) == ["a", "b"]


def test_parse_array_drops_non_strings():
    from arz.suggestions import _parse_array

    raw = '["ok", 42, null, "good"]'
    assert _parse_array(raw) == ["ok", "good"]


def test_parse_array_returns_empty_on_garbage():
    from arz.suggestions import _parse_array

    assert _parse_array("totally not json") == []
    assert _parse_array("") == []


@pytest.mark.asyncio
async def test_refresh_now_uses_runner_when_context_present(monkeypatch, tmp_path):
    from arz import suggestions
    from arz.memory import workspace as ws

    # Stage some preferences so the cold-start gate passes.
    mem = tmp_path / "memory"
    mem.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(ws, "memory_dir", lambda: mem)
    (mem / "preferences.md").write_text(
        "- Prefer terse output\n- No trailing summaries\n" * 5, encoding="utf-8"
    )

    captured: list[tuple[str, str]] = []

    async def fake_runner(agent: str, prompt: str) -> str:
        captured.append((agent, prompt))
        return '["Continue terse refactor", "Tighten the test suite"]'

    suggestions.init_suggestions(fake_runner, session_manager=None)
    out = await suggestions.refresh_now()
    assert out == ["Continue terse refactor", "Tighten the test suite"]
    assert len(captured) == 1
    assert captured[0][0] == "general"
    assert "USER PREFERENCES" in captured[0][1]


@pytest.mark.asyncio
async def test_refresh_now_falls_back_when_no_memory(monkeypatch, tmp_path):
    from arz import suggestions
    from arz.memory import workspace as ws

    monkeypatch.setattr(ws, "memory_dir", lambda: tmp_path / "empty-memory")

    async def fake_runner(agent: str, prompt: str) -> str:
        raise AssertionError("runner should not be called on cold start")

    suggestions.init_suggestions(fake_runner, session_manager=None)
    out = await suggestions.refresh_now()
    assert out == suggestions.fallback_suggestions()


@pytest.mark.asyncio
async def test_refresh_swallows_runner_errors(monkeypatch, tmp_path):
    from arz import suggestions
    from arz.memory import workspace as ws

    mem = tmp_path / "memory"
    mem.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(ws, "memory_dir", lambda: mem)
    (mem / "preferences.md").write_text("- foo\n" * 30, encoding="utf-8")

    async def boom(agent: str, prompt: str) -> str:
        raise RuntimeError("model down")

    suggestions.init_suggestions(boom, session_manager=None)
    out = await suggestions.refresh_now()
    # Cache stays as the prior content (initially the fallback).
    assert out == suggestions.fallback_suggestions()
    assert "model down" in suggestions.stats()["last_error"]


@pytest.mark.asyncio
async def test_refresh_caps_at_six_and_filters_long(monkeypatch, tmp_path):
    from arz import suggestions
    from arz.memory import workspace as ws

    mem = tmp_path / "memory"
    mem.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(ws, "memory_dir", lambda: mem)
    (mem / "preferences.md").write_text("- foo\n" * 30, encoding="utf-8")

    long = "x" * 200

    async def fake_runner(agent: str, prompt: str) -> str:
        return f'["a","b","c","d","e","f","g","{long}"]'

    suggestions.init_suggestions(fake_runner, session_manager=None)
    out = await suggestions.refresh_now()
    assert len(out) == 6
    assert long not in out


@pytest.mark.asyncio
async def test_redact_applied_to_suggestions(monkeypatch, tmp_path):
    from arz import suggestions
    from arz.memory import workspace as ws

    mem = tmp_path / "memory"
    mem.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(ws, "memory_dir", lambda: mem)
    (mem / "preferences.md").write_text("- foo\n" * 30, encoding="utf-8")

    async def fake_runner(agent: str, prompt: str) -> str:
        return '["Use sk-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa now"]'

    suggestions.init_suggestions(fake_runner, session_manager=None)
    out = await suggestions.refresh_now()
    assert len(out) == 1
    assert "REDACTED" in out[0]
    assert "sk-aaaaaaaaaa" not in out[0]
