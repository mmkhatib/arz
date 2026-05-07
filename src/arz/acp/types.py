"""ACP protocol types — events, JSON-RPC messages, constants."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

# ── Event kinds emitted by AcpClient ──────────────────────────────────────────

EVENT_TEXT_CHUNK = "text_chunk"
EVENT_THINKING_CHUNK = "thinking_chunk"
EVENT_TOOL_CALL = "tool_call"
EVENT_TOOL_RESULT = "tool_result"
EVENT_PERMISSION_REQUEST = "permission_request"
EVENT_COMPACTION_STATUS = "compaction_status"
EVENT_COMPLETE = "complete"

# ── ACP JSON-RPC method names ──────────────────────────────────────────────────

METHOD_INITIALIZE = "initialize"
METHOD_SESSION_NEW = "session/new"
METHOD_SESSION_LOAD = "session/load"
METHOD_SET_MODEL = "session/set_model"
METHOD_SET_MODE = "session/set_mode"
METHOD_PROMPT = "session/prompt"
METHOD_CANCEL = "session/cancel"
METHOD_REQUEST_PERMISSION = "session/request_permission"
METHOD_SESSION_UPDATE = "session/update"

# ── session/update sub-types ───────────────────────────────────────────────────

UPDATE_AGENT_MESSAGE_CHUNK = "agent_message_chunk"
UPDATE_TOOL_CALL = "tool_call"

# ── Permission outcomes ────────────────────────────────────────────────────────

OUTCOME_SELECTED = "selected"
OPTION_ALLOW_ONCE = "allow_once"
OPTION_ALLOW_ALWAYS = "allow_always"

# ── Protocol version ──────────────────────────────────────────────────────────

PROTOCOL_VERSION = "2025-08-22"


@dataclass
class JsonRpcRequest:
    """Outbound JSON-RPC 2.0 request."""

    method: str
    params: dict[str, Any]
    id: int
    jsonrpc: str = "2.0"

    def to_dict(self) -> dict[str, Any]:
        return {
            "jsonrpc": self.jsonrpc,
            "id": self.id,
            "method": self.method,
            "params": self.params,
        }


@dataclass
class JsonRpcMessage:
    """Inbound JSON-RPC 2.0 message (response or notification)."""

    id: Any = None
    method: str | None = None
    result: Any = None
    error: Any = None
    params: Any = None

    def is_response_for(self, req_id: int) -> bool:
        return self.id == req_id

    def is_notification(self, name: str) -> bool:
        return self.id is None and self.method == name

    def is_request(self, name: str) -> bool:
        return self.id is not None and self.method == name


@dataclass
class Usage:
    """Per-turn usage. Token counts come from Anthropic-style providers
    (Claude Code); ``credits``/``credit_unit`` come from Kiro's metering
    metadata. ``turn_duration_ms`` is the wall time the agent reported (Kiro)
    or that we measured (CC). Fields are union-of-providers so the dashboard
    can surface whichever the active provider offers."""

    input_tokens: int = 0
    output_tokens: int = 0
    cache_creation_input_tokens: int = 0
    cache_read_input_tokens: int = 0
    credits: float = 0.0
    credit_unit: str = ""
    turn_duration_ms: int = 0

    def to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {
            "input_tokens": self.input_tokens,
            "output_tokens": self.output_tokens,
            "cache_creation_input_tokens": self.cache_creation_input_tokens,
            "cache_read_input_tokens": self.cache_read_input_tokens,
        }
        if self.credits:
            d["credits"] = self.credits
            d["credit_unit"] = self.credit_unit or "credit"
        if self.turn_duration_ms:
            d["turn_duration_ms"] = self.turn_duration_ms
        return d

    @classmethod
    def from_dict(cls, d: dict[str, Any] | None) -> Usage | None:
        if not d:
            return None
        return cls(
            input_tokens=int(d.get("input_tokens", 0) or 0),
            output_tokens=int(d.get("output_tokens", 0) or 0),
            cache_creation_input_tokens=int(d.get("cache_creation_input_tokens", 0) or 0),
            cache_read_input_tokens=int(d.get("cache_read_input_tokens", 0) or 0),
            credits=float(d.get("credits", 0.0) or 0.0),
            credit_unit=str(d.get("credit_unit", "") or ""),
            turn_duration_ms=int(d.get("turn_duration_ms", 0) or 0),
        )


@dataclass
class AcpEvent:
    """One streaming event emitted to callers of AcpClient."""

    kind: str
    text: str = ""
    tool_call_id: str = ""
    title: str = ""
    tool_input: str = ""
    tool_output: str = ""
    stop_reason: str = ""
    request_id: str | int = ""
    options: list[dict[str, str]] = field(default_factory=list)
    context_usage_pct: float = 0.0
    usage: Usage | None = None
    extra: dict[str, Any] = field(default_factory=dict)
