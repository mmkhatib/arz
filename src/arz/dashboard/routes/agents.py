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
