"""Settings route — GET/PATCH provider + dashboard config."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field

from arz.config.loader import save_config
from arz.dashboard.token_auth import require_token

router = APIRouter(dependencies=[Depends(require_token)])

ProviderName = Literal["claude-code", "kiro-cli", "codex", "anthropic"]


class SettingsResponse(BaseModel):
    provider: ProviderName
    model: str
    bot_name: str
    host: str
    port: int
    token_auth: bool
    system_prompt: str
    log_level: str
    auto_recall: bool
    recall_k: int


class SettingsPatch(BaseModel):
    provider: ProviderName | None = None
    model: str | None = None
    bot_name: str | None = None
    host: str | None = None
    port: int | None = Field(default=None, ge=1, le=65535)
    token_auth: bool | None = None
    system_prompt: str | None = None
    log_level: str | None = None
    auto_recall: bool | None = None
    recall_k: int | None = Field(default=None, ge=1, le=20)


def _to_response(cfg) -> SettingsResponse:
    return SettingsResponse(
        provider=cfg.provider.name,
        model=cfg.provider.model,
        bot_name=cfg.dashboard.bot_name,
        host=cfg.dashboard.host,
        port=cfg.dashboard.port,
        token_auth=cfg.dashboard.token_auth,
        system_prompt=cfg.dashboard.system_prompt,
        log_level=cfg.log_level,
        auto_recall=cfg.dashboard.auto_recall,
        recall_k=cfg.dashboard.recall_k,
    )


@router.get("/api/settings", response_model=SettingsResponse)
async def get_settings(request: Request) -> SettingsResponse:
    return _to_response(request.app.state.config)


@router.patch("/api/settings", response_model=SettingsResponse)
async def patch_settings(body: SettingsPatch, request: Request) -> SettingsResponse:
    cfg = request.app.state.config

    if body.provider is not None:
        cfg.provider.name = body.provider
    if body.model is not None:
        cfg.provider.model = body.model
    if body.bot_name is not None:
        cfg.dashboard.bot_name = body.bot_name
    if body.host is not None:
        cfg.dashboard.host = body.host
    if body.port is not None:
        cfg.dashboard.port = body.port
    if body.token_auth is not None:
        cfg.dashboard.token_auth = body.token_auth
    if body.system_prompt is not None:
        cfg.dashboard.system_prompt = body.system_prompt
    if body.log_level is not None:
        cfg.log_level = body.log_level
    if body.auto_recall is not None:
        cfg.dashboard.auto_recall = body.auto_recall
    if body.recall_k is not None:
        cfg.dashboard.recall_k = body.recall_k

    save_config(cfg)
    return _to_response(cfg)
