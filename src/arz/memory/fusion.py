"""Result fusion for memory recall: reciprocal-rank fusion + MMR.

Recall used to print FTS hits, then vector hits, back to back. A document
both retrievers ranked first got no credit for it, the two lists often
repeated the same fact in different words, and the block's order said
nothing about relevance.

* :func:`rrf` merges ranked lists by reciprocal rank (score = Σ 1/(k+rank)),
  so agreement between retrievers lifts a hit without needing their raw
  scores (BM25 vs cosine) to be comparable.
* :func:`mmr` then re-picks for diversity: each step takes the candidate
  with the best ``λ·relevance − (1−λ)·max_similarity_to_already_picked``.
"""

from __future__ import annotations

import re
from collections.abc import Callable, Hashable, Sequence

RRF_K = 60
MMR_LAMBDA = 0.6

_WORD = re.compile(r"[a-z0-9]+")


def rrf[K: Hashable](
    ranked_lists: Sequence[Sequence[K]], *, k: int = RRF_K
) -> list[tuple[K, float]]:
    """Fuse ranked key lists. Returns ``(key, score)`` best first."""
    scores: dict[K, float] = {}
    first_seen: dict[K, int] = {}
    order = 0
    for lst in ranked_lists:
        for rank, key in enumerate(lst):
            scores[key] = scores.get(key, 0.0) + 1.0 / (k + rank + 1)
            if key not in first_seen:
                first_seen[key] = order
                order += 1
    return sorted(scores.items(), key=lambda kv: (-kv[1], first_seen[kv[0]]))


def token_jaccard(a: str, b: str) -> float:
    ta, tb = set(_WORD.findall(a.lower())), set(_WORD.findall(b.lower()))
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / len(ta | tb)


def mmr[T](
    items: Sequence[T],
    *,
    relevance: Callable[[T], float],
    similarity: Callable[[T, T], float],
    limit: int,
    lam: float = MMR_LAMBDA,
) -> list[T]:
    """Maximal-marginal-relevance selection of up to *limit* items.

    *relevance* is normalised to [0, 1] internally so callers can pass raw
    scores of any scale.
    """
    if limit <= 0 or not items:
        return []
    rel = [relevance(x) for x in items]
    top = max(rel) or 1.0
    rel = [r / top for r in rel]
    picked: list[int] = []
    remaining = list(range(len(items)))
    while remaining and len(picked) < limit:
        best, best_score = remaining[0], float("-inf")
        for i in remaining:
            redundancy = max((similarity(items[i], items[j]) for j in picked), default=0.0)
            score = lam * rel[i] - (1 - lam) * redundancy
            if score > best_score:
                best, best_score = i, score
        picked.append(best)
        remaining.remove(best)
    return [items[i] for i in picked]
