"""Overview — at-a-glance dashboard for session/cron/memory health."""

from __future__ import annotations

import shutil
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


class AuditEntryPub(BaseModel):
    id: int
    ts: float
    kind: str
    summary: str
    session_id: str | None = None


class OverviewResponse(BaseModel):
    counts: OverviewCounts
    providers: list[ProviderStatus]
    cron_health: CronHealth
    recent_activity: list[AuditEntryPub]


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
        1 for c in cron_entries
        if c.last_run_at and c.last_run_at >= cutoff and (c.last_status or "").startswith("error")
    )

    # Memory
    notes = 0
    lessons = 0
    md_store = getattr(state, "markdown_store", None)
    lesson_store = getattr(state, "lessons_store", None)
    if md_store is None:
        from arz.memory.markdown import MarkdownStore
        md_store = MarkdownStore()
        state.markdown_store = md_store
    if lesson_store is None:
        from arz.memory.lessons import LessonsStore
        lesson_store = LessonsStore()
        state.lessons_store = lesson_store
    try:
        notes = len(md_store.list())
    except Exception:
        pass
    try:
        lessons = len(lesson_store.list())
    except Exception:
        pass

    # Providers — show currently configured one as active, plus install state
    cfg = state.config
    provider_names = ["claude-code", "kiro-cli", "codex", "anthropic"]
    providers: list[ProviderStatus] = []
    for name in provider_names:
        installed, binary = _detect_provider(name)
        providers.append(ProviderStatus(
            name=name,
            installed=installed,
            binary_path=binary,
            is_active=(name == cfg.provider.name),
        ))

    # Recent activity from the audit log
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

    return OverviewResponse(
        counts=OverviewCounts(
            sessions_active=active,
            sessions_history=history,
            crons=len(cron_entries),
            memory_notes=notes,
            memory_lessons=lessons,
        ),
        providers=providers,
        cron_health=CronHealth(
            total=len(cron_entries),
            enabled=enabled,
            last_run_at=last_run_at,
            error_count_24h=error_count_24h,
        ),
        recent_activity=recent,
    )
