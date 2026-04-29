"""learn_add — store a durable lesson that future sessions will see."""

tool_spec = {
    "name": "learn_add",
    "description": (
        "Store a durable lesson that auto-injects into future sessions. "
        "Use when the user corrects you, expresses a preference, or teaches "
        "you something the runtime should remember next time."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "category": {
                "type": "string",
                "enum": ["preference", "tool", "knowledge"],
                "description": "preference = user style/dont-do; tool = how to use a tool; knowledge = a fact",
            },
            "text": {"type": "string", "description": "The lesson, in one or two sentences."},
            "pinned": {"type": "boolean", "description": "Pin to never evict.", "default": False},
        },
        "required": ["category", "text"],
    },
}


async def run(input: dict) -> str:
    from arz.lessons import get_lesson_store

    category = (input.get("category") or "knowledge").strip()
    text = (input.get("text") or "").strip()
    pinned = bool(input.get("pinned", False))
    if not text:
        return "error: text is required"
    try:
        l = get_lesson_store().add(category, text, pinned)
    except ValueError as e:
        return f"error: {e}"
    return f"saved lesson #{l.id} [{l.category}]"
