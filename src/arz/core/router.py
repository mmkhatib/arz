"""Cross-surface message router.

`MessageRouter` is the seam between any messaging surface (dashboard, Slack,
Telegram, WhatsApp, TUI) and the LLM provider layer. Surfaces translate
platform-specific events into ``IncomingMessage``; the router resolves the
session, dispatches to the configured provider, and emits ``OutgoingMessage``
back to the surface.

Owner-lock and authorization are enforced **before** ``handle()`` is called —
each surface adapter is responsible for its own ``is_authorized()`` gate.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Awaitable, Callable

from arz.core.event_bus import Event, EventBus
from arz.session.manager import SessionManager
from arz.session.session import Session

log = logging.getLogger(__name__)


@dataclass
class IncomingMessage:
    """A normalized message arriving from any surface."""

    surface: str  # "dashboard", "slack", "telegram", ...
    chat_id: str
    text: str
    thread_id: str | None = None
    user_id: str | None = None
    received_at: datetime = field(default_factory=datetime.utcnow)
    extra: dict[str, Any] = field(default_factory=dict)


@dataclass
class OutgoingMessage:
    """A reply or notification destined for a surface."""

    surface: str
    chat_id: str
    text: str
    thread_id: str | None = None
    extra: dict[str, Any] = field(default_factory=dict)


# Surface adapters register a sender callable so the router can deliver replies.
SurfaceSender = Callable[[OutgoingMessage], Awaitable[None]]


class MessageRouter:
    """Routes IncomingMessage → provider → OutgoingMessage.

    The router does not itself instantiate providers — that wiring lives in
    the dashboard server today. As phases land, providers will move behind a
    pluggable factory injected here. For now this class encapsulates the
    surface routing seam so surfaces can be added without coupling them to
    each other or to the dashboard.
    """

    def __init__(self, session_manager: SessionManager, event_bus: EventBus | None = None) -> None:
        self._sessions = session_manager
        self._bus = event_bus or EventBus()
        self._senders: dict[str, SurfaceSender] = {}

    @property
    def event_bus(self) -> EventBus:
        return self._bus

    def register_surface(self, surface: str, sender: SurfaceSender) -> None:
        """Register a callback the router will use to deliver messages back."""
        self._senders[surface] = sender

    def session_for(self, msg: IncomingMessage) -> Session:
        return self._sessions.get_or_create(
            surface=msg.surface, chat_id=msg.chat_id, thread_id=msg.thread_id
        )

    async def deliver(self, msg: OutgoingMessage) -> None:
        """Send ``msg`` to its surface; raises if the surface isn't registered."""
        sender = self._senders.get(msg.surface)
        if sender is None:
            raise RuntimeError(f"No sender registered for surface {msg.surface!r}")
        await sender(msg)
        await self._bus.post(Event(kind="message_sent", payload={"surface": msg.surface}, source="router"))

    async def handle(self, msg: IncomingMessage) -> Session:
        """Record an incoming message on its session and emit a bus event.

        Concrete provider dispatch is layered on top by the dashboard or other
        callers — this hook records history and lets observers (audit, search
        index, analytics) pick the event up.
        """
        session = self.session_for(msg)
        session.add_message("user", msg.text)
        self._sessions.save(session)
        await self._bus.post(
            Event(
                kind="message_received",
                payload={"surface": msg.surface, "session_id": session.id, "user_id": msg.user_id},
                source="router",
            )
        )
        return session
