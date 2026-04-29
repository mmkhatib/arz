"""spawn_run — fire a background subagent.

The subagent runs in isolation; its result will be injected into the parent
session's next turn as `[subagent:<name> status=…] …`. This call returns
immediately with the subagent id, NOT the result.
"""

tool_spec = {
    "name": "spawn_run",
    "description": (
        "Fire a background subagent with an isolated context. Returns "
        "immediately. The subagent's reply will be injected into the next "
        "turn of this session as a system message. Use for parallel work, "
        "long research, or anything that would otherwise blow the context "
        "budget."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "agent": {
                "type": "string",
                "description": "Agent name (e.g. researcher, code-reviewer, architect).",
            },
            "prompt": {
                "type": "string",
                "description": "What you want the subagent to do.",
            },
            "parent_session_id": {
                "type": "string",
                "description": "Required: this session's id, so the result lands here.",
            },
        },
        "required": ["agent", "prompt", "parent_session_id"],
    },
}


async def run(input: dict) -> str:
    from arz.subagents import get_subagent_manager

    parent = (input.get("parent_session_id") or "").strip()
    agent = (input.get("agent") or "general").strip()
    prompt = (input.get("prompt") or "").strip()
    if not parent:
        return "error: parent_session_id required"
    if not prompt:
        return "error: prompt required"
    try:
        rec = get_subagent_manager().spawn(parent, agent, prompt)
    except RuntimeError as e:
        return f"error: {e}"
    return f"spawned subagent {rec.id} [{agent}]"
