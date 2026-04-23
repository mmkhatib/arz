"""FastAPI application factory for the Arz dashboard."""

from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncIterator

import structlog
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from arz.config.schema import ArzConfig
from arz.dashboard.routes.chat import router as chat_router
from arz.dashboard.routes.health import router as health_router
from arz.dashboard.routes.sessions import router as sessions_router
from arz.dashboard.token_auth import load_token
from arz.providers.pool import ProviderPool
from arz.session.manager import SessionManager

log = structlog.get_logger(__name__)

_STATIC_DIR = Path(__file__).parent.parent / "static"


@asynccontextmanager
async def _lifespan(app: FastAPI) -> AsyncIterator[None]:
    log.info("Arz gateway starting", port=app.state.config.dashboard.port)
    app.state.session_manager.load_all()
    yield
    log.info("Arz gateway shutting down")
    await app.state.provider_pool.shutdown_all()


def create_app(config: ArzConfig, provider_pool: ProviderPool | None = None) -> FastAPI:
    """Construct the FastAPI app with all routes and middleware."""
    app = FastAPI(title="Arz", version="0.1.0", lifespan=_lifespan)

    app.state.config = config
    app.state.provider_pool = provider_pool or ProviderPool(max_size=5)
    app.state.session_manager = SessionManager()
    app.state.token_auth_enabled = config.dashboard.token_auth
    app.state.token = load_token() if config.dashboard.token_auth else None

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

    if _STATIC_DIR.exists():
        app.mount("/", StaticFiles(directory=str(_STATIC_DIR), html=True), name="static")

    return app
