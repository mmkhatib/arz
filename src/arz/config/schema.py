"""Pydantic v2 configuration schema for Arz."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class ProviderConfig(BaseModel):
    """LLM provider settings."""

    name: Literal["claude-code", "kiro-cli", "anthropic"] = "claude-code"
    model: str = "claude-opus-4-7"
    work_dir: str | None = None


class DashboardConfig(BaseModel):
    """Web dashboard settings."""

    port: int = 7777
    host: str = "127.0.0.1"
    bot_name: str = "Arzeh"
    token_auth: bool = False
    max_active_sessions: int = 5


class SlackConfig(BaseModel):
    """Slack surface settings."""

    enabled: bool = False
    bot_token: str = ""
    app_token: str = ""
    owner_id: str = ""


class TelegramConfig(BaseModel):
    """Telegram surface settings."""

    enabled: bool = False
    bot_token: str = ""
    owner_id: str = ""


class WhatsAppConfig(BaseModel):
    """WhatsApp surface settings (Meta Cloud API)."""

    enabled: bool = False
    access_token: str = ""
    phone_number_id: str = ""
    verify_token: str = ""
    owner_number: str = ""


class MemoryConfig(BaseModel):
    """Memory backend settings."""

    db_path: str = "~/.arz/memory.db"
    markdown_dir: str = "~/.arz/memory"


class ArzConfig(BaseModel):
    """Root Arz configuration."""

    provider: ProviderConfig = Field(default_factory=ProviderConfig)
    dashboard: DashboardConfig = Field(default_factory=DashboardConfig)
    slack: SlackConfig = Field(default_factory=SlackConfig)
    telegram: TelegramConfig = Field(default_factory=TelegramConfig)
    whatsapp: WhatsAppConfig = Field(default_factory=WhatsAppConfig)
    memory: MemoryConfig = Field(default_factory=MemoryConfig)
    log_level: str = "INFO"
