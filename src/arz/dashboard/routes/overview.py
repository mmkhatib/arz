"""Overview — at-a-glance dashboard for session/cron/memory health."""

from __future__ import annotations

import shutil
from datetime import UTC
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel

from arz.dashboard.token_auth import require_token

router = APIRouter(dependencies=[Depends(require_token)])


class ProviderStatus(BaseModel):
    name: str
    installed: bool
    binary_path: str | None = None
    is_active: bool


class CronHealth(BaseModel):
    total: int
    enabled: int
    last_run_at: float | None = None
    error_count_24h: int = 0


class OverviewCounts(BaseModel):
    sessions_active: int
    sessions_history: int
    crons: int
    memory_notes: int
    memory_lessons: int
    agents: int = 0
    subagents: int = 0
    channels: int = 0
    tasks: int = 0
    mcp_servers: int = 0


class AuditEntryPub(BaseModel):
    id: int
    ts: float
    kind: str
    summary: str
    session_id: str | None = None


class PoolStatus(BaseModel):
    active: int
    max_size: int
    warm: int
    warm_target: int


class OverviewResponse(BaseModel):
    counts: OverviewCounts
    providers: list[ProviderStatus]
    cron_health: CronHealth
    recent_activity: list[AuditEntryPub]
    pool: PoolStatus | None = None


def _detect_provider(name: str) -> tuple[bool, str | None]:
    """Detect a provider's CLI binary on disk."""
    if name == "claude-code":
        # ClaudeCodeProvider uses claude-cli's underlying claude binary
        for cand in [Path.home() / ".local" / "bin" / "claude", "claude"]:
            if isinstance(cand, Path) and cand.is_file():
                return True, str(cand)
        found = shutil.which("claude")
        return (bool(found), found)
    if name == "kiro-cli":
        for cand in [Path.home() / ".local" / "bin" / "kiro-cli"]:
            if cand.is_file():
                return True, str(cand)
        found = shutil.which("kiro-cli")
        return (bool(found), found)
    if name == "codex":
        found = shutil.which("codex")
        return (bool(found), found)
    if name == "gemini":
        found = shutil.which("gemini")
        return (bool(found), found)
    if name == "ollama":
        found = shutil.which("ollama")
        return (bool(found), found)
    if name == "anthropic":
        # SDK provider — no CLI to detect; consider it "installed" if anthropic is importable
        try:
            import anthropic  # noqa: F401

            return True, None
        except Exception:
            return False, None
    return False, None


@router.get("/api/overview", response_model=OverviewResponse)
async def overview(
    request: Request,
    activity_limit: Annotated[int, Query(ge=1, le=50)] = 10,
) -> OverviewResponse:
    state = request.app.state
    mgr = state.session_manager

    # Sessions
    active = sum(1 for s in mgr._sessions.values() if s.active)  # noqa: SLF001
    history = sum(1 for s in mgr._sessions.values() if not s.active)  # noqa: SLF001

    # Cron
    cron_registry = state.cron_registry
    cron_entries = cron_registry.list()
    enabled = sum(1 for c in cron_entries if c.enabled)
    last_run_at = max((c.last_run_at for c in cron_entries if c.last_run_at), default=None)
    import time as _time

    cutoff = _time.time() - 86400.0
    error_count_24h = sum(
        1
        for c in cron_entries
        if c.last_run_at and c.last_run_at >= cutoff and (c.last_status or "").startswith("error")
    )

    # Memory
    notes = 0
    lessons = 0
    md_store = getattr(state, "markdown_store", None)
    if md_store is None:
        from arz.memory.markdown import MarkdownStore

        md_store = MarkdownStore()
        state.markdown_store = md_store
    try:
        notes = len(md_store.list())
    except Exception:
        pass
    try:
        from arz.lessons import get_lesson_store

        lessons = len(get_lesson_store().list())
    except Exception:
        pass

    # Counts for the new autonomy features.
    agents_count = 0
    subagents_count = 0
    channels_count = 0
    tasks_count = 0
    mcp_count = 0
    try:
        from arz.agents import AgentRegistry

        agents_count = len(AgentRegistry().list())
    except Exception:
        pass
    try:
        from arz.subagents import get_subagent_manager

        subagents_count = len(get_subagent_manager().list_recent(limit=200))
    except Exception:
        pass
    try:
        from arz.channels import get_channel_store

        channels_count = len(get_channel_store().list())
    except Exception:
        pass
    try:
        from arz.taskrunner import get_task_runner

        tasks_count = len(get_task_runner().list())
    except Exception:
        pass
    try:
        import json as _json
        from pathlib import Path as _P

        reg_path = _P.home() / ".arz" / "mcp_registry.json"
        if reg_path.exists():
            mcp_count = len(_json.loads(reg_path.read_text()).get("servers") or {})
    except Exception:
        pass

    # Providers — show currently configured one as active, plus install state
    cfg = state.config
    provider_names = ["claude-code", "kiro-cli", "codex", "gemini", "ollama", "anthropic"]
    providers: list[ProviderStatus] = []
    for name in provider_names:
        installed, binary = _detect_provider(name)
        providers.append(
            ProviderStatus(
                name=name,
                installed=installed,
                binary_path=binary,
                is_active=(name == cfg.provider.name),
            )
        )

    # Recent activity from the audit log; if empty, fall back to recent
    # messages across sessions so the panel is useful from day one.
    audit_log = getattr(state, "audit_log", None)
    if audit_log is None:
        from arz.dashboard.audit import AuditLog

        audit_log = AuditLog()
        state.audit_log = audit_log
    recent = [
        AuditEntryPub(
            id=e.id,
            ts=e.ts,
            kind=e.kind,
            summary=e.summary,
            session_id=e.session_id,
        )
        for e in audit_log.query(limit=activity_limit)
    ]
    if not recent:
        # Fallback: harvest the most recent assistant/user messages.
        events: list[tuple[float, str, str, str]] = []  # ts, kind, summary, session_id
        for s in mgr._sessions.values():  # noqa: SLF001
            for m in s.messages[-20:]:
                # Message timestamps are naive UTC; .timestamp() on a naive
                # datetime assumes local time and yields "-14000s ago" west of UTC.
                created = m.created_at
                if created.tzinfo is None:
                    created = created.replace(tzinfo=UTC)
                ts = created.timestamp()
                kind = "message" if m.role in ("user", "assistant") else m.role
                summary = (m.text or "").replace("\n", " ")[:120]
                events.append((ts, kind, f"[{s.title[:40]}] {m.role}: {summary}", s.id))
        events.sort(key=lambda e: e[0], reverse=True)
        for i, (ts, kind, summary, sid) in enumerate(events[:activity_limit]):
            recent.append(
                AuditEntryPub(id=-(i + 1), ts=ts, kind=kind, summary=summary, session_id=sid)
            )

    pool = getattr(state, "provider_pool", None)
    pool_status: PoolStatus | None = None
    if pool is not None:
        try:
            pool_status = PoolStatus(
                active=pool.active_count(),
                max_size=pool.max_size,
                warm=pool.warm_count(),
                warm_target=int(getattr(cfg.dashboard, "warm_pool_size", 0) or 0),
            )
        except Exception:
            pool_status = None

    return OverviewResponse(
        counts=OverviewCounts(
            sessions_active=active,
            sessions_history=history,
            crons=len(cron_entries),
            memory_notes=notes,
            memory_lessons=lessons,
            agents=agents_count,
            subagents=subagents_count,
            channels=channels_count,
            tasks=tasks_count,
            mcp_servers=mcp_count,
        ),
        providers=providers,
        cron_health=CronHealth(
            total=len(cron_entries),
            enabled=enabled,
            last_run_at=last_run_at,
            error_count_24h=error_count_24h,
        ),
        recent_activity=recent,
        pool=pool_status,
    )
