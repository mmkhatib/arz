"""Per-session in-flight stream registry.

Decouples the LLM run from the HTTP/SSE connection. A turn flows like:

    1. POST /api/chat creates a StreamState for the session and spawns
       a background asyncio task that drives the provider.
    2. The task pushes SSE events into the StreamState's event log AND
       fans them out to any currently-subscribed client queues.
    3. The HTTP handler subscribes to the same StreamState and forwards
       events to the SSE response. If the client disconnects, only the
       subscriber queue goes away — the background task keeps running.
    4. A reconnecting client (GET /api/chat/{id}/stream) replays the
       buffered events and then follows live ones until completion.

Eventually-consistent guarantees:
    - At most one active turn per session_id.
    - Events are durable for the lifetime of the turn (kept in-memory).
    - On gateway restart all in-flight turns are lost (we don't snapshot).
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections import deque
from dataclasses import dataclass, field

log = logging.getLogger(__name__)

_MAX_BUFFERED_EVENTS = 4000  # ring-buffer cap per turn
_QUEUE_CAP = 1000  # per-subscriber backpressure


@dataclass
class StreamState:
    session_id: str
    status: str = "running"  # running | complete | failed | cancelled
    started_at: float = field(default_factory=time.time)
    finished_at: float = 0.0
    # SSE event strings (already-formatted "data: ...\n\n").
    events: deque[str] = field(default_factory=lambda: deque(maxlen=_MAX_BUFFERED_EVENTS))
    subscribers: list[asyncio.Queue[str | None]] = field(default_factory=list)
    task: asyncio.Task | None = None
    # Mirror of streaming text + tool calls so the SSE replay can reflect them.
    full_reply: str = ""
    turn_tool_calls: list[dict] = field(default_factory=list)
    # Reasoning text accumulated across the turn; saved on the assistant
    # Message so the collapsible Thinking block survives a reload.
    thinking: str = ""
    error: str | None = None
    # Regenerate: alternate assistant texts to merge into the new
    # assistant message at completion time. Empty for normal turns.
    archive_versions: list[str] = field(default_factory=list)
    # Watchdog + context-guard state (stay-on-task layers 2 + 6).
    # last_event_at: tick on every publish() so the watchdog can detect
    #   no-progress stalls without conflating slow-but-active streams.
    # last_context_pct: latest provider context %, captured from acp
    #   events. Mid-stream guard reads this before approving a tool.
    # stall_notified: idempotent — only emit the 60min notice once.
    last_event_at: float = field(default_factory=time.time)
    last_context_pct: float = 0.0
    stall_notified: bool = False
    context_warned_85: bool = False
    context_warned_95: bool = False


class StreamRegistry:
    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._states: dict[str, StreamState] = {}

    # ── lifecycle ───────────────────────────────────────────────────────────

    # Hard cap: a "running" turn this old gets force-cancelled when a new
    # turn arrives. Generous enough that real long-running tool calls
    # finish, tight enough that a hung provider doesn't block forever.
    _MAX_TURN_AGE_S = 20 * 60  # 20 min

    async def start(self, session_id: str) -> StreamState:
        """Allocate a StreamState. Caller fills .task immediately after.

        Clears stuck "running" entries automatically:
          - Task already done but status not transitioned -> mark failed
          - Task still running but turn-age > _MAX_TURN_AGE_S
            -> cancel the task, mark cancelled, allow new turn
        """
        async with self._lock:
            existing = self._states.get(session_id)
            if existing and existing.status == "running":
                age = time.time() - existing.started_at
                task_done = (existing.task is None) or existing.task.done()
                if task_done:
                    log.warning(
                        "Clearing stale 'running' StreamState for %s (task done but status not transitioned)",
                        session_id,
                    )
                    self._mark_finished(existing, "failed", "stuck-state cleared by next turn")
                elif age > self._MAX_TURN_AGE_S:
                    log.warning(
                        "Force-cancelling stuck turn for %s (age=%.0fs > %.0fs cap)",
                        session_id,
                        age,
                        self._MAX_TURN_AGE_S,
                    )
                    if existing.task is not None and not existing.task.done():
                        existing.task.cancel()
                    self._mark_finished(
                        existing, "cancelled", f"turn exceeded {self._MAX_TURN_AGE_S}s budget"
                    )
                else:
                    raise RuntimeError(f"session {session_id} already has a running turn")
            state = StreamState(session_id=session_id)
            self._states[session_id] = state
            return state

    @staticmethod
    def _mark_finished(state: StreamState, status: str, error: str | None = None) -> None:
        state.status = status
        state.finished_at = time.time()
        state.error = error
        for q in state.subscribers:
            try:
                q.put_nowait(None)
            except asyncio.QueueFull:
                pass
        state.subscribers.clear()

    async def finish(
        self, session_id: str, *, status: str = "complete", error: str | None = None
    ) -> None:
        """Mark a turn done and close all subscriber queues."""
        async with self._lock:
            state = self._states.get(session_id)
            if not state:
                return
            state.status = status
            state.finished_at = time.time()
            state.error = error
            for q in state.subscribers:
                try:
                    q.put_nowait(None)  # sentinel: stream closed
                except asyncio.QueueFull:
                    pass
            state.subscribers.clear()

    def discard(self, session_id: str, *, after_seconds: float = 60.0) -> None:
        """Drop the StreamState after a delay so late clients can still
        replay (e.g. user reloaded just as the turn finished)."""

        async def _bg():
            await asyncio.sleep(after_seconds)
            async with self._lock:
                self._states.pop(session_id, None)

        try:
            asyncio.create_task(_bg())
        except RuntimeError:
            # No loop running — best-effort
            self._states.pop(session_id, None)

    # ── pub/sub ─────────────────────────────────────────────────────────────

    async def publish(self, session_id: str, sse_chunk: str) -> None:
        """Append an event to the buffer and fan-out to live subscribers."""
        async with self._lock:
            state = self._states.get(session_id)
            if not state:
                return
            state.events.append(sse_chunk)
            state.last_event_at = time.time()
            for q in state.subscribers:
                try:
                    q.put_nowait(sse_chunk)
                except asyncio.QueueFull:
                    # Backpressure: drop oldest in this subscriber's queue
                    try:
                        q.get_nowait()
                    except Exception:
                        pass
                    try:
                        q.put_nowait(sse_chunk)
                    except Exception:
                        pass

    async def subscribe(
        self, session_id: str
    ) -> tuple[StreamState | None, asyncio.Queue[str | None]]:
        """Return the current state plus a fresh queue. The queue is added
        to the state's subscriber list. Caller is responsible for replaying
        state.events to the client before consuming new ones from the queue.
        """
        q: asyncio.Queue[str | None] = asyncio.Queue(maxsize=_QUEUE_CAP)
        async with self._lock:
            state = self._states.get(session_id)
            if not state:
                # Send sentinel so the caller closes the stream cleanly.
                q.put_nowait(None)
                return None, q
            if state.status == "running":
                state.subscribers.append(q)
            else:
                # Already finished — no live updates to come; caller still
                # gets the buffered replay, then sees the sentinel.
                q.put_nowait(None)
            return state, q

    async def unsubscribe(self, session_id: str, q: asyncio.Queue[str | None]) -> None:
        async with self._lock:
            state = self._states.get(session_id)
            if state and q in state.subscribers:
                state.subscribers.remove(q)

    # ── snapshots ───────────────────────────────────────────────────────────

    def is_streaming(self, session_id: str) -> bool:
        state = self._states.get(session_id)
        return bool(state and state.status == "running")

    def streaming_session_ids(self) -> list[str]:
        return [sid for sid, s in self._states.items() if s.status == "running"]

    def snapshot(self, session_id: str) -> dict | None:
        state = self._states.get(session_id)
        if not state:
            return None
        return {
            "session_id": state.session_id,
            "status": state.status,
            "started_at": state.started_at,
            "finished_at": state.finished_at,
            "buffered_events": len(state.events),
            "subscribers": len(state.subscribers),
            "full_reply_len": len(state.full_reply),
            "error": state.error,
        }


# Watchdog tunables — stay-on-task layer 6.
_WATCHDOG_TICK_S = 30.0
_STALL_NOTIFY_S = 60 * 60  # 60min — emit a "stalled?" marker
_STALL_CANCEL_S = 2 * 60 * 60  # 2h — force-cancel + reset


async def watchdog_loop() -> None:
    """30s tick that walks running streams + emits stall markers.

    Stage 1 (>60min no event): emit a `<goal-marker variant="stall"/>`
    style chunk so the UI can show the user that the turn looks stuck.
    Stage 2 (>2h no event): force-cancel the asyncio.Task, mark the
    state cancelled, and broadcast a final marker. The next turn the
    user fires starts on a clean slate.

    Resilient to gateway restart — state.last_event_at lives on the
    in-memory StreamState; restarts clear it, which is fine because
    on restart there are no running streams to watch.
    """
    from arz.dashboard.sse import sse_chunk

    reg = get_stream_registry()
    while True:
        try:
            await asyncio.sleep(_WATCHDOG_TICK_S)
        except asyncio.CancelledError:
            return

        now = time.time()
        async with reg._lock:  # noqa: SLF001
            states = list(reg._states.values())  # noqa: SLF001

        for state in states:
            if state.status != "running":
                continue
            idle = now - state.last_event_at
            if idle >= _STALL_CANCEL_S:
                log.warning(
                    "watchdog: stall-cancel session %s (idle %.0fs)",
                    state.session_id,
                    idle,
                )
                if state.task is not None and not state.task.done():
                    state.task.cancel()
                chunk = sse_chunk(
                    '\n\n<goal-marker variant="stall-cancel" '
                    f'reason="No progress for {idle / 60:.0f} minutes — turn force-cancelled" />\n\n'
                )
                try:
                    state.events.append(chunk)
                    for q in list(state.subscribers):
                        try:
                            q.put_nowait(chunk)
                        except Exception:
                            pass
                except Exception:
                    pass
                await reg.finish(
                    state.session_id, status="cancelled", error="watchdog-stall-cancel"
                )
            elif idle >= _STALL_NOTIFY_S and not state.stall_notified:
                state.stall_notified = True
                log.warning(
                    "watchdog: stall-notify session %s (idle %.0fs)",
                    state.session_id,
                    idle,
                )
                chunk = sse_chunk(
                    '\n\n<goal-marker variant="stall-notify" '
                    f'reason="No progress for {idle / 60:.0f} minutes — provider may be stuck" />\n\n'
                )
                try:
                    state.events.append(chunk)
                    for q in list(state.subscribers):
                        try:
                            q.put_nowait(chunk)
                        except Exception:
                            pass
                except Exception:
                    pass


_singleton: StreamRegistry | None = None


def get_stream_registry() -> StreamRegistry:
    global _singleton
    if _singleton is None:
        _singleton = StreamRegistry()
    return _singleton
