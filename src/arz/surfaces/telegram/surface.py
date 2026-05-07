"""Telegram surface — aiogram 3.x adapter.

Long-polling Bot API client. Owner-lock checks ``message.from_user.id`` against
``config.telegram.owner_id``.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator

from arz.surfaces.base import IncomingMessage, MessagingSurface, OutgoingMessage

log = logging.getLogger(__name__)


class TelegramSurface(MessagingSurface):
    name = "telegram"

    def __init__(self, bot_token: str, owner_id: str) -> None:
        self._token = bot_token
        self._owner_id = str(owner_id)
        self._queue: asyncio.Queue[IncomingMessage] = asyncio.Queue()
        self._bot = None
        self._dp = None
        self._poll_task: asyncio.Task | None = None

    def is_authorized(self, sender_id: str) -> bool:
        return bool(self._owner_id) and str(sender_id) == self._owner_id

    async def start(self) -> None:
        from aiogram import Bot, Dispatcher
        from aiogram.types import Message

        self._bot = Bot(token=self._token)
        self._dp = Dispatcher()

        @self._dp.message()
        async def on_message(message: Message) -> None:
            sender = str(message.from_user.id) if message.from_user else ""
            if not self.is_authorized(sender):
                log.info("Telegram: ignoring message from unauthorized sender %s", sender)
                return
            await self._queue.put(
                IncomingMessage(
                    surface="telegram",
                    chat_id=str(message.chat.id),
                    thread_id=str(message.message_thread_id) if message.message_thread_id else None,
                    message_id=str(message.message_id),
                    sender_id=sender,
                    sender_display_name=message.from_user.full_name
                    if message.from_user
                    else sender,
                    text=message.text or message.caption or "",
                    attachments=[],
                    raw=message.model_dump(),
                )
            )

        self._poll_task = asyncio.create_task(self._dp.start_polling(self._bot))
        log.info("Telegram surface started")

    async def shutdown(self) -> None:
        if self._dp is not None:
            try:
                await self._dp.stop_polling()
            except Exception:
                log.exception("Telegram dispatcher stop failed")
        if self._bot is not None:
            try:
                await self._bot.session.close()
            except Exception:
                pass
        log.info("Telegram surface stopped")

    async def events(self) -> AsyncIterator[IncomingMessage]:  # type: ignore[override]
        while True:
            yield await self._queue.get()

    async def send(self, message: OutgoingMessage) -> str:
        assert self._bot is not None
        kwargs: dict = {"chat_id": int(message.chat_id), "text": message.text}
        if message.thread_id:
            kwargs["message_thread_id"] = int(message.thread_id)
        if message.reply_to_message_id:
            kwargs["reply_to_message_id"] = int(message.reply_to_message_id)
        sent = await self._bot.send_message(**kwargs)
        return str(sent.message_id)

    async def edit(self, chat_id: str, message_id: str, text: str) -> None:
        assert self._bot is not None
        await self._bot.edit_message_text(
            chat_id=int(chat_id), message_id=int(message_id), text=text
        )

    async def react(self, chat_id: str, message_id: str, emoji: str) -> None:
        # Bot API supports message reactions via setMessageReaction (Telegram >= 7.0)
        assert self._bot is not None
        try:
            await self._bot.set_message_reaction(
                chat_id=int(chat_id),
                message_id=int(message_id),
                reaction=[{"type": "emoji", "emoji": emoji.strip(":")}],
            )
        except Exception:
            log.debug("Telegram react failed (%s)", emoji)

    async def typing(self, chat_id: str) -> None:
        assert self._bot is not None
        try:
            await self._bot.send_chat_action(chat_id=int(chat_id), action="typing")
        except Exception:
            pass
