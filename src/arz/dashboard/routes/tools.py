"""Tool registry routes — list, reload, invoke, and CRUD source files."""

from __future__ import annotations

import re
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from arz.dashboard.token_auth import require_token
from arz.tools.registry import ToolRegistry

router = APIRouter(dependencies=[Depends(require_token)])

_SAFE_NAME = re.compile(r"^[a-zA-Z][a-zA-Z0-9_]{0,63}$")

_TEMPLATE = '''"""{name} — short description."""

tool_spec = {{
    "name": "{name}",
    "description": "Describe what this tool does and when to use it.",
    "input_schema": {{
        "type": "object",
        "properties": {{
            "query": {{"type": "string"}},
        }},
        "required": ["query"],
    }},
}}


async def run(input: dict) -> str:
    query = str(input.get("query") or "")
    return f"echo: {{query}}"
'''


def _registry(request: Request) -> ToolRegistry:
    reg = getattr(request.app.state, "tool_registry", None)
    if reg is None:
        reg = ToolRegistry()
        request.app.state.tool_registry = reg
    return reg


def _file_for(reg: ToolRegistry, name: str) -> Path:
    if not _SAFE_NAME.match(name):
        raise HTTPException(status_code=400, detail="bad tool name")
    return reg.directory / f"{name}.py"


class ToolView(BaseModel):
    name: str
    description: str
    input_schema: dict
    source_path: str
    error: str | None = None


class ToolInvoke(BaseModel):
    input: dict


class ToolSource(BaseModel):
    source: str


class ToolCreate(BaseModel):
    name: str
    source: str | None = None


@router.get("/api/tools", response_model=list[ToolView])
async def list_tools(request: Request) -> list[ToolView]:
    return [ToolView(**t.to_public()) for t in _registry(request).list()]


@router.post("/api/tools/reload", response_model=dict)
async def reload_tools(request: Request) -> dict:
    count = _registry(request).reload()
    return {"loaded": count}


@router.get("/api/tools/{name}/source", response_model=ToolSource)
async def get_tool_source(name: str, request: Request) -> ToolSource:
    reg = _registry(request)
    path = _file_for(reg, name)
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"unknown tool {name!r}")
    return ToolSource(source=path.read_text(encoding="utf-8"))


@router.put("/api/tools/{name}/source", response_model=ToolView)
async def put_tool_source(name: str, body: ToolSource, request: Request) -> ToolView:
    reg = _registry(request)
    path = _file_for(reg, name)
    path.write_text(body.source, encoding="utf-8")
    reg.reload()
    spec = reg.get(name)
    if spec is None:
        raise HTTPException(status_code=400, detail="tool failed to load — check syntax")
    return ToolView(**spec.to_public())


@router.post("/api/tools", response_model=ToolView, status_code=201)
async def create_tool(body: ToolCreate, request: Request) -> ToolView:
    reg = _registry(request)
    path = _file_for(reg, body.name)
    if path.exists():
        raise HTTPException(status_code=409, detail="tool already exists")
    src = body.source or _TEMPLATE.format(name=body.name)
    path.write_text(src, encoding="utf-8")
    reg.reload()
    spec = reg.get(body.name)
    if spec is None:
        raise HTTPException(status_code=400, detail="tool failed to load — check syntax")
    return ToolView(**spec.to_public())


@router.delete("/api/tools/{name}", status_code=204)
async def delete_tool(name: str, request: Request) -> None:
    reg = _registry(request)
    path = _file_for(reg, name)
    if path.exists():
        path.unlink()
    reg.reload()


@router.post("/api/tools/{name}/invoke", response_model=dict)
async def invoke_tool(name: str, body: ToolInvoke, request: Request) -> dict:
    try:
        result = await _registry(request).invoke(name, body.input)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"unknown tool {name!r}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    return {"result": result}
