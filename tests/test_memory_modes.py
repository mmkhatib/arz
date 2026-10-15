"""Step 3c: per-session memory modes + global switches."""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from arz import inline_learn
from arz.session.session import Session, memory_reads, memory_writes


def _cfg(inject: bool = True, write: bool = True):
    return SimpleNamespace(dashboard=SimpleNamespace(memory_inject=inject, memory_write=write))


@pytest.mark.parametrize(
    "mode,reads,writes",
    [("persistent", True, True), ("incognito", True, False), ("temporary", False, False)],
)
def test_mode_matrix(mode: str, reads: bool, writes: bool) -> None:
    s = SimpleNamespace(memory_mode=mode)
    assert memory_reads(s, _cfg()) is reads
    assert memory_writes(s, _cfg()) is writes


def test_global_switches_narrow_every_session() -> None:
    s = SimpleNamespace(memory_mode="persistent")
    assert memory_reads(s, _cfg(inject=False)) is False
    assert memory_writes(s, _cfg(write=False)) is False


def test_session_roundtrip_and_bad_value() -> None:
    s = Session(surface="dashboard", chat_id="web")
    s.memory_mode = "incognito"
    assert Session.from_dict(s.to_dict()).memory_mode == "incognito"
    d = s.to_dict()
    d["memory_mode"] = "nonsense"
    assert Session.from_dict(d).memory_mode == "persistent"


def test_apply_skips_writes_but_keeps_recall_and_todo(monkeypatch: pytest.MonkeyPatch) -> None:
    _, ex = inline_learn.parse(
        "<learn>secret project codename</learn><recall>deploy notes</recall>"
        '<semantic key="x.y">z</semantic>'
    )
    inline_learn.drain_recalls("s-incog")
    counts = inline_learn.apply(ex, session_id="s-incog", write=False)
    assert counts["learn"] == 0 and counts["semantic"] == 0
    assert counts["recall"] == 1 and counts["skipped"] == 2
    assert inline_learn.drain_recalls("s-incog") == ["deploy notes"]
    counts = inline_learn.apply(ex, session_id="s-temp", write=False, read=False)
    assert counts["recall"] == 0 and counts["skipped"] == 3


def test_memory_mode_endpoint() -> None:
    from arz.config.loader import load_config
    from arz.dashboard.server import create_app
    from arz.providers.pool import ProviderPool

    cfg = load_config()
    cfg.dashboard.token_auth = False
    client = TestClient(create_app(cfg, ProviderPool(max_size=1)))
    sid = client.post("/api/sessions", json={"surface": "dashboard", "chat_id": "web"}).json()["id"]
    assert client.get(f"/api/sessions/{sid}").json()["memory_mode"] == "persistent"
    assert (
        client.patch(f"/api/sessions/{sid}/memory-mode", json={"mode": "temporary"}).status_code
        == 204
    )
    assert client.get(f"/api/sessions/{sid}").json()["memory_mode"] == "temporary"
    assert client.patch(f"/api/sessions/{sid}/memory-mode", json={"mode": "x"}).status_code == 422
