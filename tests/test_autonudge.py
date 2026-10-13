"""AutoNudge idle detection."""

from __future__ import annotations

import asyncio
import os
import time
from datetime import datetime, timedelta
from pathlib import Path

import pytest

from arz.autonudge import AutoNudge
from arz.session.manager import SessionManager


@pytest.fixture()
def west_of_utc():
    """Run in a timezone where naive-UTC-as-local puts timestamps in the future."""
    old = os.environ.get("TZ")
    os.environ["TZ"] = "America/Los_Angeles"
    time.tzset()
    yield
    if old is None:
        os.environ.pop("TZ", None)
    else:
        os.environ["TZ"] = old
    time.tzset()


def test_fires_for_idle_session_west_of_utc(tmp_path: Path, west_of_utc) -> None:
    mgr = SessionManager(sessions_dir=tmp_path)
    s = mgr.create(surface="dashboard", chat_id="web")
    s.autonudge_goal = "ship it"
    s.autonudge_idle_s = 60
    s.updated_at = datetime.utcnow() - timedelta(minutes=5)
    fired: list[str] = []

    async def runner(sid: str, msg: str) -> None:
        fired.append(sid)

    async def go() -> None:
        nudge = AutoNudge(mgr, runner)
        await nudge._tick()  # noqa: SLF001
        await asyncio.sleep(0)
        await asyncio.sleep(0)

    asyncio.run(go())
    assert fired == [s.id]
    assert s.autonudge_iterations == 1


def test_skips_recently_active_session(tmp_path: Path) -> None:
    mgr = SessionManager(sessions_dir=tmp_path)
    s = mgr.create(surface="dashboard", chat_id="web")
    s.autonudge_goal = "ship it"
    s.autonudge_idle_s = 600
    fired: list[str] = []

    async def runner(sid: str, msg: str) -> None:
        fired.append(sid)

    asyncio.run(AutoNudge(mgr, runner)._tick())  # noqa: SLF001
    assert fired == []
