"""HeartbeatService — read ~/.arz/HEARTBEAT.md on a fixed interval and run
each unchecked checklist item as a one-shot subagent.

Markdown format:

    # Arz heartbeat checklist
    - [ ] First task description
    - [ ] Another task <!-- KEEP -->
    - [x] Already done; will be skipped

After running, the line is rewritten with `[x]`. Lines marked
`<!-- KEEP -->` get reset back to `[ ]` after the next cycle, so they keep
firing.
"""

from __future__ import annotations

import asyncio
import re
from pathlib import Path

import structlog

log = structlog.get_logger(__name__)

_PATH = Path.home() / ".arz" / "HEARTBEAT.md"
_DEFAULT_INTERVAL_S = 300  # 5 minutes
_TASK_RE = re.compile(r"^(\s*-\s*\[)( |x|X)(\]\s*)(.*?)$")
_KEEP_RE = re.compile(r"<!--\s*KEEP\s*-->", re.IGNORECASE)


def _ensure_default_file() -> None:
    if _PATH.exists():
        return
    _PATH.parent.mkdir(parents=True, exist_ok=True)
    _PATH.write_text(
        "# Arz heartbeat checklist\n"
        "\n"
        "Tick `[ ]` items run on each tick (default every 5 min) using the\n"
        "configured agent. After a successful run the line flips to `[x]`.\n"
        "Lines tagged with `<!-- KEEP -->` reset to `[ ]` afterward so they\n"
        "keep firing.\n"
        "\n"
        "**No items are scheduled by default.** Add `- [ ] your prompt` lines\n"
        "below to enable. Each unchecked line will run on the next tick and\n"
        "will hit your configured LLM provider — costs money on hosted models.\n"
        "\n"
        "Examples to copy (the leading `<!--` keeps them inert until you\n"
        "uncomment):\n"
        "<!--\n"
        "- [ ] Summarise the open browser tabs <!-- KEEP -->\n"
        "- [ ] Check the inbox for unread urgent items\n"
        "-->\n",
        encoding="utf-8",
    )


class HeartbeatService:
    def __init__(
        self,
        runner,  # async (agent_name, prompt) -> str
        path: Path | None = None,
        interval_s: int = _DEFAULT_INTERVAL_S,
        agent_name: str = "general",
    ) -> None:
        self._runner = runner
        self._path = path or _PATH
        # interval_s <= 0 disables the loop entirely. Otherwise clamp to
        # at least 60s so we don't hammer the LLM on misconfig.
        n = int(interval_s)
        self._interval = 0 if n <= 0 else max(60, n)
        self._agent = agent_name
        self._task: asyncio.Task | None = None
        self._stopping = asyncio.Event()
        _ensure_default_file()

    def start(self) -> None:
        if self._interval <= 0:
            log.info("heartbeat disabled (interval_s=0)")
            return
        if self._task and not self._task.done():
            return
        self._stopping.clear()
        self._task = asyncio.create_task(self._loop())
        log.info("heartbeat started", path=str(self._path), interval_s=self._interval)

    def stop(self) -> None:
        self._stopping.set()
        if self._task:
            self._task.cancel()

    async def _loop(self) -> None:
        # Stagger first tick a few seconds after start so the gateway is fully up.
        try:
            await asyncio.wait_for(self._stopping.wait(), timeout=10.0)
            return
        except TimeoutError:
            pass
        while not self._stopping.is_set():
            try:
                await self._tick()
            except Exception:
                log.exception("heartbeat tick failed")
            try:
                await asyncio.wait_for(self._stopping.wait(), timeout=self._interval)
            except TimeoutError:
                continue

    async def _tick(self) -> None:
        if not self._path.exists():
            return
        text = self._path.read_text(encoding="utf-8")
        lines = text.splitlines(keepends=False)
        rewrote = False
        in_comment = False  # tracks `<!--` … `-->` block depth
        for i, line in enumerate(lines):
            stripped = line.strip()
            # Track HTML comment region. Lines that open a comment without
            # closing it on the same line enter the region; lines that
            # contain `-->` exit it. Single-line `<!-- … -->` stays out.
            opens = "<!--" in stripped
            closes = "-->" in stripped
            if in_comment:
                if closes:
                    in_comment = False
                continue
            if opens and not closes:
                in_comment = True
                continue
            m = _TASK_RE.match(line)
            if not m:
                continue
            mark = m.group(2)
            body = m.group(4)
            # Strip an inline KEEP marker AND any inline trailing comment
            # like `<!-- KEEP -->` from the prompt fed to the runner.
            keep = bool(_KEEP_RE.search(body))
            prompt_body = re.sub(r"<!--.*?-->", "", body)
            if mark != " ":
                # Already done; if KEEP, reset to unchecked for next time.
                if keep:
                    lines[i] = f"{m.group(1)} {m.group(3)}{body}"
                    rewrote = True
                continue
            prompt = prompt_body.strip()
            if not prompt:
                continue
            log.info("heartbeat firing item", line=i, prompt=prompt[:80])
            try:
                await self._runner(self._agent, prompt)
            except Exception:
                log.exception("heartbeat item runner failed")
                continue
            lines[i] = f"{m.group(1)}x{m.group(3)}{body}"
            rewrote = True
        if rewrote:
            self._path.write_text(
                "\n".join(lines) + ("\n" if text.endswith("\n") else ""), encoding="utf-8"
            )
