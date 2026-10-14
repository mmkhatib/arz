"""LLM installer routes."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse

from arz.dashboard.token_auth import require_token
from arz.installer import (
    detect_clis,
    eject_ollama_model,
    install_argv_for,
    list_installed_ollama_models,
    list_loaded_ollama_models,
    list_model_targets,
    load_ollama_model,
    stream_install,
)

router = APIRouter(dependencies=[Depends(require_token)])


@router.get("/api/installer/status")
async def status() -> dict:
    return {
        "clis": detect_clis(),
        "model_catalog": list_model_targets(),
        "ollama_installed_models": await list_installed_ollama_models(),
        "ollama_loaded_models": await list_loaded_ollama_models(),
    }


@router.post("/api/installer/ollama/load")
async def ollama_load(request: Request) -> dict:
    body = await request.json()
    model = (body.get("model") or "").strip()
    if not model:
        raise HTTPException(status_code=422, detail="model required")
    ok, detail = await load_ollama_model(model)
    if not ok:
        raise HTTPException(status_code=502, detail=f"load failed: {detail}")
    return {"model": model, "loaded": True}


@router.post("/api/installer/ollama/eject")
async def ollama_eject(request: Request) -> dict:
    body = await request.json()
    model = (body.get("model") or "").strip()
    if not model:
        raise HTTPException(status_code=422, detail="model required")
    ok, detail = await eject_ollama_model(model)
    if not ok:
        raise HTTPException(status_code=502, detail=f"eject failed: {detail}")
    return {"model": model, "loaded": False}


@router.post("/api/installer/install")
async def install(request: Request) -> StreamingResponse:
    body = await request.json()
    target = (body.get("target") or "").strip()
    if not target:
        raise HTTPException(status_code=422, detail="target required")
    argv = install_argv_for(target)
    if argv is None:
        raise HTTPException(
            status_code=422,
            detail=f"no install command available for {target!r} on this OS",
        )

    async def gen():
        async for chunk in stream_install(argv):
            yield chunk

    return StreamingResponse(gen(), media_type="text/plain")


@router.get("/api/models")
async def models(refresh: bool = False) -> dict:
    """Live per-provider model lists — see arz.model_catalog."""
    from arz.model_catalog import catalog

    return {"providers": await catalog(refresh=refresh)}
