"""Tests for session model and manager."""

from __future__ import annotations

import json
import tempfile
from pathlib import Path

import pytest

from arz.session.session import Message, Session
from arz.session.manager import SessionManager


def _make_manager() -> tuple[SessionManager, Path]:
    tmp = Path(tempfile.mkdtemp())
    return SessionManager(sessions_dir=tmp), tmp


def test_session_add_message_sets_title() -> None:
    session = Session()
    assert session.title == "New session"
    session.add_message("user", "Hello Arzeh!")
    assert session.title == "Hello Arzeh!"


def test_session_add_message_appends() -> None:
    session = Session()
    session.add_message("user", "hi")
    session.add_message("assistant", "hello")
    assert len(session.messages) == 2
    assert session.messages[0].role == "user"
    assert session.messages[1].role == "assistant"


def test_session_roundtrip() -> None:
    session = Session(title="test", surface="slack", chat_id="C123")
    session.add_message("user", "ping")
    session.add_message("assistant", "pong")
    restored = Session.from_dict(session.to_dict())
    assert restored.id == session.id
    assert restored.title == "test"  # explicitly-set title preserved through roundtrip
    assert len(restored.messages) == 2


def test_manager_create_and_get() -> None:
    mgr, _ = _make_manager()
    session = mgr.create(surface="cli", chat_id="default")
    assert mgr.get(session.id) is session
    assert mgr.get("nonexistent") is None


def test_manager_get_or_create_returns_same() -> None:
    mgr, _ = _make_manager()
    s1 = mgr.get_or_create(surface="slack", chat_id="C123", thread_id=None)
    s2 = mgr.get_or_create(surface="slack", chat_id="C123", thread_id=None)
    assert s1.id == s2.id


def test_manager_list_active_sorts() -> None:
    mgr, _ = _make_manager()
    s1 = mgr.create()
    s2 = mgr.create()
    s2.add_message("user", "newer")
    active = mgr.list_active()
    assert active[0].id == s2.id


def test_manager_save_and_load(tmp_path: Path) -> None:
    mgr = SessionManager(sessions_dir=tmp_path)
    session = mgr.create(surface="telegram", chat_id="999")
    session.add_message("user", "hello")
    mgr.save(session)

    mgr2 = SessionManager(sessions_dir=tmp_path)
    count = mgr2.load_all()
    assert count == 1
    loaded = mgr2.get(session.id)
    assert loaded is not None
    assert loaded.surface == "telegram"
    assert len(loaded.messages) == 1


def test_manager_close(tmp_path: Path) -> None:
    mgr = SessionManager(sessions_dir=tmp_path)
    session = mgr.create()
    mgr.close(session.id)
    assert not session.active
    assert (tmp_path / f"{session.id}.json").exists()
