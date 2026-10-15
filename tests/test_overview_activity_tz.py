"""Overview activity fallback: naive-UTC message timestamps → correct epoch."""

from __future__ import annotations

import time
from pathlib import Path

from fastapi.testclient import TestClient

from arz.config.loader import load_config
from arz.dashboard.audit import AuditLog
from arz.dashboard.server import create_app
from arz.providers.pool import ProviderPool
from arz.session.manager import SessionManager


def test_fallback_activity_ts_is_utc(tmp_path: Path) -> None:
    config = load_config()
    config.dashboard.token_auth = False
    app = create_app(config, ProviderPool(max_size=1))
    app.state.session_manager = SessionManager(sessions_dir=tmp_path / "s")
    app.state.audit_log = AuditLog(tmp_path / "audit.db")  # empty → message fallback
    s = app.state.session_manager.create(surface="dashboard", chat_id="web")
    s.add_message("user", "hello")

    rows = TestClient(app).get("/api/overview").json()["recent_activity"]
    assert rows, "fallback should surface the message"
    # Created moments ago: must not land hours in the future (local-time misread).
    assert abs(time.time() - rows[0]["ts"]) < 120
