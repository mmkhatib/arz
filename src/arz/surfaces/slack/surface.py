"""Slack surface — slack-bolt Socket Mode adapter.

Connects via app-level token (Socket Mode), enforces owner-lock against
``config.slack.owner_id`` on every event before emitting it, and translates
Slack events into the shared :class:`IncomingMessage` shape.

Configuration in ``~/.arz/config.toml``:

    [slack]
    enabled = true
    bot_token = "xoxb-…"
    app_token = "xapp-…"
    owner_id  = "U0123456"
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator

from arz.surfaces.base import IncomingMessage, MessagingSurface, OutgoingMessage

log = logging.getLogger(__name__)


class SlackSurface(MessagingSurface):
    name = "slack"

    def __init__(self, bot_token: str, app_token: str, owner_id: str) -> None:
        self._bot_token = bot_token
        self._app_token = app_token
        self._owner_id = owner_id
        self._queue: asyncio.Queue[IncomingMessage] = asyncio.Queue()
        self._app = None
        self._handler = None
        self._client = None

    def is_authorized(self, sender_id: str) -> bool:
        return bool(self._owner_id) and sender_id == self._owner_id

    async def start(self) -> None:
        # Lazy-import slack-bolt so the rest of the runtime works without it.
        from slack_bolt.adapter.socket_mode.async_handler import AsyncSocketModeHandler
        from slack_bolt.async_app import AsyncApp

        app = AsyncApp(token=self._bot_token)

        @app.event("message")
        async def on_message(body, say):  # type: ignore[no-untyped-def]
            event = body.get("event") or {}
            if event.get("subtype") in ("bot_message", "message_changed", "message_deleted"):
                return
            sender = event.get("user", "")
            if not self.is_authorized(sender):
                log.info("Slack: ignoring message from unauthorized sender %s", sender)
                return
            msg = IncomingMessage(
                surface="slack",
                chat_id=event.get("channel", ""),
                thread_id=event.get("thread_ts"),
                message_id=event.get("ts", ""),
                sender_id=sender,
                sender_display_name=event.get("user", ""),
                text=event.get("text", ""),
                attachments=[
                    f.get("url_private", "") for f in event.get("files", []) if f.get("url_private")
                ],
                raw=event,
            )
            await self._queue.put(msg)

        @app.event("app_mention")
        async def on_mention(body, say):  # type: ignore[no-untyped-def]
            await on_message(body, say)

        self._app = app
        self._client = app.client
        self._handler = AsyncSocketModeHandler(app, self._app_token)
        # start_async() blocks; run it as a task and return so caller can iterate events
        asyncio.create_task(self._handler.start_async())
        log.info("Slack surface started")

    async def shutdown(self) -> None:
        if self._handler is not None:
            try:
                await self._handler.close_async()
            except Exception:
                log.exception("Slack handler close failed")
        log.info("Slack surface stopped")

    async def events(self) -> AsyncIterator[IncomingMessage]:  # type: ignore[override]
        while True:
            yield await self._queue.get()

    async def send(self, message: OutgoingMessage) -> str:
        assert self._client is not None, "start() must be called first"
        kwargs: dict = {"channel": message.chat_id, "text": message.text}
        if message.thread_id:
            kwargs["thread_ts"] = message.thread_id
        if message.blocks:
            kwargs["blocks"] = message.blocks
        resp = await self._client.chat_postMessage(**kwargs)
        return resp.get("ts", "")

    async def edit(self, chat_id: str, message_id: str, text: str) -> None:
        assert self._client is not None
        await self._client.chat_update(channel=chat_id, ts=message_id, text=text)

    async def react(self, chat_id: str, message_id: str, emoji: str) -> None:
        assert self._client is not None
        try:
            await self._client.reactions_add(
                channel=chat_id, timestamp=message_id, name=emoji.strip(":")
            )
        except Exception:
            # Reacting twice with the same emoji is a 200-with-error from Slack
            log.debug("Slack react failed (%s)", emoji)

    async def typing(self, chat_id: str) -> None:
        # Socket Mode does not expose typing events to bots; best-effort no-op.
        return None
