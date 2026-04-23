"""LRU pool of LLMProvider instances — one per active Arz session.

At most `max_size` providers are alive at once. When a new session needs
a provider and the pool is full, the least-recently-used one is shut down
first. Switching back to a sleeping session wakes it by re-running the
provider factory (which uses --continue so the underlying CLI resumes
from its own saved history).
"""

from __future__ import annotations

import asyncio
from collections import OrderedDict
from collections.abc import Callable, Coroutine
from typing import Any, TypeVar

import structlog

from arz.providers.base import LLMProvider

log = structlog.get_logger(__name__)

T = TypeVar("T", bound=LLMProvider)
Factory = Callable[[], LLMProvider]


class ProviderPool:
    """LRU pool capping concurrent active LLMProvider instances."""

    def __init__(self, max_size: int = 5) -> None:
        self.max_size = max_size
        self._pool: OrderedDict[str, LLMProvider] = OrderedDict()

    # ── public ──────────────────────────────────────────────────────────────

    async def activate(self, session_id: str, factory: Factory) -> LLMProvider:
        """Return the provider for *session_id*, creating it if needed.

        If the pool is full, the LRU entry is evicted first.
        Marks *session_id* as most-recently used.
        """
        if session_id in self._pool:
            self._pool.move_to_end(session_id)
            return self._pool[session_id]

        if len(self._pool) >= self.max_size:
            await self._evict_lru()

        provider = factory()
        await provider.start()
        self._pool[session_id] = provider
        log.info("Provider activated", session_id=session_id, active=len(self._pool))
        return provider

    async def deactivate(self, session_id: str) -> None:
        """Explicitly put a session to sleep (shutdown its provider)."""
        provider = self._pool.pop(session_id, None)
        if provider:
            await provider.shutdown()
            log.info("Provider deactivated", session_id=session_id)

    async def shutdown_all(self) -> None:
        """Shut down every active provider (called on gateway shutdown)."""
        ids = list(self._pool.keys())
        await asyncio.gather(*(self._pool[sid].shutdown() for sid in ids), return_exceptions=True)
        self._pool.clear()

    def active_count(self) -> int:
        return len(self._pool)

    def active_ids(self) -> list[str]:
        return list(self._pool.keys())

    # ── private ─────────────────────────────────────────────────────────────

    async def _evict_lru(self) -> None:
        lru_id, lru_provider = next(iter(self._pool.items()))
        del self._pool[lru_id]
        try:
            await lru_provider.shutdown()
        except Exception:
            pass
        log.info("LRU provider evicted", session_id=lru_id, remaining=len(self._pool))
