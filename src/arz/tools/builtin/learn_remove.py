"""learn_remove — delete a lesson by id."""

tool_spec = {
    "name": "learn_remove",
    "description": "Delete a lesson by its id.",
    "input_schema": {
        "type": "object",
        "properties": {"id": {"type": "integer"}},
        "required": ["id"],
    },
}


async def run(input: dict) -> str:
    from arz.lessons import get_lesson_store

    lid = int(input.get("id") or 0)
    if not lid:
        return "error: id required"
    if get_lesson_store().remove(lid):
        return f"removed lesson #{lid}"
    return f"no lesson #{lid}"
