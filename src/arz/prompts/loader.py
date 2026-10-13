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


# Re-stated on EVERY user turn, not just in the system prompt. The rule
# itself lives in base.md, but a system prompt sits at the far end of a long
# conversation and is the first thing a compaction drops — and the suggestion
# row is the one output contract whose absence the user sees immediately.
# ~350 chars against a turn that is already thousands.
OPTIONS_REMINDER = (
    "(Reminder — end this reply with `[OPTIONS: A | B | C]` as its very last "
    "line: 2-4 next actions, the one you recommend FIRST, each written as the "
    'user would type it back to you ("Run the tests", not "I\'ll run the '
    'tests"), each one sendable on its own, under ~6 words. Nothing after '
    "that line.)"
)


def build_turn_message(message: str, *, interactive: bool = True) -> str:
    """Append the per-turn output-contract reminder to a user message.

    Dashboard chat only. A subagent, the task runner and the consolidator all
    return text to ANOTHER agent rather than to a person, so a suggestion row
    there is noise the caller has to strip back out.
    """
    if not interactive:
        return message
    return f"{message}\n\n{OPTIONS_REMINDER}"


def get_user_override_path() -> Path:
    return _USER_OVERRIDE


def get_bundled_path() -> Path:
    return _BUNDLED
