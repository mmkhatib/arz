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
_DEFAULT_CONFIDENCE = 0.8
_REINFORCE_STEP = 0.1
_CONTRADICTION_STEP = 0.3

# Min confidence required to write. MeshClaw blueprint specifies 0.8 —
# tightened from our initial 0.7 so noisier LLM extractions don't bleed
# into the long-term store. Inline `<semantic>` writes still default to
# 0.7 via _DEFAULT_CONFIDENCE; explicit-confidence writes from the
# consolidator must pass ≥ 0.8 to land.
_MIN_WRITE_CONFIDENCE = 0.8

# Conflict-resolution: when a key already exists, only allow an update if
# the incoming confidence is ≥ the stored value, OR the existing row is
# older than this many days (a stale fact gets overwritten by anything
# fresher even if confidence is lower).
_STALE_OVERWRITE_AGE_DAYS = 7
_STALE_OVERWRITE_AGE_S = _STALE_OVERWRITE_AGE_DAYS * 86400

# Allow-list of canonical key prefixes. Anything outside this set is
# rejected with `code="allowlist_reject"` so a chatty LLM can't pollute
# the store with `random.thoughts.42 = "I think therefore I am"`.
_ALLOWED_PREFIXES: tuple[str, ...] = (
    "pref.",
    "preference.",
    "project.",
    "user.",
    "lesson.",
    "team.",
    "repo.",
    "prod.",
    "dev.",
    "stage.",
    "infra.",
    "service.",
    "config.",
    "tool.",
    "deploy.",
    "owner.",
    "deadline.",
)

# Block-list of reserved prefixes. Mirrors MeshClaw's "no system./prompt./
# instruction." rule — blocks the most obvious prompt-injection landing
# pads. `code="reserved_key"` in the audit log.
_BLOCKED_PREFIXES: tuple[str, ...] = (
    "system.",
    "prompt.",
    "instruction.",
    "override.",
    "ignore.",
    "_internal.",
)

# Jailbreak / prompt-injection patterns. If the value matches any of
# these, the write is rejected with `code="injection_blocked"` and an
# audit row is logged. The same patterns are scrubbed at READ time as
# defense in depth — a fact written before the regex was added still
# can't escape into a future prompt unredacted.
import re as _re

_INJECTION_PATTERNS = [
    _re.compile(r"(?i)\bignore (?:previous|all|above) (?:instructions|prompt)"),
    _re.compile(r"(?i)\bdisregard (?:the )?(?:above|prior|previous|earlier)"),
    _re.compile(r"(?i)\byou are now\b"),
    _re.compile(r"(?i)\bnew (?:role|persona|instruction)s?\b"),
    _re.compile(
        r"(?i)<\s*/?\s*(?:system|preferences|projects|lessons|memory|recent-context|arz-runtime)\s*>"
    ),
    _re.compile(r"(?i)\bbreak character\b"),
    _re.compile(r"(?i)\bact as (?:if you were|a different)"),
]

# Credential / exfiltration patterns scrubbed at every read and write
# boundary. Mirrors arz/skills.py redaction list — defense in depth so
# tool-output that gets summarised into semantic memory can't smuggle
# tokens back out via the prompt prefix.
_REDACT_PATTERNS = [
    (_re.compile(r"(?i)sk-[A-Za-z0-9_-]{20,}"), "[REDACTED-KEY]"),
    (_re.compile(r"(?i)ghp_[A-Za-z0-9]{20,}"), "[REDACTED-GH-PAT]"),
    (_re.compile(r"(?i)bearer\s+[A-Za-z0-9._-]{20,}"), "Bearer [REDACTED]"),
    (
        _re.compile(r"(?i)(api[_-]?key|access[_-]?token|password|secret)(\s*[:=]\s*)[^\s\"'`,;)]+"),
        lambda m: f"{m.group(1)}{m.group(2)}[REDACTED]",
    ),
]

# Valid-key shape: starts lowercase, dotted segments, no trailing dot,
# 1-100 chars. Mirrors the MeshClaw regex.
_KEY_SHAPE = _re.compile(r"^[a-z][a-z0-9_]*(?:\.[a-z0-9][a-z0-9_]*)*$")


class WriteRejected(Exception):
    """Raised by ``upsert`` when a write is blocked by guardrails. The
    audit log already has the row; the exception just lets callers
    differentiate from generic ``ValueError`` shapes."""

    def __init__(self, code: str, key: str, reason: str) -> None:
        self.code = code
        self.key = key
        self.reason = reason
        super().__init__(f"[{code}] {key}: {reason}")


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
            confidence REAL NOT NULL DEFAULT 0.8,
            source TEXT,
            created_at REAL NOT NULL,
            updated_at REAL NOT NULL,
            hit_count INTEGER NOT NULL DEFAULT 0,
            is_deleted INTEGER NOT NULL DEFAULT 0
        )"""
    )
    # Soft-delete migration for stores created before is_deleted was added.
    cols = {row[1] for row in conn.execute("PRAGMA table_info(semantic_memory)").fetchall()}
    if "is_deleted" not in cols:
        conn.execute("ALTER TABLE semantic_memory ADD COLUMN is_deleted INTEGER NOT NULL DEFAULT 0")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_semantic_conf ON semantic_memory(confidence DESC)")
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_semantic_alive ON semantic_memory(is_deleted, confidence DESC)"
    )
    # Audit log for every write rejection. Lets us see attack patterns
    # over time (one row per blocked write) without lighting up the
    # gateway logs with noise.
    conn.execute(
        """CREATE TABLE IF NOT EXISTS memory_events (
            ts REAL NOT NULL,
            code TEXT NOT NULL,
            key TEXT,
            reason TEXT,
            source TEXT
        )"""
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_events_ts ON memory_events(ts DESC)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_events_code ON memory_events(code)")
    return conn


def _audit(code: str, key: str, reason: str, source: str = "") -> None:
    try:
        with _connect() as conn:
            conn.execute(
                "INSERT INTO memory_events(ts, code, key, reason, source) VALUES (?, ?, ?, ?, ?)",
                (time.time(), code, key, reason, source),
            )
    except Exception:
        log.warning("semantic audit write failed", code=code, key=key)


def redact(text: str) -> str:
    """Scrub credential / exfiltration patterns. Idempotent — safe at
    both write and read boundaries."""
    out = text or ""
    for pat, repl in _REDACT_PATTERNS:
        out = pat.sub(repl, out)
    return out


def _looks_injected(value: str) -> tuple[bool, str]:
    for pat in _INJECTION_PATTERNS:
        m = pat.search(value or "")
        if m:
            return True, m.group(0)[:60]
    return False, ""


def _validate_key(key: str) -> tuple[bool, str]:
    """Returns (ok, reason). Reason is empty when ok."""
    if not key:
        return False, "empty"
    if len(key) > 100:
        return False, "too long"
    if not _KEY_SHAPE.match(key):
        return False, "shape mismatch (must be lowercase dotted)"
    if any(key.startswith(p) for p in _BLOCKED_PREFIXES):
        return False, "reserved prefix"
    if not any(key.startswith(p) for p in _ALLOWED_PREFIXES):
        return False, "prefix not on allow-list"
    return True, ""


def upsert(
    key: str,
    value: str,
    *,
    source: str = "",
    confidence_delta: float = _REINFORCE_STEP,
    confidence: float | None = None,
) -> Fact:
    """Insert a new fact or reinforce an existing one — guard-railed.

    Rejection codes (logged to ``memory_events``):
      - ``shape_reject``        bad key shape
      - ``reserved_key``        key uses a blocked prefix
      - ``allowlist_reject``    key not on allow-list
      - ``low_confidence``      explicit confidence < 0.7 on first write
      - ``injection_blocked``   value matched a jailbreak pattern
      - ``stale_overwrite``     incoming confidence < stored AND row fresh
      - ``empty``               key or value missing

    On accept the value is redacted before persistence so credentials
    never reach disk in cleartext. ``confidence`` overrides the default
    starting confidence; ``confidence_delta`` is used on reinforce.
    """
    key = (key or "").strip().lower()
    value = (value or "").strip()
    if not key or not value:
        _audit("empty", key, "key or value missing", source)
        raise WriteRejected("empty", key, "key or value missing")

    ok, reason = _validate_key(key)
    if not ok:
        code = (
            "reserved_key"
            if "reserved" in reason
            else ("allowlist_reject" if "allow-list" in reason else "shape_reject")
        )
        _audit(code, key, reason, source)
        raise WriteRejected(code, key, reason)

    injected, snippet = _looks_injected(value)
    if injected:
        _audit("injection_blocked", key, f"matched: {snippet!r}", source)
        raise WriteRejected("injection_blocked", key, f"matched: {snippet!r}")

    # Redact at write boundary so secrets never reach the row.
    safe_value = redact(value)

    now = time.time()
    with _connect() as conn:
        row = conn.execute(
            "SELECT value, confidence, source, created_at, hit_count, updated_at "
            "FROM semantic_memory WHERE key=?",
            (key,),
        ).fetchone()
        if row is None:
            initial = float(confidence) if confidence is not None else _DEFAULT_CONFIDENCE
            if initial < _MIN_WRITE_CONFIDENCE:
                _audit("low_confidence", key, f"initial={initial:.2f}", source)
                raise WriteRejected("low_confidence", key, f"initial={initial:.2f}")
            conn.execute(
                "INSERT INTO semantic_memory(key, value, confidence, source, created_at, updated_at, hit_count) "
                "VALUES (?, ?, ?, ?, ?, ?, 0)",
                (key, safe_value, initial, source, now, now),
            )
            return Fact(
                key=key,
                value=safe_value,
                confidence=initial,
                source=source,
                created_at=now,
                updated_at=now,
                hit_count=0,
            )

        prev_value, prev_conf, prev_src, created_at, hit, prev_updated = row
        prev_conf_f = float(prev_conf)
        prev_updated_f = float(prev_updated)
        # Conflict-resolution: incoming must be ≥ stored confidence OR
        # the stored row must be older than _STALE_OVERWRITE_AGE_DAYS.
        # Reinforces (no explicit confidence) always pass — that's the
        # "I saw this fact again" signal.
        if confidence is not None:
            if confidence < prev_conf_f and (now - prev_updated_f) < _STALE_OVERWRITE_AGE_S:
                _audit(
                    "stale_overwrite",
                    key,
                    f"incoming={confidence:.2f} < stored={prev_conf_f:.2f}",
                    source,
                )
                raise WriteRejected(
                    "stale_overwrite",
                    key,
                    f"incoming={confidence:.2f} < stored={prev_conf_f:.2f}",
                )
            new_conf = float(confidence)
        else:
            new_conf = min(1.0, prev_conf_f + confidence_delta)

        conn.execute(
            "UPDATE semantic_memory SET value=?, confidence=?, source=?, updated_at=? WHERE key=?",
            (safe_value, new_conf, source or prev_src, now, key),
        )
        return Fact(
            key=key,
            value=safe_value,
            confidence=new_conf,
            source=source or prev_src,
            created_at=float(created_at),
            updated_at=now,
            hit_count=int(hit),
        )


def contradict(key: str) -> None:
    """Drop confidence sharply; soft-delete (is_deleted=1) at zero so the
    row stays auditable but no longer surfaces in reads.

    Soft-delete instead of hard-delete because the audit log + consolidator
    state can reference the key — and a future consolidator pass might
    legitimately re-confirm it (resurrection should keep history).
    """
    key = (key or "").strip().lower()
    if not key:
        return
    with _connect() as conn:
        row = conn.execute(
            "SELECT confidence FROM semantic_memory WHERE key=? AND is_deleted = 0", (key,)
        ).fetchone()
        if row is None:
            return
        new_conf = max(0.0, float(row[0]) - _CONTRADICTION_STEP)
        if new_conf <= 0.0:
            conn.execute(
                "UPDATE semantic_memory SET is_deleted=1, confidence=0, updated_at=? WHERE key=?",
                (time.time(), key),
            )
        else:
            conn.execute(
                "UPDATE semantic_memory SET confidence=?, updated_at=? WHERE key=?",
                (new_conf, time.time(), key),
            )


def delete(key: str) -> bool:
    """Soft-delete: flips ``is_deleted = 1``. The row stays for audit
    purposes; reads filter it out. Returns True if a live row was hit."""
    key = (key or "").strip().lower()
    if not key:
        return False
    with _connect() as conn:
        cur = conn.execute(
            "UPDATE semantic_memory SET is_deleted=1, updated_at=? WHERE key=? AND is_deleted = 0",
            (time.time(), key),
        )
        return cur.rowcount > 0


def purge_deleted(*, older_than_days: int = 90) -> int:
    """Hard-remove tombstones older than N days. Cheap maintenance call
    that the consolidator can fire on its idle pass."""
    cutoff = time.time() - older_than_days * 86400
    with _connect() as conn:
        cur = conn.execute(
            "DELETE FROM semantic_memory WHERE is_deleted = 1 AND updated_at < ?",
            (cutoff,),
        )
        return cur.rowcount


def get(key: str) -> Fact | None:
    key = (key or "").strip().lower()
    if not key:
        return None
    with _connect() as conn:
        row = conn.execute(
            "SELECT key, value, confidence, source, created_at, updated_at, hit_count "
            "FROM semantic_memory WHERE key=? AND is_deleted = 0",
            (key,),
        ).fetchone()
    return _row_to_fact(row) if row else None


def top(n: int = 10, min_confidence: float = 0.4) -> list[Fact]:
    """Return top facts by confidence, capped at *n*."""
    with _connect() as conn:
        rows = conn.execute(
            "SELECT key, value, confidence, source, created_at, updated_at, hit_count "
            "FROM semantic_memory WHERE is_deleted = 0 AND confidence >= ? "
            "ORDER BY confidence DESC, updated_at DESC LIMIT ?",
            (float(min_confidence), int(n)),
        ).fetchall()
    return [_row_to_fact(r) for r in rows]


def render_for_prompt(query: str = "", cap_chars: int = 1500) -> str:
    """Render the top semantic facts as a citation-tagged block.

    Bumps hit_count for each fact surfaced so confidence reflects "this
    actually got used", not just "we wrote it down once".
    """
    facts = top(n=40, min_confidence=0.4)
    if not facts:
        return ""
    # Hybrid score (MeshClaw blueprint): 0.6 * cosine + 0.4 * keyword_overlap.
    # Without a vector embedder we fall back to keyword-only ranking so the
    # hash-embedder default still produces sensible results. Vector-on
    # callers get the full hybrid blend.
    if query.strip():
        scored = _hybrid_score(query, facts)
        facts = [f for _, f in scored]
    out: list[str] = []
    used = 0
    surfaced_keys: list[str] = []
    for f in facts:
        # Defense in depth: redact again at read boundary in case a
        # secret was written before the regex landed.
        safe = redact(f.value)
        line = f"- **{f.key}** ({int(f.confidence * 100)}% confidence) — {safe}"
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


def _keyword_score(query_tokens: set[str], fact: Fact) -> float:
    """Token-overlap score, weighted so a key match beats a value match.

    Mirrors the MeshClaw blueprint's `(key_overlap * 3 + value_overlap) / 10`.
    Returns a float in [0, 1].
    """
    if not query_tokens:
        return 0.0
    key_hits = len(query_tokens & _tokens(fact.key)) * 3
    val_hits = len(query_tokens & _tokens(fact.value))
    raw = (key_hits + val_hits) / 10.0
    return min(1.0, raw)


def _cosine_score(query: str, fact: Fact) -> float:
    """Vector cosine similarity via the shared VectorStore embedder, when
    one is wired. Falls back to 0 when not — caller should treat absence
    as "keyword-only ranking", not as "irrelevant".
    """
    try:
        from arz.memory.context import _vector_store

        store = _vector_store(None)
        if store is None or not hasattr(store, "_embedder"):
            return 0.0
        emb = store._embedder  # noqa: SLF001
        if not hasattr(emb, "embed"):
            return 0.0
        q_vec = emb.embed(query)
        f_vec = emb.embed(f"{fact.key} {fact.value}")
        # Cosine similarity. Both vectors expected unit-norm-ish; we
        # don't normalise here because the hash embedder already does.
        dot = sum(a * b for a, b in zip(q_vec, f_vec, strict=False))
        return max(0.0, min(1.0, dot))
    except Exception:
        return 0.0


_DAY_SECONDS = 86400.0


def _recency_factor(updated_at: float, *, now: float | None = None) -> float:
    """Tiered recency multiplier so freshly-touched facts win ties.

    Tiers (mirrors history-decay tiers used for compression so a fact
    "ages out" of prominence at the same rate the verbatim transcript
    does):
      <7d → 1.0, <30d → 0.85, <90d → 0.7, else → 0.55.
    """
    if updated_at <= 0:
        return 0.7
    age_days = ((now or time.time()) - updated_at) / _DAY_SECONDS
    if age_days < 7:
        return 1.0
    if age_days < 30:
        return 0.85
    if age_days < 90:
        return 0.7
    return 0.55


def _frequency_factor(hit_count: int) -> float:
    """Saturating frequency boost. Rarely-hit facts stay at 1.0; facts
    surfaced often climb toward ~1.5. Saturates so a runaway lookup
    can't dominate the ranking.

    Formula: 1 + log10(1 + hit_count) * 0.3.
    hit_count=0 → 1.0, =10 → 1.31, =100 → 1.60.
    """
    import math

    if hit_count <= 0:
        return 1.0
    return min(1.6, 1.0 + math.log10(1.0 + hit_count) * 0.3)


def _hybrid_score(query: str, facts: list[Fact]) -> list[tuple[float, Fact]]:
    """Score every fact against the query with the 0.6/0.4 hybrid blend,
    then multiply by recency + frequency factors so old, never-hit facts
    sink and recent / proven-useful facts rise.

    High-confidence facts (≥ 0.95) skip the relevance gate so canonical
    things ("repo.default_branch") always make it into the prefix even
    when the user is asking about something unrelated.
    """
    q_tokens = {t for t in _tokens(query) if len(t) >= 3}
    now = time.time()
    out: list[tuple[float, Fact]] = []
    for f in facts:
        kw = _keyword_score(q_tokens, f)
        cos = _cosine_score(query, f)
        base = 0.6 * cos + 0.4 * kw
        rec = _recency_factor(f.updated_at, now=now)
        freq = _frequency_factor(f.hit_count)
        score = base * rec * freq
        # Force-include the high-confidence rocks regardless of score.
        if score > 0 or f.confidence >= 0.95:
            out.append((score, f))
    out.sort(key=lambda p: (p[0], p[1].confidence), reverse=True)
    return out


def recent_events(limit: int = 100) -> list[dict]:
    """Tail of the audit log — drives the dashboard's "rejected memory
    writes" panel so the user can spot attack patterns."""
    try:
        with _connect() as conn:
            rows = conn.execute(
                "SELECT ts, code, key, reason, source FROM memory_events ORDER BY ts DESC LIMIT ?",
                (max(1, min(limit, 500)),),
            ).fetchall()
        return [
            {
                "ts": r[0],
                "code": r[1],
                "key": r[2] or "",
                "reason": r[3] or "",
                "source": r[4] or "",
            }
            for r in rows
        ]
    except Exception:
        return []


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
