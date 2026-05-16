"""Memory context builder — single source of truth for what the LLM sees.

Every surface that talks to a provider (chat turn, subagent, heartbeat
item, task runner step, cron fire) calls ``build_prefix(user_message)``
and prepends the result to the prompt sent to the underlying model.

Block layout (top to bottom):

  <preferences>...</preferences>          always-on, ~1k chars
  <projects>...</projects>                always-on, ~2k chars
  <memory_notes>...</memory_notes>        always-on, ~2k chars
  <lessons>...</lessons>                  always-on, ranked, ~6k chars
  <memory>                                relevance-ranked top-K hits
    - [fts:lessons/12] ...
    - [vec:projects/arz] ...
  </memory>
  {user_message}

Result: every model on every surface sees the same memory shape.

Designed to be cheap when nothing's changed: the FTS index is mtime-driven
and lessons/files reload on change. Vector hits are pulled from a shared
``VectorStore`` singleton so embedding cost is paid once per turn.
"""

from __future__ import annotations

import logging
from typing import Any

log = logging.getLogger(__name__)


def build_prefix(
    user_message: str,
    *,
    config: Any | None = None,
    recall_k: int = 5,
    enable_recall: bool = True,
    enable_lessons: bool = True,
    enable_memory_files: bool = True,
) -> str:
    """Return the memory prefix to prepend to *user_message* before sending
    it to a provider. Empty string if nothing useful to inject.

    All flags default ON so any surface that just calls ``build_prefix(text)``
    gets the full treatment without further wiring.
    """
    parts: list[str] = []

    # 0. Runtime hint about widget rendering. Injected on EVERY turn (not
    # just at process start) so persistent providers — claude-code, kiro —
    # that were spawned with an older base prompt still get nudged toward
    # `<arzwidget>` for visual asks. Cheap (~250 chars) and the agent can
    # ignore it when irrelevant.
    if config is not None:
        density = getattr(getattr(config, "dashboard", None), "widget_density", "more")
        if density in {"more", "less"}:
            parts.append(_widget_hint(density))

    # 1. Always-on preferences/projects/memory_notes (with source citations)
    if enable_memory_files:
        try:
            from arz.memory.files import get_memory_files

            files = get_memory_files()
            block = files.render_for_prompt()
            if block:
                parts.append(_cite("memory-files", str(files.base_dir), block))
        except Exception:
            log.exception("memory files render failed")

    # 2. Always-on lessons (ranked by relevance to the user message)
    if enable_lessons:
        try:
            from arz.lessons import get_lesson_store

            block = get_lesson_store().render_for_prompt(user_message)
            if block:
                parts.append(_cite("lessons", "~/.arz/lessons.jsonl", block))
        except Exception:
            log.exception("lessons render failed")

    # 3. Semantic memory — high-confidence key/value facts. Filtered against
    # the user message when present so long-tail facts only surface when
    # relevant. Hits bump hit_count so the dashboard can see what's actually
    # carrying its weight.
    try:
        from arz.memory.semantic import render_for_prompt as semantic_render

        block = semantic_render(query=user_message, cap_chars=1500)
        if block:
            parts.append(_cite("semantic-memory", "~/.arz/memory.db", block))
    except Exception:
        log.exception("semantic memory render failed")

    # 4. Skills index — curated + auto-saved procedures. Short header-only
    # listing so the model knows what's available without inlining 50 KB
    # of bodies. It can `<recall>` a skill body by title if needed.
    try:
        block = _skills_index_block()
        if block:
            parts.append(_cite("skills", "~/.arz/skills/", block))
    except Exception:
        log.exception("skills index render failed")

    # 5. Episodic memory — vector-retrieved past conversation fragments
    # against the user message. Length-aware threshold (0.55 short / 0.42
    # long) keeps long entries from getting filtered out by embedding
    # dilution. Cheap when the embedder is warm.
    if user_message and user_message.strip():
        try:
            from arz.memory.episodic import render_for_prompt as episodic_render

            block = episodic_render(user_message, k=5, cap_chars=3000)
            if block:
                parts.append(_cite("episodic-memory", "~/.arz/memory.db", block))
        except Exception:
            log.exception("episodic render failed")

    # 6. Top-K relevance hits (FTS + vector). Cheap when index is warm.
    # Auto-fires against the user message — no `<recall>` tag needed.
    if enable_recall:
        try:
            block = _recall_block(user_message, recall_k=recall_k, config=config)
            if block:
                parts.append(_cite("recall", "FTS5 + vector", block))
        except Exception:
            log.exception("recall failed")

    if not parts:
        return ""
    return "\n\n".join(parts)


def _cite(label: str, source: str, body: str) -> str:
    """Prepend a `_[source: …]_` line above each block.

    Mirrors MeshClaw's citation style so the model can refer back ("per
    your preferences.md") and the user can audit where claims came from.
    """
    return f"_[source: {source}]_\n{body}"


def _skills_index_block() -> str:
    """One-line-per-skill index: title + namespace + tags. Body is loaded
    lazily via `<recall>` if the agent decides it needs the full text."""
    try:
        from arz.skills import get_skill_store

        skills = get_skill_store().list()
    except Exception:
        return ""
    if not skills:
        return ""
    lines: list[str] = []
    # Curated first (more trusted), auto after.
    skills.sort(key=lambda s: (0 if s.namespace == "curated" else 1, -s.tool_calls))
    for s in skills[:30]:
        tag_str = (" — " + ", ".join(f"#{t}" for t in s.tags[:3])) if s.tags else ""
        lines.append(f"- [{s.namespace}] {s.title}{tag_str}")
    if not lines:
        return ""
    return "<skills>\n" + "\n".join(lines) + "\n</skills>"


def _widget_hint(density: str) -> str:
    """Per-turn nudge so old persistent processes also see the widget rule."""
    return (
        "<arz-runtime>\n"
        f"widget_density={density}. You render in a browser chat UI, not a terminal. "
        "For any visual / animated / chart / interactive / 'html' request, emit "
        '<arzwidget title="…">…raw HTML/CSS/JS…</arzwidget> INLINE in your reply. '
        "Tailwind + any CDN script tag works. Do NOT write .html files unless the user "
        "explicitly says 'write', 'save', or 'create a file'. Do NOT say "
        '"open it in a browser" — the browser is already here.\n'
        "\n"
        "RECALL — same-turn memory search. If you need older context (past "
        "decisions, prior files touched, earlier user preferences, lessons from "
        "previous projects), emit `<recall>specific search query</recall>` "
        "anywhere in your reply. The server pauses you, runs FTS5 + vector "
        "search over ~/.arz/memory.db + lessons + skills, and re-enters your "
        'stream with `<recall_result query="…">…hits…</recall_result>` blocks '
        "appended. Keep reasoning. You can emit up to 3 recall queries per "
        "turn — use them freely when uncertain. Don't guess if memory can "
        "answer.\n"
        "</arz-runtime>"
    )


def _recall_block(user_message: str, *, recall_k: int, config: Any | None) -> str:
    from arz.memory.fts import get_memory_fts

    fts = get_memory_fts()
    try:
        fts.reindex()
    except Exception:
        pass
    fts_hits = fts.search(user_message, k=recall_k)

    vec = _vector_store(config)
    vector_hits: list = []
    if vec is not None:
        try:
            vector_hits = vec.search(user_message, k=recall_k)
        except Exception:
            log.exception("vector search failed")

    blocks: list[str] = []
    for h in fts_hits:
        blocks.append(f"- [fts:{h['source']}/{h['key']}] {h['snippet']}")
    for tup in vector_hits:
        try:
            k, content, _score = tup
        except (TypeError, ValueError):
            continue
        blocks.append(f"- [vec:{k}] {(content or '')[:400]}")
    if not blocks:
        return ""
    return "<memory>\n" + "\n".join(blocks) + "\n</memory>"


_vector_singleton = None


def _vector_store(config: Any | None):
    """Lazy-init shared VectorStore so embedding cost is paid once."""
    global _vector_singleton
    if _vector_singleton is not None:
        return _vector_singleton
    try:
        from arz.memory.embedder import embedder_from_config
        from arz.memory.vector import VectorStore

        spec = "hash"
        if config is not None and hasattr(config, "dashboard"):
            spec = getattr(config.dashboard, "embedding_model", "hash") or "hash"
        emb = embedder_from_config(spec)
        _vector_singleton = VectorStore(embedder=emb)
        return _vector_singleton
    except Exception:
        log.exception("VectorStore init failed")
        return None


def reset_vector_store_for_tests() -> None:
    """Test helper — clears the shared singleton."""
    global _vector_singleton
    _vector_singleton = None
