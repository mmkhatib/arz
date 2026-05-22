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


# Stay-on-task tier 2 — extra event kinds the frontend uses for
# segmentation + status banners.


def sse_thinking(text: str) -> str:
    """Streaming reasoning / scratchpad text. Renders in a separate
    collapsible panel, never in the main bubble."""
    return sse_event({"type": "thinking_chunk", "text": text})


def sse_compaction(status: str, detail: str = "") -> str:
    """Provider context-compaction status — ``in_progress`` / ``done``
    / ``failed``. Renders as a top-of-chat banner."""
    return sse_event({"type": "compaction_status", "status": status, "detail": detail})


def sse_segment() -> str:
    """Bubble-boundary hint: close the current streaming bubble + start
    fresh on the next text_chunk. Emitted when a tool-group ends and
    text resumes."""
    return sse_event({"type": "chat_segment"})


def sse_heartbeat() -> str:
    """5s keepalive ping during long turns. Frontend resets its
    client-side stall timer; not rendered."""
    return sse_event({"type": "heartbeat"})


def sse_writer_done() -> str:
    """Writer turn finished + assistant message persisted. Frontend
    clears its live streamBuffer so the just-saved bubble doesn't
    duplicate-render alongside the streaming bubble while the
    evaluator runs. Distinct from sse_complete — that one fires
    only after the evaluator has streamed its chips."""
    return sse_event({"type": "writer_done"})
