"""FastAPI application factory for the Arz dashboard."""

from __future__ import annotations

import logging
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
from arz.session.manager import SessionManager

log = structlog.get_logger(__name__)

_STATIC_DIR = Path(__file__).parent.parent / "static"


@asynccontextmanager
async def _lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Start provider + session manager on startup; shutdown on exit."""
    log.info("Arz gateway starting", port=app.state.config.dashboard.port)
    await app.state.provider.start()
    app.state.session_manager.load_all()
    yield
    log.info("Arz gateway shutting down")
    await app.state.provider.shutdown()


def create_app(config: ArzConfig, provider: object) -> FastAPI:
    """Construct the FastAPI app with all routes and middleware.

    Args:
        config: Loaded ArzConfig.
        provider: An initialised LLMProvider instance.
    """
    app = FastAPI(title="Arz", version="0.1.0", lifespan=_lifespan)

    # State
    app.state.config = config
    app.state.provider = provider
    app.state.session_manager = SessionManager()
    app.state.token_auth_enabled = config.dashboard.token_auth
    app.state.token = load_token() if config.dashboard.token_auth else None

    # CORS — allow Vite dev server and same-origin in prod
    origins = [
        f"http://localhost:3000",
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

    # API routes
    app.include_router(health_router)
    app.include_router(sessions_router)
    app.include_router(chat_router)

    # Serve built frontend if dist/ exists
    if _STATIC_DIR.exists():
        app.mount("/", StaticFiles(directory=str(_STATIC_DIR), html=True), name="static")

    return app
