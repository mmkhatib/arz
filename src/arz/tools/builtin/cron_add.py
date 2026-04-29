"""cron_add — schedule a recurring or one-shot prompt."""

tool_spec = {
    "name": "cron_add",
    "description": (
        "Schedule a prompt to run on a cadence. Use when the user says 'every "
        "morning', 'every Monday', 'in 2 weeks', or wants something to keep "
        "happening on its own."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "name": {"type": "string"},
            "schedule": {
                "type": "string",
                "description": "Cron expression (m h dom mon dow), or '@every 30m', or 'at 1700' for daily.",
            },
            "prompt": {"type": "string"},
        },
        "required": ["name", "schedule", "prompt"],
    },
}


async def run(input: dict) -> str:
    from arz.dashboard.cron import get_cron_registry

    name = (input.get("name") or "").strip()
    schedule = (input.get("schedule") or "").strip()
    prompt = (input.get("prompt") or "").strip()
    if not (name and schedule and prompt):
        return "error: name, schedule, prompt all required"
    try:
        registry = get_cron_registry()
    except Exception as e:
        return f"error: cron registry unavailable: {e}"
    saved = registry.create(name=name, prompt=prompt, schedule=schedule, enabled=True)
    return f"scheduled cron #{saved.id} '{saved.name}' ({saved.schedule})"
