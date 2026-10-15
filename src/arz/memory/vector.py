"""VectorStore — semantic search via sqlite-vec.

Stores documents alongside their dense embedding vectors and uses sqlite-vec's
vec0 virtual table for ANN search. The embedder is pluggable — see
``arz.memory.embedder``.

Two invariants this module enforces:

1. **Vectors from different embedders are never mixed.** The active embedder's
   id is persisted in ``vector_meta``. When it changes (hash → local, model
   swap, dim change) the vec0 table is rebuilt at the new dimension and every
   document is queued for re-embedding. Without this a backend switch silently
   corrupts every cosine score — old rows either fail to insert or score
   against a different vector space.

2. **A cold embedder never blocks or loses a write.** While a local model is
   still downloading, ``add()`` stores the document with a NULL ``embedder_id``
   and ``reembed_pending()`` picks it up once the model is ready.
"""

from __future__ import annotations

import json
import logging
import sqlite3
import threading
from pathlib import Path

import sqlite_vec

from arz.memory.embedder import (
    DEFAULT_DIM,
    Embedder,
    EmbedderNotReady,
    HashEmbedder,
    embedder_id,
)

log = logging.getLogger(__name__)

_DB_PATH = Path.home() / ".arz" / "memory.db"


class VectorStore:
    """Document store with semantic search via sqlite-vec.

    The schema is split: ``vector_docs`` holds the human-readable rows and
    ``vector_embeddings`` is the vec0 virtual table holding the dense vector.
    ``rowid`` links them.
    """

    def __init__(
        self,
        db_path: Path | None = None,
        embedder: Embedder | None = None,
        dim: int | None = None,
    ) -> None:
        self._db = db_path or _DB_PATH
        self._db.parent.mkdir(parents=True, exist_ok=True)
        self._embedder = embedder or HashEmbedder(dim=dim or DEFAULT_DIM)
        self._dim = self._embedder.dim
        self._eid = embedder_id(self._embedder)
        self._lock = threading.Lock()
        self._init_schema()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self._db))
        conn.enable_load_extension(True)
        sqlite_vec.load(conn)
        conn.enable_load_extension(False)
        return conn

    def _init_schema(self) -> None:
        with self._lock, self._connect() as conn:
            conn.execute(
                "CREATE TABLE IF NOT EXISTS vector_docs ("
                "  id INTEGER PRIMARY KEY AUTOINCREMENT,"
                "  key TEXT NOT NULL UNIQUE,"
                "  content TEXT NOT NULL,"
                "  meta TEXT NOT NULL DEFAULT '{}'"
                ")"
            )
            # Added after first release — older databases lack it.
            cols = {r[1] for r in conn.execute("PRAGMA table_info(vector_docs)")}
            if "embedder_id" not in cols:
                conn.execute("ALTER TABLE vector_docs ADD COLUMN embedder_id TEXT")
            conn.execute(
                "CREATE TABLE IF NOT EXISTS vector_meta (  k TEXT PRIMARY KEY,  v TEXT NOT NULL)"
            )
            row = conn.execute("SELECT v FROM vector_meta WHERE k = 'embedder_id'").fetchone()
            stored = row[0] if row else None

            if stored is not None and stored != self._eid:
                log.warning(
                    "embedder changed (%s → %s) — rebuilding vector index and "
                    "queueing %s documents for re-embedding",
                    stored,
                    self._eid,
                    conn.execute("SELECT COUNT(*) FROM vector_docs").fetchone()[0],
                )
                conn.execute("DROP TABLE IF EXISTS vector_embeddings")
                conn.execute("UPDATE vector_docs SET embedder_id = NULL")

            conn.execute(
                f"CREATE VIRTUAL TABLE IF NOT EXISTS vector_embeddings USING vec0("
                f"  emb float[{self._dim}]"
                f")"
            )
            conn.execute(
                "INSERT INTO vector_meta (k, v) VALUES ('embedder_id', ?) "
                "ON CONFLICT(k) DO UPDATE SET v = excluded.v",
                (self._eid,),
            )

    def add(self, key: str, content: str, meta: dict | None = None) -> None:
        """Insert or replace a document and its embedding.

        If the embedder is not ready yet the document is still stored, with a
        NULL ``embedder_id``, and picked up by :meth:`reembed_pending` later.
        """
        try:
            vec = self._embedder.encode(content)
            emb = sqlite_vec.serialize_float32(vec)
            eid: str | None = self._eid
        except EmbedderNotReady as e:
            log.debug("deferring embedding for %r: %s", key, e)
            emb, eid = None, None
        except Exception:
            log.exception("embedding failed for %r — storing document unembedded", key)
            emb, eid = None, None

        with self._lock, self._connect() as conn:
            cur = conn.execute("SELECT id FROM vector_docs WHERE key = ?", (key,))
            row = cur.fetchone()
            meta_json = json.dumps(meta or {})
            if row is None:
                cur = conn.execute(
                    "INSERT INTO vector_docs (key, content, meta, embedder_id) VALUES (?, ?, ?, ?)",
                    (key, content, meta_json, eid),
                )
                doc_id = cur.lastrowid
            else:
                doc_id = row[0]
                conn.execute(
                    "UPDATE vector_docs SET content = ?, meta = ?, embedder_id = ? WHERE id = ?",
                    (content, meta_json, eid, doc_id),
                )
                conn.execute("DELETE FROM vector_embeddings WHERE rowid = ?", (doc_id,))
            if emb is not None:
                conn.execute(
                    "INSERT INTO vector_embeddings (rowid, emb) VALUES (?, ?)",
                    (doc_id, emb),
                )

    def remove(self, key: str) -> bool:
        with self._lock, self._connect() as conn:
            cur = conn.execute("SELECT id FROM vector_docs WHERE key = ?", (key,))
            row = cur.fetchone()
            if not row:
                return False
            conn.execute("DELETE FROM vector_embeddings WHERE rowid = ?", (row[0],))
            conn.execute("DELETE FROM vector_docs WHERE id = ?", (row[0],))
            return True

    def count(self) -> int:
        """Total documents (embedded or pending)."""
        with self._connect() as conn:
            return int(conn.execute("SELECT COUNT(*) FROM vector_docs").fetchone()[0])

    def pending_count(self) -> int:
        """Documents with no vector for the active embedder."""
        with self._connect() as conn:
            return int(
                conn.execute(
                    "SELECT COUNT(*) FROM vector_docs "
                    "WHERE embedder_id IS NULL OR embedder_id != ?",
                    (self._eid,),
                ).fetchone()[0]
            )

    def reembed_pending(self, *, batch: int = 256) -> int:
        """Embed documents that have no vector for the active embedder.

        Safe to call repeatedly. Returns the number of documents embedded.
        Stops early — without raising — if the embedder is still warming up.
        """
        embedded = 0
        while True:
            with self._connect() as conn:
                rows = conn.execute(
                    "SELECT id, content FROM vector_docs "
                    "WHERE embedder_id IS NULL OR embedder_id != ? "
                    "LIMIT ?",
                    (self._eid, batch),
                ).fetchall()
            if not rows:
                return embedded
            for doc_id, content in rows:
                try:
                    emb = sqlite_vec.serialize_float32(self._embedder.encode(content))
                except EmbedderNotReady:
                    if embedded:
                        log.info("re-embedded %d documents before backend went cold", embedded)
                    return embedded
                except Exception:
                    log.exception("re-embed failed for doc %s — skipping", doc_id)
                    continue
                with self._lock, self._connect() as conn:
                    conn.execute("DELETE FROM vector_embeddings WHERE rowid = ?", (doc_id,))
                    conn.execute(
                        "INSERT INTO vector_embeddings (rowid, emb) VALUES (?, ?)",
                        (doc_id, emb),
                    )
                    conn.execute(
                        "UPDATE vector_docs SET embedder_id = ? WHERE id = ?",
                        (self._eid, doc_id),
                    )
                embedded += 1
            if len(rows) < batch:
                return embedded

    def search(self, query: str, k: int = 5) -> list[tuple[str, str, float]]:
        """Return up to k (key, content, similarity) tuples; higher score is better.

        Returns [] when the embedder is not ready — the caller's FTS/keyword
        path serves the query instead.
        """
        if not query.strip():
            return []
        try:
            emb = sqlite_vec.serialize_float32(self._embedder.encode(query))
        except EmbedderNotReady as e:
            log.debug("vector search skipped, embedder warming: %s", e)
            return []
        except Exception:
            log.exception("query embedding failed for %r", query)
            return []
        try:
            with self._connect() as conn:
                # sqlite-vec requires an explicit `k = N` clause on MATCH queries.
                rows = conn.execute(
                    "SELECT vector_docs.key, vector_docs.content, vector_embeddings.distance "
                    "FROM vector_embeddings "
                    "JOIN vector_docs ON vector_docs.id = vector_embeddings.rowid "
                    "WHERE vector_embeddings.emb MATCH ? AND k = ? "
                    "ORDER BY vector_embeddings.distance",
                    (emb, k),
                ).fetchall()
        except sqlite3.OperationalError as e:
            log.debug("Vector search failed for %r: %s", query, e)
            return []
        # Convert L2 distance → similarity-ish score (1 / (1 + d)).
        return [(key, content, 1.0 / (1.0 + dist)) for key, content, dist in rows]


# ── Shared instance ─────────────────────────────────────────────────────────
# Every caller MUST go through get_vector_store(). Two VectorStores with
# different embedders on the same DB fight: each one's _init_schema sees the
# other's embedder_id, drops vector_embeddings and queues a full re-embed —
# so vector recall silently empties every time the "other" one starts.

_shared: VectorStore | None = None
_shared_lock = threading.Lock()


def get_vector_store(config=None) -> VectorStore | None:
    """Process-wide VectorStore using the configured embedder.

    ``config`` is optional; without it the user config is loaded so the
    embedder choice never depends on which caller happened to start first.
    """
    global _shared
    if _shared is not None:
        return _shared
    with _shared_lock:
        if _shared is not None:
            return _shared
        try:
            from arz.memory.embedder import embedder_from_config

            if config is None:
                try:
                    from arz.config.loader import load_config

                    config = load_config()
                except Exception:
                    config = None
            spec = "auto"
            if config is not None and hasattr(config, "dashboard"):
                spec = getattr(config.dashboard, "embedding_model", "auto") or "auto"
            _shared = VectorStore(embedder=embedder_from_config(spec))
        except Exception:
            log.exception("VectorStore init failed")
            return None
        return _shared


def reset_vector_store_for_tests() -> None:
    global _shared
    _shared = None
