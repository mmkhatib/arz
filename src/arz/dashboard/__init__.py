"""Arz web dashboard — FastAPI server + SSE + optional token auth."""

from arz.dashboard.server import create_app

__all__ = ["create_app"]
