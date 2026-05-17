"""Chat route — POST message → SSE stream."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse

from arz import inline_learn
from arz.acp.client import AcpError
from arz.acp.types import (
    EVENT_COMPLETE,
    EVENT_PERMISSION_REQUEST,
    EVENT_TEXT_CHUNK,
    EVENT_TOOL_CALL,
    EVENT_TOOL_RESULT,
)
from arz.dashboard.sse import (
    sse_chunk,
    sse_complete,
    sse_error,
    sse_permission_request,
    sse_tool_call,
    sse_tool_result,
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
    model = model_override or config.provider.model
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
    """
    if extracted:
        return cleaned or "_(memory updated — no visible reply)_"
    return cleaned or raw


async def _goal_followup(
    *,
    session,
    mgr,
    subagent_runner,
    chat_runner,
) -> None:
    """Evaluate the goal after the just-finished assistant turn; if not
    met, fire one auto-follow-up via the chat runner. Bounded by
    ``session.goal_max_iterations``; respects user-cleared / met state.
    """
    from arz import goal as _goal

    try:
        # Build a short history tail for the evaluator.
        history = [{"role": m.role, "text": m.text} for m in (session.messages or [])][-8:]
        decision = await _goal.evaluate(
            goal=session.goal or "",
            history=history,
            runner=subagent_runner,
            n_turns=6,
        )
    except Exception:
        log.exception("goal evaluator crashed", extra={"session_id": session.id})
        return

    # Refresh from disk in case the user cleared the goal mid-eval.
    fresh = mgr.get(session.id)
    if fresh is None:
        return
    if (not (fresh.goal or "").strip()) or fresh.goal_status != "active":
        return

    fresh.goal_last_reason = decision.reason

    # Always emit an evaluator marker so the user can see the
    # back-and-forth between the worker turn and the judge — without
    # this the evaluator was invisible and felt like nothing was
    # happening between auto-iterations.
    def _emit_marker(text: str) -> None:
        try:
            from arz.dashboard.sse import sse_chunk
            from arz.dashboard.stream_registry import get_stream_registry

            reg = get_stream_registry()
            state = reg._states.get(fresh.id)  # noqa: SLF001
            if state is None:
                return
            chunk = sse_chunk(text)
            # Persist into state.events so a late-joining subscriber
            # replaying the buffer sees the marker too.
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

    verdict = "met" if decision.met else "not met"
    _emit_marker(f"\n\n_[evaluator · {verdict}: {decision.reason}]_\n\n")

    if decision.met:
        fresh.goal_status = "done"
        mgr.save(fresh)
        _emit_marker(f"_[goal: done — {decision.reason}]_\n\n")
        log.info(
            "goal achieved",
            extra={
                "session_id": fresh.id,
                "iterations": fresh.goal_iterations,
                "reason": decision.reason,
            },
        )
        return

    # Not met — fire one more turn if budget remains.
    new_iter = fresh.goal_iterations + 1
    if new_iter > fresh.goal_max_iterations:
        log.warning(
            "goal cap reached without completion",
            extra={"session_id": fresh.id, "iterations": fresh.goal_iterations},
        )
        return
    fresh.goal_iterations = new_iter
    mgr.save(fresh)
    prompt = _goal.build_followup_prompt(
        goal=fresh.goal or "",
        reason=decision.reason,
        iteration=new_iter,
        cap=fresh.goal_max_iterations,
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
    try:
        # Mark this as a goal-auto POST so the receiving turn doesn't
        # reset the iteration counter back to 0.
        await chat_runner(fresh.id, prompt, extra_body={"_goal_auto": True})
    except TypeError:
        # Older chat_runner signature didn't take extra_body — fall back
        # gracefully (counter will reset, but the loop still progresses).
        try:
            await chat_runner(fresh.id, prompt)
        except Exception:
            log.exception("goal chat_runner failed (fallback)")
    except Exception:
        log.exception("goal chat_runner failed")


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
                if event.kind == EVENT_TEXT_CHUNK and event.text:
                    state.full_reply += event.text
                    await emit(sse_chunk(event.text))

                elif event.kind == EVENT_TOOL_RESULT:
                    await emit(
                        sse_tool_result(
                            tool_call_id=event.tool_call_id or "",
                            content=event.tool_output or "",
                        )
                    )

                elif event.kind == EVENT_TOOL_CALL:
                    tool_name = event.text or ""
                    tool_input_str = str(event.tool_input or "")
                    if tool_name:
                        state.turn_tool_calls.append({"name": tool_name, "input": tool_input_str})
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
            await emit(
                sse_complete(
                    event.stop_reason or "end_turn",
                    context_pct=event.context_usage_pct or 0.0,
                    usage=usage_dict,
                )
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

        # ── /goal auto-iteration ──
        # After every assistant turn ends, if the session has an active
        # goal we ask a cheap model whether the condition is met. If yes,
        # mark done + leave a transcript marker. If no, fire ONE more
        # auto-turn with the evaluator's reason as guidance — bounded by
        # goal_max_iterations and short-circuited by the `goal:done`
        # token in the assistant reply.
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
                    asyncio.create_task(
                        _goal_followup(
                            session=session,
                            mgr=mgr,
                            subagent_runner=subagent_runner,
                            chat_runner=chat_runner,
                        )
                    )
        except Exception:
            log.exception("goal auto-iteration scheduling failed")


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
