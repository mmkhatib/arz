"""Health check route."""

from fastapi import APIRouter, Request

from arz import __version__

router = APIRouter()


@router.get("/api/health")
async def health(request: Request) -> dict:
    pool = getattr(request.app.state, "provider_pool", None)
    return {
        "status": "ok",
        "version": __version__,
        "active_sessions": pool.active_count() if pool else 0,
        "max_active_sessions": pool.max_size if pool else 0,
    }
