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


def sse_complete(
    stop_reason: str = "end_turn",
    context_pct: float = 0.0,
    usage: dict[str, int] | None = None,
) -> str:
    payload: dict[str, Any] = {
        "type": "complete",
        "stop_reason": stop_reason,
        "context_pct": context_pct,
    }
    if usage is not None:
        payload["usage"] = usage
    return sse_event(payload)


def sse_error(message: str) -> str:
    return sse_event({"type": "error", "message": message})


def sse_tool_call(tool_name: str, tool_input: str, request_id: str | int) -> str:
    return sse_event(
        {
            "type": "tool_call",
            "tool_name": tool_name,
            "tool_input": tool_input,
            "request_id": str(request_id),
        }
    )


def sse_tool_result(tool_call_id: str, content: str) -> str:
    return sse_event(
        {
            "type": "tool_result",
            "tool_call_id": tool_call_id,
            "content": content,
        }
    )


def sse_permission_request(title: str, tool_input: str, request_id: str) -> str:
    return sse_event(
        {
            "type": "permission_request",
            "title": title,
            "tool_input": tool_input,
            "request_id": request_id,
        }
    )
