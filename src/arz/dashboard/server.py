"""FastAPI application factory for the Arz dashboard."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

import structlog
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from arz.acp.types import EVENT_COMPLETE, EVENT_TEXT_CHUNK
from arz.config.schema import ArzConfig
from arz.core.router import MessageRouter
from arz.dashboard.audit import AuditLog
from arz.dashboard.cron import CronEntry, CronRegistry
from arz.dashboard.routes.action_items import router as action_items_router
from arz.dashboard.routes.agents import router as agents_router
from arz.dashboard.routes.analytics import router as analytics_router
from arz.dashboard.routes.approvals import router as approvals_router
from arz.dashboard.routes.audit import router as audit_router
from arz.dashboard.routes.channels import router as channels_router
from arz.dashboard.routes.chat import router as chat_router
from arz.dashboard.routes.compare import router as compare_router
from arz.dashboard.routes.consolidator import router as consolidator_router
from arz.dashboard.routes.cron import router as cron_router
from arz.dashboard.routes.files import router as files_router
from arz.dashboard.routes.folders import router as folders_router
from arz.dashboard.routes.health import router as health_router
from arz.dashboard.routes.heartbeat import router as heartbeat_router
from arz.dashboard.routes.hooks import router as hooks_router
from arz.dashboard.routes.installer import router as installer_router
from arz.dashboard.routes.lessons import router as lessons_router
from arz.dashboard.routes.mcp import router as mcp_router
from arz.dashboard.routes.memory import router as memory_router
from arz.dashboard.routes.overview import router as overview_router
from arz.dashboard.routes.projects import router as projects_router
from arz.dashboard.routes.prompts import router as prompts_router
from arz.dashboard.routes.search import router as search_router
from arz.dashboard.routes.sessions import router as sessions_router
from arz.dashboard.routes.settings import router as settings_router
from arz.dashboard.routes.skills import router as skills_router
from arz.dashboard.routes.subagents import router as subagents_router
from arz.dashboard.routes.suggestions import router as suggestions_router
from arz.dashboard.routes.taskrunner import router as taskrunner_router
from arz.dashboard.routes.tools import router as tools_router
from arz.dashboard.routes.workspace import router as workspace_router
from arz.dashboard.search import SessionSearchIndex
from arz.dashboard.token_auth import load_token
from arz.providers.pool import ProviderPool
from arz.session.manager import SessionManager
from arz.session.session_map import SessionMap
from arz.surfaces.manager import SurfaceManager

log = structlog.get_logger(__name__)

_STATIC_DIR = Path(__file__).parent.parent / "static"


def _spawn_cron_run(app: FastAPI, entry: CronEntry) -> None:
    """Schedule an async cron run on the gateway event loop.

    APScheduler fires us from a worker thread that has no running loop,
    so we hand the coroutine to the loop captured at startup via
    ``run_coroutine_threadsafe``. If startup hasn't captured one yet,
    fall back to a fresh thread-local loop.
    """
    loop = getattr(app.state, "event_loop", None)
    coro = _run_cron_entry(app, entry)
    if loop is not None and loop.is_running():
        asyncio.run_coroutine_threadsafe(coro, loop)
    else:
        asyncio.run(coro)


async def _run_cron_entry(app: FastAPI, entry: CronEntry) -> None:
    """Execute a cron entry: create a session, stream the prompt, persist results.

    A few special prompts are intercepted and routed to internal handlers
    instead of being treated as user prompts:

        arz:consolidate           — run the memory consolidator
        arz:consolidate --force   — same, ignoring the recency window

    Anything else falls through to the normal "spin up a session" path.
    """
    from arz.providers.claude_code import ClaudeCodeProvider
    from arz.providers.codex import CodexProvider
    from arz.providers.kiro_cli import KiroCliProvider

    cfg: ArzConfig = app.state.config
    mgr: SessionManager = app.state.session_manager
    registry: CronRegistry = app.state.cron_registry

    # ── special: built-in arz: handlers ──
    raw = (entry.prompt or "").strip()
    if raw.startswith("arz:consolidate"):
        try:
            from arz.consolidator import get_consolidator

            force = "--force" in raw
            report = await get_consolidator().consolidate_all(force=force)
            summary = (
                f"sessions={report.get('candidates', 0)} "
                f"prefs+={report.get('preferences_added', 0)} "
                f"projects+={report.get('projects_added', 0)} "
                f"lessons+={report.get('lessons_added', 0)}"
            )
            registry.record_run(entry.id, f"success: {summary}", session_id=None)
        except Exception as e:
            log.exception("Cron consolidation failed", cron_id=entry.id)
            registry.record_run(entry.id, f"error: {e}", session_id=None)
        return

    log.info("Cron run started", cron_id=entry.id, name=entry.name)
    # Persistent mode: reuse the prior session if one exists. Default
    # (persistent_session=False) creates a fresh session every fire so
    # context cannot accumulate unbounded — the bug that OOM-killed
    # MeshClaw gateways after several days.
    session = None
    if getattr(entry, "persistent_session", False) and entry.last_session_id:
        session = mgr.get(entry.last_session_id)
    if session is None:
        session = mgr.create(surface="cron", chat_id=f"cron-{entry.id}")
        session.title = f"⏱ {entry.name}"
        session.provider = cfg.provider.name
    session.add_message("user", entry.prompt)
    mgr.save(session)

    # Build a fresh provider for the run; cron sessions are short-lived.
    if cfg.provider.name == "claude-code":
        provider = ClaudeCodeProvider(model=cfg.provider.model, work_dir=cfg.provider.work_dir)
    elif cfg.provider.name == "kiro-cli":
        provider = KiroCliProvider(model=cfg.provider.model, work_dir=cfg.provider.work_dir)
    elif cfg.provider.name == "codex":
        provider = CodexProvider(model=cfg.provider.model, work_dir=cfg.provider.work_dir)
    else:
        registry.record_run(entry.id, "error: unsupported provider", session.id)
        return

    # Inject the standard memory prefix so cron fires see the same
    # context as a chat turn would.
    cron_prompt = entry.prompt
    try:
        from arz.memory.context import build_prefix

        prefix = build_prefix(
            cron_prompt,
            config=cfg,
            recall_k=int(getattr(cfg.dashboard, "recall_k", 5) or 5),
            enable_recall=bool(getattr(cfg.dashboard, "auto_recall", True)),
        )
        if prefix:
            cron_prompt = f"{prefix}\n\n{cron_prompt}"
    except Exception:
        log.exception("cron memory injection failed", cron_id=entry.id)

    full_reply = ""
    status = "success"
    try:
        await provider.start()
        async for event in provider.stream(cron_prompt):
            if event.kind == EVENT_TEXT_CHUNK and event.text:
                full_reply += event.text
            elif event.kind == EVENT_COMPLETE:
                break
        if full_reply:
            # Self-learning: cron replies persist tags too.
            try:
                from arz import inline_learn

                cleaned, extracted = inline_learn.parse(full_reply)
                if extracted:
                    inline_learn.apply(extracted)
                full_reply = cleaned or full_reply
            except Exception:
                log.exception("cron inline-learn failed", cron_id=entry.id)
            msg = session.add_message("assistant", full_reply)
            msg.model = provider.current_model
            mgr.save(session)
    except Exception as e:
        log.exception("Cron run failed", cron_id=entry.id)
        status = f"error: {e}"
    finally:
        try:
            await provider.shutdown()
        except Exception:
            pass

    registry.record_run(entry.id, status, session.id)
    log.info("Cron run finished", cron_id=entry.id, status=status, session=session.id)


@asynccontextmanager
async def _lifespan(app: FastAPI) -> AsyncIterator[None]:
    log.info("Arz gateway starting", port=app.state.config.dashboard.port)
    # Purge ghost session files (title="New session", 0 messages) older
    # than an hour. Warm pool + failed creates left ~115 of these on the
    # user's box; they polluted the <recent-sessions> block.
    try:
        purged = app.state.session_manager.purge_ghosts(older_than_minutes=60)
        if purged:
            log.info("Purged ghost sessions on startup", count=purged)
    except Exception:
        log.exception("Ghost session purge failed; continuing")
    app.state.session_manager.load_all()
    # Hydrate approval-mode hot path from persisted session state.
    for s in app.state.session_manager._sessions.values():  # noqa: SLF001
        mode = getattr(s, "approval_mode", "normal")
        if mode != "normal":
            app.state.session_modes[s.id] = mode
        if mode == "yolo":
            app.state.yolo_sessions.add(s.id)
    indexed = app.state.search_index.rebuild(app.state.session_manager)
    log.info("Search index ready", sessions=indexed)
    app.state.event_loop = asyncio.get_running_loop()
    app.state.cron_registry.start()
    log.info("Cron scheduler started")
    try:
        from arz.reaper import get_reaper

        await get_reaper().start()
        log.info("Orphan reaper started")
    except Exception:
        log.warning("Could not start orphan reaper", exc_info=True)
    try:
        await app.state.autonudge.start()
        log.info("AutoNudge started")
    except Exception:
        log.warning("Could not start AutoNudge", exc_info=True)
    # Pre-spawn N warm providers if configured.
    warm_n = int(getattr(app.state.config.dashboard, "warm_pool_size", 0) or 0)
    if warm_n > 0:
        from arz.dashboard.routes.chat import _make_provider as _make_p

        try:
            spawned = await app.state.provider_pool.prewarm(
                warm_n,
                lambda: _make_p(
                    app.state.config,
                    "warm-slot",
                    None,
                    None,
                    app.state.config.provider.name,
                    app.state.config.provider.model,
                    "normal",
                    None,
                ),
            )
            log.info("Warm pool ready", spawned=spawned)
        except Exception:
            log.warning("Pre-warm failed", exc_info=True)
    # Seed the memory-consolidator cron if missing. Runs nightly at 03:00.
    try:
        existing = {c.name for c in app.state.cron_registry.list()}
        if "memory-consolidator" not in existing:
            app.state.cron_registry.create(
                name="memory-consolidator",
                prompt="arz:consolidate",
                schedule="0 3 * * *",
                enabled=True,
            )
            log.info("Seeded memory-consolidator cron (03:00 daily)")
    except Exception:
        log.warning("Could not seed memory-consolidator cron", exc_info=True)
    await app.state.surface_manager.start()
    if getattr(app.state, "heartbeat_service", None) is not None:
        app.state.heartbeat_service.start()
        log.info("Heartbeat started")

    # Idle-sweep task — every 5 min, consolidate sessions that have been
    # quiet for ≥3h with unconsolidated turns. Cheap when nothing's idle.
    async def _idle_sweep_loop() -> None:
        from arz.consolidator import _IDLE_POLL_SECONDS, get_consolidator

        await asyncio.sleep(_IDLE_POLL_SECONDS)
        while True:
            try:
                await get_consolidator().idle_sweep()
            except Exception:
                log.exception("idle sweep iteration failed")
            await asyncio.sleep(_IDLE_POLL_SECONDS)

    app.state.idle_sweep_task = asyncio.create_task(_idle_sweep_loop())
    log.info("Consolidator idle-sweep task started")
    # Suggestions periodic refresh — every 30 min in the background.
    try:
        from arz.suggestions import start_periodic_refresh

        await start_periodic_refresh()
        log.info("Suggestions refresh task started")
    except Exception:
        log.warning("Could not start suggestions refresh", exc_info=True)
    yield
    log.info("Arz gateway shutting down")
    sweep = getattr(app.state, "idle_sweep_task", None)
    if sweep:
        sweep.cancel()
        try:
            await sweep
        except (asyncio.CancelledError, Exception):
            pass
    try:
        from arz.suggestions import stop_periodic_refresh

        await stop_periodic_refresh()
    except Exception:
        pass
    await app.state.surface_manager.shutdown()
    app.state.cron_registry.shutdown()
    if getattr(app.state, "heartbeat_service", None) is not None:
        app.state.heartbeat_service.stop()
    await app.state.provider_pool.shutdown_all()
    try:
        from arz.reaper import get_reaper, scan_orphan_clis

        await get_reaper().stop()
        # Final sweep — catches any provider whose .shutdown() left the
        # child process alive (claude-code occasionally does this when
        # the ACP socket dies mid-stream). Best-effort; logs warnings
        # but never raises.
        try:
            rows = scan_orphan_clis(dry_run=False)
            killed = sum(1 for r in rows if r["killed"])
            if killed:
                log.info("Shutdown sweep killed %d residual CLI(s)", killed)
        except Exception:
            pass
    except Exception:
        pass
    try:
        if getattr(app.state, "autonudge", None) is not None:
            await app.state.autonudge.stop()
    except Exception:
        pass


def create_app(config: ArzConfig, provider_pool: ProviderPool | None = None) -> FastAPI:
    """Construct the FastAPI app with all routes and middleware."""
    app = FastAPI(title="Arz", version="0.7.81", lifespan=_lifespan)

    app.state.config = config
    app.state.provider_pool = provider_pool or ProviderPool(max_size=5)
    app.state.session_manager = SessionManager()
    app.state.search_index = SessionSearchIndex()
    app.state.session_manager.on_save = app.state.search_index.index_session
    app.state.session_map = SessionMap()
    app.state.token_auth_enabled = config.dashboard.token_auth
    app.state.token = load_token() if config.dashboard.token_auth else None
    app.state.pending_approvals = {}
    # Parallel dict keyed by request_id holding metadata (session_id,
    # tool name, tool input, created_at, title) so the Operations board
    # can render Approve/Deny/Trust without opening the session.
    app.state.pending_approval_meta: dict[str, dict] = {}
    app.state.yolo_sessions: set[str] = set()
    app.state.session_modes: dict[str, str] = {}
    app.state.cron_registry = CronRegistry(runner=lambda entry: _spawn_cron_run(app, entry))
    from arz.dashboard.cron import set_cron_registry

    set_cron_registry(app.state.cron_registry)
    app.state.message_router = MessageRouter(app.state.session_manager)
    app.state.surface_manager = SurfaceManager(config, app.state.message_router)
    app.state.audit_log = AuditLog()

    # Subagent runner: spawns an isolated single-turn provider using the named
    # agent's config (or the global default if missing).
    from arz.agents import AgentRegistry
    from arz.subagents import get_subagent_manager

    agent_registry = AgentRegistry()
    app.state.agent_registry = agent_registry

    async def _run_subagent(
        agent_name: str,
        prompt: str,
        approval_mode: str | None = None,
        work_dir: str | None = None,
    ) -> str:
        from arz.acp.types import EVENT_COMPLETE as _EC
        from arz.acp.types import EVENT_TEXT_CHUNK as _ETC
        from arz.prompts.loader import resolve_system_prompt
        from arz.providers.claude_code import ClaudeCodeProvider
        from arz.providers.codex import CodexProvider
        from arz.providers.kiro_cli import KiroCliProvider

        agent = agent_registry.get(agent_name)
        provider_name = (agent.provider if agent else None) or config.provider.name
        # Use the agent's preferred model if set; otherwise leave empty and
        # let the provider pick its own default. We deliberately do NOT
        # inherit the global config.provider.model — it's frequently
        # mismatched (e.g. provider=claude-code but model=gpt-5.4 left over
        # from a previous codex experiment), and the wrong model id makes
        # the underlying CLI hard-fail.
        model = agent.model if (agent and agent.model) else ""
        sys_prompt = resolve_system_prompt(agent.system_prompt if agent else None)

        # Caller override beats agent default. Project-linked channels
        # pass approval_mode="yolo" so specialists can write into the
        # project workspace without per-call permission prompts.
        effective_approval = approval_mode or (agent.approval_mode if agent else None) or "normal"
        from arz.dashboard.routes.chat import _APPROVAL_TO_CLAUDE as _CC_MAP

        cc_permission = _CC_MAP.get(effective_approval)

        if provider_name == "claude-code":
            provider = ClaudeCodeProvider(
                model=model,
                system_prompt=sys_prompt or None,
                work_dir=work_dir,
                permission_mode=cc_permission,
            )
        elif provider_name == "kiro-cli":
            provider = KiroCliProvider(model=model, work_dir=work_dir)
        elif provider_name == "codex":
            provider = CodexProvider(
                model=model, system_prompt=sys_prompt or None, work_dir=work_dir
            )
        elif provider_name == "gemini":
            from arz.providers.gemini import GeminiProvider

            provider = GeminiProvider(
                model=model or None,
                work_dir=work_dir,
                approval_mode=effective_approval,
            )
        elif provider_name == "ollama":
            from arz.providers.ollama import OllamaProvider

            provider = OllamaProvider(model=model or None)
        else:
            return f"(unsupported provider {provider_name!r})"

        # Inject the same memory prefix the chat route uses so subagents,
        # heartbeat items, task-runner steps, and cron fires all see the
        # user's preferences/projects/lessons/recall hits.
        try:
            from arz.memory.context import build_prefix

            prefix = build_prefix(
                prompt,
                config=config,
                recall_k=int(getattr(config.dashboard, "recall_k", 5) or 5),
                enable_recall=bool(getattr(config.dashboard, "auto_recall", True)),
            )
            if prefix:
                prompt = f"{prefix}\n\n{prompt}"
        except Exception:
            log.exception("subagent memory injection failed")

        text = ""
        try:
            await provider.start()
            async for event in provider.stream(prompt):
                if event.kind == _ETC and event.text:
                    text += event.text
                elif event.kind == _EC:
                    break
            # Self-learning: subagent replies can also emit <learn>/<memory>/<note>.
            try:
                from arz import inline_learn

                _, extracted = inline_learn.parse(text)
                if extracted:
                    inline_learn.apply(extracted)
            except Exception:
                log.exception("subagent inline-learn failed")
        finally:
            try:
                await provider.shutdown()
            except Exception:
                pass
        return text

    get_subagent_manager().set_runner(_run_subagent)

    # Heartbeat: separate background loop reading ~/.arz/HEARTBEAT.md.
    from arz.heartbeat import HeartbeatService

    interval = getattr(config.dashboard, "heartbeat_interval_s", 300)
    app.state.heartbeat_service = HeartbeatService(
        runner=_run_subagent, interval_s=interval, agent_name="general"
    )

    # Task runner shares the same single-turn runner.
    from arz.taskrunner import get_task_runner

    get_task_runner().set_runner(_run_subagent)

    # Channel runner — orchestrator + specialist execution loop. Uses
    # the same single-turn subagent runner as everything else.
    from arz.channel_runner import init_channel_runner

    init_channel_runner(_run_subagent)

    # Memory consolidator ("dream"): nightly LLM-driven rollup of recent
    # sessions into preferences/projects/lessons + daily summaries.
    from arz.consolidator import init_consolidator

    init_consolidator(app.state.session_manager, runner=_run_subagent)

    # Suggestions: cached "what should I ask next?" pills on dashboard
    # new-session views. Reuses the same cheap subagent runner.
    from arz.suggestions import init_suggestions

    init_suggestions(_run_subagent, app.state.session_manager)

    # AutoNudge: keeps idle sessions moving toward a stated goal. Posts
    # back to our own /api/chat endpoint so it reuses all the regular
    # streaming / tool / approval plumbing.
    import httpx as _httpx

    async def _autonudge_runner(
        session_id: str, message: str, extra_body: dict | None = None
    ) -> None:
        port = config.dashboard.port
        headers = {"Content-Type": "application/json"}
        if app.state.token_auth_enabled and app.state.token:
            headers["Authorization"] = f"Bearer {app.state.token}"
        body: dict = {"message": message}
        if extra_body:
            body.update(extra_body)
        async with _httpx.AsyncClient(timeout=300.0) as client:
            resp = await client.post(
                f"http://127.0.0.1:{port}/api/chat/{session_id}",
                json=body,
                headers=headers,
            )
            # Drain so the server treats the response as consumed; we don't
            # care about the SSE chunks here.
            try:
                async for _ in resp.aiter_text():
                    pass
            except Exception:
                pass

    from arz.autonudge import init_autonudge

    app.state.autonudge = init_autonudge(app.state.session_manager, runner=_autonudge_runner)
    # Same runner is reused by the /goal auto-iteration loop so a goal
    # turn POSTs back through /api/chat just like an autonudge does.
    app.state.chat_runner = _autonudge_runner
    # Cheap-subagent runner — for the goal evaluator + future helpers.
    # Same `_run_subagent` the consolidator already uses.
    app.state.subagent_runner = _run_subagent

    # Mirror every router event into the audit log.
    def _audit_handler(event):
        from arz.core.event_bus import Event as _Event

        if isinstance(event, _Event):
            app.state.audit_log.log(
                kind=event.kind,
                summary=str(event.payload.get("session_id") or event.source),
                session_id=event.payload.get("session_id"),
                actor=event.payload.get("user_id"),
                details=dict(event.payload),
            )

    app.state.message_router.event_bus.subscribe_all(_audit_handler)

    origins = [
        "http://localhost:3000",
        f"http://localhost:{config.dashboard.port}",
        f"http://127.0.0.1:{config.dashboard.port}",
    ]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(health_router)
    app.include_router(sessions_router)
    app.include_router(chat_router)
    app.include_router(settings_router)
    app.include_router(approvals_router)
    app.include_router(files_router)
    app.include_router(search_router)
    app.include_router(memory_router)
    app.include_router(cron_router)
    app.include_router(compare_router)
    app.include_router(tools_router)
    app.include_router(audit_router)
    app.include_router(analytics_router)
    app.include_router(overview_router)
    app.include_router(agents_router)
    app.include_router(mcp_router)
    app.include_router(prompts_router)
    app.include_router(lessons_router)
    app.include_router(hooks_router)
    app.include_router(subagents_router)
    app.include_router(channels_router)
    app.include_router(heartbeat_router)
    app.include_router(taskrunner_router)
    app.include_router(installer_router)
    app.include_router(consolidator_router)
    app.include_router(action_items_router)
    app.include_router(skills_router)
    app.include_router(suggestions_router)
    app.include_router(workspace_router)
    app.include_router(folders_router)
    app.include_router(projects_router)

    if _STATIC_DIR.exists():
        # SPA fallback: any non-/api path that doesn't match a real file
        # should return index.html so React Router can handle it on the
        # client. Without this, a hard reload of /board, /agents, etc. 404s.
        from fastapi.responses import FileResponse
        from starlette.exceptions import HTTPException as StarletteHTTPException

        index_path = _STATIC_DIR / "index.html"

        @app.exception_handler(StarletteHTTPException)
        async def _spa_fallback(request, exc):
            if (
                exc.status_code == 404
                and request.method == "GET"
                and not request.url.path.startswith("/api/")
                and index_path.exists()
            ):
                return FileResponse(index_path)
            from fastapi.responses import JSONResponse

            return JSONResponse({"detail": exc.detail}, status_code=exc.status_code)

        app.mount("/", StaticFiles(directory=str(_STATIC_DIR), html=True), name="static")

    return app
