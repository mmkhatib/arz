"""Tool registry routes — list, reload, invoke user-defined tools."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from arz.dashboard.token_auth import require_token
from arz.tools.registry import ToolRegistry

router = APIRouter(dependencies=[Depends(require_token)])


def _registry(request: Request) -> ToolRegistry:
    reg = getattr(request.app.state, "tool_registry", None)
    if reg is None:
        reg = ToolRegistry()
        request.app.state.tool_registry = reg
    return reg


class ToolView(BaseModel):
    name: str
    description: str
    input_schema: dict
    source_path: str
    error: str | None = None


class ToolInvoke(BaseModel):
    input: dict


@router.get("/api/tools", response_model=list[ToolView])
async def list_tools(request: Request) -> list[ToolView]:
    return [ToolView(**t.to_public()) for t in _registry(request).list()]


@router.post("/api/tools/reload", response_model=dict)
async def reload_tools(request: Request) -> dict:
    count = _registry(request).reload()
    return {"loaded": count}


@router.post("/api/tools/{name}/invoke", response_model=dict)
async def invoke_tool(name: str, body: ToolInvoke, request: Request) -> dict:
    try:
        result = await _registry(request).invoke(name, body.input)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"unknown tool {name!r}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    return {"result": result}
