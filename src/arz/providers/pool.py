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

    # Sentinel session_id used for warm-pool entries waiting to be claimed.
    # The key is unique per pre-spawn so multiple warm slots coexist.
    WARM_PREFIX = "__warm__:"

    def __init__(self, max_size: int = 5) -> None:
        self.max_size = max_size
        self._pool: OrderedDict[str, LLMProvider] = OrderedDict()
        self._warm: list[LLMProvider] = []  # ready-to-claim, no session yet

    # ── public ──────────────────────────────────────────────────────────────

    async def activate(self, session_id: str, factory: Factory) -> LLMProvider:
        """Return the provider for *session_id*, creating it if needed.

        If the pool is full, the LRU entry is evicted first.
        Marks *session_id* as most-recently used.

        Lossless resume: a stale entry whose backing process has died
        (idle-killed, crashed, OOM-reaped, etc.) is silently re-created.
        The caller's factory is responsible for wiring the prior native
        session ID via SessionMap so conversation history survives.
        """
        existing = self._pool.get(session_id)
        if existing is not None:
            if existing.is_alive():
                self._pool.move_to_end(session_id)
                return existing
            log.info(
                "Provider in pool but dead — re-creating",
                session_id=session_id,
                provider=existing.name,
            )
            del self._pool[session_id]
            try:
                await existing.shutdown()
            except Exception:
                pass

        if len(self._pool) >= self.max_size:
            await self._evict_lru()

        provider = factory()
        await provider.start()
        self._pool[session_id] = provider
        log.info("Provider activated", session_id=session_id, active=len(self._pool))
        try:
            from arz.reaper import get_reaper

            get_reaper().register(provider.pid, provider.name)
        except Exception:
            log.warning("Reaper register failed", exc_info=True)
        return provider

    async def deactivate(self, session_id: str) -> None:
        """Put a session to sleep — shut down the process only.

        This is *not* the same as destroying a session. Conversation
        history (in ``SessionManager``) and the native CLI session ID
        (in ``SessionMap``) are deliberately NOT touched here, so the
        next user message can resume seamlessly. Callers that want to
        delete a session entirely must remove those records explicitly.
        """
        provider = self._pool.pop(session_id, None)
        if provider:
            pid = provider.pid
            try:
                await provider.shutdown()
            except Exception:
                log.warning("Provider shutdown raised", session_id=session_id, exc_info=True)
            try:
                from arz.reaper import get_reaper

                get_reaper().unregister(pid)
            except Exception:
                pass
            log.info("Provider deactivated", session_id=session_id)

    async def shutdown_all(self) -> None:
        """Shut down every active + warm provider (called on gateway shutdown)."""
        ids = list(self._pool.keys())
        pids = [self._pool[sid].pid for sid in ids] + [p.pid for p in self._warm]
        coros = [self._pool[sid].shutdown() for sid in ids] + [p.shutdown() for p in self._warm]
        await asyncio.gather(*coros, return_exceptions=True)
        try:
            from arz.reaper import get_reaper

            reaper = get_reaper()
            for pid in pids:
                reaper.unregister(pid)
        except Exception:
            pass
        self._pool.clear()
        self._warm.clear()

    def active_count(self) -> int:
        return len(self._pool)

    def active_ids(self) -> list[str]:
        return list(self._pool.keys())

    # ── warm pool ───────────────────────────────────────────────────────────

    async def prewarm(self, n: int, factory: Factory) -> int:
        """Pre-spawn up to *n* providers so first-message latency is near-zero.

        Returns the count actually spawned (errors are logged + skipped).
        Warm slots are kept in a separate list and consumed by ``claim_warm``;
        they don't count against ``max_size`` until claimed.
        """
        spawned = 0
        for _ in range(max(0, n)):
            try:
                provider = factory()
                await provider.start()
                self._warm.append(provider)
                spawned += 1
                try:
                    from arz.reaper import get_reaper

                    get_reaper().register(provider.pid, f"warm:{provider.name}")
                except Exception:
                    pass
            except Exception:
                log.warning("prewarm failed", exc_info=True)
        log.info("Pool pre-warmed", spawned=spawned, total_warm=len(self._warm))
        return spawned

    def claim_warm(self, session_id: str) -> LLMProvider | None:
        """Pop a warm provider and assign it to *session_id*.

        Returns None if no warm provider is available. Caller must ensure
        the warm provider is compatible with the session (same provider
        type & model) — otherwise ``activate`` should ignore the warm pool.
        """
        if not self._warm:
            return None
        if len(self._pool) >= self.max_size:
            return None
        provider = self._warm.pop(0)
        if not provider.is_alive():
            return None
        self._pool[session_id] = provider
        log.info(
            "Warm provider claimed",
            session_id=session_id,
            remaining_warm=len(self._warm),
        )
        return provider

    def warm_count(self) -> int:
        return len(self._warm)

    # ── private ─────────────────────────────────────────────────────────────

    async def _evict_lru(self) -> None:
        lru_id, lru_provider = next(iter(self._pool.items()))
        del self._pool[lru_id]
        try:
            await lru_provider.shutdown()
        except Exception:
            pass
        log.info("LRU provider evicted", session_id=lru_id, remaining=len(self._pool))
