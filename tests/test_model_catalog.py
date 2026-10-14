"""Live model catalog — discovery from each CLI's own sources."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest

from arz import model_catalog as mc


@pytest.fixture
def home(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setattr(mc, "_home", lambda: tmp_path)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    mc._cache.clear()
    return tmp_path


def _write_codex_cache(home: Path) -> None:
    (home / ".codex").mkdir()
    (home / ".codex" / "models_cache.json").write_text(
        json.dumps(
            {
                "models": [
                    {"slug": "gpt-old", "display_name": "Old", "visibility": "hide", "priority": 1},
                    {
                        "slug": "gpt-9-mini",
                        "display_name": "GPT-9 Mini",
                        "visibility": "list",
                        "priority": 5,
                    },
                    {"slug": "gpt-9", "display_name": "GPT-9", "visibility": "list", "priority": 2},
                ]
            }
        )
    )


def test_codex_reads_cli_cache_visible_only_in_priority_order(home: Path) -> None:
    _write_codex_cache(home)
    rows = mc._codex_models()
    assert [m.id for m in rows] == ["gpt-9", "gpt-9-mini"]
    assert rows[0].default and not rows[1].default
    assert mc.cheap_codex_model() == "gpt-9-mini"


def test_claude_code_aliases_labelled_with_resolved_ids(home: Path) -> None:
    proj = home / ".claude" / "projects" / "p"
    proj.mkdir(parents=True)
    (proj / "s.jsonl").write_text(
        '{"message":{"model":"claude-opus-4-7"}}\n{"message":{"model":"claude-opus-5-5"}}\n'
    )
    models = asyncio.run(mc.list_models("claude-code"))
    by_id = {m.id: m for m in models}
    assert by_id["opus"].default
    assert by_id["opus"].label == "Opus 5.5 (latest Opus)"
    assert by_id["haiku"].label == "Haiku (latest)"


def test_pretty_claude() -> None:
    assert mc._pretty_claude("claude-opus-5-5") == "Opus 5.5"
    assert mc._pretty_claude("claude-haiku-4-5-20251001") == "Haiku 4.5"
    assert mc._pretty_claude("weird") == "weird"


@pytest.mark.parametrize(
    "text,ids,default",
    [
        ('["a","b"]', ["a", "b"], None),
        (
            '{"models":[{"model_id":"x","model_name":"X"},{"id":"y"}],"default_model":"y"}',
            ["x", "y"],
            "y",
        ),
        ("not json", [], None),
    ],
)
def test_parse_kiro_models(text: str, ids: list[str], default: str | None) -> None:
    rows = mc.parse_kiro_models(text)
    assert [m.id for m in rows] == ids
    assert next((m.id for m in rows if m.default), None) == default


def test_normalize_model_maps_stale_ids(home: Path) -> None:
    _write_codex_cache(home)
    assert mc.normalize_model("claude-code", "claude-opus-4-7") == "opus"
    assert mc.normalize_model("claude-code", "claude-haiku-4-5-20251001") == "haiku"
    assert mc.normalize_model("claude-code", "sonnet") == "sonnet"
    assert mc.normalize_model("codex", "gpt-5.4") == ""
    assert mc.normalize_model("codex", "gpt-9") == "gpt-9"
    assert mc.normalize_model("gemini", "pro") == "pro"
    assert mc.normalize_model("claude-code", "") == ""


def test_catalog_shape(home: Path) -> None:
    out = asyncio.run(mc.catalog())
    assert set(out) == set(mc.PROVIDERS)
    assert out["gemini"]["source"] == "cli-aliases"
    assert out["anthropic"]["source"] == "fallback"
    assert out["codex"]["models"] == []
