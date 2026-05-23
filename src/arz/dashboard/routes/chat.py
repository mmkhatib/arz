"""Chat route — POST message → SSE stream."""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import AsyncIterator
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse

from arz import inline_learn
from arz.acp.client import AcpError
from arz.acp.types import (
    EVENT_COMPACTION_STATUS,
    EVENT_COMPLETE,
    EVENT_PERMISSION_REQUEST,
    EVENT_TEXT_CHUNK,
    EVENT_THINKING_CHUNK,
    EVENT_TOOL_CALL,
    EVENT_TOOL_RESULT,
)
from arz.dashboard.redact import redact_chunk, redact_full
from arz.dashboard.sse import (
    sse_chunk,
    sse_compaction,
    sse_complete,
    sse_error,
    sse_heartbeat,
    sse_permission_request,
    sse_segment,
    sse_thinking,
    sse_tool_call,
    sse_tool_result,
    sse_writer_done,
)
from arz.dashboard.stream_registry import get_stream_registry
from arz.dashboard.token_auth import require_token
from arz.hooks import get_hook_manager
from arz.prompts.loader import resolve_system_prompt
from arz.providers.base import LLMProvider
from arz.providers.pool import ProviderPool
from arz.session.manager import SessionManager
from arz.session.session_map import SessionMap
from arz.subagents import get_subagent_manager

log = logging.getLogger(__name__)
router = APIRouter(dependencies=[Depends(require_token)])

_WORKSPACE_ROOT = Path.home() / ".arz" / "workspace"


_APPROVAL_TO_CLAUDE = {
    "normal": None,  # default behavior
    "trust_reads": "acceptEdits",  # auto-accept edits, ask for risky
    "trust": "bypassPermissions",  # never ask
    "yolo": "bypassPermissions",
}


def _make_provider(
    config: object,
    session_id: str,
    history: list[dict] | None,
    session_work_dir: str | None = None,
    provider_name_override: str | None = None,
    model_override: str | None = None,
    approval_mode: str = "normal",
    agent_name: str | None = None,
) -> LLMProvider:
    """Factory: build the right provider for this session."""
    from arz.config.schema import ArzConfig

    assert isinstance(config, ArzConfig)

    provider_name = provider_name_override or config.provider.name
    # Only inherit `config.provider.model` when the session's provider
    # matches the global config provider. Otherwise the model is almost
    # certainly wrong (e.g. global config sets model=gpt-5.4 for
    # provider=claude-code from an earlier codex experiment — the writer
    # then errors out every turn with "model not found", spinning the
    # /goal loop to its iteration cap). Pass "" and let the provider
    # pick its own default for the new provider family.
    if model_override:
        model = model_override
    elif provider_name == config.provider.name:
        model = config.provider.model
    else:
        model = ""
    work_dir = Path(session_work_dir) if session_work_dir else (_WORKSPACE_ROOT / session_id)
    # Resolve the steered prompt: agent's system_prompt (if set) → per-config
    # override → bundled.
    agent_prompt = ""
    if agent_name:
        try:
            from arz.agents import AgentRegistry

            agent = AgentRegistry().get(agent_name)
            if agent and agent.system_prompt:
                agent_prompt = agent.system_prompt
        except Exception:
            pass
    system_prompt = resolve_system_prompt(
        agent_prompt or config.dashboard.system_prompt or None,
        widget_density=getattr(config.dashboard, "widget_density", None),
    )

    if provider_name == "claude-code":
        from arz.providers.claude_code import ClaudeCodeProvider

        return ClaudeCodeProvider(
            model=model,
            work_dir=work_dir,
            system_prompt=system_prompt or None,
            history_messages=history,
            permission_mode=_APPROVAL_TO_CLAUDE.get(approval_mode),
        )

    if provider_name == "kiro-cli":
        from arz.providers.kiro_cli import KiroCliProvider

        return KiroCliProvider(
            model=model,
            work_dir=work_dir,
            system_prompt=system_prompt or None,
            history_messages=history,
        )

    if provider_name == "codex":
        from arz.providers.codex import CodexProvider

        return CodexProvider(
            model=model,
            work_dir=work_dir,
            system_prompt=system_prompt or None,
            history_messages=history,
        )

    if provider_name == "gemini":
        from arz.providers.gemini import GeminiProvider

        return GeminiProvider(
            model=model,
            work_dir=work_dir,
            system_prompt=system_prompt or None,
            history_messages=history,
            approval_mode=approval_mode,
        )

    if provider_name == "ollama":
        from arz.providers.ollama import OllamaProvider

        return OllamaProvider(
            model=model,
            work_dir=work_dir,
            system_prompt=system_prompt or None,
            history_messages=history,
        )

    raise ValueError(f"Unknown provider: {provider_name!r}")


READ_ONLY_TOOLS = {"Read", "Glob", "Grep", "WebSearch", "WebFetch"}


def _final_assistant_text(cleaned: str, extracted: list, raw: str) -> str:
    """Pick the text we actually save to the session.

    The old fallback was `cleaned or raw` — but when the model's reply
    was ONLY inline tags (e.g. a lone `<recall>` or `<learn>`), cleaned
    is "" and we'd revert to the raw text, persisting the tag literal
    into the visible bubble. That's exactly the case we want cleaned to
    win in. So: trust cleaned when we actually extracted something,
    falling back to a tiny placeholder so the bubble isn't blank.

    Stay-on-task #12: apply full-text redaction here so cross-chunk
    credential patterns (which slip past the per-chunk pass) don't
    persist into session.messages.
    """
    if extracted:
        return redact_full(cleaned) if cleaned else "_(memory updated — no visible reply)_"
    return redact_full(cleaned or raw)


_ARTIFACT_TOOLS = frozenset(
    {"Write", "Edit", "MultiEdit", "Create", "fs_write", "fs_edit", "fs_create"}
)


def _accumulate_goal_memory(session) -> None:
    """Walk the just-saved assistant message + extract files touched
    by Write/Edit/Create tool_calls, plus DECISION:/BLOCKER: lines
    from the assistant's text. Appended onto session.goal_* lists so
    the judge sees cumulative progress across iterations. Deduped and
    capped at modest sizes so a 50-iteration goal doesn't bloat the
    session JSON unboundedly.
    """
    if not session or not session.messages:
        return
    last = session.messages[-1]
    if last.role != "assistant":
        return
    # Files touched
    for tc in last.tool_calls or []:
        name = str(tc.get("name") or "")
        if name not in _ARTIFACT_TOOLS:
            continue
        raw_input = tc.get("input") or ""
        try:
            tc_data = json.loads(raw_input) if isinstance(raw_input, str) else raw_input
        except Exception:
            tc_data = {}
        path = (
            tc_data.get("file_path")
            or tc_data.get("path")
            or tc_data.get("target_file")
            or tc_data.get("filename")
        )
        if path and isinstance(path, str):
            entry = f"{name} {path}"
            if entry not in session.goal_files_changed:
                session.goal_files_changed.append(entry)
    # Decisions + Blockers from text
    for line in (last.text or "").splitlines():
        s = line.strip()
        if s.startswith("DECISION:"):
            d = s[9:].strip()[:240]
            if d and d not in session.goal_decisions:
                session.goal_decisions.append(d)
        elif s.startswith("BLOCKER:"):
            b = s[8:].strip()[:240]
            if b and b not in session.goal_blockers:
                session.goal_blockers.append(b)
    # Trim to recent N to keep session.json bounded.
    if len(session.goal_files_changed) > 60:
        session.goal_files_changed = session.goal_files_changed[-60:]
    if len(session.goal_decisions) > 30:
        session.goal_decisions = session.goal_decisions[-30:]
    if len(session.goal_blockers) > 20:
        session.goal_blockers = session.goal_blockers[-20:]


# Tool calls whose stdout is itself the artifact — e.g. pytest --cov,
# Tool calls whose stdout is itself the artifact — e.g. pytest --cov,
# `npm test`, `go vet`. Judge sees the captured output as a synthetic
# artifact entry alongside any files the writer touched.
_STDOUT_TOOLS = frozenset({"Bash", "Run", "Shell", "execute_bash", "run_command"})


def _collect_recent_artifacts(session) -> list[dict]:
    """Walk recent assistant messages for Write/Edit/Create-shaped
    tool_calls. Resolve each path against the session's work_dir and
    read the current content from disk. The judge prompt gets these
    as inline file dumps so file-output goals (CSV, code file, table
    written to disk) can be verified directly instead of guessed from
    transcript chatter.

    Bounds:
      - Last 4 assistant turns scanned
      - At most 8 unique files
      - Per-file read cap 64K (formatter trims further)
      - Silently skips files that don't exist or aren't UTF-8 readable
    """
    out: list[dict] = []
    seen: set[str] = set()
    work_dir = Path(session.work_dir) if session.work_dir else (_WORKSPACE_ROOT / session.id)
    msgs = [m for m in (session.messages or []) if m.role == "assistant"][-4:]
    for m in reversed(msgs):
        for tc in m.tool_calls or []:
            name = str(tc.get("name") or "")
            if name in _STDOUT_TOOLS:
                # Synthetic artifact: the command output is the proof.
                # Naming: `stdout:Bash:<short-cmd>` so the judge can
                # cite which command produced the evidence.
                raw_input = tc.get("input") or ""
                try:
                    tc_data = json.loads(raw_input) if isinstance(raw_input, str) else raw_input
                except Exception:
                    tc_data = {}
                cmd = (
                    tc_data.get("command")
                    or tc_data.get("cmd")
                    or tc_data.get("script")
                    or (raw_input if isinstance(raw_input, str) else "")
                )
                cmd_str = str(cmd or "").strip().splitlines()[0][:200] if cmd else "?"
                output = str(tc.get("output") or "").strip()
                if not output:
                    continue
                key = f"stdout:{name}:{cmd_str}"
                if key in seen:
                    continue
                seen.add(key)
                out.append({"path": key, "content": output[:16000]})
                if len(out) >= 8:
                    return out
                continue
            if name not in _ARTIFACT_TOOLS:
                continue
            raw_input = tc.get("input") or ""
            try:
                tc_data = json.loads(raw_input) if isinstance(raw_input, str) else raw_input
            except Exception:
                tc_data = {}
            path = (
                tc_data.get("file_path")
                or tc_data.get("path")
                or tc_data.get("target_file")
                or tc_data.get("filename")
            )
            if not path or not isinstance(path, str):
                continue
            full = Path(path) if Path(path).is_absolute() else work_dir / path
            key = str(full)
            if key in seen:
                continue
            seen.add(key)
            try:
                content = full.read_text(encoding="utf-8", errors="replace")[:65536]
            except Exception:
                continue
            out.append({"path": str(full), "content": content})
            if len(out) >= 8:
                return out
    return out


async def _goal_followup(
    *,
    session,
    mgr,
    subagent_runner,
    chat_runner,
    target_msg_idx: int | None = None,
):
    """Evaluate the goal after the just-finished assistant turn; emit
    the verdict marker live. If not met and budget remains, RETURN a
    coroutine for the follow-up writer POST so the caller can schedule
    it AFTER the current SSE stream has finished. Returns ``None``
    when no follow-up turn should fire (goal met / cap reached /
    evaluator unavailable / user cleared the goal mid-eval).
    """
    from arz import goal as _goal

    log.info(
        "goal followup starting",
        extra={
            "session_id": session.id,
            "goal_len": len((session.goal or "").strip()),
            "iterations": getattr(session, "goal_iterations", 0),
        },
    )

    # Pin the evaluator to a cheap judge model matching the session's
    # main provider (Opus writes → Haiku judges, Pro writes → Flash-Lite
    # judges, etc.). Without this the evaluator falls through to the
    # same model the main turn used, which defeats the point of having
    # an independent cheap critic and burns tokens.
    judge_provider = session.provider or None
    judge_model = _goal.cheap_model_for(judge_provider)
    judge_tools = getattr(session, "goal_judge_tools", "trust_reads") or "trust_reads"
    # Judge runs in the same workspace as the writer so file artifacts
    # the writer touched are reachable via Read / Grep / Bash without
    # path mangling. "trust_reads" auto-approves Read/Grep/Glob/Web*;
    # "trust" lets the judge run pytest / build commands; "none" runs
    # without tools (fastest, blindest).
    judge_work_dir = session.work_dir or None
    judge_approval = "normal" if judge_tools == "none" else judge_tools

    async def _judge_runner(agent_name: str, prompt: str) -> str:
        try:
            return await subagent_runner(
                agent_name,
                prompt,
                approval_mode=judge_approval,
                work_dir=judge_work_dir,
                provider_override=judge_provider,
                model_override=judge_model or None,
            )
        except TypeError:
            # Backwards-compat: older runner sig without overrides.
            return await subagent_runner(agent_name, prompt)

    # Update cumulative working memory from THIS turn before judging
    # so the WORKING MEMORY block reflects everything the writer has
    # done across the goal loop, not just turn 1.
    try:
        _accumulate_goal_memory(session)
        mgr.save(session)
    except Exception:
        log.exception("goal memory accumulate failed", extra={"session_id": session.id})

    try:
        # Build a short history tail for the evaluator.
        history = [{"role": m.role, "text": m.text} for m in (session.messages or [])][-8:]
        # Collect file artifacts the writer touched in recent turns so
        # the judge can verify file-output goals directly instead of
        # guessing from transcript chatter.
        artifacts = _collect_recent_artifacts(session)
        memory_payload = {
            "files_changed": list(getattr(session, "goal_files_changed", []) or []),
            "decisions": list(getattr(session, "goal_decisions", []) or []),
            "blockers": list(getattr(session, "goal_blockers", []) or []),
        }
        decision = await _goal.evaluate(
            goal=session.goal or "",
            history=history,
            runner=_judge_runner,
            n_turns=6,
            artifacts=artifacts,
            memory=memory_payload,
        )
    except Exception:
        log.exception("goal evaluator crashed", extra={"session_id": session.id})
        return None

    # Refresh from disk in case the user cleared the goal mid-eval.
    fresh = mgr.get(session.id)
    if fresh is None:
        return None
    if (not (fresh.goal or "").strip()) or fresh.goal_status != "active":
        return None

    # Frustration counter: bump when judge rejects with the same reason
    # back-to-back; reset on any new complaint or a "met" verdict.
    prev_reason = getattr(fresh, "goal_last_reason", "")
    prev_streak = int(getattr(fresh, "goal_same_reason_count", 0) or 0)
    if decision.met:
        fresh.goal_same_reason_count = 0
    elif _goal.is_same_reason(decision.reason, prev_reason):
        fresh.goal_same_reason_count = prev_streak + 1
    else:
        fresh.goal_same_reason_count = 1
    fresh.goal_last_reason = decision.reason

    # Always emit an evaluator marker so the user can see the
    # back-and-forth between the worker turn and the judge — without
    # this the evaluator was invisible and felt like nothing was
    # happening between auto-iterations.
    def _emit_marker(text: str) -> None:
        # 1. Persist the marker into the assistant message that
        #    corresponds to THIS turn (target_msg_idx, captured by the
        #    caller before any auto-iter follow-up could land). Fallback
        #    to "last assistant in session" only when caller didn't
        #    supply an index — prevents chips from a no-text iteration
        #    landing on the previous turn's bubble.
        try:
            target = None
            if target_msg_idx is not None and 0 <= target_msg_idx < len(fresh.messages):
                cand = fresh.messages[target_msg_idx]
                if cand.role == "assistant":
                    target = cand
            if target is None:
                target = next(
                    (m for m in reversed(fresh.messages) if m.role == "assistant"),
                    None,
                )
            if target is not None:
                tag = text.strip()
                if tag and tag not in (target.text or ""):
                    target.text = (target.text or "").rstrip() + "\n\n" + tag
                    mgr.save(fresh)
        except Exception:
            log.exception("goal marker persist failed", extra={"session_id": fresh.id})

        # 2. Broadcast the marker to live SSE subscribers so the active
        #    chat view shows the chip without waiting for a refresh.
        try:
            from arz.dashboard.sse import sse_chunk
            from arz.dashboard.stream_registry import get_stream_registry

            reg = get_stream_registry()
            state = reg._states.get(fresh.id)  # noqa: SLF001
            if state is None:
                return
            chunk = sse_chunk(text)
            try:
                state.events.append(chunk)
            except Exception:
                pass
            for q in list(state.subscribers):
                try:
                    q.put_nowait(chunk)
                except Exception:
                    pass
        except Exception:
            pass

    # Empty model_override means the provider picked its own default
    # (e.g. Ollama) — surface the provider alone.
    judge_label = judge_model or (judge_provider or "default")
    verdict_attr = "met" if decision.met else "not-met"
    safe_reason = (
        (decision.reason or "")
        .replace('"', "'")
        .replace("\n", " ")
        .replace("\r", " ")
        # Escape angle brackets so embedded `<arzwidget>` / `<goal-marker>`
        # mentions inside the reason text don't break the chip's regex
        # parser (which scans for the next `>` to end the self-closing
        # tag). Use unicode angle quotes — visually similar, parse-safe.
        .replace("<", "‹")
        .replace(">", "›")[:600]
    )
    _emit_marker(
        f'\n\n<goal-marker variant="evaluator" judge="{judge_label}" '
        f'verdict="{verdict_attr}" reason="{safe_reason}" />\n\n'
    )
    log.info(
        "goal evaluator judged",
        extra={
            "session_id": session.id,
            "judge_provider": judge_provider,
            "judge_model": judge_model,
            "met": decision.met,
        },
    )

    if decision.met:
        fresh.goal_status = "done"
        mgr.save(fresh)
        _emit_marker(f'<goal-marker variant="done" reason="{safe_reason}" />\n\n')
        log.info(
            "goal achieved",
            extra={
                "session_id": fresh.id,
                "iterations": fresh.goal_iterations,
                "reason": decision.reason,
            },
        )
        return None

    # Bail without spawning a follow-up turn when the evaluator itself
    # was unreachable. We already emitted the marker above so the user
    # can see WHY the loop paused; the next user message kicks things
    # back into gear.
    if (decision.reason or "").lower().startswith("evaluator unavailable"):
        log.warning(
            "goal evaluator unavailable — not auto-iterating",
            extra={"session_id": fresh.id},
        )
        return None

    # Not met — fire one more turn if budget remains.
    new_iter = fresh.goal_iterations + 1
    if new_iter > fresh.goal_max_iterations:
        log.warning(
            "goal cap reached without completion",
            extra={"session_id": fresh.id, "iterations": fresh.goal_iterations},
        )
        _emit_marker(
            f'<goal-marker variant="cap" iter="{fresh.goal_iterations}" '
            f'cap="{fresh.goal_max_iterations}" reason="{safe_reason}" />\n\n'
        )
        return None
    fresh.goal_iterations = new_iter
    mgr.save(fresh)

    # Surface a frustration marker when we're about to fire a hard
    # reset so the user can see WHY the next prompt looks different.
    streak = int(getattr(fresh, "goal_same_reason_count", 0) or 0)
    if streak >= _goal.FRUSTRATION_THRESHOLD:
        _emit_marker(
            f'<goal-marker variant="reset" streak="{streak}" reason="{safe_reason}" />\n\n'
        )

    prompt = _goal.build_followup_prompt(
        goal=fresh.goal or "",
        reason=decision.reason,
        iteration=new_iter,
        cap=fresh.goal_max_iterations,
        same_reason_streak=int(getattr(fresh, "goal_same_reason_count", 0) or 0),
    )
    log.info(
        "goal auto-iteration firing",
        extra={
            "session_id": fresh.id,
            "iteration": new_iter,
            "max": fresh.goal_max_iterations,
            "reason": decision.reason,
        },
    )

    # Defer the writer POST: the caller schedules this AFTER the
    # current SSE stream has finished so the next turn's stream starts
    # on a clean slate.
    target_id = fresh.id

    async def _do_post() -> None:
        try:
            await chat_runner(target_id, prompt, extra_body={"_goal_auto": True})
        except TypeError:
            try:
                await chat_runner(target_id, prompt)
            except Exception:
                log.exception("goal chat_runner failed (fallback)")
        except Exception:
            log.exception("goal chat_runner failed")

    return _do_post()


async def _run_turn(
    provider: LLMProvider,
    session_id: str,
    augmented_message: str,
    mgr: SessionManager,
    pending_approvals: dict | None = None,
    yolo_sessions: set | None = None,
    session_modes: dict | None = None,
    pending_approval_meta: dict | None = None,
    *,
    chat_runner=None,  # (session_id, message) -> awaitable, posts to /api/chat
    subagent_runner=None,  # (agent_name, prompt) -> awaitable[str], cheap model
    is_goal_auto: bool = False,  # True when fired by the auto-iteration loop
) -> None:
    """Background task: drive the provider, persist the assistant turn,
    publish events to the StreamRegistry. NOT tied to any HTTP connection
    — survives client disconnects, page navigations, refreshes.
    """
    import time as _time

    registry = get_stream_registry()
    state = registry._states.get(session_id)
    if state is None:
        return  # caller didn't allocate state

    async def emit(chunk: str) -> None:
        state.events.append(chunk)
        for q in list(state.subscribers):
            try:
                q.put_nowait(chunk)
            except asyncio.QueueFull:
                try:
                    q.get_nowait()
                except Exception:
                    pass
                try:
                    q.put_nowait(chunk)
                except Exception:
                    pass

    session = mgr.get(session_id)
    turn_started = _time.monotonic()
    saved_assistant = False
    final_status = "complete"
    final_error: str | None = None
    deferred_complete: str | None = None  # held back so evaluator chips stream before "complete"

    # Stay-on-task #8: 5s heartbeat keepalive so the frontend's pulse
    # indicator stays alive + the client-side stall timer resets. The
    # provider's text_chunks also count as activity; this task just
    # guarantees the floor when the model is silent (thinking / calling
    # a long-running tool / blocked on a slow MCP server).
    async def _heartbeat_loop() -> None:
        try:
            while True:
                await asyncio.sleep(5.0)
                try:
                    await emit(sse_heartbeat())
                except Exception:
                    return
        except asyncio.CancelledError:
            return

    heartbeat_task = asyncio.create_task(_heartbeat_loop())

    # Same-turn recall loop. When the model emits `<recall>q</recall>` mid-
    # reply we drain the queue, run the search, and feed `<recall_result>`
    # back as a continuation message in the SAME assistant bubble. The cap
    # prevents runaway loops; 3 is enough for "search → reason → search
    # again → answer" without letting a confused model thrash.
    _RECALL_CONTINUATION_CAP = 3
    recall_iterations = 0
    segment_start = 0  # offset into full_reply for per-segment tag apply
    current_message = augmented_message
    final_event = None  # the last EVENT_COMPLETE, for usage/stop_reason
    try:
        while True:
            inner_complete = False
            async for event in provider.stream(current_message):
                # Stay-on-task: track provider's context usage on every
                # event so the mid-stream guard + watchdog have fresh
                # state without an extra provider RPC.
                pct = getattr(event, "context_usage_pct", None)
                if pct:
                    state.last_context_pct = float(pct)
                    # Emit one-time warning markers as the context fills.
                    if state.last_context_pct >= 95.0 and not state.context_warned_95:
                        state.context_warned_95 = True
                        await emit(
                            sse_chunk(
                                '\n\n<goal-marker variant="context-warn" '
                                f'reason="Context at {state.last_context_pct:.0f}% — '
                                'tool calls may be rejected" />\n\n'
                            )
                        )
                    elif state.last_context_pct >= 85.0 and not state.context_warned_85:
                        state.context_warned_85 = True
                        await emit(
                            sse_chunk(
                                '\n\n<goal-marker variant="context-warn" '
                                f'reason="Context at {state.last_context_pct:.0f}% — '
                                'approaching compaction threshold" />\n\n'
                            )
                        )

                if event.kind == EVENT_TEXT_CHUNK and event.text:
                    # Stay-on-task #7: when text resumes after a
                    # tool-group, emit a chat_segment boundary so the
                    # frontend closes the current bubble + opens a
                    # fresh one. Avoids the "wall of text with tool
                    # cards mid-paragraph" rendering bug.
                    if getattr(state, "_in_tool_group", False):
                        await emit(sse_segment())
                        state._in_tool_group = False  # type: ignore[attr-defined]
                    # Stay-on-task #12: per-chunk credential +
                    # exfiltration-URL redaction. The full-text pass
                    # at turn-end catches cross-chunk patterns.
                    safe_text = redact_chunk(event.text)
                    state.full_reply += safe_text
                    await emit(sse_chunk(safe_text))

                elif event.kind == EVENT_THINKING_CHUNK and getattr(event, "text", ""):
                    # Stay-on-task #5: reasoning chunks render in a
                    # separate collapsible panel — never inline.
                    await emit(sse_thinking(redact_chunk(event.text)))

                elif event.kind == EVENT_COMPACTION_STATUS:
                    # Stay-on-task #6: surface provider-level
                    # compaction transitions to the UI banner.
                    await emit(
                        sse_compaction(
                            status=str(getattr(event, "stop_reason", "") or "in_progress"),
                            detail=str(getattr(event, "text", "") or ""),
                        )
                    )

                elif event.kind == EVENT_TOOL_RESULT:
                    state._in_tool_group = True  # type: ignore[attr-defined]
                    tcid = event.tool_call_id or ""
                    out = event.tool_output or ""
                    # Stitch the output back onto the matching tool_call
                    # entry so it survives into the saved Message — the
                    # goal evaluator reads these to verify pytest /
                    # coverage / build / lint output for file-output
                    # goals where the answer is in stdout, not on disk.
                    if tcid and state.turn_tool_calls:
                        for tc in reversed(state.turn_tool_calls):
                            if tc.get("tool_call_id") == tcid:
                                tc["output"] = (out or "")[:32000]
                                break
                    await emit(
                        sse_tool_result(
                            tool_call_id=tcid,
                            content=out,
                        )
                    )

                elif event.kind == EVENT_TOOL_CALL:
                    state._in_tool_group = True  # type: ignore[attr-defined]
                    tool_name = event.text or ""
                    tool_input_str = str(event.tool_input or "")
                    if tool_name:
                        state.turn_tool_calls.append(
                            {
                                "name": tool_name,
                                "input": tool_input_str,
                                "tool_call_id": event.tool_call_id or event.request_id or "",
                            }
                        )
                    await emit(
                        sse_tool_call(
                            tool_name=tool_name,
                            tool_input=tool_input_str,
                            request_id=event.request_id or "",
                        )
                    )

                elif event.kind == EVENT_PERMISSION_REQUEST:
                    request_id = str(event.request_id or "")
                    if request_id:
                        mode = (session_modes or {}).get(session_id, "normal")
                        tool_name = str(event.text or "")
                        hooks = get_hook_manager()
                        raw_input = str(event.tool_input or "")
                        # Stay-on-task #1: mid-stream context guard.
                        # Reject expensive tool calls when the provider's
                        # context window is almost full — otherwise one
                        # more 30K-token tool call blows past the limit
                        # and forces a full session reset that loses
                        # progress. The marker tells the user why.
                        if state.last_context_pct >= 90.0:
                            await provider.reject_tool(request_id)
                            await emit(
                                sse_chunk(
                                    '\n\n<goal-marker variant="context-guard" '
                                    f'reason="Tool {tool_name!r} rejected — context at '
                                    f'{state.last_context_pct:.0f}%. Compact or start a new session." />\n\n'
                                )
                            )
                            continue
                        if tool_name == "Bash":
                            rule = hooks.evaluate_command(raw_input)
                            if rule and rule.severity == "block":
                                await provider.reject_tool(request_id)
                                await emit(sse_chunk(f"\n⚠️ blocked: {rule.reason}\n"))
                                continue
                        if (
                            mode in ("trust", "yolo")
                            or (yolo_sessions is not None and session_id in yolo_sessions)
                            or mode == "trust_reads"
                            and tool_name in READ_ONLY_TOOLS
                            or hooks.auto_approves(tool_name)
                        ):
                            await provider.approve_tool(request_id)
                        elif pending_approvals is not None:
                            loop = asyncio.get_event_loop()
                            fut: asyncio.Future = loop.create_future()
                            pending_approvals[request_id] = fut
                            if pending_approval_meta is not None:
                                pending_approval_meta[request_id] = {
                                    "request_id": request_id,
                                    "session_id": session_id,
                                    "tool_name": tool_name,
                                    "tool_input": raw_input,
                                    "title": event.title or event.text or "",
                                    "created_at": _time.time(),
                                }
                            await emit(
                                sse_permission_request(
                                    title=event.title or event.text or "",
                                    tool_input=str(event.tool_input or ""),
                                    request_id=request_id,
                                )
                            )
                            try:
                                approved = await asyncio.wait_for(fut, timeout=7200.0)
                            except TimeoutError:
                                approved = False
                            finally:
                                pending_approvals.pop(request_id, None)
                                if pending_approval_meta is not None:
                                    pending_approval_meta.pop(request_id, None)
                            if approved:
                                await provider.approve_tool(request_id)
                            else:
                                await provider.reject_tool(request_id)

                elif event.kind == EVENT_COMPLETE:
                    final_event = event
                    inner_complete = True
                    break

            # ── End of inner stream. Decide: continue with recall or finish. ──
            if not inner_complete:
                # Stream ended without EVENT_COMPLETE (cancellation, crash).
                # Let the outer except/finally handle persistence.
                break

            # Apply inline tags on JUST the new segment so prior segments'
            # tags don't re-apply. <recall> tags queue into _pending_recalls
            # via inline_learn.apply, which we drain right after.
            new_segment = state.full_reply[segment_start:]
            seg_extracted: list = []
            if new_segment:
                _, seg_extracted = inline_learn.parse(new_segment)
                if seg_extracted:
                    try:
                        inline_learn.apply(seg_extracted, session_id=session_id)
                    except Exception:
                        log.exception("inline-learn apply (segment) failed")
            segment_start = len(state.full_reply)

            pending_recalls = (
                inline_learn.drain_recalls(session_id)
                if recall_iterations < _RECALL_CONTINUATION_CAP
                else []
            )
            if pending_recalls:
                try:
                    from arz.config.loader import load_config as _lc
                    from arz.memory.context import _recall_block  # type: ignore[attr-defined]

                    _cfg = _lc()
                    _k = int(getattr(_cfg.dashboard, "recall_k", 8) or 8)
                    blocks: list[str] = []
                    for q in pending_recalls:
                        blk = _recall_block(q, recall_k=_k, config=_cfg)
                        if blk:
                            blocks.append(f'<recall_result query="{q}">\n{blk}\n</recall_result>')
                        else:
                            # Empty hit set — STILL feed it back so the model
                            # knows the search ran and can either retry with a
                            # different query or answer from prior context.
                            # Without this it would just sit on the `<recall>`
                            # tag with no continuation.
                            blocks.append(
                                f'<recall_result query="{q}">\n'
                                "no matches in memory.db (FTS5 + vector). "
                                "Try a broader query or answer from what's in "
                                "the conversation above.\n"
                                "</recall_result>"
                            )
                    # Subtle UI marker so user sees the model is searching.
                    await emit(sse_chunk(f"\n\n_[recall: {', '.join(pending_recalls)}]_\n\n"))
                    # Re-enter stream with results + nudge to keep reasoning.
                    current_message = (
                        "\n\n".join(blocks)
                        + "\n\nContinue your reply with this context. "
                        + "Do not repeat what you already wrote."
                    )
                    recall_iterations += 1
                    log.info(
                        "recall continuation fired",
                        extra={
                            "session_id": session_id,
                            "iteration": recall_iterations,
                            "queries": pending_recalls,
                            "hit_blocks": sum(1 for b in blocks if "no matches" not in b),
                        },
                    )
                    continue  # outer while: stream again
                except Exception:
                    log.exception("recall continuation failed; finalising")

            # ── No more recalls → finalise. Use the saved EVENT_COMPLETE. ──
            event = final_event
            usage_dict = event.usage.to_dict() if event.usage else None
            elapsed_ms = int((_time.monotonic() - turn_started) * 1000)
            if session and state.full_reply:
                # Re-parse + persist full reply (already-applied per-segment
                # tags are idempotent in practice — semantic.upsert reinforces,
                # learn writes a no-op duplicate). Cleaned text is what
                # we save and what the user sees.
                cleaned, extracted = inline_learn.parse(state.full_reply)
                if not extracted:
                    # Fallback: model didn't emit any tags. Run a cheap
                    # post-turn extraction pass against the raw reply
                    # to catch durable preferences / corrections the
                    # model decided to write to its own native store
                    # (Claude Code's project memory) or to none at all.
                    try:
                        from arz.config.loader import load_config as _lc
                        from arz.post_turn_extract import maybe_extract

                        user_for_extract = ""
                        if session and session.messages:
                            for m in reversed(session.messages):
                                if m.role == "user":
                                    user_for_extract = m.text
                                    break
                        if user_for_extract:
                            sess_provider = getattr(session, "provider", None) if session else None
                            sess_model = getattr(session, "model", None) if session else None
                            asyncio.create_task(
                                maybe_extract(
                                    user_for_extract,
                                    _final_assistant_text(cleaned, extracted, state.full_reply),
                                    config=_lc(),
                                    provider_name=sess_provider,
                                    model=sess_model,
                                )
                            )
                    except Exception:
                        log.exception("post-turn extraction schedule failed")
                msg = session.add_message(
                    "assistant", _final_assistant_text(cleaned, extracted, state.full_reply)
                )
                if usage_dict:
                    msg.usage = usage_dict
                msg.model = provider.current_model
                msg.elapsed_ms = elapsed_ms
                if state.turn_tool_calls:
                    msg.tool_calls = state.turn_tool_calls
                if state.archive_versions:
                    msg.versions = list(state.archive_versions) + [
                        _final_assistant_text(cleaned, extracted, state.full_reply)
                    ]
                    msg.version_index = len(msg.versions) - 1
                mgr.save(session)
                saved_assistant = True
            # The writer turn is finished AND persisted. Emit
            # sse_writer_done so the frontend can clear its live
            # streamBuffer — otherwise the saved bubble + the
            # streaming bubble both render the same writer text for
            # the entire ~10s judge runtime. Distinct from
            # sse_complete: complete still waits for the evaluator
            # chips so the frontend's EventSource stays open.
            await emit(sse_writer_done())
            deferred_complete = sse_complete(
                event.stop_reason or "end_turn",
                context_pct=event.context_usage_pct or 0.0,
                usage=usage_dict,
            )
            break  # outer while

    except asyncio.CancelledError:
        final_status = "cancelled"
        raise
    except Exception as e:
        log.exception("Error streaming session %s", session_id)
        final_status = "failed"
        final_error = str(e)
        await emit(sse_error(str(e)))
    finally:
        # Cancel the 5s heartbeat keepalive — turn is ending.
        try:
            heartbeat_task.cancel()
        except Exception:
            pass
        # When a goal is active but the writer returned empty text,
        # still persist a placeholder so the evaluator chip lands on a
        # bubble for THIS turn instead of the previous one.
        if (
            session
            and not saved_assistant
            and not state.full_reply
            and (getattr(session, "goal", None) or "").strip()
            and getattr(session, "goal_status", "") == "active"
        ):
            try:
                msg = session.add_message("assistant", "_(empty reply)_")
                msg.model = provider.current_model
                msg.elapsed_ms = int((_time.monotonic() - turn_started) * 1000)
                mgr.save(session)
                saved_assistant = True
            except Exception:
                log.exception("empty-reply placeholder persist failed")

        # Always persist the assistant message if we got any text. This
        # covers all the failure modes: cancellation, provider crash,
        # mid-stream provider eviction, etc.
        if session and state.full_reply and not saved_assistant:
            try:
                cleaned, extracted = inline_learn.parse(state.full_reply)
                if extracted:
                    try:
                        inline_learn.apply(extracted, session_id=session_id)
                    except Exception:
                        log.exception("inline-learn apply (finally path) failed")
                msg = session.add_message(
                    "assistant", _final_assistant_text(cleaned, extracted, state.full_reply)
                )
                msg.model = provider.current_model
                msg.elapsed_ms = int((_time.monotonic() - turn_started) * 1000)
                if state.turn_tool_calls:
                    msg.tool_calls = state.turn_tool_calls
                if state.archive_versions:
                    msg.versions = list(state.archive_versions) + [
                        _final_assistant_text(cleaned, extracted, state.full_reply)
                    ]
                    msg.version_index = len(msg.versions) - 1
                mgr.save(session)
            except Exception:
                log.exception("Failed to persist partial reply on stream end")
        # ── /goal auto-iteration ──
        # Run the evaluator INLINE — before registry.finish() — so its
        # marker chips stream live to subscribers instead of arriving
        # only after a page refresh. The follow-up writer turn (if the
        # judge rules "not met") is still scheduled as a background
        # task because it spawns a new /api/chat POST.
        goal_auto_iter_task = None
        try:
            if session and chat_runner is not None and subagent_runner is not None:
                from arz import goal as _goal

                g_text = (getattr(session, "goal", None) or "").strip()
                g_status = getattr(session, "goal_status", "active")
                g_iters = int(getattr(session, "goal_iterations", 0) or 0)
                g_cap = int(getattr(session, "goal_max_iterations", 20) or 20)
                last_text = session.messages[-1].text if session.messages else ""
                if g_text and g_status == "active" and not is_goal_auto:
                    # First fire for THIS user turn: reset the counter so
                    # a fresh user message restarts the loop budget.
                    session.goal_iterations = 0
                    g_iters = 0
                    mgr.save(session)
                if _goal.should_auto_iterate(
                    goal=g_text,
                    status=g_status,
                    iterations=g_iters,
                    max_iterations=g_cap,
                    last_assistant_text=last_text,
                ):
                    # Show a placeholder chip immediately so the user
                    # knows the cheap judge is running. The real verdict
                    # marker overwrites — well, follows — this once
                    # _goal_followup finishes its subagent call.
                    try:
                        chunk = sse_chunk(
                            '\n\n<goal-marker variant="pending" reason="judge running…" />\n\n'
                        )
                        state.events.append(chunk)
                        for q in list(state.subscribers):
                            try:
                                q.put_nowait(chunk)
                            except Exception:
                                pass
                    except Exception:
                        pass

                    # Capture the index of the assistant message that
                    # represents THIS turn so the chip-emitter can
                    # always target it — even after an auto-iter
                    # follow-up adds a new user message.
                    target_idx = len(session.messages) - 1
                    if target_idx < 0 or session.messages[target_idx].role != "assistant":
                        target_idx = next(
                            (
                                i
                                for i in range(len(session.messages) - 1, -1, -1)
                                if session.messages[i].role == "assistant"
                            ),
                            -1,
                        )
                    goal_auto_iter_task = await _goal_followup(
                        session=session,
                        mgr=mgr,
                        subagent_runner=subagent_runner,
                        chat_runner=chat_runner,
                        target_msg_idx=target_idx if target_idx >= 0 else None,
                    )
        except Exception:
            log.exception("goal auto-iteration scheduling failed")

        # Flush the held-back `complete` event AFTER the evaluator
        # marker. The frontend closes its EventSource on this event,
        # so the order is what matters: writer chunks → judge chips →
        # complete.
        if deferred_complete is not None:
            try:
                await emit(deferred_complete)
            except Exception:
                log.exception("deferred sse_complete emit failed")

        await registry.finish(session_id, status=final_status, error=final_error)
        registry.discard(session_id, after_seconds=120.0)
        # 30-msg threshold trigger — fire-and-forget. The consolidator
        # bumps last_consolidated_index itself so re-entering on the next
        # turn won't double-fire. If no runner is wired or threshold
        # isn't crossed, this is a no-op.
        try:
            from arz.consolidator import get_consolidator

            asyncio.create_task(get_consolidator().maybe_trigger(session))
        except Exception:
            pass

        # Detach the follow-up writer POST after the SSE stream is
        # finished so the next turn's stream starts cleanly.
        if goal_auto_iter_task is not None:
            try:
                asyncio.create_task(goal_auto_iter_task)
            except Exception:
                log.exception("goal follow-up POST scheduling failed")


async def _sse_subscribe(session_id: str) -> AsyncIterator[str]:
    """Subscribe an SSE client to an in-flight (or just-finished) turn.

    Replays buffered events first so a late-joining client sees the full
    transcript so far, then forwards live events until the registry
    closes the queue with None.
    """
    registry = get_stream_registry()
    state, queue = await registry.subscribe(session_id)
    if state is None:
        # No active turn to attach to; close immediately.
        yield sse_error("no active turn for this session")
        return
    # Replay buffered events.
    for ev in list(state.events):
        yield ev
    # If the run already finished while we were replaying, queue has the
    # sentinel waiting. Drain until None.
    try:
        while True:
            chunk = await queue.get()
            if chunk is None:
                return
            yield chunk
    finally:
        await registry.unsubscribe(session_id, queue)


@router.post("/api/chat/{session_id}")
async def chat(session_id: str, request: Request) -> StreamingResponse:
    mgr: SessionManager = request.app.state.session_manager
    pool: ProviderPool = request.app.state.provider_pool

    session = mgr.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    body = await request.json()
    original_message: str = body.get("message", "").strip()
    if not original_message:
        raise HTTPException(status_code=422, detail="message is required")

    # Edit & resend: when set, drop trailing assistant + replace last user
    # text before treating *original_message* as the user's resend. The
    # save-user-message branch below will skip re-adding when the last
    # message is already a matching user.
    replace_last_user: bool = bool(body.get("replace_last_user", False))
    # Regenerate: like replace_last_user, but the dropped assistant text(s)
    # are stashed so they're surfaced as ◀▶ history on the new message.
    regenerate: bool = bool(body.get("regenerate", False))
    archived_versions: list[str] = []
    if (replace_last_user or regenerate) and session:
        # Drop trailing assistant replies after the last user msg.
        msgs = session.messages
        while msgs and msgs[-1].role == "assistant":
            popped = msgs.pop()
            if regenerate:
                # Preserve any earlier versions accumulated from prior regens
                # so the count keeps growing instead of resetting on each ↻.
                if popped.versions:
                    archived_versions = list(popped.versions)
                else:
                    archived_versions = [popped.text]
        # Edit the trailing user msg if present.
        if msgs and msgs[-1].role == "user" and replace_last_user:
            msgs[-1].text = original_message
        mgr.save(session)

    # Build a separate augmented copy for the LLM. The injection blocks
    # below mutate `message`; the original is preserved for history.
    message = original_message

    cfg = request.app.state.config

    # Drain any <recall> queries queued by the assistant on a prior turn.
    # Run them as searches and prepend the results so the model sees what
    # it asked for. This is the on-demand search path without MCP.
    try:
        pending = inline_learn.drain_recalls(session_id)
        if pending:
            from arz.memory.context import _recall_block  # type: ignore[attr-defined]

            recall_blocks: list[str] = []
            for q in pending:
                blk = _recall_block(
                    q, recall_k=int(getattr(cfg.dashboard, "recall_k", 5) or 5), config=cfg
                )
                if blk:
                    recall_blocks.append(f'<recall_result query="{q}">\n{blk}\n</recall_result>')
            if recall_blocks:
                message = "\n\n".join(recall_blocks) + "\n\n" + message
    except Exception:
        log.exception("recall drain failed")

    # Refresh the intent tracker from the latest message tail so
    # build_prefix can inject a `<intent>` block + boost retrieval.
    try:
        from arz.memory import intent as _intent

        tail_msgs = [{"role": m.role, "text": m.text} for m in (session.messages or [])][-6:]
        tail_msgs.append({"role": "user", "text": original_message})
        _intent.update_from_messages(session_id, tail_msgs)
    except Exception:
        log.exception("intent update failed")

    # Single source of truth for memory context — same shape on every
    # provider, every surface (chat, subagent, heartbeat, taskrunner).
    try:
        from arz.memory.context import build_prefix

        prefix = build_prefix(
            message,
            config=cfg,
            recall_k=int(getattr(cfg.dashboard, "recall_k", 8) or 8),
            enable_recall=bool(getattr(cfg.dashboard, "auto_recall", True)),
            session_id=session_id,
        )
        if prefix:
            message = f"{prefix}\n\n{message}"
    except Exception:
        log.exception("Memory context build failed; continuing without it")

    # Persistent goal — when the user has set one on the session, prepend
    # a `<goal>` block so the model keeps it in mind on every turn until
    # cleared or marked done. Cheap (~100 chars) and very high-leverage
    # for long-running objectives.
    try:
        goal = getattr(session, "goal", None) if session else None
        goal_status = getattr(session, "goal_status", "active") if session else "active"
        if goal and goal_status == "active":
            goal_block = (
                "<goal>\n"
                f"User's active goal: {goal}\n"
                "Keep this in mind every turn. Make tangible progress toward it "
                "in your reply. If you complete it, say so explicitly. If you're "
                "blocked, name what you need from the user.\n"
                "</goal>"
            )
            message = f"{goal_block}\n\n{message}"
    except Exception:
        log.exception("goal injection failed")

    # Inject any completed subagent results that landed since the last turn.
    try:
        pending = get_subagent_manager().pop_pending_for(session_id)
        if pending:
            blocks: list[str] = []
            for rec in pending:
                blocks.append(f"[subagent:{rec.agent_name} status={rec.status}]\n{rec.result}")
            message = "\n\n".join(blocks) + "\n\n" + message
    except Exception:
        log.exception("Subagent injection failed; continuing without it")

    history: list[dict] | None = None
    if session and session.messages:
        history = [{"role": m.role, "text": m.text} for m in session.messages]
        # Compress the middle when the raw transcript would blow past the
        # underlying model's context window. Falls through to verbatim
        # when the runner is missing or the history is small enough.
        try:
            from arz.consolidator import get_consolidator
            from arz.memory.compress import compress_history

            # The consolidator already holds a wired runner pointed at the
            # cheap subagent path. Reusing it keeps "background LLM call"
            # behaviour identical between compression + consolidation.
            runner = getattr(get_consolidator(), "_runner", None)
            history = await compress_history(history, runner=runner)
        except Exception:
            log.exception("history compression failed; using verbatim transcript")
    session_map: SessionMap = request.app.state.session_map
    session_work_dir = getattr(session, "work_dir", None)

    # Per-session provider/model overrides global config
    effective_provider_name = getattr(session, "provider", None) or cfg.provider.name
    effective_model = getattr(session, "model", None) or cfg.provider.model
    effective_approval = getattr(session, "approval_mode", "normal") or "normal"
    effective_agent = getattr(session, "agent", None)

    # Look up any prior provider session ID for native resume
    provider_sid = session_map.get(session_id)

    def _factory() -> LLMProvider:
        p = _make_provider(
            cfg,
            session_id,
            history,
            session_work_dir,
            effective_provider_name,
            effective_model,
            effective_approval,
            effective_agent,
        )
        if provider_sid:
            p.set_resume_session_id(provider_sid)
        return p

    # Warm-pool fast path: if no provider is in the pool yet for this
    # session AND the next warm slot matches the default provider, claim
    # it instead of cold-starting. Saves 3-10s on first message.
    #
    # ONLY for *fresh* sessions (no prior history). A warm provider was
    # spawned without our session's conversation context — handing it to
    # a session that already had turns would silently lose memory on the
    # very next reply ("I don't have any earlier C++ code in this
    # session"). The factory path below cold-starts a provider seeded
    # with `history` instead.
    if (
        session_id not in pool._pool  # noqa: SLF001
        and pool.warm_count() > 0
        and effective_provider_name == cfg.provider.name
        and effective_model == cfg.provider.model
        and not provider_sid
        and not (history and len(history) > 0)
    ):
        warm = pool.claim_warm(session_id)
        if warm is not None and warm.name == effective_provider_name:
            log.info("Used warm provider", extra={"session_id": session_id})

    try:
        provider = await pool.activate(session_id, _factory)
    except (AcpError, FileNotFoundError, ValueError) as e:
        # Most common cause: the configured provider's CLI binary isn't installed
        # on this machine. Surface a clean 503 instead of a 500 traceback so the
        # frontend can render a useful error toast.
        raise HTTPException(
            status_code=503,
            detail=f"Provider {effective_provider_name!r} unavailable: {e}",
        )

    # Auto-evict if provider was started with a different model than the
    # session's effective model.
    desired_model = effective_model
    if provider.current_model is not None and provider.current_model != desired_model:
        log.info(
            "Model mismatch — evicting and recreating provider",
            session_id=session_id,
            had=provider.current_model,
            want=desired_model,
        )
        # Clear session map so the new provider starts fresh with the correct model
        session_map.remove(session_id)
        await pool.deactivate(session_id)
        try:
            provider = await pool.activate(
                session_id,
                lambda: _make_provider(
                    cfg,
                    session_id,
                    history,
                    session_work_dir,
                    effective_provider_name,
                    effective_model,
                    effective_approval,
                    effective_agent,
                ),
            )
        except (AcpError, FileNotFoundError, ValueError) as e:
            raise HTTPException(
                status_code=503,
                detail=f"Provider {effective_provider_name!r} unavailable: {e}",
            )

    # Persist provider session ID for future resume
    if provider.session_id:
        session_map.set(session_id, provider.session_id)

    # Allocate a stream slot. If one's already running for this session,
    # surface a clean 409 so the UI can attach to /stream instead.
    registry = get_stream_registry()
    try:
        state = await registry.start(session_id)
    except RuntimeError:
        raise HTTPException(
            status_code=409,
            detail="A turn is already running for this session — attach to GET /api/chat/{id}/stream instead.",
        )
    if archived_versions:
        # Cap archive at 20 entries to bound disk usage on aggressive ↻ users.
        state.archive_versions = archived_versions[-19:]

    # Save the user message NOW (synchronously, before the background task
    # starts) so a fast reload still shows what was sent. Skip if we
    # already wrote it as part of an edit-and-resend.
    if session and not (
        replace_last_user
        and session.messages
        and session.messages[-1].role == "user"
        and session.messages[-1].text == original_message
    ):
        session.add_message("user", original_message)
        mgr.save(session)

    # Spawn the LLM run as a fire-and-forget task. It's anchored on the
    # event loop, not on this HTTP request — so client disconnects don't
    # cancel it.
    state.task = asyncio.create_task(
        _run_turn(
            provider,
            session_id,
            message,
            mgr,
            request.app.state.pending_approvals,
            request.app.state.yolo_sessions,
            request.app.state.session_modes,
            getattr(request.app.state, "pending_approval_meta", None),
            chat_runner=getattr(request.app.state, "chat_runner", None),
            subagent_runner=getattr(request.app.state, "subagent_runner", None),
            is_goal_auto=bool(body.get("_goal_auto") or False),
        )
    )

    # The returned SSE stream just observes the same registry. Disconnecting
    # only drops the subscriber — the background task keeps running.
    return StreamingResponse(
        _sse_subscribe(session_id),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/api/chat/{session_id}/stream")
async def chat_stream(session_id: str) -> StreamingResponse:
    """Re-attach to an in-flight turn. Returns SSE that replays buffered
    events and follows live ones, exactly like the response from the
    original POST. Closes immediately if no turn is in flight.
    """
    return StreamingResponse(
        _sse_subscribe(session_id),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/api/chat/{session_id}/streaming")
async def chat_streaming(session_id: str) -> dict:
    """Cheap snapshot — is a turn currently running for this session?"""
    snap = get_stream_registry().snapshot(session_id)
    return {"streaming": bool(snap and snap.get("status") == "running"), "snapshot": snap}


# Cooperative-stop budget. Provider gets this long to honor a graceful
# cancel; if the background task hasn't drained by then we deactivate
# the pool entry (hard kill).
_COOP_STOP_BUDGET_S = 10.0


@router.post("/api/chat/{session_id}/stop")
async def chat_stop(session_id: str, request: Request) -> dict:
    """Stop the in-flight turn, cooperatively first then forcefully.

    Flow:
      1. provider.cancel() — sends ACP `session/cancel` for kiro/claude;
         flips a flag for ollama; SIGTERMs subprocess for codex/gemini.
      2. Wait up to _COOP_STOP_BUDGET_S for the registry task to finish.
      3. If still running, hard-kill: pool.deactivate() + task.cancel().

    Returns ``{"stopped": True, "mode": "cooperative"|"forced"|"noop"}``.
    """
    registry = get_stream_registry()
    state = registry._states.get(session_id)  # noqa: SLF001
    if state is None or state.status != "running":
        return {"stopped": False, "mode": "noop"}

    pool: ProviderPool = request.app.state.provider_pool
    provider = pool._pool.get(session_id)  # noqa: SLF001
    if provider is not None:
        try:
            await provider.cancel()
        except Exception:
            log.warning("provider.cancel() raised", exc_info=True)

    # Give cooperative cancel a budget to drain.
    deadline = asyncio.get_event_loop().time() + _COOP_STOP_BUDGET_S
    while state.status == "running" and asyncio.get_event_loop().time() < deadline:
        await asyncio.sleep(0.1)

    if state.status != "running":
        return {"stopped": True, "mode": "cooperative"}

    # Forced path — kill the subprocess and cancel the asyncio task.
    log.info("Cooperative stop did not drain in %ss — forcing", _COOP_STOP_BUDGET_S)
    try:
        await pool.deactivate(session_id)
    except Exception:
        log.warning("pool.deactivate failed during forced stop", exc_info=True)
    if state.task is not None and not state.task.done():
        state.task.cancel()
    await registry.finish(session_id, status="cancelled")
    return {"stopped": True, "mode": "forced"}
