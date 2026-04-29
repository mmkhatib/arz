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
_QUEUE_CAP = 1000             # per-subscriber backpressure


@dataclass
class StreamState:
    session_id: str
    status: str = "running"   # running | complete | failed | cancelled
    started_at: float = field(default_factory=time.time)
    finished_at: float = 0.0
    # SSE event strings (already-formatted "data: ...\n\n").
    events: deque[str] = field(default_factory=lambda: deque(maxlen=_MAX_BUFFERED_EVENTS))
    subscribers: list[asyncio.Queue[str | None]] = field(default_factory=list)
    task: asyncio.Task | None = None
    # Mirror of streaming text + tool calls so the SSE replay can reflect them.
    full_reply: str = ""
    turn_tool_calls: list[dict] = field(default_factory=list)
    error: str | None = None


class StreamRegistry:
    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._states: dict[str, StreamState] = {}

    # ── lifecycle ───────────────────────────────────────────────────────────

    async def start(self, session_id: str) -> StreamState:
        """Allocate a StreamState. Caller fills .task immediately after."""
        async with self._lock:
            existing = self._states.get(session_id)
            if existing and existing.status == "running":
                raise RuntimeError(f"session {session_id} already has a running turn")
            state = StreamState(session_id=session_id)
            self._states[session_id] = state
            return state

    async def finish(self, session_id: str, *, status: str = "complete", error: str | None = None) -> None:
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
            for q in state.subscribers:
                try:
                    q.put_nowait(sse_chunk)
                except asyncio.QueueFull:
                    # Backpressure: drop oldest in this subscriber's queue
                    try: q.get_nowait()
                    except Exception: pass
                    try: q.put_nowait(sse_chunk)
                    except Exception: pass

    async def subscribe(self, session_id: str) -> tuple[StreamState | None, asyncio.Queue[str | None]]:
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


_singleton: StreamRegistry | None = None


def get_stream_registry() -> StreamRegistry:
    global _singleton
    if _singleton is None:
        _singleton = StreamRegistry()
    return _singleton
