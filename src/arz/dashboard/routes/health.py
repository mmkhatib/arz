"""Health check route."""

from fastapi import APIRouter

from arz import __version__

router = APIRouter()


@router.get("/api/health")
async def health() -> dict:
    return {"status": "ok", "version": __version__}
