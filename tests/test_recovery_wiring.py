"""Turn recovery is wired into the chat runner end-to-end."""

from __future__ import annotations

import asyncio
from pathlib import Path

from arz.acp.types import EVENT_COMPLETE, EVENT_TEXT_CHUNK, EVENT_TOOL_CALL
from arz.dashboard.routes.chat import _run_turn
from arz.dashboard.stream_registry import get_stream_registry
from arz.providers.base import LLMEvent, LLMProvider
from arz.recovery import PROMISE_ONLY_PREFIX
from arz.session.manager import SessionManager


class _ScriptedProvider(LLMProvider):
    name = "fake"

    def __init__(self, events: list[LLMEvent]) -> None:
        self._events = events

    async def start(self) -> None:
        pass

    async def shutdown(self) -> None:
        pass

    async def stream(self, message: str):  # type: ignore[override]
        for ev in self._events:
            yield ev

    async def approve_tool(self, request_id: str | int) -> None:
        pass

    async def reject_tool(self, request_id: str | int) -> None:
        pass

    def context_usage_pct(self) -> float:
        return 0.0


def _run(tmp_path: Path, events: list[LLMEvent], **kw) -> list[tuple[str, str, dict | None]]:
    calls: list[tuple[str, str, dict | None]] = []

    async def runner(sid: str, msg: str, extra_body: dict | None = None) -> None:
        calls.append((sid, msg, extra_body))

    async def go() -> None:
        mgr = SessionManager(sessions_dir=tmp_path)
        s = mgr.create(surface="dashboard", chat_id="web")
        s.add_message("user", "ship it")
        await get_stream_registry().start(s.id)
        await _run_turn(_ScriptedProvider(events), s.id, "ship it", mgr, chat_runner=runner, **kw)
        await asyncio.sleep(0.7)  # recovery POST is scheduled after a short settle

    asyncio.run(go())
    return calls


def _text(t: str) -> LLMEvent:
    return LLMEvent(kind=EVENT_TEXT_CHUNK, text=t)


def test_promise_only_turn_gets_one_continuation(tmp_path: Path) -> None:
    calls = _run(
        tmp_path, [_text("Tests pass. I'll open the PR now."), LLMEvent(kind=EVENT_COMPLETE)]
    )
    assert len(calls) == 1
    assert calls[0][1].startswith(PROMISE_ONLY_PREFIX)
    assert calls[0][2] == {"_recovery": True}


def test_recovery_turn_does_not_recover_again(tmp_path: Path) -> None:
    calls = _run(
        tmp_path,
        [_text("I'll open the PR now."), LLMEvent(kind=EVENT_COMPLETE)],
        is_recovery=True,
    )
    assert calls == []


def test_promise_before_tool_call_is_not_recovered(tmp_path: Path) -> None:
    calls = _run(
        tmp_path,
        [
            _text("I'll open the PR now."),
            LLMEvent(kind=EVENT_TOOL_CALL, text="Bash", tool_input="gh pr create"),
            _text("Opened #12."),
            LLMEvent(kind=EVENT_COMPLETE),
        ],
    )
    assert calls == []


def test_normal_answer_not_recovered(tmp_path: Path) -> None:
    assert _run(tmp_path, [_text("Here is the answer."), LLMEvent(kind=EVENT_COMPLETE)]) == []
