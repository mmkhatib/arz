"""SessionManager — in-memory + file-persisted session registry."""

from __future__ import annotations

import json
import logging
from pathlib import Path

from arz.session.session import Session

log = logging.getLogger(__name__)

_SESSIONS_DIR = Path.home() / ".arz" / "sessions"


class SessionManager:
    """Manages the lifecycle of all Arz sessions.

    Sessions are kept in memory during runtime and serialized to
    ``~/.arz/sessions/{id}.json`` on save/close.
    """

    def __init__(self, sessions_dir: Path | None = None) -> None:
        self._dir = sessions_dir or _SESSIONS_DIR
        self._dir.mkdir(parents=True, exist_ok=True)
        self._sessions: dict[str, Session] = {}
        self._surface_index: dict[tuple[str, str, str | None], str] = {}

    # ── Public API ─────────────────────────────────────────────────────────────

    def create(
        self,
        surface: str = "cli",
        chat_id: str = "default",
        thread_id: str | None = None,
    ) -> Session:
        """Create a new session and register it."""
        session = Session(surface=surface, chat_id=chat_id, thread_id=thread_id)
        self._sessions[session.id] = session
        self._surface_index[(surface, chat_id, thread_id)] = session.id
        return session

    def get(self, session_id: str) -> Session | None:
        return self._sessions.get(session_id)

    def get_or_create(
        self,
        surface: str = "cli",
        chat_id: str = "default",
        thread_id: str | None = None,
    ) -> Session:
        """Return the existing session for this surface key or create one."""
        key = (surface, chat_id, thread_id)
        session_id = self._surface_index.get(key)
        if session_id and session_id in self._sessions:
            return self._sessions[session_id]
        return self.create(surface, chat_id, thread_id)

    def list_active(self) -> list[Session]:
        """Return active sessions sorted by updated_at descending."""
        return sorted(
            (s for s in self._sessions.values() if s.active),
            key=lambda s: s.updated_at,
            reverse=True,
        )

    def save(self, session: Session) -> None:
        """Persist a session to disk."""
        path = self._dir / f"{session.id}.json"
        path.write_text(json.dumps(session.to_dict(), indent=2))

    def close(self, session_id: str) -> None:
        """Mark a session inactive and persist it."""
        session = self._sessions.get(session_id)
        if session:
            session.active = False
            self.save(session)
            key = (session.surface, session.chat_id, session.thread_id)
            self._surface_index.pop(key, None)

    def load_all(self) -> int:
        """Load all persisted sessions from disk. Returns count loaded."""
        loaded = 0
        for path in self._dir.glob("*.json"):
            try:
                data = json.loads(path.read_text())
                session = Session.from_dict(data)
                self._sessions[session.id] = session
                if session.active:
                    key = (session.surface, session.chat_id, session.thread_id)
                    self._surface_index[key] = session.id
                loaded += 1
            except Exception as e:
                log.warning("Failed to load session %s: %s", path.name, e)
        return loaded
