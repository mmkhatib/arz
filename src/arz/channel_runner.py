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

# Hard ceiling on orchestrator turns per user post. Previously this was
# a count of barrier-style "rounds"; now the runner uses an as-completed
# loop where the orchestrator can re-fire each time a specialist returns
# so fast workers don't sit idle behind a slow one. 8 turns gives a long
# fan-out + integrate session without runaway cost.
_MAX_ORCH_TURNS = 8

# Global ceiling on concurrent specialist runs across the whole runner.
# Per-project caps (Project.max_concurrent_subagents) further restrict
# work inside one channel; the global semaphore protects the gateway as
# a whole when many channels fire at once.
_GLOBAL_MAX_CONCURRENT = 3
_global_sem = asyncio.Semaphore(_GLOBAL_MAX_CONCURRENT)


# Same ChatRunner shape used by AutoNudge / heartbeat / consolidator.
# Implementations accept (agent_name, prompt) plus optional kwargs like
# ``approval_mode`` and ``work_dir`` so the channel runner can opt
# project-linked channels into yolo mode + a custom workspace.
ChatRunner = Callable[..., Awaitable[str]]


class ChannelRunner:
    def __init__(self, runner: ChatRunner | None = None) -> None:
        self._runner = runner
        # Live in-flight tracking. ``_busy[slug]`` is the set of agent
        # names whose turn is currently being awaited. The channels API
        # surfaces this so the UI can show a thinking indicator per
        # agent — same affordance as the chat panel's streaming bubble.
        self._busy: dict[str, set[str]] = {}

    def set_runner(self, runner: ChatRunner) -> None:
        self._runner = runner

    def busy_agents(self, slug: str) -> list[str]:
        return sorted(self._busy.get(slug, set()))

    def _mark_busy(self, slug: str, agent: str) -> None:
        self._busy.setdefault(slug, set()).add(agent)

    def _mark_idle(self, slug: str, agent: str) -> None:
        s = self._busy.get(slug)
        if s is not None:
            s.discard(agent)
            if not s:
                self._busy.pop(slug, None)

    async def post_user(self, slug: str, text: str) -> Channel | None:
        """Drive the channel after a human posts. Returns the updated channel.

        Model: as-completed, not round-barrier. The orchestrator does an
        initial turn, fans out specialists, then *each time any one
        specialist completes* we run another orchestrator turn so it can
        immediately dispatch more work to whoever's idle. Slow workers
        no longer pin fast ones in the lobby.
        """
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

        from arz.projects import get_project_store, parse_and_apply_task_tags

        project = get_project_store().get_by_channel(slug)
        per_channel_cap = project.max_concurrent_subagents if project else 3
        per_channel_sem = asyncio.Semaphore(max(1, per_channel_cap))
        project_approval = "yolo" if project else None
        project_workdir = project.repo_path if (project and project.repo_path) else None

        pair_counts: dict[tuple[str, str], int] = {}
        inflight: set[asyncio.Task[None]] = set()
        orch_turns = 0

        async def run_orchestrator_once() -> list[str]:
            """One orchestrator turn. Returns the list of *new* specialist
            names it mentioned (after pair-cap filtering) so the caller
            can spawn them. Side-effect: posts the orchestrator reply.
            """
            nonlocal orch_turns
            current = store.get(slug) or ch
            ctx = self._build_context(
                current, orchestrator.agent, project_id=(project.id if project else None)
            )
            self._mark_busy(slug, orchestrator.agent)
            try:
                reply = await self._runner(
                    orchestrator.agent,
                    ctx,
                    approval_mode=project_approval,
                    work_dir=project_workdir,
                )
            except Exception:
                log.exception("orchestrator turn failed", extra={"channel": slug})
                return []
            finally:
                self._mark_idle(slug, orchestrator.agent)
            orch_turns += 1
            reply = (reply or "").strip()
            if not reply:
                return []
            if project:
                try:
                    cleaned, _touched = parse_and_apply_task_tags(reply, project.id)
                    reply = cleaned or reply
                except Exception:
                    log.exception("task-tag apply failed", extra={"channel": slug})
            store.post(slug, orchestrator.agent, reply, thread_id=None)
            mentions = _extract_member_mentions(reply, current)
            picked: list[str] = []
            for spec in mentions:
                pair = (orchestrator.agent, spec)
                if pair_counts.get(pair, 0) >= _MAX_A2A_PAIR:
                    continue
                pair_counts[pair] = pair_counts.get(pair, 0) + 1
                picked.append(spec)
            return picked

        def spawn(spec: str) -> None:
            anchor = store.get(slug)
            anchor_msg = anchor.messages[-1] if anchor and anchor.messages else None
            inflight.add(
                asyncio.create_task(
                    self._run_specialist(
                        slug,
                        spec,
                        anchor_msg.text if anchor_msg else "",
                        anchor_msg,
                        per_channel_sem,
                        approval_mode=project_approval,
                        work_dir=project_workdir,
                    )
                )
            )

        # Initial orchestrator turn + fan-out.
        for spec in await run_orchestrator_once():
            spawn(spec)

        # As-completed loop: each time a specialist finishes, the
        # orchestrator gets to react and dispatch more work to anyone
        # currently idle. Bound by _MAX_ORCH_TURNS so cost stays sane.
        while inflight and orch_turns < _MAX_ORCH_TURNS:
            done, inflight = await asyncio.wait(inflight, return_when=asyncio.FIRST_COMPLETED)
            for t in done:
                # Exceptions are already logged inside _run_specialist.
                if t.exception():
                    pass
            for spec in await run_orchestrator_once():
                spawn(spec)

        # Drain anything still running so we don't leak tasks if we hit
        # the turn cap with work in flight. Their replies still land in
        # the channel via _run_specialist's own post.
        if inflight:
            await asyncio.gather(*inflight, return_exceptions=True)

        return store.get(slug)

    async def _run_specialist(
        self,
        slug: str,
        agent: str,
        prompt: str,
        anchor: ChannelMessage | None,
        per_channel_sem: asyncio.Semaphore,
        approval_mode: str | None = None,
        work_dir: str | None = None,
    ) -> None:
        if self._runner is None:
            return
        # Bound concurrency: per-channel cap nested inside the global cap
        # so one busy channel can't starve the rest of the gateway.
        async with _global_sem, per_channel_sem:
            self._mark_busy(slug, agent)
            try:
                reply = await self._runner(
                    agent,
                    prompt,
                    approval_mode=approval_mode,
                    work_dir=work_dir,
                )
            except Exception:
                log.exception("specialist turn failed", extra={"channel": slug, "agent": agent})
                return
            finally:
                self._mark_idle(slug, agent)
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

    def _build_context(
        self,
        ch: Channel,
        agent: str,
        project_id: str | None = None,
    ) -> str:
        """Render the channel as a prompt for an orchestrator turn.
        When a project is attached, the brief, open task list, and a
        capability snapshot are layered in so the orchestrator picks the
        right specialist + model tier for each delegation.
        """
        lines: list[str] = []

        # Capability registry block — what the orchestrator can call.
        try:
            from arz.capabilities import capabilities_block

            lines.append(capabilities_block())
            lines.append("")
        except Exception:
            log.exception("capabilities block render failed")

        if ch.topic:
            lines.append(f"# Channel: {ch.name}")
            lines.append(f"Topic: {ch.topic}")
        else:
            lines.append(f"# Channel: {ch.name}")
        # Roster — grouped by base role (strip trailing -N suffix so
        # multiples like @coder + @coder-2 surface as a "coder" pool),
        # with the current concurrency cap and busy state so the
        # orchestrator can fan out without overloading any one bucket.
        import re as _re

        roster_pool: dict[str, list[str]] = {}
        for m in ch.members:
            if m.agent == agent:
                continue
            base = _re.sub(r"-\d+$", "", m.agent) or m.agent
            roster_pool.setdefault(base, []).append(m.agent)
        if roster_pool:
            busy = set(self._busy.get(ch.id, set()))
            cap = 3
            try:
                if project_id:
                    from arz.projects import get_project_store as _gps

                    p = _gps().get(project_id)
                    if p and getattr(p, "max_concurrent_subagents", None):
                        cap = max(1, int(p.max_concurrent_subagents))
            except Exception:
                pass
            lines.append(f"Specialists you can delegate to (max {cap} parallel):")
            for base, names in sorted(roster_pool.items()):
                idle = [n for n in names if n not in busy]
                tagged = [f"@{n}{' (busy)' if n in busy else ''}" for n in sorted(names)]
                lines.append(f"  {base} — {len(idle)}/{len(names)} idle: " + ", ".join(tagged))
            if busy:
                lines.append(f"Currently working: {', '.join('@' + b for b in sorted(busy))}")

        # Project state, if any.
        if project_id:
            try:
                from arz.projects import get_project_store

                p = get_project_store().get(project_id)
                if p:
                    lines.append("")
                    lines.append(f"## Project: {p.name} (status={p.status})")
                    if p.brief:
                        lines.append("### Brief")
                        lines.append(p.brief.strip())
                    open_tasks = [t for t in p.tasks if t.status not in ("done", "failed")]
                    if open_tasks:
                        lines.append("### Open tasks")
                        for t in open_tasks[:30]:
                            assignee = f" → @{t.assignee}" if t.assignee else ""
                            blockers = (
                                f" (blocked by {','.join(t.depends_on)})" if t.depends_on else ""
                            )
                            pri = getattr(t, "priority", "normal")
                            pri_tag = f" !{pri}" if pri != "normal" else ""
                            lines.append(
                                f"- [{t.status}{pri_tag}] {t.id}: {t.title}{assignee}{blockers}"
                            )
                    lines.append("")
                    lines.append(
                        'Track work by emitting `<task action="create|update|done|delete" '
                        'id="..." assignee="@agent" priority="low|normal|high|critical" '
                        'depends_on="id1,id2">title</task>` tags in your reply. Tags are '
                        "stripped before display and persisted to the project."
                    )
            except Exception:
                log.exception("project context render failed")

        lines.append("")
        lines.append("## Recent messages")
        for m in ch.messages[-30:]:
            tag = f"[thread:{m.thread_id}] " if m.thread_id else ""
            lines.append(f"{tag}@{m.from_}: {m.text}")
        lines.append("")
        lines.append(
            "Reply as the channel orchestrator. To delegate, mention a "
            "specialist with @name and ask a focused question. Pick model "
            "tiers from <capabilities>: cheap/local for trivial work, "
            "frontier only for hard reasoning. Keep replies short."
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
