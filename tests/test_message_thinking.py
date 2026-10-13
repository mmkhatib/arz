"""Persisted reasoning on assistant messages (collapsible Thinking block)."""

from __future__ import annotations

from arz.dashboard.stream_registry import StreamState
from arz.session.session import Message, Session


def test_thinking_roundtrips_through_session_json() -> None:
    s = Session()
    msg = s.add_message("assistant", "answer")
    msg.thinking = "let me check the config first"
    restored = Session.from_dict(s.to_dict())
    assert restored.messages[0].thinking == "let me check the config first"


def test_thinking_omitted_when_empty() -> None:
    msg = Message(role="assistant", text="hi")
    assert "thinking" not in msg.to_dict()
    assert Message.from_dict(msg.to_dict()).thinking is None


def test_stream_state_starts_with_empty_thinking() -> None:
    assert StreamState(session_id="x").thinking == ""
