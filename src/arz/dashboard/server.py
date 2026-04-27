"""FastAPI application factory for the Arz dashboard."""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncIterator

import structlog
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from arz.acp.types import EVENT_COMPLETE, EVENT_TEXT_CHUNK

from arz.config.schema import ArzConfig
from arz.dashboard.routes.approvals import router as approvals_router
from arz.dashboard.routes.chat import router as chat_router
from arz.dashboard.routes.files import router as files_router
from arz.dashboard.audit import AuditLog
from arz.dashboard.cron import CronEntry, CronRegistry
from arz.dashboard.routes.analytics import router as analytics_router
from arz.dashboard.routes.audit import router as audit_router
from arz.dashboard.routes.compare import router as compare_router
from arz.dashboard.routes.cron import router as cron_router
from arz.dashboard.routes.health import router as health_router
from arz.dashboard.routes.memory import router as memory_router
from arz.dashboard.routes.search import router as search_router
from arz.dashboard.routes.sessions import router as sessions_router
from arz.dashboard.routes.settings import router as settings_router
from arz.dashboard.routes.tools import router as tools_router
from arz.dashboard.search import SessionSearchIndex
from arz.dashboard.token_auth import load_token
from arz.core.router import MessageRouter
from arz.providers.pool import ProviderPool
from arz.session.manager import SessionManager
from arz.session.session_map import SessionMap
from arz.surfaces.manager import SurfaceManager

log = structlog.get_logger(__name__)

_STATIC_DIR = Path(__file__).parent.parent / "static"


def _spawn_cron_run(app: FastAPI, entry: CronEntry) -> None:
    """Schedule an async cron run on the running event loop."""
    asyncio.create_task(_run_cron_entry(app, entry))


async def _run_cron_entry(app: FastAPI, entry: CronEntry) -> None:
    """Execute a cron entry: create a session, stream the prompt, persist results."""
    from arz.providers.claude_code import ClaudeCodeProvider
    from arz.providers.kiro_cli import KiroCliProvider

    cfg: ArzConfig = app.state.config
    mgr: SessionManager = app.state.session_manager
    registry: CronRegistry = app.state.cron_registry

    log.info("Cron run started", cron_id=entry.id, name=entry.name)
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
    else:
        registry.record_run(entry.id, "error: unsupported provider", session.id)
        return

    full_reply = ""
    status = "success"
    try:
        await provider.start()
        async for event in provider.stream(entry.prompt):
            if event.kind == EVENT_TEXT_CHUNK and event.text:
                full_reply += event.text
            elif event.kind == EVENT_COMPLETE:
                break
        if full_reply:
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
    app.state.cron_registry.start()
    log.info("Cron scheduler started")
    await app.state.surface_manager.start()
    yield
    log.info("Arz gateway shutting down")
    await app.state.surface_manager.shutdown()
    app.state.cron_registry.shutdown()
    await app.state.provider_pool.shutdown_all()


def create_app(config: ArzConfig, provider_pool: ProviderPool | None = None) -> FastAPI:
    """Construct the FastAPI app with all routes and middleware."""
    app = FastAPI(title="Arz", version="0.1.0", lifespan=_lifespan)

    app.state.config = config
    app.state.provider_pool = provider_pool or ProviderPool(max_size=5)
    app.state.session_manager = SessionManager()
    app.state.search_index = SessionSearchIndex()
    app.state.session_manager.on_save = app.state.search_index.index_session
    app.state.session_map = SessionMap()
    app.state.token_auth_enabled = config.dashboard.token_auth
    app.state.token = load_token() if config.dashboard.token_auth else None
    app.state.pending_approvals = {}
    app.state.yolo_sessions: set[str] = set()
    app.state.session_modes: dict[str, str] = {}
    app.state.cron_registry = CronRegistry(runner=lambda entry: _spawn_cron_run(app, entry))
    app.state.message_router = MessageRouter(app.state.session_manager)
    app.state.surface_manager = SurfaceManager(config, app.state.message_router)
    app.state.audit_log = AuditLog()

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

    if _STATIC_DIR.exists():
        app.mount("/", StaticFiles(directory=str(_STATIC_DIR), html=True), name="static")

    return app
