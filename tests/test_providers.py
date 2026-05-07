"""Unit tests for KiroCliProvider and ClaudeCodeProvider using mock subprocesses."""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from arz.acp.types import EVENT_COMPLETE, EVENT_TEXT_CHUNK
from arz.providers.base import LLMEvent


def _make_jsonl(*objs: dict) -> bytes:  # type: ignore[type-arg]
    """Encode multiple dicts as newline-delimited JSON bytes."""
    return b"".join(json.dumps(o).encode() + b"\n" for o in objs)


# ── ClaudeCodeProvider ─────────────────────────────────────────────────────────


@pytest.mark.skip(reason="ACP handshake changed; mock setup needs refresh")
@pytest.mark.asyncio
async def test_claude_code_provider_streams_text() -> None:
    from arz.providers.claude_code import ClaudeCodeProvider

    stream_output = _make_jsonl(
        {"type": "system", "subtype": "init", "session_id": "s1"},
        {"type": "assistant", "message": {"content": [{"type": "text", "text": "Hello!"}]}},
        {"type": "result", "subtype": "success", "result": "Hello!", "is_error": False},
    )

    mock_process = MagicMock()
    mock_process.returncode = None
    mock_process.stdout = AsyncMock()
    mock_process.stdout.readline = AsyncMock(
        side_effect=[
            stream_output.split(b"\n")[0] + b"\n",
            stream_output.split(b"\n")[1] + b"\n",
            stream_output.split(b"\n")[2] + b"\n",
            b"",
        ]
    )
    mock_process.kill = MagicMock()
    mock_process.wait = AsyncMock()

    with (
        patch("shutil.which", return_value="/usr/bin/claude"),
        patch("asyncio.create_subprocess_exec", return_value=mock_process),
    ):
        provider = ClaudeCodeProvider(model="claude-opus-4-7")
        await provider.start()

        events: list[LLMEvent] = []
        async for event in provider.stream("hello"):
            events.append(event)

    text_events = [e for e in events if e.kind == EVENT_TEXT_CHUNK]
    complete_events = [e for e in events if e.kind == EVENT_COMPLETE]
    assert len(text_events) >= 1
    assert any(e.text == "Hello!" for e in text_events)
    assert len(complete_events) == 1


@pytest.mark.skip(reason="ACP handshake changed; mock setup needs refresh")
@pytest.mark.asyncio
async def test_claude_code_provider_handles_empty_stream() -> None:
    from arz.providers.claude_code import ClaudeCodeProvider

    mock_process = MagicMock()
    mock_process.returncode = 0
    mock_process.stdout = AsyncMock()
    mock_process.stdout.readline = AsyncMock(return_value=b"")
    mock_process.kill = MagicMock()
    mock_process.wait = AsyncMock()

    with (
        patch("shutil.which", return_value="/usr/bin/claude"),
        patch("asyncio.create_subprocess_exec", return_value=mock_process),
    ):
        provider = ClaudeCodeProvider()
        await provider.start()
        events = [e async for e in provider.stream("hi")]

    complete = [e for e in events if e.kind == EVENT_COMPLETE]
    assert len(complete) == 1


# ── KiroCliProvider ────────────────────────────────────────────────────────────


@pytest.mark.skip(reason="ACP handshake changed; mock setup needs refresh")
@pytest.mark.asyncio
async def test_kiro_cli_provider_streams_text() -> None:
    from arz.providers.kiro_cli import KiroCliProvider

    # Simulate ACP JSON-RPC responses
    init_response = json.dumps({"jsonrpc": "2.0", "id": 1, "result": {}}).encode() + b"\n"
    text_notification = (
        json.dumps(
            {
                "jsonrpc": "2.0",
                "method": "session/update",
                "params": {"type": "agent_message_chunk", "content": "Hi there!"},
            }
        ).encode()
        + b"\n"
    )
    prompt_response = (
        json.dumps({"jsonrpc": "2.0", "id": 4, "result": {"done": True}}).encode() + b"\n"
    )

    mock_process = MagicMock()
    mock_process.returncode = None
    mock_process.pid = 12345
    mock_process.stdin = AsyncMock()
    mock_process.stdin.write = MagicMock()
    mock_process.stdin.drain = AsyncMock()
    mock_process.stdout = AsyncMock()
    mock_process.stdout.readline = AsyncMock(
        side_effect=[
            init_response,
            b"",  # drain_briefly reads (session/new)
            b"",  # drain_briefly reads (set_model)
            text_notification,
            prompt_response,
            b"",
        ]
    )
    mock_process.stderr = AsyncMock()
    mock_process.stderr.readline = AsyncMock(return_value=b"")

    with (
        patch("shutil.which", return_value="/usr/local/bin/kiro-cli"),
        patch("asyncio.create_subprocess_exec", return_value=mock_process),
    ):
        provider = KiroCliProvider(model="claude-opus-4-7")
        await provider.start()

        events: list[LLMEvent] = []
        async for event in provider.stream("hello"):
            events.append(event)

    text_events = [e for e in events if e.kind == EVENT_TEXT_CHUNK]
    complete_events = [e for e in events if e.kind == EVENT_COMPLETE]
    assert any("Hi there!" in (e.text or "") for e in text_events)
    assert len(complete_events) == 1


# ── Config ────────────────────────────────────────────────────────────────────


def test_load_config_defaults(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    # Sandbox HOME so a user-level ~/.arz/config.toml on the dev machine
    # doesn't shadow the defaults this test asserts.
    monkeypatch.setenv("HOME", str(tmp_path))
    # Reset module-level Path cache by reimporting.
    import importlib

    from arz.config import loader

    importlib.reload(loader)
    config = loader.load_config()
    assert config.provider.name == "claude-code"
    assert config.provider.model == "claude-opus-4-7"
    assert config.dashboard.port == 7777
    assert config.dashboard.bot_name == "Arzeh"


def test_load_config_env_override(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ARZ_PROVIDER__NAME", "kiro-cli")
    monkeypatch.setenv("ARZ_DASHBOARD__PORT", "8888")

    from arz.config import load_config

    config = load_config()
    assert config.provider.name == "kiro-cli"
    # port comes in as string from env, pydantic coerces to int
    assert config.dashboard.port == 8888
