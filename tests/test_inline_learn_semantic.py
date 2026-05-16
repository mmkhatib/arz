"""<semantic> and <forget> tag round-trip through inline_learn.apply()."""

from __future__ import annotations

import pytest


@pytest.fixture
def isolated_semantic(monkeypatch, tmp_path):
    from arz.memory import semantic

    monkeypatch.setattr(semantic, "_DB_PATH", tmp_path / "memory.db")
    yield semantic


def test_semantic_tag_extraction_and_apply(isolated_semantic):
    from arz import inline_learn

    text = 'Sure thing. <semantic key="repo.default_branch">main</semantic> Also noted.'
    cleaned, extractions = inline_learn.parse(text)
    assert "main" not in cleaned  # tag body stripped
    assert any(e.kind == "semantic" for e in extractions)

    counts = inline_learn.apply(extractions, session_id="s1")
    assert counts["semantic"] == 1
    fact = isolated_semantic.get("repo.default_branch")
    assert fact is not None
    assert fact.value == "main"
    assert fact.source == "s1"


def test_forget_tag_drops_confidence(isolated_semantic):
    from arz import inline_learn

    # Prime a fact.
    isolated_semantic.upsert("prod.host", "db-1.internal")

    text = '<forget key="prod.host">decommissioned</forget>'
    _, extractions = inline_learn.parse(text)
    counts = inline_learn.apply(extractions, session_id="s2")
    assert counts["forget"] == 1
    fact = isolated_semantic.get("prod.host")
    assert fact is not None
    assert fact.confidence < 0.7  # dropped from 0.7 to 0.4


def test_semantic_without_key_is_skipped(isolated_semantic):
    from arz import inline_learn

    text = "<semantic>missing key</semantic>"
    _, extractions = inline_learn.parse(text)
    counts = inline_learn.apply(extractions, session_id="s3")
    assert counts["semantic"] == 0
    assert counts["skipped"] >= 1


def test_forget_unknown_key_no_op(isolated_semantic):
    from arz import inline_learn

    text = '<forget key="never.existed">x</forget>'
    _, extractions = inline_learn.parse(text)
    counts = inline_learn.apply(extractions, session_id="s4")
    # Counts the attempt but underlying store still empty
    assert counts["forget"] == 1
    assert isolated_semantic.get("never.existed") is None
