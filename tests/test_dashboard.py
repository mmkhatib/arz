"""Tests for the dashboard FastAPI routes."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from arz.config.loader import load_config
from arz.dashboard.server import create_app
from arz.providers.base import LLMEvent, LLMProvider
from arz.providers.pool import ProviderPool


class _FakeProvider(LLMProvider):
    name = "fake"

    async def start(self) -> None:
        pass

    async def shutdown(self) -> None:
        pass

    async def stream(self, message: str):  # type: ignore[override]
        from arz.acp.types import EVENT_COMPLETE
        yield LLMEvent(kind=EVENT_COMPLETE, text="")

    async def approve_tool(self, request_id: str | int) -> None:
        pass

    async def reject_tool(self, request_id: str | int) -> None:
        pass

    def context_usage_pct(self) -> float:
        return 0.0


@pytest.fixture()
def client() -> TestClient:
    config = load_config()
    config.dashboard.token_auth = False
    pool = ProviderPool(max_size=5)
    app = create_app(config, pool)
    return TestClient(app, raise_server_exceptions=True)


# ── /api/health ──────────────────────────────────────────────────────────────

def test_health(client: TestClient) -> None:
    r = client.get("/api/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert "version" in body


# ── GET /api/sessions ─────────────────────────────────────────────────────────

def test_list_sessions_empty(client: TestClient) -> None:
    r = client.get("/api/sessions")
    assert r.status_code == 200
    assert r.json() == []


# ── POST /api/sessions ────────────────────────────────────────────────────────

def test_create_session(client: TestClient) -> None:
    r = client.post("/api/sessions", json={})
    assert r.status_code == 201
    body = r.json()
    assert "id" in body
    assert body["active"] is True


def test_create_session_appears_in_list(client: TestClient) -> None:
    client.post("/api/sessions", json={})
    r = client.get("/api/sessions")
    assert r.status_code == 200
    assert len(r.json()) == 1


# ── GET /api/sessions/{id} ────────────────────────────────────────────────────

def test_get_session(client: TestClient) -> None:
    created = client.post("/api/sessions", json={}).json()
    r = client.get(f"/api/sessions/{created['id']}")
    assert r.status_code == 200
    body = r.json()
    assert body["id"] == created["id"]
    assert "messages" in body


def test_get_session_not_found(client: TestClient) -> None:
    r = client.get("/api/sessions/nonexistent-id")
    assert r.status_code == 404


# ── DELETE /api/sessions/{id} ─────────────────────────────────────────────────

def test_delete_session(client: TestClient) -> None:
    created = client.post("/api/sessions", json={}).json()
    r = client.delete(f"/api/sessions/{created['id']}")
    assert r.status_code == 204


def test_delete_session_not_found(client: TestClient) -> None:
    r = client.delete("/api/sessions/nonexistent-id")
    assert r.status_code == 404
