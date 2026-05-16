"""Unit tests for the eval harness scaffolding (no live LLM calls)."""

from __future__ import annotations

import pytest


def test_scenarios_have_unique_ids():
    from arz.eval import SCENARIOS

    ids = [s.id for s in SCENARIOS]
    assert len(ids) == len(set(ids))


def test_memory_scenarios_present():
    from arz.eval import SCENARIOS

    ids = {s.id for s in SCENARIOS}
    assert "memory-write-recall" in ids
    assert "memory-restart-recall" in ids
    assert "memory-forget" in ids


def test_memory_restart_scenario_uses_restart_flag():
    from arz.eval import SCENARIOS

    scn = next(s for s in SCENARIOS if s.id == "memory-restart-recall")
    assert any(t.restart_provider_first for t in scn.turns)
    assert any(t.use_memory_prefix for t in scn.turns)
    assert scn.seed_semantic
    assert scn.reset_semantic


def test_score_expect_any_pass():
    from arz.eval import Turn, _score

    ok, _ = _score(Turn(user="x", expect_any=["foo", "bar"]), "this contains foo somewhere")
    assert ok is True


def test_score_expect_any_fail():
    from arz.eval import Turn, _score

    ok, _ = _score(Turn(user="x", expect_any=["foo", "bar"]), "neither here")
    assert ok is False


def test_score_expect_all_partial_fail():
    from arz.eval import Turn, _score

    ok, why = _score(Turn(user="x", expect_all=["foo", "bar"]), "only foo here")
    assert ok is False
    assert "bar" in why


def test_score_no_assertions_passes():
    from arz.eval import Turn, _score

    ok, _ = _score(Turn(user="x"), "anything goes")
    assert ok is True


def test_seed_semantic_writes_facts(monkeypatch, tmp_path):
    from arz.eval import Scenario, Turn, _seed_semantic
    from arz.memory import semantic

    monkeypatch.setattr(semantic, "_DB_PATH", tmp_path / "memory.db")
    scn = Scenario(
        id="t",
        description="t",
        turns=[Turn(user="hi")],
        seed_semantic=[("project.test", "value-1", 0.9)],
        reset_semantic=True,
    )
    _seed_semantic(scn)
    f = semantic.get("project.test")
    assert f is not None
    assert f.value == "value-1"
    assert f.confidence == pytest.approx(0.9, abs=0.01)


def test_wrap_with_prefix_attaches_memory(monkeypatch, tmp_path):
    from arz.eval import _wrap_with_prefix
    from arz.memory import semantic

    monkeypatch.setattr(semantic, "_DB_PATH", tmp_path / "memory.db")
    semantic.upsert("project.canonical.ref", "marker-token-7", confidence=0.95)
    out = _wrap_with_prefix("dummy user message")
    assert "marker-token-7" in out
    assert "dummy user message" in out


def test_detect_installed_providers_returns_list():
    from arz.eval import _detect_installed_providers

    out = _detect_installed_providers()
    assert isinstance(out, list)
    # Don't assert any specific provider — depends on the test box.


@pytest.mark.asyncio
async def test_run_eval_handles_no_matches(monkeypatch):
    from arz.config.schema import ArzConfig
    from arz.eval import run_eval

    cfg = ArzConfig()
    out = await run_eval(cfg, scenarios=["nonexistent-scenario-id"])
    assert out["results"] == []
