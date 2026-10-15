"""Lesson relevance ranking — rarity-weighted, stemmed, optionally hybrid.

The old ranker counted shared words: "the", "file", "use" matched almost
every lesson, so a long message pulled in noise and a short one missed the
lesson that mattered. Here every query word is stemmed and weighted by how
RARE it is across the stored lessons (an IDF), so a word that appears in one
lesson out of eighty says far more than a word in half of them.

Two entry points:

* :func:`rank` — order candidates for a session's first turn. Lexical
  rarity score, blended 0.4/0.6 with embedding cosine when a real embedder
  is available.
* :func:`turn_gate` — the follow-up-turn filter. A lesson the session hasn't
  seen yet is admitted only when it shares at least ``min_terms`` distinct
  RARE stems with the message (each found in at most ``rarity`` of lessons,
  never fewer than one). Count of rare stems, not a weight sum: a sum lets a
  single rare word admit a lesson alone.

Pure functions; no store access.
"""

from __future__ import annotations

import math
import re
from collections.abc import Callable, Sequence

_WORD_RE = re.compile(r"[a-z0-9]+")

STOPWORDS = frozenset(
    """
    a about above after again against all also am an and any are as at be because been
    before being below between both but by can could did do does doing done down during
    each etc few for from further get got had has have having he her here hers him his how
    i if in into is it its itself just let like make many may me might more most much must
    my need no nor not now of off on once one only or other our out over own please really
    same say she should so some still such than that the their them then there these they
    thing things this those through to too try under until up us use used using very want
    was way we well were what when where which while who why will with would yes yet you
    your
    """.split()
)

_SUFFIXES = (
    "ational",
    "ization",
    "fulness",
    "ousness",
    "iveness",
    "ations",
    "ation",
    "ments",
    "ingly",
    "ement",
    "ness",
    "ment",
    "ings",
    "ible",
    "able",
    "edly",
    "ies",
    "ing",
    "ers",
    "est",
    "ful",
    "ous",
    "ive",
    "ize",
    "ise",
    "ed",
    "er",
    "ly",
    "es",
    "s",
)


def stem(word: str) -> str:
    """Light suffix-stripping stemmer. Keeps at least 3 chars of stem so
    "uses"/"used"/"using" → "us" never happens; good enough for overlap."""
    w = word.lower()
    if len(w) <= 4:
        return w.rstrip("s") if len(w) > 3 and w.endswith("s") and not w.endswith("ss") else w
    for suf in _SUFFIXES:
        if w.endswith(suf) and len(w) - len(suf) >= 3:
            w = w[: -len(suf)]
            break
    # Collapse doubled final consonant left by -ing/-ed ("running" → "runn" → "run").
    if len(w) > 3 and w[-1] == w[-2] and w[-1] not in "aeiouls":
        w = w[:-1]
    return w


def stems(text: str) -> set[str]:
    """Distinct content stems: lowercase words, minus stopwords and ≤2-char words."""
    return {
        stem(w) for w in _WORD_RE.findall((text or "").lower()) if len(w) > 2 and w not in STOPWORDS
    }


def document_frequency(docs: Sequence[set[str]]) -> dict[str, int]:
    df: dict[str, int] = {}
    for d in docs:
        for s in d:
            df[s] = df.get(s, 0) + 1
    return df


def _idf(df: int, n: int) -> float:
    return math.log(1.0 + n / max(1, df))


def lexical_scores(query: str, docs: Sequence[str]) -> list[float]:
    """Rarity-weighted overlap of each doc with *query*, length-normalised.

    score = Σ idf(shared stem) / sqrt(len(doc stems)) — long lessons don't win
    just by containing more words.
    """
    q = stems(query)
    doc_stems = [stems(d) for d in docs]
    if not q:
        return [0.0] * len(docs)
    df = document_frequency(doc_stems)
    n = len(docs)
    out: list[float] = []
    for d in doc_stems:
        shared = q & d
        if not shared:
            out.append(0.0)
            continue
        out.append(sum(_idf(df[s], n) for s in shared) / math.sqrt(max(1, len(d))))
    return out


def rank(
    query: str,
    docs: Sequence[str],
    *,
    cosine: Callable[[int], float] | None = None,
) -> list[tuple[int, float]]:
    """``(index, score)`` for every doc with a positive score, best first.

    With *cosine* (index → similarity in [0, 1]) the score is the hybrid
    ``0.6·cos + 0.4·lexical/max_lexical``; without it, the lexical score.
    Ties keep the input order, so callers pass newest-first.
    """
    lex = lexical_scores(query, docs)
    top = max(lex, default=0.0)
    scored: list[tuple[int, float]] = []
    for i, lx in enumerate(lex):
        if cosine is not None:
            cos = max(0.0, cosine(i))
            s = 0.6 * cos + 0.4 * (lx / top if top else 0.0)
        else:
            s = lx
        if s > 0:
            scored.append((i, s))
    scored.sort(key=lambda p: p[1], reverse=True)
    return scored


def turn_gate(
    query: str,
    docs: Sequence[str],
    *,
    min_terms: int = 2,
    rarity: float = 0.05,
) -> list[int]:
    """Indices of docs sharing ≥ *min_terms* distinct rare stems with *query*,
    ordered by summed rarity weight / sqrt(doc length).

    A stem is rare when it appears in at most ``max(1, rarity·N)`` docs.
    """
    q = stems(query)
    if not q or not docs:
        return []
    doc_stems = [stems(d) for d in docs]
    df = document_frequency(doc_stems)
    n = len(docs)
    limit = max(1, int(rarity * n))
    hits: list[tuple[float, int]] = []
    for i, d in enumerate(doc_stems):
        rare = [s for s in q & d if df[s] <= limit]
        if len(rare) < min_terms:
            continue
        weight = sum(_idf(df[s], n) for s in rare) / math.sqrt(max(1, len(d)))
        hits.append((weight, i))
    hits.sort(key=lambda p: p[0], reverse=True)
    return [i for _, i in hits]
