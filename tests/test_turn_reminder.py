"""Per-turn `[OPTIONS:]` reminder appended to dashboard chat messages."""

from __future__ import annotations

from arz.prompts.loader import OPTIONS_REMINDER, build_turn_message


def test_reminder_rides_the_user_turn():
    out = build_turn_message("ship it")
    assert out.startswith("ship it")
    assert out.endswith(OPTIONS_REMINDER)


def test_non_interactive_turns_are_untouched():
    # Subagents / task runner return text to another agent, not a person.
    assert build_turn_message("summarise this", interactive=False) == "summarise this"


def test_reminder_states_the_rule_the_frontend_parses():
    # The marker the reminder names has to be the one `extractOptions` looks
    # for, or the chips silently never render.
    assert "[OPTIONS:" in OPTIONS_REMINDER
    assert "last" in OPTIONS_REMINDER.lower()
