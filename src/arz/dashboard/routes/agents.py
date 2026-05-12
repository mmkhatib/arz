"""Agents — CRUD for named provider+config presets."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from arz.agents import AgentConfig, AgentRegistry
from arz.dashboard.token_auth import require_token

router = APIRouter(dependencies=[Depends(require_token)])


def _registry(request: Request) -> AgentRegistry:
    reg = getattr(request.app.state, "agent_registry", None)
    if reg is None:
        reg = AgentRegistry()
        request.app.state.agent_registry = reg
    return reg


class AgentCreate(BaseModel):
    name: str
    provider: str = "claude-code"
    providers: list[str] = []
    model: str = ""
    work_dir: str = ""
    system_prompt: str = ""
    approval_mode: str = "normal"
    tool_allowlist: list[str] = []
    description: str = ""
    is_default: bool = False


@router.get("/api/agents", response_model=list[AgentConfig])
async def list_agents(request: Request) -> list[AgentConfig]:
    return _registry(request).list()


@router.post("/api/agents", response_model=AgentConfig, status_code=201)
async def create_agent(body: AgentCreate, request: Request) -> AgentConfig:
    reg = _registry(request)
    if reg.get(body.name):
        raise HTTPException(409, f"Agent '{body.name}' already exists")
    agent = AgentConfig(**body.model_dump())
    reg.save(agent)
    return agent


@router.put("/api/agents/{name}", response_model=AgentConfig)
async def update_agent(name: str, body: AgentCreate, request: Request) -> AgentConfig:
    reg = _registry(request)
    agent = AgentConfig(**{**body.model_dump(), "name": name})
    reg.save(agent)
    return agent


@router.delete("/api/agents/{name}", status_code=204)
async def delete_agent(name: str, request: Request) -> None:
    if not _registry(request).delete(name):
        raise HTTPException(404, f"Agent '{name}' not found")


class AgentStats(BaseModel):
    name: str
    runs: int = 0
    messages: int = 0
    tokens_in: int = 0
    tokens_out: int = 0
    last_used: float | None = None


@router.get("/api/agents/stats", response_model=list[AgentStats])
async def agent_stats(request: Request) -> list[AgentStats]:
    """Aggregate usage stats per agent from every saved session.

    A "run" = a session whose `agent` field is set. `messages` counts every
    turn in those sessions. Token totals roll up `message.usage` per turn.
    """
    mgr = request.app.state.session_manager
    # Cover both active + closed.
    sessions = list(mgr.list_active()) + list(mgr.list_inactive())
    by_agent: dict[str, AgentStats] = {}
    for s in sessions:
        if not getattr(s, "agent", None):
            continue
        stats = by_agent.setdefault(s.agent, AgentStats(name=s.agent))
        stats.runs += 1
        for msg in s.messages:
            stats.messages += 1
            u = getattr(msg, "usage", None) or {}
            stats.tokens_in += int(u.get("input_tokens") or u.get("prompt_tokens") or 0)
            stats.tokens_out += int(u.get("output_tokens") or u.get("completion_tokens") or 0)
        last = s.updated_at.timestamp() if s.updated_at else None
        if last and (stats.last_used is None or last > stats.last_used):
            stats.last_used = last
    return sorted(by_agent.values(), key=lambda x: -(x.last_used or 0))
