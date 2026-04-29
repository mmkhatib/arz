"""task_run — hand off a markdown spec to the autonomous task runner."""

tool_spec = {
    "name": "task_run",
    "description": (
        "Hand a markdown spec to the autonomous task runner. The runner will "
        "decompose it into ordered steps, execute each, and verify the result "
        "against the spec. Returns the task id immediately; check progress "
        "via the dashboard."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "spec": {"type": "string", "description": "The markdown spec body."},
            "agent": {"type": "string", "default": "general"},
        },
        "required": ["spec"],
    },
}


async def run(input: dict) -> str:
    from arz.taskrunner import get_task_runner

    spec = (input.get("spec") or "").strip()
    agent = (input.get("agent") or "general").strip()
    if not spec:
        return "error: spec required"
    try:
        rec = await get_task_runner().kick_off(spec, agent)
    except RuntimeError as e:
        return f"error: {e}"
    return f"task {rec.id} started ({len(rec.steps) or '?'} steps planned)"
