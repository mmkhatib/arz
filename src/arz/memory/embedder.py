"""Embedding providers for VectorStore.

Defines a small interface so different embedding backends can be swapped in.
Ships a deterministic ``HashEmbedder`` as the default — it builds a
character-n-gram fingerprint that gives mild semantic similarity for related
text and zero external dependencies. Plug in a real model (Voyage, OpenAI,
local sentence-transformers) by implementing ``Embedder.encode``.
"""

from __future__ import annotations

import hashlib
import math
from abc import ABC, abstractmethod
from typing import Protocol

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
