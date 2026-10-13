"""Per-turn context breakdown — what each turn fed the model, by block.

The chat route records the char size of every block it injects ahead of
the user's message (memory prefix, recall results, goal, subagent results,
the per-turn reminder) plus the history and system prompt it hands the
provider. When the turn completes, the provider's context-usage % and
token usage are attached to the same record. The right-panel "Context"
tab reads it back to show a stacked breakdown per turn.

Kept per session as a small JSON file (last ``_MAX_TURNS`` turns) so the
breakdown survives a gateway restart. Sizes are characters, not tokens —
the provider only reports the aggregate, and chars are a stable proxy
for the relative share of each block.
"""

from __future__ import annotations

import json
import logging
import threading
import time
from pathlib import Path

log = logging.getLogger(__name__)

_ROOT = Path.home() / ".arz" / "context-trace"
_MAX_TURNS = 50
_lock = threading.Lock()


def _path(session_id: str) -> Path:
    safe = "".join(c for c in session_id if c.isalnum() or c in "-_") or "unknown"
    return _ROOT / f"{safe}.json"


def load(session_id: str) -> list[dict]:
    p = _path(session_id)
    if not p.exists():
        return []
    try:
        data = json.loads(p.read_text())
    except (OSError, ValueError):
        return []
    return data if isinstance(data, list) else []


def _save(session_id: str, turns: list[dict]) -> None:
    p = _path(session_id)
    try:
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(turns[-_MAX_TURNS:]))
    except OSError:
        log.exception("context trace save failed for %s", session_id)


def record_turn(session_id: str, blocks: dict[str, int]) -> None:
    """Append a new turn record with per-block char sizes."""
    clean = {k: int(v) for k, v in blocks.items() if int(v or 0) > 0}
    with _lock:
        turns = load(session_id)
        turns.append({"ts": time.time(), "blocks": clean, "context_pct": None, "usage": None})
        _save(session_id, turns)


def finish_turn(session_id: str, context_pct: float | None, usage: dict | None) -> None:
    """Attach provider-reported usage to the most recent turn record."""
    with _lock:
        turns = load(session_id)
        if not turns:
            return
        turns[-1]["context_pct"] = float(context_pct) if context_pct else None
        turns[-1]["usage"] = usage or None
        _save(session_id, turns)
