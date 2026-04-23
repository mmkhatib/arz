"""SSE event formatting helpers."""

from __future__ import annotations

import json
from typing import Any


def sse_event(data: Any, event: str | None = None) -> str:
    """Format a server-sent event as a string."""
    payload = json.dumps(data) if not isinstance(data, str) else data
    lines = []
    if event:
        lines.append(f"event: {event}")
    lines.append(f"data: {payload}")
    lines.append("")
    return "\n".join(lines) + "\n"


def sse_chunk(text: str) -> str:
    return sse_event({"type": "text_chunk", "text": text})


def sse_complete(stop_reason: str = "end_turn") -> str:
    return sse_event({"type": "complete", "stop_reason": stop_reason})


def sse_error(message: str) -> str:
    return sse_event({"type": "error", "message": message})


def sse_tool_call(tool_name: str, tool_input: str, request_id: str | int) -> str:
    return sse_event({
        "type": "tool_call",
        "tool_name": tool_name,
        "tool_input": tool_input,
        "request_id": str(request_id),
    })
