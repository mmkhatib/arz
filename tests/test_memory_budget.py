"""Step 2 of the memory upgrade: ranking, budget, inject-once."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from arz.memory import ranking
from arz.memory.budget import Block, admit, omission_note

GOLDEN = json.loads((Path(__file__).parent / "data" / "lesson_recall_golden.json").read_text())


# ── ranking ──────────────────────────────────────────────────────────────────


def test_stem_conflates_inflections() -> None:
    assert ranking.stem("pushing") == ranking.stem("pushed") == ranking.stem("push")
    assert ranking.stem("models") == ranking.stem("model")
    assert ranking.stem("running") == "run"


def test_stopwords_dropped() -> None:
    assert ranking.stems("can you use the thing") == set()


def _hit_rate(rank_fn, k: int = 3) -> float:
    docs = [l["text"] for l in GOLDEN["lessons"]]
    ids = [l["id"] for l in GOLDEN["lessons"]]
    hits = 0
    for case in GOLDEN["queries"]:
        top = [ids[i] for i in rank_fn(case["q"], docs)[:k]]
        hits += any(e in top for e in case["expect"])
    return hits / len(GOLDEN["queries"])


def _naive(query: str, docs: list[str]) -> list[int]:
    """The previous ranker: raw shared-word count."""
    import re

    tok = lambda s: {t.lower() for t in re.findall(r"[A-Za-z][A-Za-z0-9_]{2,}", s)}  # noqa: E731
    q = tok(query)
    scored = sorted(((len(tok(d) & q), i) for i, d in enumerate(docs)), key=lambda p: -p[0])
    return [i for s, i in scored if s > 0]


def test_golden_lesson_recall_beats_naive_overlap() -> None:
    new = _hit_rate(lambda q, d: [i for i, _ in ranking.rank(q, d)])
    old = _hit_rate(_naive)
    print(f"lesson recall@3: rarity-ranked={new:.2f} naive={old:.2f}")
    assert new >= 0.7
    assert new > old


def test_turn_gate_needs_two_rare_shared_stems() -> None:
    docs = [l["text"] for l in GOLDEN["lessons"]]
    # Two rare stems ("codex", "cache") → admitted.
    assert 7 in ranking.turn_gate("is the codex model cache stale", docs)
    # One rare stem alone is not enough; common words never count.
    assert ranking.turn_gate("codex", docs) == []
    assert ranking.turn_gate("use the file", docs) == []


# ── budget ───────────────────────────────────────────────────────────────────


def test_admit_whole_blocks_and_reports_omissions() -> None:
    blocks = [
        Block("rules", "R" * 50, protected=True),
        Block("lessons", "L" * 40),
        Block("recall", "X" * 100),  # doesn't fit → omitted, not sliced
        Block("skills", "S" * 20),  # smaller block behind it still fits
    ]
    admitted, omitted = admit(blocks, budget=70)
    assert [b.name for b in admitted] == ["rules", "lessons", "skills"]
    assert omitted == ["recall"]
    assert "recall" in omission_note(omitted) and "<recall>" in omission_note(omitted)
    # Protected blocks survive even a zero budget.
    assert [b.name for b in admit(blocks, budget=0)[0]] == ["rules"]


# ── inject-once ──────────────────────────────────────────────────────────────


class _Persistent:
    keeps_context = True


class _Stateless:
    keeps_context = False


@pytest.fixture
def mem(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    from arz import lessons as lessons_mod
    from arz.memory import context, semantic

    store = lessons_mod.LessonStore(path=tmp_path / "lessons.jsonl")
    for l in GOLDEN["lessons"]:
        store.add(l["category"], l["text"])
    store.add("preference", "Reply tersely.")
    monkeypatch.setattr(lessons_mod, "_singleton", store)
    monkeypatch.setattr(semantic, "_DB_PATH", tmp_path / "memory.db")
    monkeypatch.setattr(
        context, "_recent_sessions_block", lambda **kw: "<recent-sessions>x</recent-sessions>"
    )
    monkeypatch.setattr(context, "_skills_index_block", lambda: "")
    context._sessions.clear()
    return context


def _build(ctx, msg: str, token):
    return ctx.build_prefix(
        msg, session_id="s1", provider_token=token, enable_recall=False, enable_memory_files=False
    )


def test_persistent_provider_gets_full_prefix_once(mem) -> None:
    ctx = mem
    p = _Persistent()
    first = _build(ctx, "can you push this to github now", None)
    assert "Reply tersely." in first and "ci-local.sh" in first and "<recent-sessions>" in first
    ctx.bind_provider("s1", p)
    tok = ctx.provider_token(p)

    # Follow-up: standing rules and already-shown lessons are not resent.
    second = _build(ctx, "ok and push it", tok)
    assert "Reply tersely." not in second and "ci-local.sh" not in second
    assert "<recent-sessions>" not in second

    # A newly relevant lesson (two rare stems) is added.
    third = _build(ctx, "where does codex keep the models cache", tok)
    assert "models_cache.json" in third


def test_stateless_provider_gets_full_prefix_every_turn(mem) -> None:
    ctx = mem
    p = _Stateless()
    _build(ctx, "can you push this to github now", None)
    ctx.bind_provider("s1", p)
    again = _build(ctx, "can you push this to github now", ctx.provider_token(p))
    assert "Reply tersely." in again and "ci-local.sh" in again


def test_compaction_or_provider_swap_resets(mem) -> None:
    ctx = mem
    p = _Persistent()
    _build(ctx, "push to github", None)
    ctx.bind_provider("s1", p)
    tok = ctx.provider_token(p)
    ctx.reset_session("s1")
    assert "Reply tersely." in _build(ctx, "push to github", tok)

    # A different provider instance than the one bound → full rebuild.
    ctx.bind_provider("s1", p)
    other = _Persistent()
    assert "Reply tersely." in _build(ctx, "push to github", ctx.provider_token(other))


# ── scoped lessons ───────────────────────────────────────────────────────────


def test_repo_scoped_lessons_stay_in_their_repo(tmp_path: Path) -> None:
    from arz.lessons import LessonStore, render_lessons, scope_for

    repo_a = tmp_path / "a"
    (repo_a / ".git").mkdir(parents=True)
    (repo_a / "src").mkdir()
    repo_b = tmp_path / "b"
    (repo_b / ".git").mkdir(parents=True)
    assert scope_for(repo_a / "src") == str(repo_a.resolve())

    store = LessonStore(path=tmp_path / "l.jsonl")
    store.add("tool", "run make check before pushing", scope=scope_for(repo_a), applies="pushing")
    store.add("tool", "use uv for python deps")

    def texts(wd) -> str:
        standing, relevant = store.select("about to push, make check?", work_dir=wd)
        return render_lessons(standing + relevant)

    inside = texts(repo_a / "src")
    assert "make check" in inside and "this repo" in inside and "(when: pushing)" in inside
    assert "make check" not in texts(repo_b)
    assert "make check" not in texts(None)
    # Same text, different scope → separate lessons (no cross-scope dedup).
    store.add("tool", "run make check before pushing")
    assert len(store.list()) == 3


def test_learn_tag_scope_attr(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from arz import inline_learn
    from arz import lessons as lessons_mod

    repo = tmp_path / "proj"
    (repo / ".git").mkdir(parents=True)
    store = lessons_mod.LessonStore(path=tmp_path / "l.jsonl")
    monkeypatch.setattr(lessons_mod, "_singleton", store)
    monkeypatch.setattr(inline_learn, "_session_work_dir", lambda sid: str(repo))
    _, ex = inline_learn.parse(
        '<learn category="tool" scope="repo" applies="releasing">tag before release</learn>'
    )
    inline_learn.apply(ex, session_id="s")
    (l,) = store.list()
    assert l.scope == str(repo.resolve()) and l.applies == "releasing"
