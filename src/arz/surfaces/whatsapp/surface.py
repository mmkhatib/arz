"""WhatsApp surface — Meta Cloud API skeleton.

WhatsApp's Cloud API is webhook-based, which means the gateway has to be
reachable on a public URL with a valid certificate. This skeleton implements
the contract but the inbound side requires a webhook route mounted on the
dashboard FastAPI app — wire it in when actually deploying.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator

import httpx

from arz.surfaces.base import IncomingMessage, MessagingSurface, OutgoingMessage

log = logging.getLogger(__name__)

_API_BASE = "https://graph.facebook.com/v22.0"


class WhatsAppSurface(MessagingSurface):
    name = "whatsapp"

    def __init__(
        self,
        access_token: str,
        phone_number_id: str,
        verify_token: str,
        owner_number: str,
    ) -> None:
        self._access_token = access_token
        self._phone_number_id = phone_number_id
        self._verify_token = verify_token
        self._owner_number = owner_number  # E.164 without '+', e.g. "12025551234"
        self._queue: asyncio.Queue[IncomingMessage] = asyncio.Queue()
        self._client: httpx.AsyncClient | None = None

    def is_authorized(self, sender_id: str) -> bool:
        return bool(self._owner_number) and sender_id == self._owner_number

    async def start(self) -> None:
        self._client = httpx.AsyncClient(
            timeout=httpx.Timeout(30.0),
            headers={"Authorization": f"Bearer {self._access_token}"},
        )
        log.info("WhatsApp surface started — webhook must be wired separately")

    async def shutdown(self) -> None:
        if self._client is not None:
            await self._client.aclose()

    async def events(self) -> AsyncIterator[IncomingMessage]:  # type: ignore[override]
        while True:
            yield await self._queue.get()

    async def send(self, message: OutgoingMessage) -> str:
        assert self._client is not None
        url = f"{_API_BASE}/{self._phone_number_id}/messages"
        body = {
            "messaging_product": "whatsapp",
            "to": message.chat_id,
            "type": "text",
            "text": {"body": message.text},
        }
        resp = await self._client.post(url, json=body)
        resp.raise_for_status()
        data = resp.json()
        return data.get("messages", [{}])[0].get("id", "")

    async def edit(self, chat_id: str, message_id: str, text: str) -> None:
        # WhatsApp Cloud API does not support editing sent messages.
        log.debug("WhatsApp edit not supported; ignoring")

    async def react(self, chat_id: str, message_id: str, emoji: str) -> None:
        assert self._client is not None
        url = f"{_API_BASE}/{self._phone_number_id}/messages"
        body = {
            "messaging_product": "whatsapp",
            "to": chat_id,
            "type": "reaction",
            "reaction": {"message_id": message_id, "emoji": emoji},
        }
        try:
            resp = await self._client.post(url, json=body)
            resp.raise_for_status()
        except Exception:
            log.debug("WhatsApp react failed (%s)", emoji)

    async def typing(self, chat_id: str) -> None:
        # No typing-indicator API in WhatsApp Cloud.
        return None

    # ── Webhook helpers (called by FastAPI route) ─────────────────────────

    def verify_webhook(self, mode: str, token: str, challenge: str) -> str | None:
        """Meta verify-mode handshake. Return ``challenge`` to confirm."""
        if mode == "subscribe" and token == self._verify_token:
            return challenge
        return None

    async def push_webhook(self, payload: dict) -> None:
        """Translate a webhook payload into IncomingMessage events on the queue."""
        for entry in payload.get("entry", []):
            for change in entry.get("changes", []):
                value = change.get("value", {})
                contacts = {
                    c.get("wa_id"): c.get("profile", {}).get("name", "")
                    for c in value.get("contacts", [])
                }
                for m in value.get("messages", []):
                    sender = m.get("from", "")
                    if not self.is_authorized(sender):
                        log.info("WhatsApp: ignoring message from unauthorized sender %s", sender)
                        continue
                    text = ""
                    if m.get("type") == "text":
                        text = m.get("text", {}).get("body", "")
                    await self._queue.put(
                        IncomingMessage(
                            surface="whatsapp",
                            chat_id=sender,
                            thread_id=None,
                            message_id=m.get("id", ""),
                            sender_id=sender,
                            sender_display_name=contacts.get(sender, sender),
                            text=text,
                            attachments=[],
                            raw=m,
                        )
                    )
