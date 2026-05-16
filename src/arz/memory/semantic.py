"""Semantic memory — structured key/value facts with confidence + decay.

Mirrors MeshClaw 2.4.x's `vector_memory.semantic_*` layer in shape but
keeps the implementation small and dependency-free (sqlite only). Vector
embedding for similarity is optional and lives in the existing
``arz.memory.vector`` module; semantic.py just tracks the canonical
key/value/confidence triples.

Schema (single ``semantic_memory`` table in ``~/.arz/memory.db``):

    key          TEXT PRIMARY KEY   -- canonical fact identifier
    value        TEXT NOT NULL      -- the actual content
    confidence   REAL DEFAULT 0.7   -- 0.0–1.0, bumped on each reaffirm
    source       TEXT               -- session id that produced it
    created_at   REAL               -- epoch s, first write
    updated_at   REAL               -- epoch s, last touch
    hit_count    INTEGER DEFAULT 0  -- times surfaced in context

Confidence rules (consolidator path):
    - new fact         → confidence = 0.7
    - confirmed again  → min(1.0, confidence + 0.1)
    - contradicted     → max(0.0, confidence - 0.3)
    - delete operation → row dropped

Public surface used by the consolidator + build_prefix:
    - upsert(key, value, confidence_delta=+0.1)
    - delete(key)
    - top(n=10, min_confidence=0.4) → list[Fact]
    - render_for_prompt(query="", cap_chars=1500) → str  # citation-tagged
"""

from __future__ import annotations

import sqlite3
import time
from dataclasses import dataclass
from pathlib import Path

import structlog

log = structlog.get_logger(__name__)

_DB_PATH = Path.home() / ".arz" / "memory.db"
_DEFAULT_CONFIDENCE = 0.7
_REINFORCE_STEP = 0.1
_CONTRADICTION_STEP = 0.3


@dataclass
class Fact:
    key: str
    value: str
    confidence: float
    source: str
    created_at: float
    updated_at: float
    hit_count: int


def _connect() -> sqlite3.Connection:
    _DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(_DB_PATH, timeout=5.0, isolation_level=None)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute(
        """CREATE TABLE IF NOT EXISTS semantic_memory (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            confidence REAL NOT NULL DEFAULT 0.7,
            source TEXT,
            created_at REAL NOT NULL,
            updated_at REAL NOT NULL,
            hit_count INTEGER NOT NULL DEFAULT 0
        )"""
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_semantic_conf ON semantic_memory(confidence DESC)")
    return conn


def upsert(
    key: str,
    value: str,
    *,
    source: str = "",
    confidence_delta: float = _REINFORCE_STEP,
) -> Fact:
    """Insert a new fact or reinforce an existing one.

    On insert: confidence starts at ``_DEFAULT_CONFIDENCE`` (0.7).
    On reinforce: confidence grows by ``confidence_delta``, capped at 1.0.
    """
    key = (key or "").strip().lower()
    value = (value or "").strip()
    if not key or not value:
        raise ValueError("key and value required")
    now = time.time()
    with _connect() as conn:
        row = conn.execute(
            "SELECT value, confidence, source, created_at, hit_count FROM semantic_memory WHERE key=?",
            (key,),
        ).fetchone()
        if row is None:
            conn.execute(
                "INSERT INTO semantic_memory(key, value, confidence, source, created_at, updated_at, hit_count) "
                "VALUES (?, ?, ?, ?, ?, ?, 0)",
                (key, value, _DEFAULT_CONFIDENCE, source, now, now),
            )
            return Fact(
                key=key,
                value=value,
                confidence=_DEFAULT_CONFIDENCE,
                source=source,
                created_at=now,
                updated_at=now,
                hit_count=0,
            )
        prev_value, prev_conf, prev_src, created_at, hit = row
        new_conf = min(1.0, float(prev_conf) + confidence_delta)
        # If the value actually changed, treat that as a softer reinforce
        # — the user updated the fact — and keep confidence growing.
        conn.execute(
            "UPDATE semantic_memory SET value=?, confidence=?, source=?, updated_at=? WHERE key=?",
            (value, new_conf, source or prev_src, now, key),
        )
        return Fact(
            key=key,
            value=value,
            confidence=new_conf,
            source=source or prev_src,
            created_at=float(created_at),
            updated_at=now,
            hit_count=int(hit),
        )


def contradict(key: str) -> None:
    """Mark a fact as contradicted — drops confidence sharply, removes
    when it falls to zero. Cheaper than a full delete so the consolidator
    can express "I'm less sure of this now"."""
    key = (key or "").strip().lower()
    if not key:
        return
    with _connect() as conn:
        row = conn.execute("SELECT confidence FROM semantic_memory WHERE key=?", (key,)).fetchone()
        if row is None:
            return
        new_conf = max(0.0, float(row[0]) - _CONTRADICTION_STEP)
        if new_conf <= 0.0:
            conn.execute("DELETE FROM semantic_memory WHERE key=?", (key,))
        else:
            conn.execute(
                "UPDATE semantic_memory SET confidence=?, updated_at=? WHERE key=?",
                (new_conf, time.time(), key),
            )


def delete(key: str) -> bool:
    key = (key or "").strip().lower()
    if not key:
        return False
    with _connect() as conn:
        cur = conn.execute("DELETE FROM semantic_memory WHERE key=?", (key,))
        return cur.rowcount > 0


def get(key: str) -> Fact | None:
    key = (key or "").strip().lower()
    if not key:
        return None
    with _connect() as conn:
        row = conn.execute(
            "SELECT key, value, confidence, source, created_at, updated_at, hit_count "
            "FROM semantic_memory WHERE key=?",
            (key,),
        ).fetchone()
    return _row_to_fact(row) if row else None


def top(n: int = 10, min_confidence: float = 0.4) -> list[Fact]:
    """Return top facts by confidence, capped at *n*."""
    with _connect() as conn:
        rows = conn.execute(
            "SELECT key, value, confidence, source, created_at, updated_at, hit_count "
            "FROM semantic_memory WHERE confidence >= ? ORDER BY confidence DESC, updated_at DESC LIMIT ?",
            (float(min_confidence), int(n)),
        ).fetchall()
    return [_row_to_fact(r) for r in rows]


def render_for_prompt(query: str = "", cap_chars: int = 1500) -> str:
    """Render the top semantic facts as a citation-tagged block.

    Bumps hit_count for each fact surfaced so confidence reflects "this
    actually got used", not just "we wrote it down once".
    """
    facts = top(n=20, min_confidence=0.4)
    if not facts:
        return ""
    # Cheap relevance filter when query present: keep facts whose key OR
    # value shares any 4+ char token with the query. Without query, take
    # them in confidence order.
    if query.strip():
        q_tokens = {t for t in _tokens(query) if len(t) >= 4}
        if q_tokens:
            scored = []
            for f in facts:
                hit = len(q_tokens & (_tokens(f.key) | _tokens(f.value)))
                # Always keep high-confidence facts even without a query hit.
                if hit > 0 or f.confidence >= 0.85:
                    scored.append((hit, f))
            scored.sort(key=lambda p: (p[0], p[1].confidence), reverse=True)
            facts = [f for _, f in scored]
    out: list[str] = []
    used = 0
    surfaced_keys: list[str] = []
    for f in facts:
        line = f"- **{f.key}** ({int(f.confidence * 100)}% confidence) — {f.value}"
        if used + len(line) + 1 > cap_chars:
            break
        out.append(line)
        used += len(line) + 1
        surfaced_keys.append(f.key)
    if not out:
        return ""
    # Update hit_count for surfaced facts.
    try:
        with _connect() as conn:
            conn.executemany(
                "UPDATE semantic_memory SET hit_count = hit_count + 1 WHERE key=?",
                [(k,) for k in surfaced_keys],
            )
    except Exception:
        pass
    return "<semantic-memory>\n" + "\n".join(out) + "\n</semantic-memory>"


def _row_to_fact(row: tuple) -> Fact:
    return Fact(
        key=row[0],
        value=row[1],
        confidence=float(row[2]),
        source=row[3] or "",
        created_at=float(row[4]),
        updated_at=float(row[5]),
        hit_count=int(row[6]),
    )


_TOKEN_RE = __import__("re").compile(r"[A-Za-z][A-Za-z0-9_]{2,}")


def _tokens(s: str) -> set[str]:
    return {t.lower() for t in _TOKEN_RE.findall(s or "")}


def stats() -> dict:
    """Cheap counter for the dashboard."""
    try:
        with _connect() as conn:
            row = conn.execute(
                "SELECT COUNT(*), AVG(confidence), SUM(hit_count) FROM semantic_memory"
            ).fetchone()
        n, avg, hits = row
        return {
            "count": int(n or 0),
            "avg_confidence": float(avg or 0.0),
            "total_hits": int(hits or 0),
        }
    except Exception:
        return {"count": 0, "avg_confidence": 0.0, "total_hits": 0}
