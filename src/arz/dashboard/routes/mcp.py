"""MCP servers — read-only surface of ~/.claude/.mcp.json and ~/.kiro/mcp.json."""

from __future__ import annotations

import json
from pathlib import Path

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel

from arz.dashboard.token_auth import require_token

router = APIRouter(dependencies=[Depends(require_token)])

_OVERRIDES_PATH = Path.home() / ".arz" / "mcp_overrides.json"

_MCP_SOURCES = [
    ("claude", Path.home() / ".claude" / "mcp.json"),
    ("kiro", Path.home() / ".kiro" / "mcp.json"),
]


class McpServer(BaseModel):
    name: str
    command: str = ""
    args: list[str] = []
    env: dict[str, str] = {}
    source: str
    enabled: bool = True


def _load_overrides() -> dict[str, bool]:
    if _OVERRIDES_PATH.exists():
        try:
            return json.loads(_OVERRIDES_PATH.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {}


def _save_overrides(overrides: dict[str, bool]) -> None:
    _OVERRIDES_PATH.parent.mkdir(parents=True, exist_ok=True)
    _OVERRIDES_PATH.write_text(json.dumps(overrides, indent=2), encoding="utf-8")


@router.get("/api/mcp/servers", response_model=list[McpServer])
async def list_mcp_servers() -> list[McpServer]:
    overrides = _load_overrides()
    servers: list[McpServer] = []
    for source, path in _MCP_SOURCES:
        if not path.exists():
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        # Both Claude Code and Kiro use { "mcpServers": { name: { command, args, env } } }
        mcp_servers = data.get("mcpServers", {})
        for name, cfg in mcp_servers.items():
            key = f"{source}:{name}"
            enabled = overrides.get(key, True)
            servers.append(McpServer(
                name=name,
                command=cfg.get("command", ""),
                args=cfg.get("args", []),
                env=cfg.get("env", {}),
                source=source,
                enabled=enabled,
            ))
    return servers


@router.post("/api/mcp/servers/{source}/{name}/toggle", response_model=McpServer)
async def toggle_mcp_server(source: str, name: str) -> McpServer:
    overrides = _load_overrides()
    key = f"{source}:{name}"
    overrides[key] = not overrides.get(key, True)
    _save_overrides(overrides)

    # Return the updated server
    for src, path in _MCP_SOURCES:
        if src != source or not path.exists():
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            cfg = data.get("mcpServers", {}).get(name, {})
            return McpServer(
                name=name,
                command=cfg.get("command", ""),
                args=cfg.get("args", []),
                env=cfg.get("env", {}),
                source=source,
                enabled=overrides[key],
            )
        except Exception:
            pass
    return McpServer(name=name, source=source, enabled=overrides[key])
