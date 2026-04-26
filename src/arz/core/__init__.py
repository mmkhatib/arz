"""Arz core — session lifecycle, message routing, event bus.

`core/` is the dependency root: `providers/`, `surfaces/`, `dashboard/`, and
`tools/` depend **inward** on `core/`, never on each other. `core/` itself
imports nothing from those packages — keep it that way.

For now this package re-exports the existing session implementations so
internal callers can migrate to `arz.core.X` without behavior changes.
Physical relocation of session modules into this package can happen
incrementally.
"""

from __future__ import annotations

from arz.core.event_bus import Event, EventBus
from arz.core.router import IncomingMessage, MessageRouter, OutgoingMessage
from arz.session.manager import SessionManager
from arz.session.session import Message, Session
from arz.session.session_map import SessionMap

__all__ = [
    "Event",
    "EventBus",
    "IncomingMessage",
    "Message",
    "MessageRouter",
    "OutgoingMessage",
    "Session",
    "SessionManager",
    "SessionMap",
]
