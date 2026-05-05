"""Post-turn memory extraction — belt and braces for self-learning.

Runs only when the assistant reply did NOT emit any inline `<learn>` /
`<memory>` / `<note>` tags. Sends the (user_message, assistant_reply)
pair to a small LLM with a tight prompt asking "did the user teach
anything durable?" and persists what it returns.

Designed to be cheap: short prompt, JSON-only output, capped at one
pass per turn. Skips silently on any error so a missing or slow LLM
never blocks the chat path.
"""

from __future__ import annotations

import json
import logging
import re

from arz.acp.types import EVENT_COMPLETE, EVENT_TEXT_CHUNK
from arz.config.schema import ArzConfig

log = logging.getLogger(__name__)

_PROMPT = """\
You are extracting durable user memory from a single chat turn.

USER MESSAGE:
{user}

ASSISTANT REPLY:
{assistant}

Rules:
- Output ONLY a JSON object — no prose, no fencing.
- If the user did NOT teach anything durable (a preference, a correction,
  a constraint, a long-lived fact, a name, a project), return:
      {{"items": []}}
- If they did, return one or more items:
      {{"items": [
          {{"kind": "learn", "category": "preference|tool|knowledge",
            "text": "<one sentence>"}},
          {{"kind": "memory", "key": "preferences|projects|memory",
            "text": "<one sentence>"}}
      ]}}
- Be conservative. Casual chat, requests for help, debugging — none of
  that is durable memory. Only emit when the user genuinely taught
  something the runtime should remember next session.

Return JSON now."""


_JSON_RE = re.compile(r"\{.*\}", re.DOTALL)


async def maybe_extract(
    user_message: str,
    assistant_reply: str,
    *,
    config: ArzConfig,
) -> int:
    """If *assistant_reply* contains no inline tags, run an extraction
    pass and persist what it finds. Returns the number of items saved."""
    if not user_message.strip() or not assistant_reply.strip():
        return 0
    if _has_inline_tags(assistant_reply):
        return 0  # Tags already handled inline; don't double-process.

    items = await _extract(user_message, assistant_reply, config)
    if not items:
        return 0
    return _persist(items)


def _has_inline_tags(text: str) -> bool:
    return any(t in text.lower() for t in ("<learn", "<memory", "<note"))


async def _extract(user_message: str, assistant_reply: str, config: ArzConfig) -> list[dict]:
    """Run a single, cheap LLM call to extract memory items.

    Uses the configured provider — same model the user is paying for.
    Could be swapped to a smaller / cheaper model later (Haiku, local
    4B) by overriding ``config.dashboard.extraction_model`` if defined.
    """
    prompt = _PROMPT.format(
        user=user_message[:4000],
        assistant=assistant_reply[:4000],
    )

    provider = _build_provider(config)
    if provider is None:
        return []

    text = ""
    try:
        await provider.start()
        async for ev in provider.stream(prompt):
            if ev.kind == EVENT_TEXT_CHUNK and ev.text:
                text += ev.text
                if len(text) > 8000:
                    break
            elif ev.kind == EVENT_COMPLETE:
                break
    except Exception:
        log.exception("post-turn extraction LLM call failed")
        return []
    finally:
        try:
            await provider.shutdown()
        except Exception:
            pass

    return _parse(text)


def _build_provider(config: ArzConfig):
    """Spawn a fresh provider for the extraction pass.

    Mirrors the configured provider — keeps the call entirely local to
    whatever the user is already running. Returns None if the provider
    isn't supported for the simple-text use case.
    """
    name = config.provider.name
    model = config.provider.model
    try:
        if name == "claude-code":
            from arz.providers.claude_code import ClaudeCodeProvider

            return ClaudeCodeProvider(model=model)
        if name == "kiro-cli":
            from arz.providers.kiro_cli import KiroCliProvider

            return KiroCliProvider(model=model)
        if name == "codex":
            from arz.providers.codex import CodexProvider

            return CodexProvider(model=model)
        if name == "gemini":
            from arz.providers.gemini import GeminiProvider

            return GeminiProvider(model=model)
        if name == "ollama":
            from arz.providers.ollama import OllamaProvider

            return OllamaProvider(model=model)
    except Exception:
        log.exception("post-turn extractor: failed to build provider")
    return None


def _parse(text: str) -> list[dict]:
    if not text:
        return []
    m = _JSON_RE.search(text)
    if not m:
        return []
    try:
        obj = json.loads(m.group(0))
    except json.JSONDecodeError:
        return []
    items = obj.get("items") if isinstance(obj, dict) else None
    if not isinstance(items, list):
        return []
    out: list[dict] = []
    for it in items:
        if not isinstance(it, dict):
            continue
        kind = (it.get("kind") or "").lower()
        text_val = (it.get("text") or "").strip()
        if not text_val or kind not in ("learn", "memory", "note"):
            continue
        out.append({"kind": kind, **it, "text": text_val})
    return out


def _persist(items: list[dict]) -> int:
    """Write extracted items via the same routing inline_learn.apply uses."""
    from arz import inline_learn

    extractions: list[inline_learn.Extracted] = []
    for it in items:
        kind = it["kind"]
        attrs: dict[str, str] = {}
        if kind == "learn":
            attrs["category"] = it.get("category", "knowledge") or "knowledge"
        elif kind == "memory":
            attrs["key"] = it.get("key", "memory") or "memory"
        elif kind == "note":
            attrs["title"] = it.get("title", "untitled") or "untitled"
        extractions.append(inline_learn.Extracted(kind=kind, body=it["text"], attrs=attrs))
    counts = inline_learn.apply(extractions)
    saved = counts.get("learn", 0) + counts.get("memory", 0) + counts.get("note", 0)
    if saved:
        log.info("post-turn extraction saved %d items", saved)
    return saved
