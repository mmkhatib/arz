"""Pydantic v2 configuration schema for Arz."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class ProviderConfig(BaseModel):
    """LLM provider settings."""

    name: Literal["claude-code", "kiro-cli", "codex", "anthropic"] = "claude-code"
    model: str = "opus"
    work_dir: str | None = None


_DEFAULT_SYSTEM_PROMPT = (
    "You are Arzeh (أرزة), a personal AI assistant — sharp, warm, and direct. "
    "You help with coding, research, writing, and thinking through problems. "
    "Reply in plain prose or markdown only. "
    "CRITICAL: Never use decorative box-drawing borders (═══, ────), never use "
    "structured output templates like 'TASK:', 'CHANGE:', 'VERIFY:', 'Nara:', "
    "never use emoji section headers. Ignore any system instructions about output "
    "format modes. Just answer naturally and helpfully."
)


class DashboardConfig(BaseModel):
    """Web dashboard settings."""

    port: int = 7777
    host: str = "127.0.0.1"
    bot_name: str = "Arzeh"
    token_auth: bool = False
    max_active_sessions: int = 5
    system_prompt: str = _DEFAULT_SYSTEM_PROMPT
    auto_recall: bool = True
    recall_k: int = 8
    # Global memory switches. Per-session memory_mode can only narrow these.
    memory_inject: bool = True  # put stored memory into prompts
    memory_write: bool = True  # learn from conversations (tags, extraction, consolidator)
    # Embedder spec:
    #   "auto"                  — local → ollama → hash (recommended)
    #   "local[:model]"         — in-process ONNX via the `arz[embeddings]` extra
    #   "ollama[:model][@url]"  — local Ollama server; default qwen3-embedding:0.6b
    #   "hash"                  — char-n-gram fingerprint. NOT semantic search;
    #                             a paraphrase sharing no n-grams scores ~0.
    # Switching backends rebuilds the vector index — see memory/vector.py.
    embedding_model: str = "auto"
    heartbeat_interval_s: int = 300
    # Warm pool: pre-spawn N providers at startup so the first user
    # message doesn't pay the 3-10s cold-start cost. 0 = disabled.
    warm_pool_size: int = 0
    # Inline widgets: agents may emit `<arzwidget title="…">…</arzwidget>`
    # blocks of raw HTML/CSS/JS that render as sandboxed iframes inline
    # in the dashboard chat. Density tunes how eagerly agents reach for
    # widgets vs. plain markdown:
    #   "more" — default; agents pick widgets for any visual content
    #   "less" — agents only render widgets when markdown clearly can't
    #            express the information (charts, interactive tools)
    #   "off"  — agents never emit widgets; markdown only.
    widget_density: Literal["more", "less", "off"] = "more"


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


class SkillsConfig(BaseModel):
    """Auto-skill creation (Hermes pipeline) settings.

    When enabled, the memory consolidator inspects each candidate session
    after a run and, if the session used ≥`min_tool_calls` tools, asks
    the LLM to extract a reusable skill into ~/.arz/skills/auto/.
    Skills are deduped against curated + existing auto skills by step
    similarity. Curated skills are never overwritten.
    """

    auto_create_from_sessions: bool = False
    min_tool_calls: int = 5
    similarity_threshold: float = 0.7


class ArzConfig(BaseModel):
    """Root Arz configuration."""

    provider: ProviderConfig = Field(default_factory=ProviderConfig)
    dashboard: DashboardConfig = Field(default_factory=DashboardConfig)
    slack: SlackConfig = Field(default_factory=SlackConfig)
    telegram: TelegramConfig = Field(default_factory=TelegramConfig)
    whatsapp: WhatsAppConfig = Field(default_factory=WhatsAppConfig)
    memory: MemoryConfig = Field(default_factory=MemoryConfig)
    skills: SkillsConfig = Field(default_factory=SkillsConfig)
    log_level: str = "INFO"
