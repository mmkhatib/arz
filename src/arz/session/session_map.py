"""Persistent map: Arz session ID → provider session ID (Claude Code or kiro-cli).

Enables native session resumption across server restarts. Entries are validated
on read — if the underlying provider session file is gone, the entry is pruned
and None is returned so the caller starts fresh.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

log = logging.getLogger(__name__)

_MAP_FILE = Path.home() / ".arz" / "session_map.json"
_CLAUDE_PROJECTS_DIR = Path.home() / ".claude" / "projects"
_KIRO_SESSIONS_DIR = Path.home() / ".kiro" / "sessions" / "cli"


def _provider_session_exists(sid: str) -> bool:
    """Return True if a Claude Code or kiro-cli session file exists for *sid*."""
    # kiro-cli: flat file check (fast)
    if (_KIRO_SESSIONS_DIR / f"{sid}.json").exists():
        return True
    # Claude Code: sessions live under ~/.claude/projects/<project-hash>/{sid}.jsonl
    if _CLAUDE_PROJECTS_DIR.exists():
        for p in _CLAUDE_PROJECTS_DIR.iterdir():
            if p.is_dir() and (p / f"{sid}.jsonl").exists():
                return True
    return False


class SessionMap:
    """Thread-unsafe, file-persisted map of arz_session_id → provider_session_id."""

    def __init__(self, path: Path | None = None) -> None:
        self._path = path or _MAP_FILE
        self._data: dict[str, str] = {}
        self._load()

    # ── public ──────────────────────────────────────────────────────────────

    def get(self, arz_session_id: str) -> str | None:
        """Return the provider session ID, or None if missing/stale."""
        sid = self._data.get(arz_session_id)
        if not sid:
            return None
        if not _provider_session_exists(sid):
            log.info("Session map entry stale — pruning %s → %s", arz_session_id, sid)
            self._data.pop(arz_session_id, None)
            self._save()
            return None
        return sid

    def set(self, arz_session_id: str, provider_session_id: str) -> None:
        """Store mapping and persist to disk."""
        self._data[arz_session_id] = provider_session_id
        self._save()

    def remove(self, arz_session_id: str) -> None:
        """Delete an entry and persist."""
        if arz_session_id in self._data:
            del self._data[arz_session_id]
            self._save()

    # ── private ─────────────────────────────────────────────────────────────

    def _load(self) -> None:
        try:
            self._data = json.loads(self._path.read_text())
        except (FileNotFoundError, json.JSONDecodeError):
            self._data = {}

    def _save(self) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._path.write_text(json.dumps(self._data, indent=2))
