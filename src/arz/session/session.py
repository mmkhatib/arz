"""Session and Message data models."""

from __future__ import annotations

import re
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from typing import Literal

_GOAL_AUTO_OPEN_RE = re.compile(r"<goal-auto\b[^>]*>", re.IGNORECASE)
_GOAL_AUTO_CLOSE_RE = re.compile(r"</goal-auto\s*>", re.IGNORECASE)
_GOAL_KICKOFF_PREFIX_RE = re.compile(r"^\s*\[goal-(?:start|auto[^\]]*)\][^\n]*\n*", re.IGNORECASE)


def _title_from_user_text(raw: str) -> str:
    """Pick a session title from the first user message.

    Strips the synthetic goal-auto wrapper (kickoff / auto-iteration
    prompts) and the visible scaffolding inside so the title reflects
    the actual goal — e.g. ``a poem about a red car`` instead of
    ``<goal-auto iter="0" cap="20" reason="kickoff" goal="a poem a``.
    Falls back to the raw text for normal user messages.
    """
    text = raw or ""

    # Prefer the explicit goal= attribute on the wrapping tag — already
    # the canonical short form of what the user typed.
    m = re.search(r'<goal-auto\b[^>]*\bgoal="([^"]+)"', text, re.IGNORECASE)
    if m:
        return m.group(1).strip()[:60]

    # No goal attr (legacy / auto-iteration follow-ups) — strip the
    # wrapper, drop the `[goal-...]` prefix, drop the boilerplate, and
    # take the first non-empty content line as the title.
    text = _GOAL_AUTO_OPEN_RE.sub("", text)
    text = _GOAL_AUTO_CLOSE_RE.sub("", text)
    text = _GOAL_KICKOFF_PREFIX_RE.sub("", text)
    # The auto-iteration prompt body has a recognisable "Goal:\n<x>"
    # line — promote that when present.
    m = re.search(r"^Goal:\s*\n(.+)$", text, re.IGNORECASE | re.MULTILINE)
    if m:
        return m.group(1).strip()[:60]
    return text.strip()[:60]


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
    # Provenance (MeshClaw blueprint §2.1) — captures WHERE this turn came
    # from so downstream memory operations can cite "you asked this in
    # #engineering on 2026-05-13" without rebuilding the lineage. Optional
    # because most non-Slack surfaces don't have a meaningful thread / user.
    source_user: str | None = None
    source_thread: str | None = None
    source_surface: str | None = None  # "dashboard" | "slack" | "cli" | etc.

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
        if self.source_user:
            d["source_user"] = self.source_user
        if self.source_thread:
            d["source_thread"] = self.source_thread
        if self.source_surface:
            d["source_surface"] = self.source_surface
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
            source_user=d.get("source_user"),
            source_thread=d.get("source_thread"),
            source_surface=d.get("source_surface"),
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
    # Persistent goal — when set, injected as `<goal>` block into every
    # turn's memory prefix so the model keeps it in mind across restarts.
    # Separate from autonudge_goal (which only matters when background
    # nudges are enabled). status: "active" | "done".
    goal: str | None = None
    goal_status: str = "active"
    goal_set_at: float = 0.0
    # Auto-iteration: after every assistant turn an evaluator decides if
    # the goal is met; if not, the chat route fires a synthetic follow-up
    # turn. Iterations + last reason are persisted so the UI pill can
    # show progress + so a gateway restart can resume mid-loop.
    goal_iterations: int = 0
    goal_max_iterations: int = 20
    goal_last_reason: str = ""
    # Frustration tracker: how many consecutive iterations the evaluator
    # has rejected the writer for the SAME reason. When this hits the
    # threshold (3) we inject a hard-reset prompt forcing the writer to
    # discard its current approach — handles sticky-cache failure modes
    # where the writer keeps repeating the previous answer verbatim.
    goal_same_reason_count: int = 0
    # Per-session UI state — persists across restarts and machines.
    pinned: bool = False
    archived: bool = False
    # Index into self.messages marking the last consolidated turn. Used by
    # the consolidation triggers (30-msg threshold, idle sweep) to know
    # which slice still needs an LLM pass. Survives gateway restart so
    # we don't redo work or skip pending turns. -1 means "never".
    last_consolidated_index: int = -1
    # Wall-clock timestamp (epoch s) of the last consolidation attempt
    # for this session — even when no new messages crossed the trigger.
    # The idle sweep needs this so it doesn't refire on the same idle
    # state every tick.
    last_consolidation_ts: float = 0.0

    def add_message(self, role: Literal["user", "assistant", "system"], text: str) -> Message:
        msg = Message(role=role, text=text)
        self.messages.append(msg)
        self.updated_at = datetime.utcnow()
        if self.title == "New session" and role == "user" and text.strip():
            self.title = _title_from_user_text(text)
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
            "goal": self.goal,
            "goal_status": self.goal_status,
            "goal_set_at": self.goal_set_at,
            "goal_iterations": self.goal_iterations,
            "goal_max_iterations": self.goal_max_iterations,
            "goal_last_reason": self.goal_last_reason,
            "goal_same_reason_count": self.goal_same_reason_count,
            "pinned": self.pinned,
            "archived": self.archived,
            "last_consolidated_index": self.last_consolidated_index,
            "last_consolidation_ts": self.last_consolidation_ts,
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
            goal=d.get("goal"),
            goal_status=d.get("goal_status") or "active",
            goal_set_at=float(d.get("goal_set_at") or 0.0),
            goal_iterations=int(d.get("goal_iterations") or 0),
            goal_max_iterations=int(d.get("goal_max_iterations") or 20),
            goal_last_reason=str(d.get("goal_last_reason") or ""),
            goal_same_reason_count=int(d.get("goal_same_reason_count") or 0),
            pinned=bool(d.get("pinned") or False),
            archived=bool(d.get("archived") or False),
            last_consolidated_index=int(d.get("last_consolidated_index", -1) or -1),
            last_consolidation_ts=float(d.get("last_consolidation_ts") or 0.0),
        )
