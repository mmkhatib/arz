"""Episodic memory — vector-retrievable conversation fragments.

Mirrors MeshClaw 2.4.x ``vector_memory.episodic_*`` shape on top of the
existing ``arz.memory.vector.VectorStore``. Adds three things the bare
VectorStore doesn't:

  1. ``importance`` per row (0.0–1.0) so an LRU sweep can drop the
     least-important rows when capacity is exceeded.
  2. Length-aware retrieval threshold: short rows need cosine ≥ 0.55,
     long rows (>300 chars) need only ≥ 0.42 to compensate for the
     embedding-dilution effect on long blobs.
  3. Hard cap on row count; oldest least-important wins eviction.

Schema lives in the same ``~/.arz/memory.db`` (sqlite, no extra deps):

    id          INTEGER PRIMARY KEY
    text        TEXT NOT NULL              -- 10–2000 chars
    tags        TEXT NOT NULL DEFAULT '[]' -- JSON array
    importance  REAL NOT NULL DEFAULT 0.5
    created_at  REAL NOT NULL
    is_deleted  INTEGER NOT NULL DEFAULT 0
    embedding   BLOB                       -- float32[]
    embedder_id TEXT                       -- which embedder produced it

For now the embedding column is stored alongside the row rather than
in a vec0 virtual table — keeps the schema portable and lets us start
with brute-force cosine over the (capped) candidate set. When the
episodic store grows past ~10k rows we swap to FAISS without changing
the public surface.
"""

from __future__ import annotations

import array
import json
import math
import sqlite3
import time
from dataclasses import dataclass
from pathlib import Path

import structlog

from arz.memory.embedder import EmbedderNotReady

log = structlog.get_logger(__name__)

_DB_PATH = Path.home() / ".arz" / "memory.db"
_DEFAULT_CAP = 10_000
_LONG_TEXT_THRESHOLD = 300
_RELEVANCE_SHORT = 0.55
_RELEVANCE_LONG = 0.42
_MIN_TEXT = 10
_MAX_TEXT = 2000


@dataclass
class Episode:
    id: int
    text: str
    tags: list[str]
    importance: float
    created_at: float


def _connect() -> sqlite3.Connection:
    _DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(_DB_PATH, timeout=5.0, isolation_level=None)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute(
        """CREATE TABLE IF NOT EXISTS episodic_memories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            text TEXT NOT NULL,
            tags TEXT NOT NULL DEFAULT '[]',
            importance REAL NOT NULL DEFAULT 0.5,
            created_at REAL NOT NULL,
            is_deleted INTEGER NOT NULL DEFAULT 0,
            embedding BLOB
        )"""
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_episodic_alive ON episodic_memories(is_deleted, importance DESC)"
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_episodic_created ON episodic_memories(created_at)")
    # Added after first release. Vectors from different embedders are not
    # comparable, so every row records which one produced it; rows from a
    # stale embedder are ignored by search() and rebuilt by reembed_pending().
    cols = {r[1] for r in conn.execute("PRAGMA table_info(episodic_memories)")}
    if "embedder_id" not in cols:
        conn.execute("ALTER TABLE episodic_memories ADD COLUMN embedder_id TEXT")
    return conn


def _embedder():
    """Reuse the same embedder the VectorStore is already wired with so
    we don't pay the 600 MB Ollama-load cost twice."""
    try:
        from arz.memory.context import _vector_store

        store = _vector_store(None)
        if store is None:
            return None
        return getattr(store, "_embedder", None)
    except Exception:
        return None


def _active_embedder_id() -> str | None:
    """Stable id of the embedder currently wired up, or None when there isn't
    one. Keeps incomparable vector spaces apart."""
    emb = _embedder()
    if emb is None:
        return None
    from arz.memory.embedder import embedder_id

    return embedder_id(emb)


def _embed(text: str) -> list[float] | None:
    emb = _embedder()
    if emb is None:
        return None
    # Embedder protocol method is `encode`. Older code paths use `embed`;
    # try both so a future swap doesn't silently break.
    fn = getattr(emb, "encode", None) or getattr(emb, "embed", None)
    if fn is None:
        return None
    try:
        return list(fn(text))
    except EmbedderNotReady:
        # Model still downloading — degrade to FTS rather than store a vector
        # we could never compare against.
        return None
    except Exception as e:
        log.warning(
            "episodic embed failed",
            extra={"err": str(e), "embedder": type(emb).__name__},
        )
        return None


def _pack(vec: list[float]) -> bytes:
    return array.array("f", vec).tobytes()


def _unpack(blob: bytes) -> list[float]:
    a = array.array("f")
    a.frombytes(blob)
    return list(a)


def _cosine(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b, strict=False))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    if na == 0 or nb == 0:
        return 0.0
    return dot / (na * nb)


def add(
    text: str,
    *,
    importance: float = 0.5,
    tags: list[str] | None = None,
) -> Episode | None:
    """Append a new episode. Returns the persisted record, or None if
    the text is outside the [10, 2000] char window."""
    text = (text or "").strip()
    if len(text) < _MIN_TEXT or len(text) > _MAX_TEXT:
        return None
    importance = max(0.0, min(1.0, float(importance)))
    tags_json = json.dumps(tags or [])
    now = time.time()
    vec = _embed(text)
    blob = _pack(vec) if vec else None
    eid = _active_embedder_id() if blob is not None else None
    with _connect() as conn:
        cur = conn.execute(
            "INSERT INTO episodic_memories"
            "(text, tags, importance, created_at, embedding, embedder_id) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (text, tags_json, importance, now, blob, eid),
        )
        rid = int(cur.lastrowid or 0)
    enforce_cap()
    return Episode(id=rid, text=text, tags=tags or [], importance=importance, created_at=now)


def search(query: str, *, k: int = 5) -> list[tuple[Episode, float]]:
    """Top-K cosine-similar episodes against *query*, length-aware filtered.

    Without an embedder the result is empty (no fallback to substring
    search — that's the FTS5 layer's job over markdown files).
    """
    q_vec = _embed(query)
    if not q_vec:
        return []
    eid = _active_embedder_id()
    # Gates are per-embedder: cosine distributions are not comparable across
    # models, so a fixed threshold silently starves recall on some backends.
    gate_short, gate_long = _RELEVANCE_SHORT, _RELEVANCE_LONG
    emb = _embedder()
    if emb is not None:
        from arz.memory.embedder import relevance_gates

        gate_short, gate_long = relevance_gates(emb)
    with _connect() as conn:
        rows = conn.execute(
            "SELECT id, text, tags, importance, created_at, embedding "
            "FROM episodic_memories WHERE is_deleted = 0 AND embedding IS NOT NULL "
            "AND embedder_id IS ?",
            (eid,),
        ).fetchall()
    scored: list[tuple[Episode, float]] = []
    for rid, text, tags_json, importance, created_at, blob in rows:
        if blob is None:
            continue
        sim = _cosine(q_vec, _unpack(blob))
        threshold = gate_long if len(text) > _LONG_TEXT_THRESHOLD else gate_short
        if sim < threshold:
            continue
        scored.append(
            (
                Episode(
                    id=int(rid),
                    text=text,
                    tags=_safe_tags(tags_json),
                    importance=float(importance),
                    created_at=float(created_at),
                ),
                float(sim),
            )
        )
    scored.sort(key=lambda p: p[1], reverse=True)
    return scored[: max(1, k)]


def render_for_prompt(query: str, *, k: int = 5, cap_chars: int = 3000) -> str:
    hits = search(query, k=k)
    if not hits:
        return ""
    out: list[str] = []
    used = 0
    for ep, sim in hits:
        line = f"- ({sim:.2f}) {ep.text}"
        if len(line) > 600:
            line = line[:600] + "…"
        if used + len(line) + 1 > cap_chars:
            break
        out.append(line)
        used += len(line) + 1
    if not out:
        return ""
    return "<episodic-memory>\n" + "\n".join(out) + "\n</episodic-memory>"


def reembed_pending(*, batch: int = 256) -> int:
    """Re-embed rows whose vector came from a different embedder (or none).

    Safe to call repeatedly; stops early without raising if the embedder is
    still warming up. Returns the number of rows re-embedded.
    """
    eid = _active_embedder_id()
    if eid is None:
        return 0
    done = 0
    while True:
        with _connect() as conn:
            rows = conn.execute(
                "SELECT id, text FROM episodic_memories "
                "WHERE is_deleted = 0 AND (embedder_id IS NULL OR embedder_id != ?) "
                "LIMIT ?",
                (eid, batch),
            ).fetchall()
        if not rows:
            return done
        for rid, text in rows:
            vec = _embed(text)
            if not vec:
                # Embedder went cold — leave the rest for the next sweep.
                return done
            with _connect() as conn:
                conn.execute(
                    "UPDATE episodic_memories SET embedding = ?, embedder_id = ? WHERE id = ?",
                    (_pack(vec), eid, rid),
                )
            done += 1
        if len(rows) < batch:
            return done


def enforce_cap(*, cap: int = _DEFAULT_CAP) -> int:
    """LRU-by-importance: when over *cap*, soft-delete the rows with the
    lowest importance, breaking ties by oldest-first. Returns the number
    of rows tombstoned."""
    with _connect() as conn:
        live = conn.execute(
            "SELECT COUNT(*) FROM episodic_memories WHERE is_deleted = 0"
        ).fetchone()[0]
        if live <= cap:
            return 0
        to_drop = live - cap
        # Smallest importance first; oldest first as tiebreaker.
        rows = conn.execute(
            "SELECT id FROM episodic_memories WHERE is_deleted = 0 "
            "ORDER BY importance ASC, created_at ASC LIMIT ?",
            (to_drop,),
        ).fetchall()
        if not rows:
            return 0
        ids = [r[0] for r in rows]
        conn.executemany(
            "UPDATE episodic_memories SET is_deleted = 1 WHERE id = ?",
            [(i,) for i in ids],
        )
        return len(ids)


def purge_deleted(*, older_than_days: int = 90) -> int:
    cutoff = time.time() - older_than_days * 86400
    with _connect() as conn:
        cur = conn.execute(
            "DELETE FROM episodic_memories WHERE is_deleted = 1 AND created_at < ?",
            (cutoff,),
        )
        return cur.rowcount


def stats() -> dict:
    try:
        with _connect() as conn:
            row = conn.execute(
                "SELECT COUNT(*), AVG(importance) FROM episodic_memories WHERE is_deleted = 0"
            ).fetchone()
        n, avg = row
        return {"count": int(n or 0), "avg_importance": float(avg or 0.0)}
    except Exception:
        return {"count": 0, "avg_importance": 0.0}


def _safe_tags(blob: str) -> list[str]:
    try:
        v = json.loads(blob or "[]")
        return [str(x) for x in v if isinstance(x, str)]
    except Exception:
        return []
