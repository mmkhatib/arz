"""Resolve the steered system prompt for a session.

Order of precedence:
    1. Explicit `agent_system_prompt` (per-agent override)
    2. `~/.arz/prompts/base.md` (user-customised override)
    3. Bundled `src/arz/prompts/base.md`
"""

from __future__ import annotations

from pathlib import Path

_BUNDLED = Path(__file__).with_name("base.md")
_USER_OVERRIDE = Path.home() / ".arz" / "prompts" / "base.md"


def resolve_system_prompt(agent_system_prompt: str | None = None) -> str:
    if agent_system_prompt and agent_system_prompt.strip():
        return agent_system_prompt.strip()
    if _USER_OVERRIDE.exists():
        try:
            return _USER_OVERRIDE.read_text(encoding="utf-8").strip()
        except OSError:
            pass
    try:
        return _BUNDLED.read_text(encoding="utf-8").strip()
    except OSError:
        return ""


def get_user_override_path() -> Path:
    return _USER_OVERRIDE


def get_bundled_path() -> Path:
    return _BUNDLED
