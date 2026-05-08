"""Channel runner — orchestrator + specialist execution loop.

Flow when a user posts to a channel:

    1. Append the user's message.
    2. Spawn the orchestrator with the channel context. Its reply gets
       appended.
    3. Parse @mentions in the orchestrator's reply. For each mentioned
       specialist that's a channel member, spawn it with the
       orchestrator's reply as a thread anchor. Their replies get
       appended back into the channel.
    4. Run another orchestrator turn so it can integrate the specialist
       results — capped by ``_MAX_ROUNDS`` so we never loop forever.

A2A pair limit: any (a, b) ordered pair of agents may exchange at most
``channels._MAX_A2A_PAIR`` messages per user-turn. When the cap hits,
further mentions to that pair are dropped silently and recorded.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable

from arz.channels import (
    _MAX_A2A_PAIR,
    _MENTION_RE,
    Channel,
    ChannelMessage,
    get_channel_store,
)

log = logging.getLogger(__name__)

# Hard ceiling on rounds per user turn. One round = orchestrator reply +
# any specialist replies it triggered. 3 rounds is plenty for "fan out,
# integrate, summarise" without runaway costs.
_MAX_ROUNDS = 3


# Same ChatRunner shape used by AutoNudge / heartbeat / consolidator.
ChatRunner = Callable[[str, str], Awaitable[str]]


class ChannelRunner:
    def __init__(self, runner: ChatRunner | None = None) -> None:
        self._runner = runner

    def set_runner(self, runner: ChatRunner) -> None:
        self._runner = runner

    async def post_user(self, slug: str, text: str) -> Channel | None:
        """Drive the channel after a human posts. Returns the updated channel."""
        store = get_channel_store()
        ch = store.get(slug)
        if ch is None:
            return None
        if ch.status == "dismissed":
            return ch
        if self._runner is None:
            log.warning("ChannelRunner has no runner — skipping orchestration")
            store.post(slug, "user", text)
            return store.get(slug)

        store.post(slug, "user", text)

        orchestrator = next((m for m in ch.members if m.role == "orchestrator"), None)
        if orchestrator is None:
            log.warning("channel %s has no orchestrator", slug)
            return store.get(slug)

        # Per-pair counters reset each user turn.
        pair_counts: dict[tuple[str, str], int] = {}

        for round_idx in range(_MAX_ROUNDS):
            ch = store.get(slug) or ch
            ctx = self._build_context(ch, orchestrator.agent)
            try:
                reply = await self._runner(orchestrator.agent, ctx)
            except Exception:
                log.exception("orchestrator turn failed", extra={"channel": slug})
                break
            reply = (reply or "").strip()
            if not reply:
                break
            store.post(slug, orchestrator.agent, reply, thread_id=None)
            mentions = _extract_member_mentions(reply, ch)
            if not mentions:
                break

            # Fan out to specialists in parallel. The orchestrator's reply
            # acts as the thread anchor so specialist replies thread off it.
            anchor = store.get(slug)
            anchor_msg = anchor.messages[-1] if anchor and anchor.messages else None
            tasks: list[asyncio.Task[None]] = []
            for spec in mentions:
                pair = (orchestrator.agent, spec)
                if pair_counts.get(pair, 0) >= _MAX_A2A_PAIR:
                    continue
                pair_counts[pair] = pair_counts.get(pair, 0) + 1
                tasks.append(
                    asyncio.create_task(self._run_specialist(slug, spec, reply, anchor_msg))
                )
            if not tasks:
                break
            await asyncio.gather(*tasks, return_exceptions=True)

        return store.get(slug)

    async def _run_specialist(
        self,
        slug: str,
        agent: str,
        prompt: str,
        anchor: ChannelMessage | None,
    ) -> None:
        if self._runner is None:
            return
        try:
            reply = await self._runner(agent, prompt)
        except Exception:
            log.exception("specialist turn failed", extra={"channel": slug, "agent": agent})
            return
        reply = (reply or "").strip()
        if not reply:
            return
        get_channel_store().post(
            slug,
            agent,
            reply,
            in_reply_to=anchor.id if anchor else None,
            thread_id=anchor.id if anchor else None,
        )

    def _build_context(self, ch: Channel, agent: str) -> str:
        """Render the channel as a prompt for an orchestrator turn."""
        lines: list[str] = []
        if ch.topic:
            lines.append(f"# Channel: {ch.name}")
            lines.append(f"Topic: {ch.topic}")
        else:
            lines.append(f"# Channel: {ch.name}")
        members = ", ".join(f"@{m.agent}" for m in ch.members if m.agent != agent)
        if members:
            lines.append(f"Specialists you can delegate to: {members}")
        lines.append("")
        lines.append("## Recent messages")
        for m in ch.messages[-30:]:
            tag = f"[thread:{m.thread_id}] " if m.thread_id else ""
            lines.append(f"{tag}@{m.from_}: {m.text}")
        lines.append("")
        lines.append(
            "Reply as the channel orchestrator. To delegate, mention a "
            "specialist with @name and ask a focused question. Keep replies "
            "short — humans read this feed."
        )
        return "\n".join(lines)


def _extract_member_mentions(text: str, ch: Channel) -> list[str]:
    """Parse @mentions from text, intersect with channel specialists."""
    raw = sorted(set(_MENTION_RE.findall(text)))
    specialist_names = {m.agent for m in ch.members if m.role != "orchestrator"}
    return [r for r in raw if r in specialist_names]


# ── Module singleton ───────────────────────────────────────────────────────
_singleton: ChannelRunner | None = None


def init_channel_runner(runner: ChatRunner) -> ChannelRunner:
    global _singleton
    _singleton = ChannelRunner(runner=runner)
    return _singleton


def get_channel_runner() -> ChannelRunner | None:
    return _singleton


# ── Built-in presets ───────────────────────────────────────────────────────
PRESETS: dict[str, dict] = {
    "incident_response": {
        "name": "Incident Response",
        "topic": "Coordinate diagnosis and mitigation of a live incident.",
        "members": [
            {"agent": "incident-commander", "role": "orchestrator"},
            {"agent": "logs-analyst", "role": "specialist"},
            {"agent": "metrics-analyst", "role": "specialist"},
            {"agent": "comms-writer", "role": "specialist"},
        ],
    },
    "code_review": {
        "name": "Code Review",
        "topic": "Review a PR or change for correctness, style, and security.",
        "members": [
            {"agent": "review-orchestrator", "role": "orchestrator"},
            {"agent": "security-reviewer", "role": "specialist"},
            {"agent": "style-reviewer", "role": "specialist"},
            {"agent": "tests-reviewer", "role": "specialist"},
        ],
    },
    "research": {
        "name": "Research",
        "topic": "Investigate a topic and synthesize findings into a brief.",
        "members": [
            {"agent": "research-lead", "role": "orchestrator"},
            {"agent": "web-researcher", "role": "specialist"},
            {"agent": "code-researcher", "role": "specialist"},
            {"agent": "writer", "role": "specialist"},
        ],
    },
}
