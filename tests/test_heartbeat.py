"""HeartbeatService — verify items inside HTML comment blocks don't fire."""

from __future__ import annotations

import asyncio
from pathlib import Path

import pytest

from arz.heartbeat import HeartbeatService


@pytest.mark.asyncio
async def test_skips_items_inside_html_comment(tmp_path: Path) -> None:
    md = tmp_path / "HEARTBEAT.md"
    md.write_text(
        "# Heartbeat\n"
        "<!--\n"
        "- [ ] Should never fire\n"
        "- [ ] Also should never fire <!-- KEEP -->\n"
        "-->\n"
        "- [ ] Real item\n",
        encoding="utf-8",
    )
    fired: list[str] = []

    async def runner(_agent: str, prompt: str) -> str:
        fired.append(prompt)
        return ""

    svc = HeartbeatService(runner, path=md, interval_s=60)
    await svc._tick()
    assert fired == ["Real item"]


@pytest.mark.asyncio
async def test_keep_marker_stripped_from_prompt(tmp_path: Path) -> None:
    md = tmp_path / "HEARTBEAT.md"
    md.write_text(
        "- [ ] Renew tokens <!-- KEEP -->\n",
        encoding="utf-8",
    )
    fired: list[str] = []

    async def runner(_agent: str, prompt: str) -> str:
        fired.append(prompt)
        return ""

    svc = HeartbeatService(runner, path=md, interval_s=60)
    await svc._tick()
    assert fired == ["Renew tokens"]
    # Marked done after fire, but KEEP resets next tick — that's a separate cycle.
    assert "[x]" in md.read_text()


@pytest.mark.asyncio
async def test_skips_completed_items_without_keep(tmp_path: Path) -> None:
    md = tmp_path / "HEARTBEAT.md"
    md.write_text("- [x] Already done\n", encoding="utf-8")
    fired: list[str] = []

    async def runner(_agent: str, prompt: str) -> str:
        fired.append(prompt)
        return ""

    svc = HeartbeatService(runner, path=md, interval_s=60)
    await svc._tick()
    assert fired == []


if __name__ == "__main__":
    asyncio.run(test_skips_items_inside_html_comment(Path("/tmp/test")))
