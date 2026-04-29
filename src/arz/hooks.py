"""HookManager — pattern-based auto-approve / auto-reply / deny.

Config file: ~/.arz/hooks.json

    {
      "auto_approve_tools": ["Read", "Glob", "Grep", "WebSearch"],
      "auto_replies": [
          { "pattern": "(?i)^ping$", "reply": "pong" }
      ],
      "deny": [
          { "pattern": "rm -rf /", "reason": "destructive" }
      ]
    }
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path

from arz.security.deny_patterns import DEFAULT_DENY_RULES, DenyRule

_DEFAULT_PATH = Path.home() / ".arz" / "hooks.json"


@dataclass
class AutoReply:
    pattern: re.Pattern[str]
    reply: str


@dataclass
class HookConfig:
    auto_approve_tools: set[str]
    auto_replies: list[AutoReply]
    extra_deny: list[DenyRule]


def _load_config(path: Path) -> HookConfig:
    if not path.exists():
        return HookConfig(set(), [], [])
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return HookConfig(set(), [], [])
    auto_approve = set(data.get("auto_approve_tools") or [])
    replies = [
        AutoReply(re.compile(r["pattern"]), r["reply"])
        for r in (data.get("auto_replies") or [])
        if isinstance(r, dict) and r.get("pattern") and r.get("reply") is not None
    ]
    extra_deny: list[DenyRule] = []
    for d in (data.get("deny") or []):
        if isinstance(d, dict) and d.get("pattern"):
            try:
                extra_deny.append(DenyRule(
                    pattern=re.compile(d["pattern"], re.IGNORECASE),
                    reason=d.get("reason", "user-defined deny rule"),
                    severity=d.get("severity", "warn"),
                ))
            except re.error:
                continue
    return HookConfig(auto_approve, replies, extra_deny)


class HookManager:
    """Loads ~/.arz/hooks.json, evaluates against tool calls and messages."""

    def __init__(self, path: Path | None = None) -> None:
        self._path = path or _DEFAULT_PATH
        self._config = _load_config(self._path)

    def reload(self) -> None:
        self._config = _load_config(self._path)

    @property
    def config(self) -> HookConfig:
        return self._config

    def auto_approves(self, tool_name: str) -> bool:
        return tool_name in self._config.auto_approve_tools

    def auto_reply_for(self, message: str) -> str | None:
        for r in self._config.auto_replies:
            if r.pattern.search(message):
                return r.reply
        return None

    def evaluate_command(self, command: str) -> DenyRule | None:
        all_rules = list(DEFAULT_DENY_RULES) + self._config.extra_deny
        for rule in all_rules:
            if rule.pattern.search(command or ""):
                return rule
        return None


_singleton: HookManager | None = None


def get_hook_manager() -> HookManager:
    global _singleton
    if _singleton is None:
        _singleton = HookManager()
    return _singleton
