"""Platform-agnostic messaging surface abstraction.

Every messaging platform (Slack, Telegram, WhatsApp, and future additions)
implements :class:`MessagingSurface`. Arz core speaks only this interface —
platform SDKs do not leak beyond ``arz.surfaces.<platform>.*``.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Any


@dataclass
class IncomingMessage:
    """A message arriving from a messaging surface."""

    surface: str  # "slack" | "telegram" | "whatsapp"
    chat_id: str  # channel / group / DM identifier
    thread_id: str | None  # thread-ts, reply-to-message-id, etc.
    message_id: str  # platform-assigned message ID
    sender_id: str  # platform user ID
    sender_display_name: str
    text: str
    attachments: list[str] = field(default_factory=list)
    raw: dict[str, Any] = field(default_factory=dict)


@dataclass
class OutgoingMessage:
    """A reply or outbound message the runtime wants to send."""

    chat_id: str
    text: str
    thread_id: str | None = None
    reply_to_message_id: str | None = None
    blocks: list[dict[str, Any]] | None = None  # Block Kit / platform-specific rich content


class MessagingSurface(ABC):
    """Abstract messaging-platform adapter.

    Implementations live in ``arz.surfaces.<name>``. Each instance owns one
    connection to one platform and emits :class:`IncomingMessage` objects via
    :meth:`events`.
    """

    name: str = "unknown"

    @abstractmethod
    async def start(self) -> None:
        """Connect to the platform (open socket, start webhook listener, etc.)."""

    @abstractmethod
    async def shutdown(self) -> None:
        """Disconnect cleanly."""

    @abstractmethod
    def events(self) -> AsyncIterator[IncomingMessage]:
        """Async iterator of inbound messages. Must yield only authorized senders."""

    @abstractmethod
    async def send(self, message: OutgoingMessage) -> str:
        """Send a message; return the platform-assigned message ID."""

    @abstractmethod
    async def edit(self, chat_id: str, message_id: str, text: str) -> None:
        """Edit a previously sent message."""

    @abstractmethod
    async def react(self, chat_id: str, message_id: str, emoji: str) -> None:
        """Add a reaction to a message."""

    @abstractmethod
    async def typing(self, chat_id: str) -> None:
        """Show a typing indicator (best effort — silently ignored if unsupported)."""

    @abstractmethod
    def is_authorized(self, sender_id: str) -> bool:
        """Owner-lock check.

        MUST be called on every inbound message before emitting via :meth:`events`.
        Never optional — surfaces that skip this are a security bug.
        """
