"""learn_list — list stored lessons."""

tool_spec = {
    "name": "learn_list",
    "description": "List the lessons stored for this user.",
    "input_schema": {
        "type": "object",
        "properties": {
            "category": {
                "type": "string",
                "enum": ["preference", "tool", "knowledge"],
                "description": "Filter by category. Omit for all.",
            },
        },
    },
}


async def run(input: dict) -> str:
    from arz.lessons import get_lesson_store

    category = (input.get("category") or "").strip()
    lessons = get_lesson_store().list()
    if category:
        lessons = [l for l in lessons if l.category == category]
    if not lessons:
        return "(no lessons)"
    lines = [
        f"#{l.id} [{l.category}]{' 📌' if l.pinned else ''} {l.text}"
        for l in lessons
    ]
    return "\n".join(lines)
