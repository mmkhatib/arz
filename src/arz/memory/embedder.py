"""Embedding providers for VectorStore.

Defines a small interface so different embedding backends can be swapped in.

Backends:
    - ``LocalEmbedder``: real sentence embeddings, in-process, no external
      service. Backed by ``fastembed`` (ONNX Runtime — no torch). The model
      downloads once in the background to ``~/.arz/models/``; until it is
      ready ``encode()`` raises :class:`EmbedderNotReady` and callers fall
      back to keyword/FTS retrieval rather than blocking a turn.
    - ``OllamaEmbedder``: hits a local Ollama server (default port 11434).
      Requires the user to have pulled the model themselves.
    - ``HashEmbedder``: deterministic char-n-gram fingerprint, no deps. This
      is NOT semantic search — it matches shared character n-grams. Kept as
      the last-resort fallback and for deterministic tests.

The factory ``embedder_from_config`` picks a backend from a config string.
``"auto"`` (the default) resolves local → ollama → hash, and records what it
picked so ``arz doctor`` and the Memory page can show whether retrieval is
running degraded. The silent fallback was the bug; the status is the fix.

Every embedder exposes a stable ``id``. Vectors produced by different
embedders are NOT comparable — mixing them silently corrupts every cosine
score — so stores persist the id alongside each vector and re-embed when it
changes. See ``vector.py`` and ``episodic.py``.
"""

from __future__ import annotations

import hashlib
import json
import logging
import math
import threading
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Protocol

log = logging.getLogger(__name__)

DEFAULT_DIM = 256

MODELS_DIR = Path.home() / ".arz" / "models"


class EmbedderNotReady(RuntimeError):
    """Raised when a backend is still warming up (e.g. model downloading).

    Callers must treat this as "no vector available right now" and degrade to
    keyword/FTS retrieval — never as a hard failure and never by blocking.
    """


class Embedder(Protocol):
    """An embedding provider."""

    @property
    def id(self) -> str: ...

    @property
    def dim(self) -> int: ...

    def encode(self, text: str) -> list[float]: ...


# Cosine similarity distributions are model-specific — the same pair of
# paraphrases scores 0.07 under the hash fingerprint and 0.24 under MiniLM.
# A single global relevance gate is therefore wrong for every backend but
# the one it was tuned against, so each embedder declares its own.
# (short_text_gate, long_text_gate); long text gets the looser gate to
# offset embedding dilution over many tokens.
_DEFAULT_GATES = (0.55, 0.42)


def relevance_gates(emb: object) -> tuple[float, float]:
    """(short, long) cosine gates for the given embedder."""
    got = getattr(emb, "gates", None)
    if isinstance(got, tuple) and len(got) == 2:
        return (float(got[0]), float(got[1]))
    return _DEFAULT_GATES


def embedder_id(emb: object) -> str:
    """Read an embedder's stable id, tolerating third-party implementations
    that predate the ``id`` property."""
    got = getattr(emb, "id", None)
    if isinstance(got, str) and got:
        return got
    dim = getattr(emb, "dim", "?")
    return f"{type(emb).__name__.lower()}-{dim}"


class HashEmbedder:
    """Character-n-gram fingerprint embedding.

    Tokenizes ``text`` into lowercased character 3-grams, hashes each gram
    into ``dim`` buckets, accumulates counts, and L2-normalizes the resulting
    vector. Texts sharing many n-grams will have higher cosine similarity.

    This is a lexical fingerprint, not semantic search: a paraphrase with no
    shared character n-grams scores ~0. It exists so arz still works with no
    model available, and so tests are deterministic.
    """

    # Kept at the historical values so existing installs behave as before.
    # They are strict for a fingerprint this weak — which is precisely the
    # argument for not running on it.
    gates = (0.55, 0.42)

    def __init__(self, dim: int = DEFAULT_DIM, ngram: int = 3) -> None:
        self._dim = dim
        self._n = ngram

    @property
    def id(self) -> str:
        return f"hash-{self._n}-{self._dim}"

    @property
    def dim(self) -> int:
        return self._dim

    def encode(self, text: str) -> list[float]:
        if not text:
            return [0.0] * self._dim
        s = text.lower()
        v = [0.0] * self._dim
        n = self._n
        if len(s) < n:
            grams = [s]
        else:
            grams = [s[i : i + n] for i in range(len(s) - n + 1)]
        for g in grams:
            h = int(hashlib.sha1(g.encode("utf-8")).hexdigest(), 16)
            idx = h % self._dim
            sign = 1.0 if (h // self._dim) % 2 == 0 else -1.0
            v[idx] += sign
        norm = math.sqrt(sum(x * x for x in v))
        if norm == 0:
            return v
        return [x / norm for x in v]


# Known fastembed models and their output dimensions. Hard-coding the dim
# lets the vec0 table be created before the model finishes downloading.
_LOCAL_MODEL_DIMS = {
    "sentence-transformers/all-MiniLM-L6-v2": 384,
    "BAAI/bge-small-en-v1.5": 384,
    "BAAI/bge-base-en-v1.5": 768,
    "intfloat/multilingual-e5-small": 384,
}


class LocalEmbedder:
    """Real semantic embeddings, in-process, via fastembed (ONNX Runtime).

    No server, no torch, no API key. The model (~90MB for the default) is
    fetched once into ``~/.arz/models/`` on a background thread.

    ``encode()`` raises :class:`EmbedderNotReady` until the model is loaded,
    so the first turns after a fresh install answer from FTS/keyword memory
    instead of stalling on a download.
    """

    DEFAULT_MODEL = "sentence-transformers/all-MiniLM-L6-v2"
    # MiniLM-class models put clear paraphrases around 0.25-0.6 and unrelated
    # text near or below 0. Measured on this repo's own prose: paraphrase 0.24,
    # unrelated -0.06. Gates sit under the paraphrase band, above the noise.
    gates = (0.30, 0.22)

    def __init__(self, model: str | None = None, cache_dir: Path | None = None) -> None:
        self._model_name = model or self.DEFAULT_MODEL
        self._cache_dir = cache_dir or MODELS_DIR
        self._dim = _LOCAL_MODEL_DIMS.get(self._model_name, 384)
        self._model = None
        self._lock = threading.Lock()
        self._thread: threading.Thread | None = None
        self._failed: str | None = None

    @property
    def id(self) -> str:
        return f"local-{self._model_name}-{self._dim}"

    @property
    def dim(self) -> int:
        return self._dim

    @property
    def model_name(self) -> str:
        return self._model_name

    @staticmethod
    def installed() -> bool:
        """True when the fastembed extra is importable."""
        try:
            import fastembed  # noqa: F401

            return True
        except Exception:
            return False

    def ready(self) -> bool:
        return self._model is not None

    def failure(self) -> str | None:
        return self._failed

    def ensure_started(self) -> None:
        """Kick off model load on a background thread. Idempotent."""
        if self._model is not None or self._failed is not None:
            return
        with self._lock:
            if self._thread is not None and self._thread.is_alive():
                return
            self._thread = threading.Thread(
                target=self._load, name="arz-embedder-warmup", daemon=True
            )
            self._thread.start()

    def _load(self) -> None:
        try:
            from fastembed import TextEmbedding

            self._cache_dir.mkdir(parents=True, exist_ok=True)
            log.info(
                "loading local embedding model %s (first run downloads to %s)",
                self._model_name,
                self._cache_dir,
            )
            model = TextEmbedding(model_name=self._model_name, cache_dir=str(self._cache_dir))
            # Probe once so the real dim wins over the table above if they differ.
            probe = list(model.embed(["probe"]))
            if probe:
                self._dim = len(probe[0])
            self._model = model
            log.info("local embedding model ready: %s (dim=%d)", self._model_name, self._dim)
        except Exception as e:
            self._failed = str(e)
            log.warning("local embedding model failed to load: %s", e)

    def wait_ready(self, timeout: float = 0.0) -> bool:
        """Block up to *timeout* seconds for the model. Only for CLI/tests —
        never call this on a request path."""
        self.ensure_started()
        t = self._thread
        if t is not None and timeout > 0:
            t.join(timeout)
        return self._model is not None

    def encode(self, text: str) -> list[float]:
        if self._model is None:
            self.ensure_started()
            raise EmbedderNotReady(
                f"local embedding model {self._model_name} is still loading"
                if self._failed is None
                else f"local embedding model unavailable: {self._failed}"
            )
        if not text:
            return [0.0] * self._dim
        vecs = list(self._model.embed([text]))
        if not vecs:
            raise EmbedderNotReady("embedding produced no output")
        return [float(x) for x in vecs[0]]


class OllamaEmbedder:
    """Real semantic embeddings via a local Ollama server.

    qwen3-embedding:0.6b produces 1024-dim vectors and runs comfortably on a
    laptop. Pulls happen via the Models page or `ollama pull …`.

    Falls back to None on errors (caller should detect with .available()).
    """

    DEFAULT_URL = "http://127.0.0.1:11434"
    DEFAULT_MODEL = "qwen3-embedding:0.6b"
    # qwen3-embedding scores higher than MiniLM on the same pairs, which is
    # what the original 0.55/0.42 constants were tuned against.
    gates = (0.55, 0.42)
    # Common dim for the default model. We probe-and-cache on first use to
    # avoid hard-coding a wrong number when the user picks a different model.
    _PROBE_DIM_FALLBACK = 1024

    def __init__(self, model: str | None = None, base_url: str | None = None) -> None:
        self._url = (base_url or self.DEFAULT_URL).rstrip("/")
        self._model = model or self.DEFAULT_MODEL
        self._dim: int | None = None

    @property
    def id(self) -> str:
        return f"ollama-{self._model}-{self.dim}"

    @property
    def dim(self) -> int:
        if self._dim is None:
            try:
                v = self.encode("probe")
                self._dim = len(v) or self._PROBE_DIM_FALLBACK
            except Exception:
                self._dim = self._PROBE_DIM_FALLBACK
        return self._dim

    def available(self) -> bool:
        try:
            req = urllib.request.Request(f"{self._url}/api/tags", method="GET")
            with urllib.request.urlopen(req, timeout=2) as resp:
                if resp.status >= 400:
                    return False
                data = json.loads(resp.read().decode("utf-8"))
            models = {m.get("name", "") for m in (data.get("models") or [])}
            return self._model in models or any(
                m.startswith(self._model.split(":")[0]) for m in models
            )
        except Exception:
            return False

    def encode(self, text: str) -> list[float]:
        if not text:
            return [0.0] * (self._dim or self._PROBE_DIM_FALLBACK)
        body = json.dumps({"model": self._model, "input": text}).encode("utf-8")
        req = urllib.request.Request(
            f"{self._url}/api/embed",
            data=body,
            method="POST",
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        # Ollama returns {"embeddings": [[...]]} for /api/embed (v0.1.27+).
        emb = data.get("embeddings") or data.get("embedding")
        if isinstance(emb, list) and emb and isinstance(emb[0], list):
            return [float(x) for x in emb[0]]
        if isinstance(emb, list):
            return [float(x) for x in emb]
        raise ValueError(f"unexpected /api/embed response shape: {list(data.keys())}")


# ── Status ────────────────────────────────────────────────────────────────
# The old code fell back to HashEmbedder with only a log line, so an install
# could run lexical-only retrieval forever without anyone noticing. Record
# what actually got picked and why, so doctor/UI can say so out loud.

_status: dict[str, Any] = {
    "backend": "none",
    "id": "",
    "dim": 0,
    "requested": "",
    "degraded": True,
    "reason": "no embedder built yet",
}
_status_lock = threading.Lock()


def _set_status(**kw: Any) -> None:
    with _status_lock:
        _status.update(kw)


def active_status() -> dict[str, Any]:
    """Snapshot of the live embedder: backend, id, dim, degraded, reason."""
    with _status_lock:
        return dict(_status)


def _hash_fallback(requested: str, reason: str) -> HashEmbedder:
    emb = HashEmbedder()
    _set_status(
        backend="hash",
        id=emb.id,
        dim=emb.dim,
        requested=requested,
        degraded=True,
        reason=reason,
    )
    log.warning("embedder degraded to hash fingerprint (%s): %s", requested, reason)
    return emb


def embedder_from_config(spec: str | None) -> Embedder:
    """Build an embedder from a config string.

    Examples:
        ``"auto"``                                → local → ollama → hash
        ``"local"``                               → LocalEmbedder, default model
        ``"local:BAAI/bge-small-en-v1.5"``        → LocalEmbedder w/ that model
        ``"hash"``                                → HashEmbedder
        ``"ollama"``                              → OllamaEmbedder w/ default model
        ``"ollama:qwen3-embedding:0.6b"``         → OllamaEmbedder w/ that model
        ``"ollama:nomic-embed-text:latest@http://localhost:11434"`` → URL too

    Never raises: an unavailable backend degrades one rung and the reason is
    recorded in :func:`active_status`.
    """
    requested = (spec or "auto").strip()
    low = requested.lower()

    if low.startswith("local"):
        rest = requested[len("local") :].lstrip(":").strip()
        emb = LocalEmbedder(model=rest or None)
        if not LocalEmbedder.installed():
            return _hash_fallback(
                requested,
                "fastembed is not installed — run `uv pip install 'arz[embeddings]'`",
            )
        emb.ensure_started()
        _set_status(
            backend="local",
            id=emb.id,
            dim=emb.dim,
            requested=requested,
            degraded=False,
            reason="model loading in background; FTS serves queries until ready",
        )
        return emb

    if low.startswith("ollama"):
        # ollama, ollama:<model>, ollama:<model>@<url>
        rest = requested[len("ollama") :].lstrip(":")
        url = None
        model = rest
        if rest and "@" in rest:
            model, url = rest.split("@", 1)
        if not model:
            model = OllamaEmbedder.DEFAULT_MODEL
        emb_o = OllamaEmbedder(model=model, base_url=url)
        if emb_o.available():
            _set_status(
                backend="ollama",
                id=emb_o.id,
                dim=emb_o.dim,
                requested=requested,
                degraded=False,
                reason="",
            )
            return emb_o
        return _hash_fallback(requested, f"ollama server or model {model!r} unavailable")

    if low == "hash":
        emb_h = HashEmbedder()
        _set_status(
            backend="hash",
            id=emb_h.id,
            dim=emb_h.dim,
            requested=requested,
            degraded=True,
            reason="explicitly configured; lexical fingerprint, not semantic search",
        )
        return emb_h

    if low != "auto":
        log.warning("unknown embedding_model %r — treating as 'auto'", requested)

    # auto: local → ollama → hash
    if LocalEmbedder.installed():
        emb_l = LocalEmbedder()
        emb_l.ensure_started()
        _set_status(
            backend="local",
            id=emb_l.id,
            dim=emb_l.dim,
            requested=requested,
            degraded=False,
            reason="model loading in background; FTS serves queries until ready",
        )
        return emb_l

    emb_o = OllamaEmbedder()
    if emb_o.available():
        _set_status(
            backend="ollama",
            id=emb_o.id,
            dim=emb_o.dim,
            requested=requested,
            degraded=False,
            reason="",
        )
        return emb_o

    return _hash_fallback(
        requested,
        "no local model (install `arz[embeddings]`) and no Ollama server; recall is lexical-only",
    )
