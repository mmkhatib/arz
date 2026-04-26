"""Surface manager — start configured surfaces and route their messages.

Reads ``ArzConfig`` to instantiate enabled surfaces (Slack/Telegram/WhatsApp),
then wires each surface's event stream through the ``MessageRouter`` into the
configured provider, and ships the response back via the surface's ``send``.
"""

from __future__ import annotations

import asyncio
import logging

from arz.acp.types import EVENT_COMPLETE, EVENT_TEXT_CHUNK
from arz.config.schema import ArzConfig
from arz.core.router import IncomingMessage as CoreIncoming
from arz.core.router import MessageRouter, OutgoingMessage as CoreOutgoing
from arz.surfaces.base import IncomingMessage as SurfaceIncoming
from arz.surfaces.base import MessagingSurface, OutgoingMessage as SurfaceOutgoing

log = logging.getLogger(__name__)


class SurfaceManager:
    """Owns the lifecycle of all messaging surfaces."""

    def __init__(self, config: ArzConfig, router: MessageRouter) -> None:
        self._config = config
        self._router = router
        self._surfaces: dict[str, MessagingSurface] = {}
        self._tasks: list[asyncio.Task] = []

    def _build(self) -> None:
        cfg = self._config
        if cfg.slack.enabled and cfg.slack.bot_token and cfg.slack.app_token and cfg.slack.owner_id:
            from arz.surfaces.slack import SlackSurface
            self._surfaces["slack"] = SlackSurface(
                bot_token=cfg.slack.bot_token,
                app_token=cfg.slack.app_token,
                owner_id=cfg.slack.owner_id,
            )
        if cfg.telegram.enabled and cfg.telegram.bot_token and cfg.telegram.owner_id:
            from arz.surfaces.telegram import TelegramSurface
            self._surfaces["telegram"] = TelegramSurface(
                bot_token=cfg.telegram.bot_token,
                owner_id=cfg.telegram.owner_id,
            )
        if (
            cfg.whatsapp.enabled
            and cfg.whatsapp.access_token
            and cfg.whatsapp.phone_number_id
            and cfg.whatsapp.owner_number
        ):
            from arz.surfaces.whatsapp import WhatsAppSurface
            self._surfaces["whatsapp"] = WhatsAppSurface(
                access_token=cfg.whatsapp.access_token,
                phone_number_id=cfg.whatsapp.phone_number_id,
                verify_token=cfg.whatsapp.verify_token,
                owner_number=cfg.whatsapp.owner_number,
            )

    async def start(self) -> None:
        self._build()
        if not self._surfaces:
            return
        for name, surface in self._surfaces.items():
            try:
                await surface.start()
                self._router.register_surface(name, _wrap_sender(surface))
                self._tasks.append(asyncio.create_task(self._consume(surface)))
            except Exception:
                log.exception("Failed to start surface %s", name)

    async def shutdown(self) -> None:
        for t in self._tasks:
            t.cancel()
        for surface in self._surfaces.values():
            try:
                await surface.shutdown()
            except Exception:
                log.exception("Surface shutdown failed: %s", surface.name)
        self._surfaces.clear()
        self._tasks.clear()

    def get(self, name: str) -> MessagingSurface | None:
        return self._surfaces.get(name)

    async def _consume(self, surface: MessagingSurface) -> None:
        """Forward each event through the router and reply via the surface."""
        try:
            async for event in surface.events():
                core_msg = CoreIncoming(
                    surface=event.surface,
                    chat_id=event.chat_id,
                    text=event.text,
                    thread_id=event.thread_id,
                    user_id=event.sender_id,
                    extra={"message_id": event.message_id},
                )
                try:
                    session = await self._router.handle(core_msg)
                    reply_text = await self._run_provider(event.text)
                    if reply_text:
                        from arz.session.session import Message
                        msg = session.add_message("assistant", reply_text)
                        # Best-effort: tag with current global model
                        msg.model = self._config.provider.model
                        await self._router.deliver(CoreOutgoing(
                            surface=event.surface,
                            chat_id=event.chat_id,
                            text=reply_text,
                            thread_id=event.thread_id,
                            extra={"reply_to_message_id": event.message_id},
                        ))
                except Exception:
                    log.exception("Surface %s message handling failed", surface.name)
        except asyncio.CancelledError:
            return

    async def _run_provider(self, prompt: str) -> str:
        """Spin up a fresh provider, run the prompt one-shot, return text."""
        cfg = self._config
        if cfg.provider.name == "claude-code":
            from arz.providers.claude_code import ClaudeCodeProvider
            provider = ClaudeCodeProvider(model=cfg.provider.model, work_dir=cfg.provider.work_dir)
        elif cfg.provider.name == "kiro-cli":
            from arz.providers.kiro_cli import KiroCliProvider
            provider = KiroCliProvider(model=cfg.provider.model, work_dir=cfg.provider.work_dir)
        else:
            return ""

        full = ""
        try:
            await provider.start()
            async for ev in provider.stream(prompt):
                if ev.kind == EVENT_TEXT_CHUNK and ev.text:
                    full += ev.text
                elif ev.kind == EVENT_COMPLETE:
                    break
        finally:
            try:
                await provider.shutdown()
            except Exception:
                pass
        return full


def _wrap_sender(surface: MessagingSurface):
    """Adapt the core OutgoingMessage shape to the surface's send method."""

    async def sender(msg: CoreOutgoing) -> None:
        out = SurfaceOutgoing(
            chat_id=msg.chat_id,
            text=msg.text,
            thread_id=msg.thread_id,
            reply_to_message_id=msg.extra.get("reply_to_message_id") if msg.extra else None,
        )
        await surface.send(out)

    return sender
