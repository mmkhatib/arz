"""Unit tests for ACP types and JSON-RPC serialization."""

from __future__ import annotations

import json

from arz.acp.types import (
    EVENT_TEXT_CHUNK,
    AcpEvent,
    JsonRpcMessage,
    JsonRpcRequest,
)


def test_jsonrpc_request_serializes() -> None:
    req = JsonRpcRequest(method="session/prompt", params={"message": "hello"}, id=1)
    d = req.to_dict()
    assert d["jsonrpc"] == "2.0"
    assert d["id"] == 1
    assert d["method"] == "session/prompt"
    assert d["params"] == {"message": "hello"}


def test_jsonrpc_request_is_json_serializable() -> None:
    req = JsonRpcRequest(method="initialize", params={"protocolVersion": "2025-08-22"}, id=2)
    raw = json.dumps(req.to_dict())
    parsed = json.loads(raw)
    assert parsed["id"] == 2


def test_jsonrpc_message_is_response_for() -> None:
    msg = JsonRpcMessage(id=3, result={"sessionId": "abc"})
    assert msg.is_response_for(3)
    assert not msg.is_response_for(4)


def test_jsonrpc_message_is_notification() -> None:
    msg = JsonRpcMessage(id=None, method="session/update", params={"type": "agent_message_chunk"})
    assert msg.is_notification("session/update")
    assert not msg.is_notification("session/prompt")


def test_jsonrpc_message_is_request() -> None:
    msg = JsonRpcMessage(id=42, method="session/request_permission", params={})
    assert msg.is_request("session/request_permission")
    assert not msg.is_notification("session/request_permission")


def test_acp_event_defaults() -> None:
    event = AcpEvent(kind=EVENT_TEXT_CHUNK, text="hello")
    assert event.kind == EVENT_TEXT_CHUNK
    assert event.text == "hello"
    assert event.tool_call_id == ""
    assert event.options == []
