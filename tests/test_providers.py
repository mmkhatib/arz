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


# ── Mid-turn steer ─────────────────────────────────────────────────────────────


def test_every_provider_answers_the_steer_contract() -> None:
    """Conformance: `steer` / `supports_steer` exist on every implementation.

    A provider without a native mid-turn path must say so rather than raise —
    the chat route reads the flag to decide between steering and queueing.
    """
    from arz.providers.claude_code import ClaudeCodeProvider
    from arz.providers.codex import CodexProvider
    from arz.providers.gemini import GeminiProvider
    from arz.providers.kiro_cli import KiroCliProvider
    from arz.providers.ollama import OllamaProvider

    for cls in (
        ClaudeCodeProvider,
        KiroCliProvider,
        CodexProvider,
        GeminiProvider,
        OllamaProvider,
    ):
        assert callable(getattr(cls, "steer", None)), f"{cls.__name__} has no steer()"
        assert isinstance(getattr(cls, "supports_steer", None), property)


@pytest.mark.asyncio
async def test_claude_interactive_steer_refused_outside_a_turn() -> None:
    """A steer with no turn running would be answered as a fresh turn, whose
    reply the next turn's reader would then mistake for its own."""
    from arz.acp.claude_interactive import ClaudeInteractiveClient

    client = ClaudeInteractiveClient.__new__(ClaudeInteractiveClient)
    client._process = MagicMock(returncode=None)  # noqa: SLF001
    client._turn_active = False  # noqa: SLF001

    assert await client.steer("change course") is False
    assert client._steer_pending == 0  # noqa: SLF001


@pytest.mark.asyncio
async def test_claude_interactive_steer_writes_and_owes_a_result() -> None:
    """An accepted steer wraps the text and books the extra `result` frame the
    turn now owes, so the reader keeps going instead of closing early."""
    from arz.acp.claude_interactive import ClaudeInteractiveClient

    client = ClaudeInteractiveClient.__new__(ClaudeInteractiveClient)
    client._process = MagicMock(returncode=None)  # noqa: SLF001
    client._turn_active = True  # noqa: SLF001
    client._steer_pending = 0  # noqa: SLF001
    written: list[dict] = []  # type: ignore[type-arg]

    async def _capture(obj: dict) -> None:  # type: ignore[type-arg]
        written.append(obj)

    client._write_json = _capture  # type: ignore[method-assign]  # noqa: SLF001

    assert await client.steer("stop at 10") is True
    assert client._steer_pending == 1  # noqa: SLF001
    text = written[0]["message"]["content"][0]["text"]
    assert text == "<user_message>\nstop at 10\n</user_message>"


@pytest.mark.asyncio
async def test_steered_reply_stays_inside_the_same_turn() -> None:
    """The CLI closes the pre-steer work with its own `result`, then answers the
    steer with a second one. Both are this turn's — one COMPLETE, no leftovers
    in the pipe for the next turn to read."""
    from arz.acp.claude_interactive import ClaudeInteractiveClient

    client = ClaudeInteractiveClient.__new__(ClaudeInteractiveClient)
    client._session_id = "s1"  # noqa: SLF001
    client._resumed = False  # noqa: SLF001

    lines = [
        json.dumps(
            {"type": "assistant", "message": {"content": [{"type": "text", "text": "1..40"}]}}
        ).encode()
        + b"\n",
        json.dumps({"type": "result", "is_error": False}).encode() + b"\n",
        json.dumps(
            {"type": "assistant", "message": {"content": [{"type": "text", "text": "STEERED"}]}}
        ).encode()
        + b"\n",
        json.dumps({"type": "result", "is_error": False}).encode() + b"\n",
    ]
    proc = MagicMock(returncode=None)
    proc.stdout = AsyncMock()
    proc.stdout.readline = AsyncMock(side_effect=lines + [b""])
    proc.stdin = MagicMock()
    client._process = proc  # noqa: SLF001

    async def _noop(obj: dict) -> None:  # type: ignore[type-arg]
        return None

    client._write_json = _noop  # type: ignore[method-assign]  # noqa: SLF001

    events: list[LLMEvent] = []
    steered = False
    async for ev in client.stream_events("list 1..40"):
        if not steered:
            # Injected while the first result is still ahead of the reader.
            await client.steer("stop at 10")
            steered = True
        events.append(ev)

    texts = [e.text for e in events if e.kind == EVENT_TEXT_CHUNK]
    assert texts == ["1..40", "STEERED"]
    assert sum(1 for e in events if e.kind == EVENT_COMPLETE) == 1
    # Turn state is released so the next turn starts from a clean slate.
    assert client._turn_active is False  # noqa: SLF001
    assert client._steer_pending == 0  # noqa: SLF001
