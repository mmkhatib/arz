"""SessionManager — in-memory + file-persisted session registry."""

from __future__ import annotations

import json
import logging
import re
from collections.abc import Callable
from pathlib import Path

from arz.session.session import Session

# Wrappers we historically prepended to the user message before saving:
# <preferences>…</preferences>, <projects>…</projects>, <lessons>…</lessons>,
# <memory>…</memory>, plus subagent completion lines starting with [subagent:…].
_INJECT_BLOCK_RE = re.compile(
    r"<(preferences|projects|lessons|memory|memory_notes|recall_result)\b[^>]*>[\s\S]*?</\1>\s*",
    re.IGNORECASE,
)
_SUBAGENT_LINE_RE = re.compile(r"^\[subagent:[^\]]+\][^\n]*(?:\n[^\n]*)*?\n\n", re.MULTILINE)


def _strip_injection(text: str) -> str:
    if not text:
        return text
    cleaned = _INJECT_BLOCK_RE.sub("", text)
    cleaned = _SUBAGENT_LINE_RE.sub("", cleaned)
    return cleaned.strip()


def _migrate_strip_injection(session: Session) -> bool:
    """Returns True if any user message was rewritten."""
    changed = False
    for m in session.messages:
        if m.role != "user":
            continue
        cleaned = _strip_injection(m.text)
        if cleaned and cleaned != m.text:
            m.text = cleaned
            changed = True
    return changed


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
        self.on_save: Callable[[Session], None] | None = None
        self.on_delete: Callable[[str], None] | None = None

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

    def list_inactive(self) -> list[Session]:
        """Return closed sessions sorted by updated_at descending."""
        return sorted(
            (s for s in self._sessions.values() if not s.active),
            key=lambda s: s.updated_at,
            reverse=True,
        )

    def reactivate(self, session_id: str) -> Session | None:
        """Mark a closed session active again and persist it."""
        session = self._sessions.get(session_id)
        if not session:
            return None
        session.active = True
        self.save(session)
        key = (session.surface, session.chat_id, session.thread_id)
        self._surface_index[key] = session.id
        return session

    def save(self, session: Session) -> None:
        """Persist a session to disk."""
        path = self._dir / f"{session.id}.json"
        path.write_text(json.dumps(session.to_dict(), indent=2))
        if self.on_save is not None:
            try:
                self.on_save(session)
            except Exception:
                log.exception("on_save hook failed for session %s", session.id)

    def purge_ghosts(self, *, older_than_minutes: int = 60) -> int:
        """Delete ghost session files that the warm pool / failed creates
        leave behind: title=="New session", 0 messages, last touched
        more than ``older_than_minutes`` ago.

        Returns the count deleted. Cheap to call on startup — only reads
        each JSON's first ~200 bytes via Python's json parser. Safe under
        race because we never touch files newer than the threshold.
        """
        import time as _time

        cutoff_ts = _time.time() - older_than_minutes * 60
        deleted = 0
        for path in list(self._dir.glob("*.json")):
            try:
                if path.stat().st_mtime > cutoff_ts:
                    continue
                data = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            title = data.get("title") or ""
            msgs = data.get("messages") or []
            if len(msgs) == 0 and title in ("New session", "Untitled", ""):
                try:
                    path.unlink()
                    deleted += 1
                    self._sessions.pop(data.get("id", ""), None)
                except OSError:
                    pass
        if deleted:
            log.info("Purged %d ghost session file(s)", deleted)
        return deleted

    def close(self, session_id: str) -> None:
        """Mark a session inactive and persist it."""
        session = self._sessions.get(session_id)
        if session:
            session.active = False
            self.save(session)
            key = (session.surface, session.chat_id, session.thread_id)
            self._surface_index.pop(key, None)

    def load_all(self) -> int:
        """Load all persisted sessions from disk. Returns count loaded.

        Lossless across restarts: every message ever written to disk is
        rehydrated — we never truncate or drop old messages on load. A
        corrupt JSON file is renamed ``<id>.json.corrupt`` so the next
        boot doesn't keep warning about the same file.

        Also runs a one-shot migration that strips auto-injected
        <preferences> / <projects> / <lessons> / <memory> / [subagent:…]
        wrapper text from saved user messages — a previous bug saved the
        augmented LLM payload as the user's history entry, polluting the
        chat panel.
        """
        loaded = 0
        total_messages = 0
        for path in self._dir.glob("*.json"):
            try:
                data = json.loads(path.read_text())
                session = Session.from_dict(data)
                if _migrate_strip_injection(session):
                    self.save(session)
                self._sessions[session.id] = session
                if session.active:
                    key = (session.surface, session.chat_id, session.thread_id)
                    self._surface_index[key] = session.id
                loaded += 1
                total_messages += len(session.messages)
            except Exception as e:
                log.warning("Failed to load session %s: %s", path.name, e)
                try:
                    quarantined = path.with_suffix(path.suffix + ".corrupt")
                    path.rename(quarantined)
                    log.warning("Quarantined corrupt session file → %s", quarantined.name)
                except OSError:
                    log.warning("Could not quarantine corrupt session file %s", path.name)
        log.info("Loaded %d sessions (%d messages total)", loaded, total_messages)
        return loaded
