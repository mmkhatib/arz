"""wait — pause for up to 30 minutes (useful for polling external state)."""

import asyncio

tool_spec = {
    "name": "wait",
    "description": (
        "Pause for up to 1800 seconds (30 minutes). Use when you're waiting "
        "for external state to change (a build to finish, an alert to fire). "
        "Don't use to fake thinking time."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "seconds": {"type": "integer", "minimum": 1, "maximum": 1800},
        },
        "required": ["seconds"],
    },
}


async def run(input: dict) -> str:
    seconds = max(1, min(1800, int(input.get("seconds") or 1)))
    await asyncio.sleep(seconds)
    return f"waited {seconds}s"
