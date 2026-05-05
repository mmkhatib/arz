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
    r"<(?P<tag>learn|memory|note)(?P<attrs>(?:\s+[a-z_]+=\"[^\"]*\")*)\s*>"
    r"(?P<body>.*?)"
    r"</(?P=tag)>",
    re.IGNORECASE | re.DOTALL,
)
_ATTR_RE = re.compile(r"([a-z_]+)=\"([^\"]*)\"", re.IGNORECASE)

_VALID_LEARN_CATEGORIES = {"preference", "tool", "knowledge"}


@dataclass
class Extracted:
    kind: Literal["learn", "memory", "note"]
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


def apply(extractions: list[Extracted]) -> dict[str, int]:
    """Persist each extraction to the right store. Returns counts per kind."""
    counts = {"learn": 0, "memory": 0, "note": 0, "skipped": 0}
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
                sep = "" if not prev else ("\n" if prev.endswith("\n") else "\n\n")
                target.write_text(prev + sep + f"- {ex.body.strip()}\n", encoding="utf-8")
                counts["memory"] += 1
            elif ex.kind == "note":
                title = (ex.attrs.get("title") or "untitled").strip()
                notes.save(title, ex.body)
                counts["note"] += 1
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
