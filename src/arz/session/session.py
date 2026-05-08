"""Session and Message data models."""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime
from typing import Literal


@dataclass
class Message:
    """One turn in a session's conversation history."""

    role: Literal["user", "assistant", "system"]
    text: str
    created_at: datetime = field(default_factory=datetime.utcnow)
    usage: dict[str, int] | None = None
    model: str | None = None
    elapsed_ms: int | None = None
    tool_calls: list[dict] | None = None
    # Regenerate support: archive of alternate texts for assistant messages.
    # When the user clicks ↻, the prior text is appended to ``versions`` and
    # ``text`` is updated to the new generation. ``version_index`` points at
    # whichever entry is currently displayed.
    versions: list[str] | None = None
    version_index: int = 0

    def to_dict(self) -> dict:
        d: dict = {
            "role": self.role,
            "text": self.text,
            "created_at": self.created_at.isoformat(),
        }
        if self.usage is not None:
            d["usage"] = self.usage
        if self.model is not None:
            d["model"] = self.model
        if self.elapsed_ms is not None:
            d["elapsed_ms"] = self.elapsed_ms
        if self.tool_calls:
            d["tool_calls"] = self.tool_calls
        if self.versions:
            d["versions"] = self.versions
            d["version_index"] = self.version_index
        return d

    @classmethod
    def from_dict(cls, d: dict) -> Message:
        return cls(
            role=d["role"],
            text=d["text"],
            created_at=datetime.fromisoformat(d["created_at"]),
            usage=d.get("usage"),
            model=d.get("model"),
            elapsed_ms=d.get("elapsed_ms"),
            tool_calls=d.get("tool_calls"),
            versions=d.get("versions"),
            version_index=d.get("version_index", 0),
        )


@dataclass
class Session:
    """One conversation session with a provider."""

    id: str = field(default_factory=lambda: uuid.uuid4().hex)
    title: str = "New session"
    surface: str = "cli"
    chat_id: str = "default"
    thread_id: str | None = None
    messages: list[Message] = field(default_factory=list)
    created_at: datetime = field(default_factory=datetime.utcnow)
    updated_at: datetime = field(default_factory=datetime.utcnow)
    active: bool = True
    color: int | None = None
    work_dir: str | None = None
    provider: str | None = None
    model: str | None = None
    agent: str | None = None
    approval_mode: str = "normal"  # "normal" | "trust_reads" | "trust" | "yolo"
    # AutoNudge: when enabled, a background loop sends a "continue working
    # toward your goal" prompt every ``autonudge_idle_s`` seconds of session
    # idleness. Survives gateway restart because it lives on the Session.
    autonudge_goal: str | None = None
    autonudge_idle_s: int = 0  # 0 = disabled
    autonudge_max_iterations: int = 20  # safety cap
    autonudge_iterations: int = 0  # how many nudges have fired so far
    # Per-session UI state — persists across restarts and machines.
    pinned: bool = False
    archived: bool = False

    def add_message(self, role: Literal["user", "assistant", "system"], text: str) -> Message:
        msg = Message(role=role, text=text)
        self.messages.append(msg)
        self.updated_at = datetime.utcnow()
        if self.title == "New session" and role == "user" and text.strip():
            self.title = text[:60].strip()
        return msg

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "title": self.title,
            "surface": self.surface,
            "chat_id": self.chat_id,
            "thread_id": self.thread_id,
            "messages": [m.to_dict() for m in self.messages],
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
            "active": self.active,
            "color": self.color,
            "work_dir": self.work_dir,
            "provider": self.provider,
            "model": self.model,
            "agent": self.agent,
            "approval_mode": self.approval_mode,
            "autonudge_goal": self.autonudge_goal,
            "autonudge_idle_s": self.autonudge_idle_s,
            "autonudge_max_iterations": self.autonudge_max_iterations,
            "autonudge_iterations": self.autonudge_iterations,
            "pinned": self.pinned,
            "archived": self.archived,
        }

    @classmethod
    def from_dict(cls, d: dict) -> Session:
        return cls(
            id=d["id"],
            title=d.get("title", "Session"),
            surface=d.get("surface", "cli"),
            chat_id=d.get("chat_id", "default"),
            thread_id=d.get("thread_id"),
            messages=[Message.from_dict(m) for m in d.get("messages", [])],
            created_at=datetime.fromisoformat(d["created_at"]),
            updated_at=datetime.fromisoformat(d["updated_at"]),
            active=d.get("active", True),
            color=d.get("color"),
            work_dir=d.get("work_dir"),
            provider=d.get("provider"),
            model=d.get("model"),
            agent=d.get("agent"),
            approval_mode=d.get("approval_mode", "normal"),
            autonudge_goal=d.get("autonudge_goal"),
            autonudge_idle_s=int(d.get("autonudge_idle_s") or 0),
            autonudge_max_iterations=int(d.get("autonudge_max_iterations") or 20),
            autonudge_iterations=int(d.get("autonudge_iterations") or 0),
            pinned=bool(d.get("pinned") or False),
            archived=bool(d.get("archived") or False),
        )
