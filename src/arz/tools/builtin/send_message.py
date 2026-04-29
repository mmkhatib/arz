"""send_message — post into a channel that other agents share with you."""

tool_spec = {
    "name": "send_message",
    "description": (
        "Post a message into a multi-agent channel. Use this to coordinate "
        "with other agents that are members of the same channel. Use "
        "@agent-name to mention them. Returns the new message id."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "channel": {"type": "string", "description": "Channel slug."},
            "text": {"type": "string"},
            "from": {
                "type": "string",
                "description": "Sender label — your agent name.",
                "default": "agent",
            },
            "in_reply_to": {"type": "integer"},
        },
        "required": ["channel", "text"],
    },
}


async def run(input: dict) -> str:
    from arz.channels import get_channel_store

    slug = (input.get("channel") or "").strip()
    text = (input.get("text") or "").strip()
    from_ = (input.get("from") or "agent").strip()
    in_reply_to = input.get("in_reply_to")
    if not (slug and text):
        return "error: channel and text required"
    try:
        msg = get_channel_store().post(slug, from_, text, in_reply_to)
    except KeyError:
        return f"error: channel '{slug}' not found"
    return f"posted #{msg.id} to {slug}"
