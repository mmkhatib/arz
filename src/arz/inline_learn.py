"""Inline self-learning — parse <learn>, <memory>, <note> tags out of
assistant replies and persist them.

Provider-agnostic: the LLM emits the tags as part of normal text, the
gateway strips them post-stream and writes to the appropriate store.
Works on every provider (claude-code, kiro-cli, codex, gemini, ollama,
anthropic) because every one of them produces text.

Tag shapes (case-insensitive, attributes optional):

    <learn category="preference">user prefers terse replies</learn>
    <learn category="tool" pinned="true">use rg, not grep</learn>
    <memory key="projects/arz">multi-LLM agent runtime</memory>
    <note title="meshclaw-comparison">Mesh uses MCP, Arz uses tags</note>

Returned tuple is (cleaned_text, [extraction_results]) so the caller
can both display the de-tagged reply and log what landed.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import Literal

log = logging.getLogger(__name__)

# Tags we recognise. Body can include newlines. Attributes are simple
# key="value" pairs separated by whitespace.
_TAG_RE = re.compile(
    r"<(?P<tag>learn|memory|note|recall|todo|semantic|forget)(?P<attrs>(?:\s+[a-z_]+=\"[^\"]*\")*)\s*>"
    r"(?P<body>.*?)"
    r"</(?P=tag)>",
    re.IGNORECASE | re.DOTALL,
)
_ATTR_RE = re.compile(r"([a-z_]+)=\"([^\"]*)\"", re.IGNORECASE)

_VALID_LEARN_CATEGORIES = {"preference", "tool", "knowledge"}


@dataclass
class Extracted:
    kind: Literal["learn", "memory", "note", "recall", "todo", "semantic", "forget"]
    body: str
    attrs: dict[str, str]


def parse(text: str) -> tuple[str, list[Extracted]]:
    """Strip recognised tags from *text*, return (cleaned, extractions).

    Whitespace immediately before a stripped tag is normalised so the
    visible output doesn't end up with double-blank-lines where the tag
    used to be.
    """
    if not text or "<" not in text:
        return text, []
    extracted: list[Extracted] = []

    def _attrs(s: str) -> dict[str, str]:
        return {k.lower(): v for k, v in _ATTR_RE.findall(s or "")}

    def _capture(m: re.Match) -> str:
        kind = m.group("tag").lower()
        body = (m.group("body") or "").strip()
        attrs = _attrs(m.group("attrs"))
        if body:
            extracted.append(Extracted(kind=kind, body=body, attrs=attrs))  # type: ignore[arg-type]
        return ""

    cleaned = _TAG_RE.sub(_capture, text)
    # Collapse any runs of 3+ blank lines that the strip may have left.
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned).strip()
    return cleaned, extracted


# Session-keyed queue of pending <recall> queries the model asked for.
# The chat route drains these on the NEXT turn, runs a search, and
# injects the answers as a system block so the model sees them on its
# follow-up reply. Without MCP this is the cheapest way to give the
# model an on-demand search surface.
_pending_recalls: dict[str, list[str]] = {}


def queue_recall(session_id: str, query: str) -> None:
    if not session_id or not query.strip():
        return
    _pending_recalls.setdefault(session_id, []).append(query.strip())


def drain_recalls(session_id: str) -> list[str]:
    return _pending_recalls.pop(session_id, [])


def apply(extractions: list[Extracted], *, session_id: str | None = None) -> dict[str, int]:
    """Persist each extraction to the right store. Returns counts per kind.

    ``session_id`` is required for ``<recall>`` extractions so the queued
    query can be pulled on the next turn.
    """
    counts = {
        "learn": 0,
        "memory": 0,
        "note": 0,
        "recall": 0,
        "todo": 0,
        "semantic": 0,
        "forget": 0,
        "skipped": 0,
    }
    if not extractions:
        return counts
    from arz.lessons import get_lesson_store
    from arz.memory.files import get_memory_files
    from arz.memory.markdown import MarkdownStore

    lessons = get_lesson_store()
    files = get_memory_files()
    notes = MarkdownStore()

    for ex in extractions:
        try:
            if ex.kind == "recall":
                if session_id:
                    queue_recall(session_id, ex.body or ex.attrs.get("query", ""))
                    counts["recall"] += 1
                else:
                    counts["skipped"] += 1
                continue
            if ex.kind == "learn":
                cat = (ex.attrs.get("category") or "knowledge").lower()
                if cat not in _VALID_LEARN_CATEGORIES:
                    cat = "knowledge"
                pinned = ex.attrs.get("pinned", "").lower() in {"true", "1", "yes"}
                lessons.add(cat, ex.body, pinned)
                counts["learn"] += 1
            elif ex.kind == "memory":
                # Route memory entries to one of the auto-injected files
                # so they actually surface on the next turn:
                #   key starts with "pref"     -> preferences.md
                #   key starts with "proj"     -> projects.md
                #   anything else / no key     -> memory.md (also injected)
                key = (ex.attrs.get("key") or "").strip().lower()
                if key.startswith("pref"):
                    fname = "preferences.md"
                elif key.startswith("proj"):
                    fname = "projects.md"
                else:
                    fname = "memory.md"
                target = files.base_dir / fname
                target.parent.mkdir(parents=True, exist_ok=True)
                prev = target.read_text(encoding="utf-8") if target.exists() else ""
                # Dedup: skip if a fuzzy match already exists. Stops the
                # same hallucinated fact accumulating across runs.
                if _bullet_already_present(prev, ex.body):
                    counts["skipped"] += 1
                    continue
                sep = "" if not prev else ("\n" if prev.endswith("\n") else "\n\n")
                target.write_text(prev + sep + f"- {ex.body.strip()}\n", encoding="utf-8")
                counts["memory"] += 1
            elif ex.kind == "note":
                title = (ex.attrs.get("title") or "untitled").strip()
                notes.save(title, ex.body)
                counts["note"] += 1
            elif ex.kind == "todo":
                from arz.dashboard.routes.action_items import add_from_agent

                prio = (ex.attrs.get("priority") or "normal").lower()
                if prio not in {"low", "normal", "high"}:
                    prio = "normal"
                if add_from_agent(ex.body, session_id=session_id, priority=prio):  # type: ignore[arg-type]
                    counts["todo"] += 1
                else:
                    counts["skipped"] += 1
            elif ex.kind == "semantic":
                # <semantic key="prod.db.host">db-1.internal:5432</semantic>
                # Confidence rises on each reaffirm; consolidator does the
                # same upsert from session transcripts.
                from arz.memory import semantic

                key = (ex.attrs.get("key") or "").strip()
                if not key:
                    counts["skipped"] += 1
                    continue
                try:
                    semantic.upsert(key, ex.body, source=session_id or "")
                    counts["semantic"] += 1
                except ValueError:
                    counts["skipped"] += 1
            elif ex.kind == "forget":
                # <forget key="prod.db.host">contradicted at 14:32</forget>
                # Drops confidence; row deletes when it crosses zero.
                from arz.memory import semantic

                key = (ex.attrs.get("key") or "").strip()
                if not key:
                    counts["skipped"] += 1
                    continue
                semantic.contradict(key)
                counts["forget"] += 1
            else:
                counts["skipped"] += 1
        except Exception:
            log.exception("inline_learn apply failed", extra={"kind": ex.kind})
            counts["skipped"] += 1
    return counts


_SAFE_SEG_RE = re.compile(r"[^a-zA-Z0-9_\-/]+")


def _safe_segment(s: str) -> str:
    s = _SAFE_SEG_RE.sub("_", s.strip()).strip("/_")
    return s[:120] or "scratchpad"


def _normalise(s: str) -> str:
    """Lowercase + strip punctuation + collapse whitespace for fuzzy-equality.

    "User prefers avocado toast." == "user prefers avocado toast"
    """
    out = re.sub(r"[^a-z0-9 ]+", " ", (s or "").lower())
    return re.sub(r"\s+", " ", out).strip()


def _bullet_already_present(file_text: str, candidate: str) -> bool:
    """True if any existing bullet in *file_text* fuzzy-matches *candidate*."""
    target = _normalise(candidate)
    if not target:
        return True
    for line in file_text.splitlines():
        line = line.strip()
        if not line.startswith(("-", "*")):
            continue
        body = line.lstrip("-* \t")
        if not body:
            continue
        norm = _normalise(body)
        if not norm:
            continue
        # Exact normalised match OR substring overlap >= 90% of either side.
        if norm == target:
            return True
        shorter, longer = sorted([norm, target], key=len)
        if shorter and shorter in longer and len(shorter) >= 0.9 * len(longer):
            return True
    return False
