"""Memory context builder — single source of truth for what the LLM sees.

Every surface that talks to a provider (chat turn, subagent, heartbeat
item, task runner step, cron fire) calls ``build_prefix(user_message)``
and prepends the result to the prompt sent to the underlying model.

Blocks (top to bottom):

  <arz-runtime>, <intent>                 protected
  memory files (preferences/projects)     protected
  <lessons> standing (pinned/preference)  protected
  <lessons> relevant                      background ┐
  <semantic-memory>                       background │ admitted whole, in
  <memory> FTS + vector recall            background │ this order, under
  <episodic-memory>                       background │ budget.DEFAULT_BUDGET_CHARS
  <recent-sessions>                       background │
  <skills>                                background ┘
  <memory-budget> what was omitted, if anything
  {user_message}

**Inject once.** Providers that keep their own conversation (claude-code,
kiro-cli — ``LLMProvider.keeps_context``) still hold the first turn's prefix
on later turns, so re-sending it every turn only burned context. For those,
a session's first turn gets the full set; follow-up turns get the intent,
lessons/facts/episodes/recall hits the provider hasn't seen yet (lessons
must share ≥ 2 rare stems with the message), and any always-on block whose
content changed. The state resets — next turn is full again — when the
provider is replaced, the context is compacted, or the gateway restarts.
Stateless providers (ollama, gemini, codex) get the full prefix every turn.
"""

from __future__ import annotations

import hashlib
import itertools
import logging
import threading
from dataclasses import dataclass, field
from typing import Any

from arz.memory.budget import DEFAULT_BUDGET_CHARS, Block, admit, omission_note

log = logging.getLogger(__name__)


# ── Per-session injection state ─────────────────────────────────────────────


@dataclass
class _SessionMemory:
    token: int | None = None  # epoch of the provider holding our prefix
    lesson_ids: set[int] = field(default_factory=set)
    fact_keys: set[str] = field(default_factory=set)
    episode_ids: set[int] = field(default_factory=set)
    recall_keys: set[str] = field(default_factory=set)
    block_hashes: dict[str, str] = field(default_factory=dict)


_sessions: dict[str, _SessionMemory] = {}
_sessions_lock = threading.Lock()
_epochs = itertools.count(1)


def provider_token(provider: Any) -> int | None:
    """Stable token for a provider instance that keeps conversation context,
    or None for stateless providers (they need the full prefix every turn)."""
    if provider is None or not getattr(provider, "keeps_context", False):
        return None
    tok = getattr(provider, "_arz_memory_epoch", None)
    if tok is None:
        tok = next(_epochs)
        try:
            provider._arz_memory_epoch = tok  # noqa: SLF001
        except Exception:
            return None
    return tok


def bind_provider(session_id: str, provider: Any) -> None:
    """Record which provider received this session's prefix.

    Called after the turn's provider is activated. A provider swapped in
    after the prefix was built never saw the earlier injections, so the
    state is dropped and the next turn rebuilds in full.
    """
    tok = provider_token(provider)
    with _sessions_lock:
        st = _sessions.get(session_id)
        if st is None:
            return
        if tok is None:
            _sessions.pop(session_id, None)
        elif st.token is None:
            st.token = tok
        elif st.token != tok:
            _sessions.pop(session_id, None)


def reset_session(session_id: str) -> None:
    """Forget what this session's provider holds (compaction, restart, swap)."""
    with _sessions_lock:
        _sessions.pop(session_id, None)


def _hash(text: str) -> str:
    return hashlib.sha1(text.encode("utf-8", "replace")).hexdigest()


# ── Builder ─────────────────────────────────────────────────────────────────


def build_prefix(
    user_message: str,
    *,
    config: Any | None = None,
    recall_k: int = 5,
    enable_recall: bool = True,
    enable_lessons: bool = True,
    enable_memory_files: bool = True,
    session_id: str | None = None,
    provider_token: int | None = None,
    budget_chars: int | None = None,
) -> str:
    """Return the memory prefix to prepend to *user_message* before sending
    it to a provider. Empty string if nothing useful to inject.

    Pass *session_id* plus the live provider's *provider_token* (see
    :func:`provider_token`) to get inject-once behaviour; without them every
    call is a full, stateless build.
    """
    st: _SessionMemory | None = None
    follow_up = False
    if session_id:
        with _sessions_lock:
            prev = _sessions.get(session_id)
            if prev is not None and provider_token is not None and prev.token == provider_token:
                st, follow_up = prev, True
            else:
                st = _SessionMemory()
                _sessions[session_id] = st
    blocks: list[Block] = []

    def changed(name: str, text: str) -> bool:
        """First turn: always. Follow-up: only when the content moved."""
        if st is None:
            return True
        h = _hash(text)
        if follow_up and st.block_hashes.get(name) == h:
            return False
        st.block_hashes[name] = h
        return True

    # 0. Runtime hint (widgets + <recall>). A persistent provider keeps it.
    if config is not None and not follow_up:
        density = getattr(getattr(config, "dashboard", None), "widget_density", "more")
        if density in {"more", "less"}:
            blocks.append(Block("runtime", _widget_hint(density), protected=True))

    # 0a. Session intent — short phrase derived from recent turns. Always
    # sent; it is small and moves every turn.
    intent_query_boost = ""
    if session_id:
        try:
            from arz.memory.intent import get_intent
            from arz.memory.intent import render_for_prompt as intent_render

            block = intent_render(session_id)
            if block:
                blocks.append(Block("intent", block, protected=True))
                _it = get_intent(session_id)
                if _it and _it.keywords:
                    intent_query_boost = " " + " ".join(_it.keywords)
        except Exception:
            log.exception("intent render failed")

    # 1. Preference/project/notes files — the user's own instructions.
    if enable_memory_files:
        try:
            from arz.memory.files import get_memory_files

            files = get_memory_files()
            block = files.render_for_prompt()
            if block and changed("memory-files", block):
                blocks.append(
                    Block(
                        "memory files",
                        _cite("memory-files", str(files.base_dir), block),
                        protected=True,
                    )
                )
        except Exception:
            log.exception("memory files render failed")

    # 2. Lessons: standing rules protected, relevant ones compete for budget.
    if enable_lessons:
        try:
            from arz.lessons import get_lesson_store, render_lessons

            standing, relevant = get_lesson_store().select(
                user_message,
                exclude_ids=st.lesson_ids if follow_up and st else frozenset(),
                follow_up=follow_up,
            )
            if standing:
                blocks.append(
                    Block(
                        "standing lessons",
                        _cite("lessons", "~/.arz/lessons.jsonl", render_lessons(standing)),
                        protected=True,
                    )
                )
            if relevant:
                blocks.append(
                    Block(
                        "lessons",
                        _cite("lessons", "~/.arz/lessons.jsonl", render_lessons(relevant)),
                    )
                )
            if st is not None:
                st.lesson_ids.update(l.id for l in standing + relevant)
        except Exception:
            log.exception("lessons render failed")

    # 3. Semantic facts.
    try:
        from arz.memory.semantic import render_for_prompt as semantic_render

        keys: list[str] = []
        block = semantic_render(
            query=user_message,
            cap_chars=1500,
            exclude_keys=st.fact_keys if follow_up and st else frozenset(),
            follow_up=follow_up,
            keys_out=keys,
        )
        if block:
            blocks.append(
                Block("semantic facts", _cite("semantic-memory", "~/.arz/memory.db", block))
            )
            if st is not None:
                st.fact_keys.update(keys)
    except Exception:
        log.exception("semantic memory render failed")

    # 4. FTS + vector recall against the message (+ intent keywords).
    if enable_recall:
        try:
            query = (user_message or "") + intent_query_boost
            got: list[str] = []
            block = _recall_block(
                query,
                recall_k=recall_k,
                config=config,
                exclude=st.recall_keys if follow_up and st else frozenset(),
                keys_out=got,
            )
            if block:
                blocks.append(Block("recall hits", _cite("recall", "FTS5 + vector", block)))
                if st is not None:
                    st.recall_keys.update(got)
        except Exception:
            log.exception("recall failed")

    # 5. Episodic fragments.
    if user_message and user_message.strip():
        try:
            from arz.memory.episodic import render_for_prompt as episodic_render

            ids: list[int] = []
            block = episodic_render(
                user_message,
                k=5,
                cap_chars=3000,
                exclude_ids=st.episode_ids if follow_up and st else frozenset(),
                ids_out=ids,
            )
            if block:
                blocks.append(
                    Block("episodic memory", _cite("episodic-memory", "~/.arz/memory.db", block))
                )
                if st is not None:
                    st.episode_ids.update(ids)
        except Exception:
            log.exception("episodic render failed")

    # 6. Recent sessions — first turn only (titles churn every turn).
    if not follow_up:
        try:
            block = _recent_sessions_block(days=7, cap_per_day=8)
            if block:
                blocks.append(
                    Block("recent sessions", _cite("recent-sessions", "~/.arz/sessions/", block))
                )
        except Exception:
            log.exception("recent sessions render failed")

    # 7. Skills index.
    try:
        block = _skills_index_block()
        if block and changed("skills", block):
            blocks.append(Block("skills index", _cite("skills", "~/.arz/skills/", block)))
    except Exception:
        log.exception("skills index render failed")

    admitted, omitted = admit(blocks, budget=budget_chars or DEFAULT_BUDGET_CHARS)
    parts = [b.text for b in admitted]
    note = omission_note(omitted)
    if note:
        parts.append(note)
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


def _recent_sessions_block(
    *, days: int = 14, cap_per_day: int = 8, fallback_recent: int = 8
) -> str:
    """List recent session titles grouped by day so the model can answer
    "what did I work on yesterday/this week" without recall round-trips.

    Reads session JSON files directly from ~/.arz/sessions/ — cheap
    (just title + updated_at, no message bodies). Today's sessions go
    first, then yesterday, then older. Caps at ``cap_per_day`` titles
    per day to keep the block bounded.

    If no sessions fall within ``days``, falls back to the ``fallback_recent``
    most recent ones regardless of age. Better to show "your last session
    was 3 weeks ago" than to silently render nothing.
    """
    import datetime as _dt
    import json
    from pathlib import Path

    sessions_dir = Path.home() / ".arz" / "sessions"
    if not sessions_dir.exists():
        return ""
    cutoff = _dt.datetime.now() - _dt.timedelta(days=days)
    by_day: dict[str, list[str]] = {}
    all_real: list[tuple[_dt.datetime, str, int]] = []  # (ts, title, msg_count)
    for path in sessions_dir.glob("*.json"):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        updated = data.get("updated_at") or data.get("created_at")
        if not isinstance(updated, str):
            continue
        try:
            ts = _dt.datetime.fromisoformat(updated.replace("Z", "+00:00"))
            if ts.tzinfo is not None:
                ts = ts.replace(tzinfo=None)
        except ValueError:
            continue
        title = (data.get("title") or "Untitled")[:80]
        msg_count = len(data.get("messages") or [])
        # Skip ghost "New session" rows that warm-pool / failed creates
        # leave behind — they're noise, not real activity.
        if msg_count == 0 and title in ("New session", "Untitled"):
            continue
        all_real.append((ts, title, msg_count))
        if ts < cutoff:
            continue
        day = ts.date().isoformat()
        by_day.setdefault(day, []).append(f"- {title} ({msg_count} msgs)")

    today = _dt.date.today().isoformat()
    yesterday = (_dt.date.today() - _dt.timedelta(days=1)).isoformat()

    if by_day:
        out: list[str] = ["<recent-sessions>"]
        for day in sorted(by_day.keys(), reverse=True):
            label = day
            if day == today:
                label = f"{day} (today)"
            elif day == yesterday:
                label = f"{day} (yesterday)"
            out.append(label + ":")
            for line in by_day[day][:cap_per_day]:
                out.append(line)
        out.append("</recent-sessions>")
        return "\n".join(out)

    # Fallback: no sessions in window, but maybe there are older ones.
    if not all_real:
        return ""
    all_real.sort(reverse=True)
    out = [
        "<recent-sessions>",
        f"No sessions in the last {days} days. Most recent ever:",
    ]
    for ts, title, msg_count in all_real[:fallback_recent]:
        out.append(f"- [{ts.date().isoformat()}] {title} ({msg_count} msgs)")
    out.append("</recent-sessions>")
    return "\n".join(out)


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


def _recall_block(
    user_message: str,
    *,
    recall_k: int,
    config: Any | None,
    exclude: set[str] | frozenset[str] = frozenset(),
    keys_out: list[str] | None = None,
) -> str:
    from arz.memory.fts import get_memory_fts

    fts = get_memory_fts()
    try:
        fts.maybe_reindex()
    except Exception:
        pass
    fts_hits = fts.search(user_message, k=recall_k + len(exclude))

    vec = _vector_store(config)
    vector_hits: list = []
    if vec is not None:
        try:
            vector_hits = vec.search(user_message, k=recall_k + len(exclude))
        except Exception:
            log.exception("vector search failed")

    # Fuse the two rankings (agreement lifts a hit), then diversify.
    from arz.memory.fusion import mmr, rrf, token_jaccard

    texts: dict[str, str] = {}
    fts_keys: list[str] = []
    for h in fts_hits:
        key = f"fts:{h['source']}/{h['key']}"
        if key not in exclude and key not in texts:
            texts[key] = h["snippet"]
            fts_keys.append(key)
    vec_keys: list[str] = []
    for tup in vector_hits:
        try:
            k, content, _score = tup
        except (TypeError, ValueError):
            continue
        key = f"vec:{k}"
        if key not in exclude and key not in texts:
            texts[key] = (content or "")[:400]
            vec_keys.append(key)
    fused = rrf([fts_keys, vec_keys])
    score = dict(fused)
    chosen = mmr(
        [key for key, _ in fused],
        relevance=lambda key: score[key],
        similarity=lambda x, y: token_jaccard(texts[x], texts[y]),
        limit=recall_k,
    )
    blocks = [f"- [{key}] {texts[key]}" for key in chosen]
    if keys_out is not None:
        keys_out.extend(chosen)
    if not blocks:
        return ""
    return "<memory>\n" + "\n".join(blocks) + "\n</memory>"


def _vector_store(config: Any | None):
    """Shared VectorStore — see arz.memory.vector.get_vector_store."""
    from arz.memory.vector import get_vector_store

    return get_vector_store(config)


def reset_vector_store_for_tests() -> None:
    """Test helper — clears the shared singleton."""
    from arz.memory.vector import reset_vector_store_for_tests as _reset

    _reset()
