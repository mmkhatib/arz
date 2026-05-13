"""Resolve the steered system prompt for a session.

Composition (always returns the bundled base prompt as the foundation,
optionally with an agent-specific role appended):

    1. Bundled `src/arz/prompts/base.md` (or user override at
       `~/.arz/prompts/base.md` if present) — always present. This carries
       the orchestration patterns, tool guidance, redaction rules, and
       output style that EVERY arz session needs.
    2. If `agent_system_prompt` is provided, it's appended as a "## Role"
       section below the base. The agent narrows the model's focus
       (reviewer / refactorer / docs writer / etc.) without losing the
       arz-runtime knowledge baked into the base.
"""

from __future__ import annotations

from pathlib import Path

_BUNDLED = Path(__file__).with_name("base.md")
_USER_OVERRIDE = Path.home() / ".arz" / "prompts" / "base.md"


def _read_base() -> str:
    if _USER_OVERRIDE.exists():
        try:
            return _USER_OVERRIDE.read_text(encoding="utf-8").strip()
        except OSError:
            pass
    try:
        return _BUNDLED.read_text(encoding="utf-8").strip()
    except OSError:
        return ""


def resolve_system_prompt(
    agent_system_prompt: str | None = None,
    *,
    widget_density: str | None = None,
) -> str:
    base = _read_base()
    role = (agent_system_prompt or "").strip()
    parts = [base] if base else []
    if role:
        parts.append(f"## Role\n\n{role}")
    if widget_density and widget_density in {"more", "less", "off"}:
        parts.append(f"## Runtime settings\n\n- Widget density: `{widget_density}`")
    return "\n\n".join(parts)


def get_user_override_path() -> Path:
    return _USER_OVERRIDE


def get_bundled_path() -> Path:
    return _BUNDLED
