"""Tests for the <recent-sessions> always-on block + ghost purge."""

from __future__ import annotations

import datetime as dt
import json
from pathlib import Path


def _write_session(d: Path, sid: str, *, title: str, msgs: int, updated: dt.datetime) -> Path:
    p = d / f"{sid}.json"
    p.write_text(
        json.dumps(
            {
                "id": sid,
                "title": title,
                "surface": "dashboard",
                "chat_id": "web",
                "messages": [
                    {"role": "user", "text": f"msg {i}", "created_at": updated.isoformat()}
                    for i in range(msgs)
                ],
                "created_at": updated.isoformat(),
                "updated_at": updated.isoformat(),
                "active": True,
            }
        )
    )
    # Set mtime so purge_ghosts cutoff behaves predictably.
    import os

    os.utime(p, (updated.timestamp(), updated.timestamp()))
    return p


def test_recent_sessions_block_groups_by_day(monkeypatch, tmp_path):
    from arz.memory import context

    monkeypatch.setattr(Path, "home", classmethod(lambda cls: tmp_path))
    sessions_dir = tmp_path / ".arz" / "sessions"
    sessions_dir.mkdir(parents=True)
    today = dt.datetime.now()
    _write_session(sessions_dir, "a", title="Auth refactor", msgs=5, updated=today)
    _write_session(sessions_dir, "b", title="Memory work", msgs=3, updated=today)
    out = context._recent_sessions_block(days=7)
    assert "<recent-sessions>" in out
    assert "(today)" in out
    assert "Auth refactor" in out
    assert "Memory work" in out


def test_recent_sessions_block_skips_ghosts(monkeypatch, tmp_path):
    from arz.memory import context

    monkeypatch.setattr(Path, "home", classmethod(lambda cls: tmp_path))
    sessions_dir = tmp_path / ".arz" / "sessions"
    sessions_dir.mkdir(parents=True)
    today = dt.datetime.now()
    _write_session(sessions_dir, "ghost", title="New session", msgs=0, updated=today)
    _write_session(sessions_dir, "real", title="Real work", msgs=2, updated=today)
    out = context._recent_sessions_block(days=7)
    assert "Real work" in out
    assert "New session" not in out


def test_recent_sessions_block_fallback_when_all_old(monkeypatch, tmp_path):
    """If no sessions in window, fall back to most-recent-ever."""
    from arz.memory import context

    monkeypatch.setattr(Path, "home", classmethod(lambda cls: tmp_path))
    sessions_dir = tmp_path / ".arz" / "sessions"
    sessions_dir.mkdir(parents=True)
    old = dt.datetime.now() - dt.timedelta(days=60)
    _write_session(sessions_dir, "old1", title="Old work", msgs=4, updated=old)
    out = context._recent_sessions_block(days=14)
    assert "No sessions in the last 14 days" in out
    assert "Old work" in out


def test_recent_sessions_block_empty_when_dir_missing(monkeypatch, tmp_path):
    from arz.memory import context

    monkeypatch.setattr(Path, "home", classmethod(lambda cls: tmp_path))
    # No sessions dir at all.
    out = context._recent_sessions_block()
    assert out == ""


def test_purge_ghosts_removes_only_old_empties(tmp_path):
    from arz.session.manager import SessionManager

    mgr = SessionManager(sessions_dir=tmp_path)
    now = dt.datetime.now()
    old = now - dt.timedelta(hours=2)
    fresh = now - dt.timedelta(minutes=10)
    _write_session(tmp_path, "ghost-old", title="New session", msgs=0, updated=old)
    _write_session(tmp_path, "ghost-fresh", title="New session", msgs=0, updated=fresh)
    _write_session(tmp_path, "real-old", title="Real", msgs=5, updated=old)
    deleted = mgr.purge_ghosts(older_than_minutes=60)
    assert deleted == 1
    assert not (tmp_path / "ghost-old.json").exists()
    # Fresh ghost stays (might be a warm-pool slot still in use).
    assert (tmp_path / "ghost-fresh.json").exists()
    # Real session always survives.
    assert (tmp_path / "real-old.json").exists()


def test_fts_indexes_sessions(monkeypatch, tmp_path):
    from arz.memory import fts as fts_mod

    monkeypatch.setattr(fts_mod, "_SESSIONS_DIR", tmp_path / "sessions")
    monkeypatch.setattr(fts_mod, "_DB_PATH", tmp_path / "fts.db")
    monkeypatch.setattr(fts_mod, "_MEMORY_DIR", tmp_path / "memory")
    monkeypatch.setattr(fts_mod, "_LESSONS_PATH", tmp_path / "lessons.jsonl")
    monkeypatch.setattr(fts_mod, "_MARKDOWN_DIR", tmp_path / "markdown")

    sessions_dir = tmp_path / "sessions"
    sessions_dir.mkdir()
    _write_session(
        sessions_dir,
        "abc",
        title="Auth middleware refactor",
        msgs=3,
        updated=dt.datetime.now(),
    )

    idx = fts_mod.MemoryFTS()
    counts = idx.reindex(force=True)
    assert counts["sessions"] == 1
    hits = idx.search("auth", source="sessions", k=5)
    assert len(hits) >= 1
    assert "Auth middleware" in hits[0]["title"]
