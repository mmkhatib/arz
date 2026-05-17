"""Tests for the consolidator's _safe_loads silent-skip heuristics.

These exist because the cheap model sometimes returns CSS, template
literals, or plain prose instead of JSON — we want those to skip
silently, not warn on every consolidator tick.
"""

from __future__ import annotations

import json

import pytest


def test_real_json_parses():
    from arz.consolidator import _safe_loads

    out = _safe_loads('{"preferences": [], "summary": "ok"}')
    assert out["summary"] == "ok"


def test_prose_skips_silently():
    from arz.consolidator import _safe_loads

    with pytest.raises(json.JSONDecodeError):
        _safe_loads("Hey Moos, what's up?")


def test_css_with_braces_skips_silently():
    """CSS reply has `{...}` but no double-quoted keys — must skip."""
    from arz.consolidator import _safe_loads

    css = (
        "{ margin: 0; padding: 0; box-sizing: border-box; }\n"
        "body { background: #000; width: 100%; height: 100vh; }"
    )
    with pytest.raises(json.JSONDecodeError):
        _safe_loads(css)


def test_template_literal_skips_silently():
    """JS template placeholder like `{name}` is not JSON."""
    from arz.consolidator import _safe_loads

    with pytest.raises(json.JSONDecodeError):
        _safe_loads("{name}")


def test_js_object_literal_skips_silently():
    """Unquoted JS object keys aren't JSON — silent skip."""
    from arz.consolidator import _safe_loads

    with pytest.raises(json.JSONDecodeError):
        _safe_loads("{ foo: 1, bar: 'two' }")


def test_partial_json_still_warns(capsys):
    """A real JSON attempt that's malformed (truncation) WARNS so we
    can tighten the prompt — only "looks like JSON" branches do this.

    structlog routes through stderr by default — capture via capsys
    rather than caplog (which only sees stdlib logging records)."""
    from arz.consolidator import _safe_loads

    truncated = '{"preferences": [{"key": "color", "value": "gr'
    with pytest.raises(json.JSONDecodeError):
        _safe_loads(truncated)
    captured = capsys.readouterr()
    combined = captured.out + captured.err
    assert "json parse failed" in combined or "warning" in combined.lower()
