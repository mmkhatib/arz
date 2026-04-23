"""Settings route — GET/PATCH provider + model config."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel

from arz.config.loader import save_config
from arz.dashboard.token_auth import require_token

router = APIRouter(dependencies=[Depends(require_token)])


class SettingsResponse(BaseModel):
    provider: Literal["claude-code", "kiro-cli", "anthropic"]
    model: str


class SettingsPatch(BaseModel):
    provider: Literal["claude-code", "kiro-cli", "anthropic"] | None = None
    model: str | None = None


@router.get("/api/settings", response_model=SettingsResponse)
async def get_settings(request: Request) -> SettingsResponse:
    cfg = request.app.state.config
    return SettingsResponse(
        provider=cfg.provider.name,
        model=cfg.provider.model,
    )


@router.patch("/api/settings", response_model=SettingsResponse)
async def patch_settings(body: SettingsPatch, request: Request) -> SettingsResponse:
    cfg = request.app.state.config

    if body.provider is not None:
        cfg.provider.name = body.provider
    if body.model is not None:
        cfg.provider.model = body.model

    save_config(cfg)

    return SettingsResponse(
        provider=cfg.provider.name,
        model=cfg.provider.model,
    )
