"""Tests for transcript compression (Phase 2)."""

from __future__ import annotations

import pytest


def _msg(role: str, text: str) -> dict:
    return {"role": role, "text": text}


@pytest.mark.asyncio
async def test_short_history_returns_verbatim():
    from arz.memory.compress import compress_history

    msgs = [_msg("user", "hi"), _msg("assistant", "hello")]
    out = await compress_history(msgs, runner=None)
    assert out == msgs


@pytest.mark.asyncio
async def test_no_runner_returns_verbatim_even_when_long():
    from arz.memory.compress import compress_history

    msgs = [_msg("user", "x" * 1000) for _ in range(50)]  # ~50k chars
    out = await compress_history(msgs, runner=None)
    assert out == msgs  # runner missing → no compression


@pytest.mark.asyncio
async def test_long_history_compresses_middle():
    from arz.memory.compress import compress_history

    # 50 messages * 1000 chars = 50k > 32k threshold
    msgs = [
        _msg("user" if i % 2 == 0 else "assistant", f"msg-{i} " + "x" * 1000) for i in range(50)
    ]

    summary_text = "Worked on the auth refactor. Decided on JWT. Migration pending."
    calls = []

    async def fake_runner(agent: str, prompt: str) -> str:
        calls.append((agent, prompt))
        return summary_text

    out = await compress_history(msgs, runner=fake_runner)
    # head + 1 synthetic + tail (Phase 4 tightened head_tail 10 → 5).
    from arz.memory.compress import _HEAD_TAIL_MESSAGES as HT

    assert len(out) == HT + 1 + HT
    # Synthetic sits between head and tail.
    synth = out[HT]
    assert synth["role"] == "system"
    assert "COMPRESSED MIDDLE" in synth["text"]
    assert summary_text in synth["text"]
    # Head + tail kept exact
    assert out[:HT] == msgs[:HT]
    assert out[-HT:] == msgs[-HT:]
    # Runner called exactly once with the segment
    assert len(calls) == 1


@pytest.mark.asyncio
async def test_failed_runner_falls_through_to_verbatim():
    from arz.memory.compress import compress_history

    msgs = [_msg("user" if i % 2 == 0 else "assistant", "x" * 1000) for i in range(50)]

    async def boom(agent: str, prompt: str) -> str:
        raise RuntimeError("model down")

    out = await compress_history(msgs, runner=boom)
    assert out == msgs


@pytest.mark.asyncio
async def test_empty_summary_falls_through():
    from arz.memory.compress import compress_history

    msgs = [_msg("user" if i % 2 == 0 else "assistant", "x" * 1000) for i in range(50)]

    async def empty(agent: str, prompt: str) -> str:
        return ""

    out = await compress_history(msgs, runner=empty)
    assert out == msgs
