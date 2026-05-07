"""Embedding providers for VectorStore.

Defines a small interface so different embedding backends can be swapped in.

Defaults:
    - ``HashEmbedder``: deterministic char-n-gram fingerprint, no deps. Good
      enough for substring-similar matches; not real semantic search.
    - ``OllamaEmbedder``: hits a local Ollama server (default port 11434)
      and uses a real embedding model. Requires the user to have run
      ``ollama pull qwen3-embedding:0.6b`` (or similar). Falls back gracefully
      if the server isn't up.

The factory ``embedder_from_config`` picks an embedder from a config string
like ``"hash"`` or ``"ollama:qwen3-embedding:0.6b"``.
"""

from __future__ import annotations

import hashlib
import json
import logging
import math
import urllib.error
import urllib.request
from typing import Protocol

log = logging.getLogger(__name__)

DEFAULT_DIM = 256


class Embedder(Protocol):
    """An embedding provider."""

    @property
    def dim(self) -> int: ...

    def encode(self, text: str) -> list[float]: ...


class HashEmbedder:
    """Character-n-gram fingerprint embedding.

    Tokenizes ``text`` into lowercased character 3-grams, hashes each gram
    into ``dim`` buckets, accumulates counts, and L2-normalizes the resulting
    vector. Texts sharing many n-grams will have higher cosine similarity —
    not as good as a real model but useful for deterministic local testing
    and as a baseline.
    """

    def __init__(self, dim: int = DEFAULT_DIM, ngram: int = 3) -> None:
        self._dim = dim
        self._n = ngram

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


class OllamaEmbedder:
    """Real semantic embeddings via a local Ollama server.

    Matches MeshClaw's default — qwen3-embedding:0.6b produces 1024-dim
    vectors and runs comfortably on a laptop. Pulls happen via the Models
    page or `ollama pull qwen3-embedding:0.6b`.

    Falls back to None on errors (caller should detect with .available()).
    """

    DEFAULT_URL = "http://127.0.0.1:11434"
    DEFAULT_MODEL = "qwen3-embedding:0.6b"
    # Common dim for the default model. We probe-and-cache on first use to
    # avoid hard-coding a wrong number when the user picks a different model.
    _PROBE_DIM_FALLBACK = 1024

    def __init__(self, model: str | None = None, base_url: str | None = None) -> None:
        self._url = (base_url or self.DEFAULT_URL).rstrip("/")
        self._model = model or self.DEFAULT_MODEL
        self._dim: int | None = None

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


def embedder_from_config(spec: str | None) -> Embedder:
    """Build an embedder from a config string.

    Examples:
        ``"hash"``                                → HashEmbedder
        ``"ollama"``                              → OllamaEmbedder w/ default model
        ``"ollama:qwen3-embedding:0.6b"``         → OllamaEmbedder w/ that model
        ``"ollama:nomic-embed-text:latest@http://localhost:11434"`` → URL too

    Falls back to HashEmbedder if Ollama is selected but unreachable.
    """
    spec = (spec or "hash").strip().lower()
    if spec.startswith("ollama"):
        # ollama, ollama:<model>, ollama:<model>@<url>
        rest = spec[len("ollama") :].lstrip(":")
        url = None
        model = rest
        if rest and "@" in rest:
            model, url = rest.split("@", 1)
        if not model:
            model = OllamaEmbedder.DEFAULT_MODEL
        emb = OllamaEmbedder(model=model, base_url=url)
        if emb.available():
            return emb
        log.warning(
            "ollama embedder requested (%s) but server/model unavailable; "
            "falling back to HashEmbedder",
            spec,
        )
    return HashEmbedder()
