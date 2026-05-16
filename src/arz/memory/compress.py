"""Transcript compression for long-running sessions.

Mirrors MeshClaw 2.4.x `context.compress_thread_history`.

Problem: when arz re-injects a session's history into a freshly spawned
provider after a gateway restart, the full transcript can exceed the
underlying model's context window. Truncating from the middle (or only
the head) loses orientation; truncating only the tail loses recent
context.

Solution: keep N head messages and M tail messages verbatim. Compress
the middle into a single summary paragraph via a cheap LLM call. Stitch
back together with explicit section markers so the assistant knows what
it's looking at.

The compressed result is only used to feed the provider's
`history_messages` — the raw session JSON on disk stays untouched.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable

import structlog

log = structlog.get_logger(__name__)

# Below this raw character count the full transcript fits comfortably,
# so we skip compression entirely. Roughly 32k chars = ~8k tokens.
_COMPRESSION_THRESHOLD_CHARS = 32_000

# How many head + tail messages we keep verbatim around the compressed
# middle. MeshClaw blueprint specifies 5 — tightened from our initial 10
# so the compressed middle absorbs more turns and the resulting prefix
# stays smaller. Adjust if you find the head context isn't enough to
# reconstruct what the thread was about.
_HEAD_TAIL_MESSAGES = 5

# Maximum chars per individual message body when feeding the summariser.
_PER_MESSAGE_CAP = 1500

_COMPRESS_PROMPT = """\
You are compressing the middle section of a conversation transcript for
context preservation. Read the messages and produce a tight summary
paragraph capturing:
  - what was being worked on (problem / artifact / file paths)
  - decisions made (architecture, naming, library picks)
  - state at the end of this segment (in-flight, blocked, done)
  - any unresolved questions

Skip pleasantries. Skip details that are restated in the messages
surrounding this segment (the head and tail are kept verbatim). Be a
shareholder, not a court reporter.

Output ONLY the summary paragraph — no preface, no markdown headings,
no closing remarks. Aim for 200-500 words.

SEGMENT TO COMPRESS:
__SEGMENT__
"""


CompressorRunner = Callable[[str, str], Awaitable[str]]


async def compress_history(
    messages: list[dict],
    *,
    runner: CompressorRunner | None,
    agent: str = "general",
    threshold_chars: int = _COMPRESSION_THRESHOLD_CHARS,
    head_tail: int = _HEAD_TAIL_MESSAGES,
) -> list[dict]:
    """Return a possibly-compressed copy of *messages* suitable for
    re-injection into a fresh provider.

    No-op if:
      - total chars under threshold (the model can absorb the full thing)
      - fewer than ``head_tail * 2 + 1`` messages (nothing to compress)
      - runner is None (we can't summarise without an LLM call)

    On compression, the middle becomes a single synthetic message:
        {"role": "system",
         "text": "[COMPRESSED MIDDLE — N messages summarised]\\n\\n<summary>"}
    """
    if not messages:
        return messages
    total = sum(len(m.get("text") or "") for m in messages)
    if total <= threshold_chars:
        return messages
    if len(messages) <= head_tail * 2 + 1:
        return messages
    if runner is None:
        log.info("compress_history: no runner — returning verbatim")
        return messages

    head = messages[:head_tail]
    tail = messages[-head_tail:]
    middle = messages[head_tail:-head_tail]
    if not middle:
        return messages

    segment = _render_segment(middle)
    prompt = _COMPRESS_PROMPT.replace("__SEGMENT__", segment)
    try:
        summary = await runner(agent, prompt)
    except Exception:
        log.exception("compress_history: runner failed; returning verbatim")
        return messages
    summary = (summary or "").strip()
    if not summary:
        return messages

    synthetic = {
        "role": "system",
        "text": (
            f"[COMPRESSED MIDDLE — {len(middle)} messages summarised "
            f"(original ~{sum(len(m.get('text') or '') for m in middle)} chars). "
            f"Head + tail of this session are shown verbatim above and below.]\n\n" + summary
        ),
    }
    return head + [synthetic] + tail


def _render_segment(messages: list[dict]) -> str:
    out: list[str] = []
    for i, m in enumerate(messages):
        role = (m.get("role") or "user").upper()
        text = (m.get("text") or "").strip()
        if not text:
            continue
        if len(text) > _PER_MESSAGE_CAP:
            text = text[:_PER_MESSAGE_CAP] + "…"
        out.append(f"--- MESSAGE {i} role={role} ---\n{text}")
    return "\n\n".join(out)
