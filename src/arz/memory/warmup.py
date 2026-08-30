"""Embedder warm-up and backfill.

Two jobs, both on a background thread so a request path never waits on them:

1. Start loading the local embedding model (first run downloads it).
2. Once it is ready, backfill any vectors that are missing or were produced
   by a different embedder — documents written while the model was still
   downloading, plus everything already on disk after a backend switch.

Retrieval degrades to FTS/keyword until this finishes. It never blocks a turn.
"""

from __future__ import annotations

import logging
import threading
import time
from typing import Any

log = logging.getLogger(__name__)

# How long to keep waiting for a cold model before giving up on this pass.
# A first-run download of all-MiniLM-L6-v2 is ~90MB.
_MAX_WAIT_S = 900
_POLL_S = 5

_thread: threading.Thread | None = None
_lock = threading.Lock()
_state: dict[str, Any] = {"phase": "idle", "reembedded": 0, "error": ""}


def status() -> dict[str, Any]:
    """Warm-up progress, merged into the embedder status by the API."""
    with _lock:
        return dict(_state)


def _set(**kw: Any) -> None:
    with _lock:
        _state.update(kw)


def _run(config: Any) -> None:
    from arz.memory import episodic
    from arz.memory.context import _vector_store
    from arz.memory.embedder import LocalEmbedder, active_status

    try:
        store = _vector_store(config)
        if store is None:
            _set(phase="unavailable", error="vector store failed to initialise")
            return

        emb = getattr(store, "_embedder", None)
        if isinstance(emb, LocalEmbedder):
            _set(phase="loading")
            emb.ensure_started()
            deadline = time.monotonic() + _MAX_WAIT_S
            while not emb.ready() and time.monotonic() < deadline:
                if emb.failure() is not None:
                    _set(phase="failed", error=emb.failure() or "")
                    log.warning("embedder warm-up failed: %s", emb.failure())
                    return
                time.sleep(_POLL_S)
            if not emb.ready():
                _set(phase="timeout", error=f"model not ready after {_MAX_WAIT_S}s")
                log.warning("embedder still not ready after %ss", _MAX_WAIT_S)
                return

        st = active_status()
        if st.get("degraded"):
            # Hash fallback needs no backfill work worth logging about, but the
            # reason belongs in the log once, at startup, not silently.
            log.info("memory retrieval running degraded: %s", st.get("reason"))

        _set(phase="backfilling")
        pending = store.pending_count()
        if pending:
            log.info("backfilling %d document embeddings", pending)
        n = store.reembed_pending()
        try:
            n += episodic.reembed_pending()
        except Exception:
            log.exception("episodic backfill failed")
        _set(phase="ready", reembedded=n)
        if n:
            log.info("embedding backfill complete: %d rows", n)
    except Exception as e:
        _set(phase="failed", error=str(e))
        log.exception("embedder warm-up failed")


def start(config: Any = None) -> None:
    """Kick off warm-up + backfill on a daemon thread. Idempotent."""
    global _thread
    with _lock:
        if _thread is not None and _thread.is_alive():
            return
        _thread = threading.Thread(
            target=_run, args=(config,), name="arz-embedder-warmup", daemon=True
        )
        _thread.start()
