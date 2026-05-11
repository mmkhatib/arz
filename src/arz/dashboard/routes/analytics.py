"""Analytics — aggregate session data into time-bucketed counts and latency stats."""

from __future__ import annotations

import csv
import io
import statistics
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import Response
from pydantic import BaseModel

from arz.dashboard.token_auth import require_token
from arz.session.manager import SessionManager

router = APIRouter(dependencies=[Depends(require_token)])


def _all_sessions(request: Request) -> list:
    mgr: SessionManager = request.app.state.session_manager
    # list_active + list_inactive — and load_all has been called at startup
    return list(mgr._sessions.values())  # noqa: SLF001 — internal accessor


class TimeBucket(BaseModel):
    date: str  # YYYY-MM-DD UTC
    count: int


class LatencyStats(BaseModel):
    provider: str
    samples: int
    p50_ms: float
    p95_ms: float
    avg_ms: float


@router.get("/api/analytics/messages-by-day", response_model=list[TimeBucket])
async def messages_by_day(
    request: Request,
    days: Annotated[int, Query(ge=1, le=365)] = 30,
) -> list[TimeBucket]:
    cutoff = datetime.utcnow() - timedelta(days=days)
    counts: Counter[str] = Counter()
    for session in _all_sessions(request):
        for m in session.messages:
            if m.role == "user" and m.created_at >= cutoff:
                counts[m.created_at.date().isoformat()] += 1
    return _fill_buckets(counts, days)


@router.get("/api/analytics/tokens-by-day", response_model=list[TimeBucket])
async def tokens_by_day(
    request: Request,
    days: Annotated[int, Query(ge=1, le=365)] = 30,
) -> list[TimeBucket]:
    cutoff = datetime.utcnow() - timedelta(days=days)
    counts: Counter[str] = Counter()
    for session in _all_sessions(request):
        for m in session.messages:
            if m.role != "assistant" or not m.usage or m.created_at < cutoff:
                continue
            total = int(m.usage.get("input_tokens", 0) or 0) + int(
                m.usage.get("output_tokens", 0) or 0
            )
            counts[m.created_at.date().isoformat()] += total
    return _fill_buckets(counts, days)


@router.get("/api/analytics/tool-usage", response_model=list[dict])
async def tool_usage(request: Request) -> list[dict]:
    counts: Counter[str] = Counter()
    for session in _all_sessions(request):
        for m in session.messages:
            tcs = getattr(m, "tool_calls", None)
            # Message dataclass may not expose tool_calls; fall back via dict
            if tcs is None:
                d = m.to_dict()
                tcs = d.get("tool_calls", []) or []
            for tc in tcs:
                name = tc.get("name") if isinstance(tc, dict) else getattr(tc, "name", None)
                if name:
                    counts[name] += 1
    return [{"name": n, "count": c} for n, c in counts.most_common()]


@router.get("/api/analytics/providers", response_model=list[dict])
async def provider_breakdown(request: Request) -> list[dict]:
    counts: Counter[str] = Counter()
    for session in _all_sessions(request):
        provider = session.provider or "(unset)"
        counts[provider] += len(session.messages)
    return [{"provider": p, "messages": c} for p, c in counts.most_common()]


@router.get("/api/analytics/by-day-by-provider", response_model=list[dict])
async def by_day_by_provider(
    request: Request,
    days: Annotated[int, Query(ge=1, le=365)] = 30,
) -> list[dict]:
    """Per-(date, provider) rollup of user messages + assistant tokens.

    Powers the Analytics Breakdown view's per-LLM expansion. Returns
    rows shaped {date, provider, messages, tokens} — frontend pivots
    these into the day-level table.
    """
    cutoff = datetime.utcnow() - timedelta(days=days)
    msgs: dict[tuple[str, str], int] = {}
    toks: dict[tuple[str, str], int] = {}
    for session in _all_sessions(request):
        provider = session.provider or "(unset)"
        for m in session.messages:
            if m.created_at < cutoff:
                continue
            key = (m.created_at.date().isoformat(), provider)
            if m.role == "user":
                msgs[key] = msgs.get(key, 0) + 1
            elif m.role == "assistant" and m.usage:
                total = int(m.usage.get("input_tokens", 0) or 0) + int(
                    m.usage.get("output_tokens", 0) or 0
                )
                toks[key] = toks.get(key, 0) + total
    keys = set(msgs.keys()) | set(toks.keys())
    return [
        {
            "date": date,
            "provider": prov,
            "messages": msgs.get((date, prov), 0),
            "tokens": toks.get((date, prov), 0),
        }
        for date, prov in sorted(keys, key=lambda k: (k[0], k[1]))
    ]


@router.get("/api/analytics/latency", response_model=list[LatencyStats])
async def latency(request: Request) -> list[LatencyStats]:
    """Per-provider elapsed_ms statistics for assistant turns."""
    by_provider: defaultdict[str, list[int]] = defaultdict(list)
    for session in _all_sessions(request):
        provider = session.provider or "(unset)"
        for m in session.messages:
            if m.role != "assistant":
                continue
            d = m.to_dict()
            ms = d.get("elapsed_ms")
            if isinstance(ms, (int, float)) and ms > 0:
                by_provider[provider].append(int(ms))
    out: list[LatencyStats] = []
    for provider, samples in by_provider.items():
        if not samples:
            continue
        sorted_samples = sorted(samples)
        out.append(
            LatencyStats(
                provider=provider,
                samples=len(samples),
                p50_ms=float(statistics.median(sorted_samples)),
                p95_ms=float(_percentile(sorted_samples, 0.95)),
                avg_ms=float(statistics.mean(sorted_samples)),
            )
        )
    return sorted(out, key=lambda x: -x.samples)


@router.get("/api/analytics/export.csv")
async def export_csv(request: Request) -> Response:
    """Export per-message rows as CSV: session_id, role, created_at, model, in_tok, out_tok, elapsed_ms."""
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(
        [
            "session_id",
            "session_title",
            "provider",
            "role",
            "created_at",
            "model",
            "input_tokens",
            "output_tokens",
            "elapsed_ms",
        ]
    )
    for session in _all_sessions(request):
        for m in session.messages:
            d = m.to_dict()
            usage = d.get("usage") or {}
            w.writerow(
                [
                    session.id,
                    session.title,
                    session.provider or "",
                    m.role,
                    m.created_at.isoformat(),
                    d.get("model", ""),
                    usage.get("input_tokens", ""),
                    usage.get("output_tokens", ""),
                    d.get("elapsed_ms", ""),
                ]
            )
    return Response(
        content=buf.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="arz-analytics.csv"'},
    )


def _fill_buckets(counts: Counter[str], days: int) -> list[TimeBucket]:
    """Return a contiguous list of dates from (today-days+1) → today, zero-padded."""
    today = datetime.utcnow().date()
    out: list[TimeBucket] = []
    for i in range(days - 1, -1, -1):
        d = (today - timedelta(days=i)).isoformat()
        out.append(TimeBucket(date=d, count=counts.get(d, 0)))
    return out


def _percentile(sorted_samples: list[int], p: float) -> float:
    if not sorted_samples:
        return 0.0
    if len(sorted_samples) == 1:
        return float(sorted_samples[0])
    k = (len(sorted_samples) - 1) * p
    f = int(k)
    c = min(f + 1, len(sorted_samples) - 1)
    return sorted_samples[f] + (sorted_samples[c] - sorted_samples[f]) * (k - f)
