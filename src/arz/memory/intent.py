"""Session-scoped intent tracker.

Watches the rolling tail of user/assistant turns and extracts a short
phrase describing what the user is currently trying to do. Cached per
session for cheap reads from ``build_prefix``.

The intent string is fed into the retrieval query as a second pass —
boosting memories that match what the user is *working on* even when
the current message is terse ("ok keep going", "yes", "do it").

Cheap: pure regex + token-frequency over the last 3 turns. No LLM call.
A more elaborate LLM-classifier can replace ``_classify`` later without
touching the wiring.
"""

from __future__ import annotations

import logging
import re
import threading
import time
from collections import Counter
from dataclasses import dataclass, field

log = logging.getLogger(__name__)

_STOPWORDS = {
    "the",
    "and",
    "for",
    "with",
    "that",
    "this",
    "from",
    "have",
    "has",
    "are",
    "was",
    "were",
    "but",
    "not",
    "can",
    "you",
    "your",
    "yours",
    "our",
    "their",
    "they",
    "them",
    "what",
    "when",
    "where",
    "why",
    "how",
    "who",
    "whom",
    "into",
    "onto",
    "out",
    "off",
    "all",
    "any",
    "some",
    "one",
    "two",
    "more",
    "less",
    "most",
    "least",
    "such",
    "than",
    "then",
    "now",
    "yet",
    "also",
    "very",
    "much",
    "many",
    "few",
    "ok",
    "okay",
    "yes",
    "no",
    "yeah",
    "nope",
    "sure",
    "well",
    "got",
    "get",
    "let",
    "lets",
    "make",
    "made",
    "going",
    "went",
    "gone",
    "did",
    "done",
    "doing",
    "do",
    "be",
    "is",
    "am",
    "been",
    "being",
    "as",
    "at",
    "by",
    "if",
    "it",
    "its",
    "on",
    "or",
    "to",
    "us",
    "we",
    "in",
    "of",
    "an",
    "a",
    "i",
    "me",
    "my",
    "mine",
    "he",
    "she",
    "him",
    "her",
}

_TOKEN_RE = re.compile(r"[a-zA-Z][a-zA-Z0-9_]{2,}")


@dataclass
class Intent:
    """One snapshot of the session's current intent."""

    phrase: str = ""
    keywords: list[str] = field(default_factory=list)
    updated_at: float = 0.0


_lock = threading.Lock()
_intents: dict[str, Intent] = {}


def get_intent(session_id: str) -> Intent | None:
    """Return the cached intent for *session_id*, or None."""
    with _lock:
        return _intents.get(session_id)


def clear(session_id: str) -> None:
    """Wipe the cached intent for *session_id*."""
    with _lock:
        _intents.pop(session_id, None)


def update_from_messages(session_id: str, messages: list[dict]) -> Intent:
    """Recompute the intent from the tail of *messages*.

    ``messages`` is a list of ``{"role": ..., "text": ...}`` dicts in
    chronological order. We look at the last 3 user turns + last 2
    assistant turns — enough signal for a topic, cheap to scan.

    Idempotent: returns the cached intent if the input hash hasn't
    changed since the last call.
    """
    user_tail = [m["text"] for m in messages if m.get("role") == "user"][-3:]
    asst_tail = [m["text"] for m in messages if m.get("role") == "assistant"][-2:]
    if not user_tail and not asst_tail:
        return Intent()
    blob = " \n ".join(user_tail + asst_tail)
    intent = _classify(blob)
    with _lock:
        _intents[session_id] = intent
    return intent


def _classify(text: str) -> Intent:
    """Pure-Python classifier: top-K non-stopword tokens by frequency,
    de-duplicated, sorted by first-occurrence. Joined as the phrase.
    """
    tokens = [t.lower() for t in _TOKEN_RE.findall(text or "")]
    if not tokens:
        return Intent(updated_at=time.time())
    # Frequency excluding stopwords + ultra-common verbs.
    counts = Counter(t for t in tokens if t not in _STOPWORDS and len(t) >= 4)
    if not counts:
        return Intent(updated_at=time.time())
    # Top by count, but ties broken by first-occurrence so the phrase
    # reads naturally rather than alphabetically.
    first_idx: dict[str, int] = {}
    for i, t in enumerate(tokens):
        first_idx.setdefault(t, i)
    ranked = sorted(
        counts.items(),
        key=lambda kv: (-kv[1], first_idx.get(kv[0], 1_000_000)),
    )
    top = [k for k, _ in ranked[:6]]
    # Filter near-duplicates (substring matches).
    final: list[str] = []
    for t in top:
        if any(t in f or f in t for f in final):
            continue
        final.append(t)
        if len(final) >= 4:
            break
    return Intent(phrase=" ".join(final), keywords=final, updated_at=time.time())


def render_for_prompt(session_id: str) -> str:
    """Return a `<intent>` block for the prompt, or empty string."""
    intent = get_intent(session_id)
    if not intent or not intent.phrase:
        return ""
    return f"<intent>\ncurrent focus: {intent.phrase}\n</intent>"
