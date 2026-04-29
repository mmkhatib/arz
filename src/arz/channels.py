"""Channels — persistent shared spaces for multi-agent A2A.

Storage: ~/.arz/channels/{slug}.json

A channel is:
    {
      "id": str,           # url-slug
      "name": str,         # human-readable
      "members": [
          { "agent": str, "listen_mode": "ALL"|"MENTION"|"SILENT",
            "approval": "ALL"|"WRITES"|"TRUSTED" }
      ],
      "messages": [
          { "id": int, "from": str, "text": str, "ts": float,
            "mentions": [str], "in_reply_to": int|null }
      ]
    }

Limits:
    - max 3 members per channel
    - max 200 messages per channel (FIFO eviction)
    - max 3 A2A round-trips per parent user-turn (enforced by caller)
"""

from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass, field, asdict
from pathlib import Path
from threading import Lock

from pydantic import BaseModel

_DIR = Path.home() / ".arz" / "channels"
_MAX_MEMBERS = 3
_MAX_MESSAGES = 200
_MENTION_RE = re.compile(r"@([a-zA-Z][a-zA-Z0-9_-]{1,40})")


class ChannelMember(BaseModel):
    agent: str
    listen_mode: str = "ALL"   # ALL | MENTION | SILENT
    approval: str = "WRITES"   # ALL | WRITES | TRUSTED


class ChannelMessage(BaseModel):
    id: int
    from_: str
    text: str
    ts: float
    mentions: list[str] = []
    in_reply_to: int | None = None

    def model_dump(self, **kwargs):  # pydantic alias workaround for `from`
        d = super().model_dump(**kwargs)
        d["from"] = d.pop("from_")
        return d


class Channel(BaseModel):
    id: str
    name: str
    members: list[ChannelMember] = []
    messages: list[ChannelMessage] = []


def _slugify(name: str) -> str:
    s = re.sub(r"[^a-zA-Z0-9_-]+", "-", name.strip()).strip("-").lower()
    return s[:60] or "channel"


def _path_for(slug: str) -> Path:
    return _DIR / f"{slug}.json"


class ChannelStore:
    def __init__(self) -> None:
        self._dir = _DIR
        self._dir.mkdir(parents=True, exist_ok=True)
        self._lock = Lock()

    def list(self) -> list[Channel]:
        with self._lock:
            out: list[Channel] = []
            for p in sorted(self._dir.glob("*.json")):
                try:
                    out.append(self._load(p))
                except Exception:
                    continue
            return out

    def get(self, slug: str) -> Channel | None:
        with self._lock:
            p = _path_for(slug)
            if not p.exists():
                return None
            try:
                return self._load(p)
            except Exception:
                return None

    def _load(self, p: Path) -> Channel:
        raw = json.loads(p.read_text(encoding="utf-8"))
        # Convert "from" → "from_" for pydantic
        for m in raw.get("messages", []):
            if "from" in m:
                m["from_"] = m.pop("from")
        return Channel(**raw)

    def save(self, ch: Channel) -> Channel:
        with self._lock:
            data = json.loads(ch.model_dump_json())
            # Rename "from_" → "from" in messages for on-disk consistency
            for m in data.get("messages", []):
                if "from_" in m:
                    m["from"] = m.pop("from_")
            _path_for(ch.id).write_text(json.dumps(data, indent=2), encoding="utf-8")
            return ch

    def create(self, name: str, members: list[ChannelMember] | None = None) -> Channel:
        slug = _slugify(name)
        if self.get(slug):
            raise ValueError(f"channel '{slug}' already exists")
        members = (members or [])[:_MAX_MEMBERS]
        ch = Channel(id=slug, name=name.strip(), members=members)
        return self.save(ch)

    def delete(self, slug: str) -> bool:
        p = _path_for(slug)
        if p.exists():
            p.unlink()
            return True
        return False

    def add_member(self, slug: str, member: ChannelMember) -> Channel:
        ch = self.get(slug)
        if ch is None:
            raise KeyError(slug)
        if len(ch.members) >= _MAX_MEMBERS:
            raise ValueError(f"channel already has {_MAX_MEMBERS} members")
        if any(m.agent == member.agent for m in ch.members):
            raise ValueError(f"agent '{member.agent}' already in channel")
        ch.members.append(member)
        return self.save(ch)

    def post(
        self,
        slug: str,
        from_: str,
        text: str,
        in_reply_to: int | None = None,
    ) -> ChannelMessage:
        ch = self.get(slug)
        if ch is None:
            raise KeyError(slug)
        next_id = (max((m.id for m in ch.messages), default=0)) + 1
        mentions = sorted(set(_MENTION_RE.findall(text)))
        msg = ChannelMessage(
            id=next_id,
            from_=from_,
            text=text,
            ts=time.time(),
            mentions=mentions,
            in_reply_to=in_reply_to,
        )
        ch.messages.append(msg)
        if len(ch.messages) > _MAX_MESSAGES:
            ch.messages = ch.messages[-_MAX_MESSAGES:]
        self.save(ch)
        return msg

    def render_for_agent(self, slug: str, agent_name: str, max_chars: int = 2000) -> str:
        """Return recent traffic the agent should see, formatted as a context block."""
        ch = self.get(slug)
        if ch is None:
            return ""
        # Determine listen filter for this agent.
        member = next((m for m in ch.members if m.agent == agent_name), None)
        listen_mode = member.listen_mode if member else "ALL"
        if listen_mode == "SILENT":
            return ""
        msgs = ch.messages[-30:]
        if listen_mode == "MENTION":
            msgs = [m for m in msgs if agent_name in m.mentions]
        if not msgs:
            return ""
        lines = [f"<channel:{ch.id}>"]
        used = len(lines[0]) + 1
        for m in msgs:
            line = f"@{m.from_}: {m.text}"
            if used + len(line) + 1 > max_chars:
                break
            lines.append(line)
            used += len(line) + 1
        lines.append(f"</channel:{ch.id}>")
        return "\n".join(lines)


_singleton: ChannelStore | None = None


def get_channel_store() -> ChannelStore:
    global _singleton
    if _singleton is None:
        _singleton = ChannelStore()
    return _singleton
