"""AutoNudge — keeps a session moving toward a stated goal.

When a session has ``autonudge_goal`` set and ``autonudge_idle_s > 0``,
this background loop checks every 30s and, for any qualifying session
that has been idle long enough, fires a single chat turn with a nudge
prompt. The nudge counts against ``autonudge_max_iterations`` (default
20) so a runaway loop can't burn credits forever.

Survives gateway restart because state lives on the Session JSON, not
in this module's memory. The loop simply re-discovers eligible sessions
on every tick.
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Awaitable, Callable

log = logging.getLogger(__name__)

_TICK_S = 30.0
_NUDGE_TEMPLATE = (
    "[autonudge] You have been idle. Continue working toward your goal:\n\n"
    "  {goal}\n\n"
    "Make one concrete step. If the goal is complete, say 'autonudge:done' "
    "and stop. Otherwise keep going."
)


# Type for the chat-runner callable injected by the gateway:
# (session_id, message) -> awaitable that completes when the turn ends.
ChatRunner = Callable[[str, str], Awaitable[None]]


class AutoNudge:
    def __init__(self, session_manager, runner: ChatRunner) -> None:
        self._mgr = session_manager
        self._runner = runner
        self._task: asyncio.Task | None = None
        self._last_fire: dict[str, float] = {}

    async def start(self) -> None:
        if self._task is None:
            self._task = asyncio.create_task(self._loop(), name="autonudge")

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None

    async def _loop(self) -> None:
        while True:
            try:
                await asyncio.sleep(_TICK_S)
                await self._tick()
            except asyncio.CancelledError:
                raise
            except Exception:
                log.exception("autonudge tick raised")

    async def _tick(self) -> None:
        from arz.dashboard.stream_registry import get_stream_registry

        registry = get_stream_registry()
        now = time.time()
        for session in list(self._mgr._sessions.values()):  # noqa: SLF001
            goal = (getattr(session, "autonudge_goal", None) or "").strip()
            idle_s = int(getattr(session, "autonudge_idle_s", 0) or 0)
            if not goal or idle_s <= 0:
                continue
            if not session.active:
                continue
            if session.autonudge_iterations >= session.autonudge_max_iterations:
                continue
            if registry.is_streaming(session.id):
                continue
            # Idle = no message activity for at least idle_s seconds.
            try:
                last_activity = session.updated_at.timestamp()
            except Exception:
                continue
            if now - last_activity < idle_s:
                continue
            # Anti-loop: don't fire faster than the configured idle window.
            last = self._last_fire.get(session.id, 0.0)
            if now - last < idle_s:
                continue
            # Stop if the assistant signalled completion last turn.
            if session.messages and session.messages[-1].role == "assistant":
                if "autonudge:done" in (session.messages[-1].text or "").lower():
                    continue
            log.info(
                "autonudge firing",
                extra={
                    "session_id": session.id,
                    "iteration": session.autonudge_iterations + 1,
                    "max": session.autonudge_max_iterations,
                },
            )
            self._last_fire[session.id] = now
            session.autonudge_iterations += 1
            self._mgr.save(session)
            try:
                await self._runner(session.id, _NUDGE_TEMPLATE.format(goal=goal))
            except Exception:
                log.exception("autonudge runner failed", extra={"session_id": session.id})


_singleton: AutoNudge | None = None


def init_autonudge(session_manager, runner: ChatRunner) -> AutoNudge:
    global _singleton
    _singleton = AutoNudge(session_manager, runner)
    return _singleton


def get_autonudge() -> AutoNudge | None:
    return _singleton
