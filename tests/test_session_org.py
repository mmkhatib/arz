"""Sidebar organization endpoints: unread tracking, needs-input, cleanup."""

from __future__ import annotations

from datetime import datetime, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from arz.config.loader import load_config
from arz.dashboard.server import create_app
from arz.providers.pool import ProviderPool
from arz.session.manager import SessionManager
from arz.session.session import Session


@pytest.fixture()
def app_and_mgr(tmp_path: Path):
    config = load_config()
    config.dashboard.token_auth = False
    app = create_app(config, ProviderPool(max_size=1))
    mgr = SessionManager(sessions_dir=tmp_path)
    app.state.session_manager = mgr
    return app, mgr


def _summary(client: TestClient, sid: str) -> dict:
    return next(s for s in client.get("/api/sessions").json() if s["id"] == sid)


def test_unread_until_marked_read(app_and_mgr) -> None:
    app, mgr = app_and_mgr
    client = TestClient(app)
    s = mgr.create(surface="dashboard", chat_id="web")
    s.add_message("user", "hi")
    s.add_message("assistant", "hello")
    mgr.save(s)
    assert _summary(client, s.id)["unread"] is True

    assert client.post(f"/api/sessions/{s.id}/read").status_code == 204
    assert _summary(client, s.id)["unread"] is False

    s.add_message("assistant", "more")
    assert _summary(client, s.id)["unread"] is True


def test_mark_read_unknown_session_404(app_and_mgr) -> None:
    app, _ = app_and_mgr
    assert TestClient(app).post("/api/sessions/nope/read").status_code == 404


def test_legacy_session_loads_as_read() -> None:
    s = Session(id="x")
    s.add_message("user", "a")
    d = s.to_dict()
    d.pop("last_read_count")
    assert Session.from_dict(d).last_read_count == 1


def test_needs_input_reflects_pending_approval(app_and_mgr) -> None:
    import asyncio

    app, mgr = app_and_mgr
    client = TestClient(app)
    s = mgr.create(surface="dashboard", chat_id="web")
    assert _summary(client, s.id)["needs_input"] is False
    loop = asyncio.new_event_loop()
    try:
        app.state.pending_approvals["r1"] = loop.create_future()
        app.state.pending_approval_meta["r1"] = {"session_id": s.id}
        assert _summary(client, s.id)["needs_input"] is True
    finally:
        loop.close()


def test_cleanup_dry_run_then_apply(app_and_mgr) -> None:
    app, mgr = app_and_mgr
    client = TestClient(app)
    old = mgr.create(surface="dashboard", chat_id="web")
    old.updated_at = datetime.utcnow() - timedelta(days=30)
    pinned_old = mgr.create(surface="dashboard", chat_id="web")
    pinned_old.updated_at = datetime.utcnow() - timedelta(days=30)
    pinned_old.pinned = True
    fresh = mgr.create(surface="dashboard", chat_id="web")

    r = client.post("/api/sessions/cleanup", json={"max_inactive_days": 14})
    assert r.status_code == 200
    body = r.json()
    assert body["dry_run"] is True
    assert [c["id"] for c in body["sessions"]] == [old.id]
    assert old.archived is False

    r = client.post("/api/sessions/cleanup", json={"max_inactive_days": 14, "dry_run": False})
    assert r.json()["count"] == 1
    assert old.archived is True
    assert pinned_old.archived is False
    assert fresh.archived is False


def test_cleanup_rejects_bad_days(app_and_mgr) -> None:
    app, _ = app_and_mgr
    r = TestClient(app).post("/api/sessions/cleanup", json={"max_inactive_days": "x"})
    assert r.status_code == 400


def test_read_file_resolves_relative_to_workdir(app_and_mgr, tmp_path: Path) -> None:
    app, mgr = app_and_mgr
    work = tmp_path / "ws"
    work.mkdir()
    (work / "calc.py").write_text("x = 1\n")
    s = mgr.create(surface="dashboard", chat_id="web")
    s.work_dir = str(work)
    client = TestClient(app)
    r = client.get("/api/files/read", params={"path": "calc.py", "session_id": s.id})
    assert r.status_code == 200
    assert r.json()["content"] == "x = 1\n"
    # Escaping the work dir is still refused.
    r = client.get("/api/files/read", params={"path": "../../etc/hosts", "session_id": s.id})
    assert r.status_code == 400
    # No session → relative still refused.
    assert client.get("/api/files/read", params={"path": "calc.py"}).status_code == 400
