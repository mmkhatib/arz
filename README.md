# Arz 🌲

*The AI that grew up in the mountains.*

**Arz** (أرز — "cedar") is a personal AI agent runtime. Rooted, persistent, always there. Meet **Arzeh** (أرزة), your cedar sapling.

## What Arz does

- **Chat across surfaces** — Slack, Telegram, WhatsApp, web dashboard, TUI, native desktop
- **Pluggable LLM providers** — Claude Code CLI, Kiro-cli, direct Anthropic SDK
- **Persistent memory** — markdown + SQLite + vector (`sqlite-vec`)
- **Scheduled jobs** — cron-style recurring tasks via APScheduler
- **Subagents** — spawn parallel workers, synthesize results
- **Self-learning** — saves corrections as lessons across sessions
- **Tool ecosystem** — MCP-compatible

## Architecture at a glance

```
Slack / Telegram / WhatsApp / Dashboard / TUI / Electron
                        │
                        ▼
                 Session Manager
                        │
                        ▼
    LLMProvider (Claude Code | Kiro-cli | Anthropic SDK)
                        │
                        ▼
              MCP tools + subagents
```

Two pluggable seams carry the design:

- `src/arz/providers/` — `LLMProvider` ABC; one file per backend
- `src/arz/surfaces/` — `MessagingSurface` ABC; one directory per platform

## Quick start

```bash
uv pip install arz
arz chat
```

Full setup docs land in `docs/` as phases land.

## Status

Private, pre-release (v0.1.0-dev). See [`STEERING.md`](STEERING.md) for design principles and [`CONTRIBUTING.md`](CONTRIBUTING.md) for dev setup.

## License

MIT
