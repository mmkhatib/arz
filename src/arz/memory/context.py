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

    # 1. Always-on preferences/projects/memory_notes
    if enable_memory_files:
        try:
            from arz.memory.files import get_memory_files

            block = get_memory_files().render_for_prompt()
            if block:
                parts.append(block)
        except Exception:
            log.exception("memory files render failed")

    # 2. Always-on lessons (ranked by relevance to the user message)
    if enable_lessons:
        try:
            from arz.lessons import get_lesson_store

            block = get_lesson_store().render_for_prompt(user_message)
            if block:
                parts.append(block)
        except Exception:
            log.exception("lessons render failed")

    # 3. Top-K relevance hits (FTS + vector). Cheap when index is warm.
    if enable_recall:
        try:
            block = _recall_block(user_message, recall_k=recall_k, config=config)
            if block:
                parts.append(block)
        except Exception:
            log.exception("recall failed")

    if not parts:
        return ""
    return "\n\n".join(parts)


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
