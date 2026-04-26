"""VectorStore — semantic search via sqlite-vec.

Stores documents alongside their dense embedding vectors and uses sqlite-vec's
vec0 virtual table for ANN search. The embedder is pluggable; the default
``HashEmbedder`` gives deterministic local search without external deps.
"""

from __future__ import annotations

import json
import logging
import sqlite3
import threading
from pathlib import Path

import sqlite_vec

from arz.memory.embedder import DEFAULT_DIM, Embedder, HashEmbedder

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
            conn.execute(
                f"CREATE VIRTUAL TABLE IF NOT EXISTS vector_embeddings USING vec0("
                f"  emb float[{self._dim}]"
                f")"
            )

    def add(self, key: str, content: str, meta: dict | None = None) -> None:
        """Insert or replace a document and its embedding."""
        emb = sqlite_vec.serialize_float32(self._embedder.encode(content))
        with self._lock, self._connect() as conn:
            cur = conn.execute("SELECT id FROM vector_docs WHERE key = ?", (key,))
            row = cur.fetchone()
            meta_json = json.dumps(meta or {})
            if row is None:
                cur = conn.execute(
                    "INSERT INTO vector_docs (key, content, meta) VALUES (?, ?, ?)",
                    (key, content, meta_json),
                )
                doc_id = cur.lastrowid
                conn.execute(
                    "INSERT INTO vector_embeddings (rowid, emb) VALUES (?, ?)",
                    (doc_id, emb),
                )
            else:
                doc_id = row[0]
                conn.execute(
                    "UPDATE vector_docs SET content = ?, meta = ? WHERE id = ?",
                    (content, meta_json, doc_id),
                )
                conn.execute("DELETE FROM vector_embeddings WHERE rowid = ?", (doc_id,))
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

    def search(self, query: str, k: int = 5) -> list[tuple[str, str, float]]:
        """Return up to k (key, content, similarity) tuples; higher score is better."""
        if not query.strip():
            return []
        emb = sqlite_vec.serialize_float32(self._embedder.encode(query))
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
