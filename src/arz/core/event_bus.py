"""Lightweight pub/sub event bus.

Used by surfaces, providers, and the dashboard to coordinate without direct
imports of each other. All handlers run on the asyncio loop; sync-only callers
can use ``post_sync`` which schedules with ``loop.call_soon_threadsafe``.
"""

from __future__ import annotations

import asyncio
import logging
from collections import defaultdict
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any

log = logging.getLogger(__name__)

EventHandler = Callable[["Event"], Awaitable[None] | None]


@dataclass(frozen=True)
class Event:
    """A single event flowing on the bus."""

    kind: str
    payload: dict[str, Any] = field(default_factory=dict)
    source: str = ""


class EventBus:
    """Async pub/sub. Subscribers may be sync or async functions."""

    def __init__(self) -> None:
        self._subs: dict[str, list[EventHandler]] = defaultdict(list)
        self._global: list[EventHandler] = []

    def subscribe(self, kind: str, handler: EventHandler) -> Callable[[], None]:
        """Register ``handler`` for events of ``kind``. Returns an unsubscribe fn."""
        self._subs[kind].append(handler)

        def unsubscribe() -> None:
            try:
                self._subs[kind].remove(handler)
            except ValueError:
                pass

        return unsubscribe

    def subscribe_all(self, handler: EventHandler) -> Callable[[], None]:
        """Register ``handler`` for ALL events. Useful for logging/audit."""
        self._global.append(handler)

        def unsubscribe() -> None:
            try:
                self._global.remove(handler)
            except ValueError:
                pass

        return unsubscribe

    async def post(self, event: Event) -> None:
        """Dispatch ``event`` to all matching subscribers, awaiting async ones."""
        handlers = list(self._subs.get(event.kind, ())) + list(self._global)
        for h in handlers:
            try:
                result = h(event)
                if asyncio.iscoroutine(result):
                    await result
            except Exception:
                log.exception("EventBus handler failed for %s", event.kind)

    def post_sync(self, event: Event) -> None:
        """Schedule ``event`` dispatch onto the running loop from sync code."""
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            log.debug("EventBus.post_sync called with no running loop; dropping %s", event.kind)
            return
        loop.create_task(self.post(event))
