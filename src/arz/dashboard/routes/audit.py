"""Audit log query routes."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel

from arz.dashboard.audit import AuditLog
from arz.dashboard.token_auth import require_token

router = APIRouter(dependencies=[Depends(require_token)])


def _audit(request: Request) -> AuditLog:
    a = getattr(request.app.state, "audit_log", None)
    if a is None:
        a = AuditLog()
        request.app.state.audit_log = a
    return a


class AuditEntry(BaseModel):
    id: int
    ts: float
    kind: str
    session_id: str | None
    actor: str | None
    summary: str
    details: dict


@router.get("/api/audit", response_model=list[AuditEntry])
async def list_audit(
    request: Request,
    limit: int = Query(default=100, ge=1, le=1000),
    kind: str | None = None,
    session_id: str | None = None,
    since: float | None = None,
) -> list[AuditEntry]:
    rows = _audit(request).query(limit=limit, kind=kind, session_id=session_id, since=since)
    return [AuditEntry(**r.to_dict()) for r in rows]


@router.get("/api/audit/kinds", response_model=list[str])
async def list_kinds(request: Request) -> list[str]:
    return _audit(request).kinds()
