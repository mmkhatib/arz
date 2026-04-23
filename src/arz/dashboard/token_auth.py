"""Token-based authentication for the dashboard.

A SHA-256 token is stored in ~/.arz/.token (chmod 600).
Clients present it as a Bearer header or ?token= query param.
Token auth is optional — disabled when dashboard.token_auth = false.
"""

from __future__ import annotations

import hashlib
import os
import secrets
from pathlib import Path

from fastapi import HTTPException, Request, status

_TOKEN_PATH = Path.home() / ".arz" / ".token"


def generate_token() -> str:
    """Generate a cryptographically random token and persist it."""
    token = secrets.token_urlsafe(32)
    _TOKEN_PATH.parent.mkdir(parents=True, exist_ok=True)
    _TOKEN_PATH.write_text(token)
    _TOKEN_PATH.chmod(0o600)
    return token


def load_token() -> str | None:
    """Load the stored token, or None if it doesn't exist."""
    if _TOKEN_PATH.exists():
        return _TOKEN_PATH.read_text().strip()
    return None


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


async def require_token(request: Request) -> None:
    """FastAPI dependency that enforces token auth if enabled."""
    app_state = request.app.state
    if not getattr(app_state, "token_auth_enabled", False):
        return

    stored = getattr(app_state, "token", None)
    if not stored:
        return

    # Check Authorization header
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        presented = auth[7:].strip()
        if secrets.compare_digest(presented, stored):
            return

    # Check ?token= query param
    token_param = request.query_params.get("token", "")
    if token_param and secrets.compare_digest(token_param, stored):
        return

    # Check cookie
    cookie = request.cookies.get("arz_token", "")
    if cookie and secrets.compare_digest(cookie, stored):
        return

    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
