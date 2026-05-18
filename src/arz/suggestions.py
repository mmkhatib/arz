"""Background prompt-suggestions generator.

Mirrors MeshClaw 2.4.x ``suggestions.py``. Periodically asks a cheap
background LLM session for 4–6 short clickable prompt suggestions based
on what the user has been working on (preferences + projects + recent
history + recent session titles). Cached so dashboard new-session
opens render instantly without re-firing the LLM.

Public surface:
    init_suggestions(runner, mgr) — wire at gateway startup
    get_cached() → list[str]      — read for UI render
    refresh_now() → list[str]     — force regenerate (returns the list)
    fallback_suggestions() → list[str]
"""

from __future__ import annotations

import asyncio
import json
import re
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import datetime, timedelta

import structlog

from arz.memory import semantic as _sem

log = structlog.get_logger(__name__)


SuggestionRunner = Callable[[str, str], Awaitable[str]]

_REFRESH_INTERVAL_SECS = 30 * 60
_GEN_TIMEOUT_SECS = 120.0  # cheap subagent occasionally slow; recoverable via fallback
_COLD_START_THRESHOLD = 50
_MAX_SUGGESTION_CHARS = 80
_MAX_SUGGESTIONS = 6


_FALLBACK = [
    "What did I work on yesterday?",
    "Continue where I left off",
    "Run the test suite and report any failures",
    "Summarise this week's sessions",
    "Help me draft a design doc",
    "Review the latest changes on main",
]


_PROMPT = """\
You are generating contextual prompt suggestions for a developer assistant
dashboard.

Based on the user's current context below, generate 4-6 short, actionable
prompt suggestions that the user might want to ask right now. Each
suggestion is a single sentence (under 60 characters) that the user can
click to start a conversation.

Consider:
  - Recent projects + sessions (continue / resume / next-step)
  - Stated preferences and habits
  - Time of day and day of week
  - Pending follow-ups implied by recent activity

Current context:
---
{context}
---

Respond with ONLY a JSON array of strings. No explanation, no markdown
fences. Example:
["Check pipeline for MyService", "Continue refactoring auth module",
 "Review yesterday's CR feedback"]
"""


@dataclass
class _Cache:
    suggestions: list[str] = field(default_factory=lambda: list(_FALLBACK))
    generated_at: float = 0.0
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    last_error: str = ""


_cache = _Cache()
_runner: SuggestionRunner | None = None
_session_manager = None
_refresh_task: asyncio.Task | None = None


def init_suggestions(runner: SuggestionRunner, session_manager) -> None:
    """Wire the runner + session manager. Called from server lifespan."""
    global _runner, _session_manager
    _runner = runner
    _session_manager = session_manager


def fallback_suggestions() -> list[str]:
    return list(_FALLBACK)


def get_cached() -> list[str]:
    """Synchronous read — always returns at least the fallback list."""
    if _cache.suggestions:
        return list(_cache.suggestions)
    return list(_FALLBACK)


async def refresh_now() -> list[str]:
    """Force a regeneration. Used by the dashboard on a manual refresh."""
    return await _generate()


async def start_periodic_refresh() -> None:
    """Long-lived task — regenerate every _REFRESH_INTERVAL_SECS.

    Sleeps for the interval first so we don't hammer the LLM on
    gateway startup. The first user-facing render falls back to the
    hardcoded list, which is fine.
    """
    global _refresh_task
    if _refresh_task and not _refresh_task.done():
        return

    async def _loop() -> None:
        # Wait one interval before first fire so startup stays cheap.
        await asyncio.sleep(_REFRESH_INTERVAL_SECS)
        while True:
            try:
                await _generate()
            except Exception:
                log.exception("suggestions periodic refresh failed")
            await asyncio.sleep(_REFRESH_INTERVAL_SECS)

    _refresh_task = asyncio.create_task(_loop())


async def stop_periodic_refresh() -> None:
    global _refresh_task
    if _refresh_task and not _refresh_task.done():
        _refresh_task.cancel()
        try:
            await _refresh_task
        except (asyncio.CancelledError, Exception):
            pass
    _refresh_task = None


async def _generate() -> list[str]:
    """Build context, run the LLM, parse + scrub. Returns the cached
    list (never raises — failure swallows the exception and falls back
    to the prior cache or the hardcoded list)."""
    if _runner is None:
        log.info("suggestions: no runner wired — keeping fallback")
        return get_cached()
    async with _cache.lock:
        ctx = _build_context()
        if len(ctx) < _COLD_START_THRESHOLD:
            log.info("suggestions: cold-start (no memory yet) — using fallback")
            _cache.suggestions = list(_FALLBACK)
            _cache.generated_at = time.time()
            return list(_cache.suggestions)

        prompt = _PROMPT.format(context=ctx)
        try:
            raw = await asyncio.wait_for(_runner("general", prompt), timeout=_GEN_TIMEOUT_SECS)
        except asyncio.TimeoutError:
            _cache.last_error = "timeout"
            # Recoverable: we fall back to cached/fallback list. No
            # user-facing impact, demote to info so it doesn't drown
            # the log on slow days.
            log.info("suggestions: LLM timed out after %.0fs; using cached", _GEN_TIMEOUT_SECS)
            return get_cached()
        except Exception as e:
            _cache.last_error = f"{type(e).__name__}: {e}"
            log.warning("suggestions: LLM call failed", error=str(e))
            return get_cached()

        suggestions = _parse_array(raw)
        if not suggestions:
            log.info("suggestions: parsed zero items — keeping prior cache")
            return get_cached()
        # Length cap + redact (semantic.redact also covers credential
        # leaks via tool output that may have made it into history).
        cleaned: list[str] = []
        for s in suggestions:
            s = s.strip()
            if not s or len(s) > _MAX_SUGGESTION_CHARS:
                continue
            cleaned.append(_sem.redact(s))
            if len(cleaned) >= _MAX_SUGGESTIONS:
                break
        if not cleaned:
            return get_cached()
        _cache.suggestions = cleaned
        _cache.generated_at = time.time()
        _cache.last_error = ""
        log.info("suggestions: regenerated", count=len(cleaned))
        return list(cleaned)


def _parse_array(raw: str) -> list[str]:
    """Pull a JSON array of strings out of the model output. Tolerates a
    fenced ```json``` wrapper and trailing commentary."""
    if not raw:
        return []
    # Strip ANSI / control noise.
    raw = re.sub(r"\x1b\[[0-9;]*[a-zA-Z]", "", raw).strip()
    fence = re.search(r"```(?:json|JSON)?\s*(\[[\s\S]*?\])\s*```", raw)
    if fence:
        try:
            arr = json.loads(fence.group(1))
            return [str(x) for x in arr if isinstance(x, str)]
        except json.JSONDecodeError:
            pass
    first = raw.find("[")
    last = raw.rfind("]")
    if first != -1 and last != -1 and last > first:
        try:
            arr = json.loads(raw[first : last + 1])
            return [str(x) for x in arr if isinstance(x, str)]
        except json.JSONDecodeError:
            return []
    return []


def _build_context() -> str:
    parts: list[str] = []

    # Preferences (cap ~2 KB).
    prefs = _read_memory_file("preferences.md", cap=2000)
    if prefs:
        parts.append("USER PREFERENCES:\n" + prefs)

    # Projects (cap ~3 KB).
    projects = _read_memory_file("projects.md", cap=3000)
    if projects:
        parts.append("ACTIVE PROJECTS:\n" + projects)

    # Recent history — last 2 days, cap ~4 KB.
    history = _read_recent_history(days=2, cap=4000)
    if history:
        parts.append("RECENT ACTIVITY:\n" + history)

    # Recent sessions — titles + last 3 user messages, top 5 by updated_at.
    sessions_block = _recent_sessions_summary(top_n=5)
    if sessions_block:
        parts.append("RECENT SESSIONS:\n" + sessions_block)

    # Time + day-of-week is a useful trigger ("Friday → maybe ship").
    now = datetime.now()
    parts.append(f"CURRENT TIME: {now.strftime('%A, %B %d %Y at %H:%M')}")

    return "\n\n".join(parts)


def _read_memory_file(name: str, *, cap: int) -> str:
    try:
        from arz.memory.files import get_memory_files

        path = get_memory_files().base_dir / name
        if not path.exists():
            return ""
        text = path.read_text(encoding="utf-8").strip()
        if len(text) > cap:
            text = text[:cap] + "\n…(truncated)"
        return text
    except Exception:
        return ""


def _read_recent_history(*, days: int, cap: int) -> str:
    try:
        from arz.memory.files import get_memory_files

        history_dir = get_memory_files().base_dir / "history"
        if not history_dir.exists():
            return ""
        today = datetime.now().date()
        chunks: list[str] = []
        used = 0
        for d in range(days):
            target = today - timedelta(days=d)
            f = history_dir / f"{target.isoformat()}.md"
            if not f.exists():
                continue
            text = f.read_text(encoding="utf-8").strip()
            if not text:
                continue
            chunk = f"### {target.isoformat()}\n{text}"
            if used + len(chunk) > cap:
                break
            chunks.append(chunk)
            used += len(chunk)
        return "\n\n".join(chunks)
    except Exception:
        return ""


def _recent_sessions_summary(*, top_n: int = 5) -> str:
    if _session_manager is None:
        return ""
    try:
        sessions = sorted(
            _session_manager._sessions.values(),  # noqa: SLF001
            key=lambda s: s.updated_at,
            reverse=True,
        )[:top_n]
    except Exception:
        return ""
    out: list[str] = []
    for s in sessions:
        title = (s.title or "untitled").strip()
        # Last 3 user messages only — keeps the snippet lean.
        user_msgs = [m for m in s.messages if m.role == "user"][-3:]
        body = "\n".join(f"  - {m.text.strip().splitlines()[0][:120]}" for m in user_msgs if m.text)
        if body:
            out.append(f"- {title}\n{body}")
        else:
            out.append(f"- {title}")
    return "\n".join(out)


def stats() -> dict:
    return {
        "count": len(_cache.suggestions),
        "generated_at": _cache.generated_at,
        "last_error": _cache.last_error,
    }
