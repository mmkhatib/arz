"""Chat route — POST message → SSE stream."""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path
from typing import AsyncIterator

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse

from arz.acp.client import AcpError
from arz.acp.types import EVENT_COMPLETE, EVENT_PERMISSION_REQUEST, EVENT_TEXT_CHUNK, EVENT_TOOL_CALL, EVENT_TOOL_RESULT
from arz.dashboard.sse import sse_chunk, sse_complete, sse_error, sse_permission_request, sse_tool_call, sse_tool_result
from arz.dashboard.token_auth import require_token
from arz.hooks import get_hook_manager
from arz.lessons import get_lesson_store
from arz.memory.files import get_memory_files
from arz.prompts.loader import resolve_system_prompt
from arz.subagents import get_subagent_manager
from arz.providers.base import LLMProvider
from arz.providers.pool import ProviderPool
from arz.session.manager import SessionManager
from arz.session.session_map import SessionMap

log = logging.getLogger(__name__)
router = APIRouter(dependencies=[Depends(require_token)])

_WORKSPACE_ROOT = Path.home() / ".arz" / "workspace"


_APPROVAL_TO_CLAUDE = {
    "normal": None,                # default behavior
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
    system_prompt = resolve_system_prompt(agent_prompt or config.dashboard.system_prompt or None)

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
        return KiroCliProvider(model=model, work_dir=work_dir)

    if provider_name == "codex":
        from arz.providers.codex import CodexProvider
        return CodexProvider(model=model, work_dir=work_dir, system_prompt=system_prompt or None)

    raise ValueError(f"Unknown provider: {provider_name!r}")


READ_ONLY_TOOLS = {"Read", "Glob", "Grep", "WebSearch", "WebFetch"}


async def _stream_response(
    provider: LLMProvider,
    session_id: str,
    message: str,
    mgr: SessionManager,
    pending_approvals: dict | None = None,
    yolo_sessions: set | None = None,
    session_modes: dict | None = None,
) -> AsyncIterator[str]:
    """Drive the provider, record history, yield SSE strings."""
    import time as _time
    session = mgr.get(session_id)
    if session:
        session.add_message("user", message)

    full_reply = ""
    turn_started = _time.monotonic()
    turn_tool_calls: list[dict] = []
    try:
        async for event in provider.stream(message):
            if event.kind == EVENT_TEXT_CHUNK and event.text:
                full_reply += event.text
                yield sse_chunk(event.text)

            elif event.kind == EVENT_TOOL_RESULT:
                yield sse_tool_result(
                    tool_call_id=event.tool_call_id or "",
                    content=event.tool_output or "",
                )

            elif event.kind == EVENT_TOOL_CALL:
                tool_name = event.text or ""
                tool_input_str = str(event.tool_input or "")
                if tool_name:
                    turn_tool_calls.append({"name": tool_name, "input": tool_input_str})
                yield sse_tool_call(
                    tool_name=tool_name,
                    tool_input=tool_input_str,
                    request_id=event.request_id or "",
                )

            elif event.kind == EVENT_PERMISSION_REQUEST:
                request_id = str(event.request_id or "")
                if request_id:
                    mode = (session_modes or {}).get(session_id, "normal")
                    tool_name = str(event.text or "")
                    hooks = get_hook_manager()
                    # Hard-deny: surface a destructive command before we even ask.
                    raw_input = str(event.tool_input or "")
                    if tool_name == "Bash":
                        rule = hooks.evaluate_command(raw_input)
                        if rule and rule.severity == "block":
                            await provider.reject_tool(request_id)
                            yield sse_chunk(f"\n⚠️ blocked: {rule.reason}\n")
                            continue
                    # trust/yolo: auto-approve all
                    # trust_reads: auto-approve read-only tools
                    # hooks.auto_approve_tools: configured allowlist
                    if mode in ("trust", "yolo") or (yolo_sessions is not None and session_id in yolo_sessions):
                        await provider.approve_tool(request_id)
                    elif mode == "trust_reads" and tool_name in READ_ONLY_TOOLS:
                        await provider.approve_tool(request_id)
                    elif hooks.auto_approves(tool_name):
                        await provider.approve_tool(request_id)
                    elif pending_approvals is not None:
                        loop = asyncio.get_event_loop()
                        fut: asyncio.Future = loop.create_future()
                        pending_approvals[request_id] = fut
                        yield sse_permission_request(
                            title=event.title or event.text or "",
                            tool_input=str(event.tool_input or ""),
                            request_id=request_id,
                        )
                        try:
                            approved = await asyncio.wait_for(fut, timeout=7200.0)
                        except asyncio.TimeoutError:
                            approved = False
                        finally:
                            pending_approvals.pop(request_id, None)
                        if approved:
                            await provider.approve_tool(request_id)
                        else:
                            await provider.reject_tool(request_id)

            elif event.kind == EVENT_COMPLETE:
                usage_dict = event.usage.to_dict() if event.usage else None
                elapsed_ms = int((_time.monotonic() - turn_started) * 1000)
                if session and full_reply:
                    msg = session.add_message("assistant", full_reply)
                    if usage_dict:
                        msg.usage = usage_dict
                    msg.model = provider.current_model
                    msg.elapsed_ms = elapsed_ms
                    if turn_tool_calls:
                        msg.tool_calls = turn_tool_calls
                    mgr.save(session)
                yield sse_complete(
                    event.stop_reason or "end_turn",
                    context_pct=event.context_usage_pct or 0.0,
                    usage=usage_dict,
                )
                return

    except Exception as e:
        log.exception("Error streaming session %s", session_id)
        if session and full_reply:
            session.add_message("assistant", full_reply)
            mgr.save(session)
        yield sse_error(str(e))


@router.post("/api/chat/{session_id}")
async def chat(session_id: str, request: Request) -> StreamingResponse:
    mgr: SessionManager = request.app.state.session_manager
    pool: ProviderPool = request.app.state.provider_pool

    session = mgr.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    body = await request.json()
    message: str = body.get("message", "").strip()
    if not message:
        raise HTTPException(status_code=422, detail="message is required")

    cfg = request.app.state.config

    # RAG: prepend top-k memory hits when auto_recall is enabled. Off by default.
    # Two recall paths: FTS5 keyword (always cheap), and vector (if configured).
    if cfg.dashboard.auto_recall:
        try:
            from arz.memory.fts import get_memory_fts
            fts = get_memory_fts()
            try:
                fts.reindex()  # mtime-driven, near-zero cost when nothing changed
            except Exception:
                pass
            fts_hits = fts.search(message, k=cfg.dashboard.recall_k)

            vec = getattr(request.app.state, "vector_store", None)
            if vec is None:
                from arz.memory.embedder import embedder_from_config
                from arz.memory.vector import VectorStore
                emb = embedder_from_config(getattr(cfg.dashboard, "embedding_model", "hash"))
                vec = VectorStore(embedder=emb)
                request.app.state.vector_store = vec
            vector_hits = vec.search(message, k=cfg.dashboard.recall_k)

            blocks: list[str] = []
            for h in fts_hits:
                blocks.append(f"- [fts:{h['source']}/{h['key']}] {h['snippet']}")
            for k, content, _ in vector_hits:
                blocks.append(f"- [vec:{k}] {content[:400]}")
            if blocks:
                message = f"<memory>\n" + "\n".join(blocks) + f"\n</memory>\n\n{message}"
        except Exception:
            log.exception("Auto-recall failed; continuing without context injection")

    # Auto-inject memory files (preferences + projects, ~3k chars total).
    try:
        memory_block = get_memory_files().render_for_prompt()
        if memory_block:
            message = f"{memory_block}\n\n{message}"
    except Exception:
        log.exception("Memory file injection failed; continuing without it")

    # Auto-inject lessons (always-on; cheap; capped at ~6k chars).
    try:
        lessons_block = get_lesson_store().render_for_prompt(message)
        if lessons_block:
            message = f"{lessons_block}\n\n{message}"
    except Exception:
        log.exception("Lesson injection failed; continuing without it")

    # Inject any completed subagent results that landed since the last turn.
    try:
        pending = get_subagent_manager().pop_pending_for(session_id)
        if pending:
            blocks: list[str] = []
            for rec in pending:
                blocks.append(
                    f"[subagent:{rec.agent_name} status={rec.status}]\n{rec.result}"
                )
            message = "\n\n".join(blocks) + "\n\n" + message
    except Exception:
        log.exception("Subagent injection failed; continuing without it")

    history: list[dict] | None = None
    if session and session.messages:
        history = [{"role": m.role, "text": m.text} for m in session.messages]
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
        p = _make_provider(cfg, session_id, history, session_work_dir, effective_provider_name, effective_model, effective_approval, effective_agent)
        if provider_sid:
            p.set_resume_session_id(provider_sid)
        return p

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
                lambda: _make_provider(cfg, session_id, history, session_work_dir, effective_provider_name, effective_model, effective_approval, effective_agent),
            )
        except (AcpError, FileNotFoundError, ValueError) as e:
            raise HTTPException(
                status_code=503,
                detail=f"Provider {effective_provider_name!r} unavailable: {e}",
            )

    # Persist provider session ID for future resume
    if provider.session_id:
        session_map.set(session_id, provider.session_id)

    return StreamingResponse(
        _stream_response(provider, session_id, message, mgr, request.app.state.pending_approvals, request.app.state.yolo_sessions, request.app.state.session_modes),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
