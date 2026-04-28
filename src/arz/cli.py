"""Arz CLI entry point."""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from typing import Annotated

import typer

from arz import __version__
from arz.acp.types import EVENT_COMPLETE, EVENT_PERMISSION_REQUEST, EVENT_TEXT_CHUNK
from arz.config.loader import load_config
from arz.providers.base import LLMProvider

app = typer.Typer(
    help="Arz — personal AI agent runtime. Your cedar in the cloud.",
    no_args_is_help=True,
)


def _build_provider(cfg_path: Path | None = None) -> LLMProvider:
    """Instantiate the configured LLM provider."""
    config = load_config(cfg_path)
    provider_name = config.provider.name
    model = config.provider.model
    work_dir = config.provider.work_dir

    if provider_name == "claude-code":
        from arz.providers.claude_code import ClaudeCodeProvider
        return ClaudeCodeProvider(model=model, work_dir=work_dir)
    elif provider_name == "kiro-cli":
        from arz.providers.kiro_cli import KiroCliProvider
        return KiroCliProvider(model=model, work_dir=work_dir)
    elif provider_name == "codex":
        from arz.providers.codex import CodexProvider
        return CodexProvider(model=model, work_dir=work_dir)
    elif provider_name == "anthropic":
        raise typer.BadParameter("anthropic direct provider not yet implemented (Phase 3)")
    else:
        raise typer.BadParameter(f"Unknown provider: {provider_name!r}")


async def _chat_loop(provider: LLMProvider, auto_approve: bool) -> None:
    """Interactive REPL — read from stdin, stream from provider."""
    await provider.start()
    try:
        print(f"Arzeh 🌲  (provider: {provider.name})")
        print("Type /exit or Ctrl+D to quit. /approve — auto-approve tools.\n")

        while True:
            try:
                message = input("arz> ").strip()
            except (EOFError, KeyboardInterrupt):
                print()
                break

            if not message:
                continue
            if message.lower() in ("/exit", "/quit", "exit", "quit"):
                break

            print()
            pending_approval: str | int | None = None

            async for event in provider.stream(message):
                if event.kind == EVENT_TEXT_CHUNK and event.text:
                    print(event.text, end="", flush=True)

                elif event.kind == EVENT_PERMISSION_REQUEST:
                    pending_approval = event.request_id
                    print(f"\n\n[Tool: {event.title}]")
                    if event.tool_input:
                        print(f"Input: {event.tool_input[:300]}")
                    if auto_approve:
                        print("Auto-approving (--auto-approve).")
                        await provider.approve_tool(event.request_id)
                    else:
                        answer = input("Approve? [y/N/always] ").strip().lower()
                        if answer in ("y", "yes", "always"):
                            await provider.approve_tool(event.request_id)
                        else:
                            await provider.reject_tool(event.request_id)

                elif event.kind == EVENT_COMPLETE:
                    break

            print("\n")

    finally:
        await provider.shutdown()


@app.command()
def chat(
    config: Annotated[Path | None, typer.Option("--config", "-c", help="Config file path")] = None,
    auto_approve: Annotated[bool, typer.Option("--auto-approve", help="Auto-approve all tool calls")] = False,
) -> None:
    """Start an interactive chat session with Arzeh."""
    provider = _build_provider(config)
    try:
        asyncio.run(_chat_loop(provider, auto_approve))
    except KeyboardInterrupt:
        pass


@app.command()
def gateway(
    config: Annotated[Path | None, typer.Option("--config", "-c", help="Config file path")] = None,
    host: Annotated[str | None, typer.Option("--host", help="Bind host")] = None,
    port: Annotated[int | None, typer.Option("--port", "-p", help="Bind port")] = None,
) -> None:
    """Run the Arz dashboard gateway (FastAPI + uvicorn)."""
    import uvicorn
    from arz.dashboard.server import create_app

    cfg = load_config(config)
    if host is not None:
        cfg.dashboard.host = host
    if port is not None:
        cfg.dashboard.port = port

    from arz.providers.pool import ProviderPool
    pool = ProviderPool(max_size=cfg.dashboard.max_active_sessions)
    web_app = create_app(cfg, pool)

    import logging

    class _QuietPolling(logging.Filter):
        _SKIP = ("/api/health", "/api/cron", "/api/overview", "/api/sessions")
        def filter(self, record: logging.LogRecord) -> bool:
            msg = record.getMessage()
            return not any(p in msg for p in self._SKIP)

    logging.getLogger("uvicorn.access").addFilter(_QuietPolling())

    typer.echo(f"Arz gateway starting at http://{cfg.dashboard.host}:{cfg.dashboard.port}")
    uvicorn.run(
        web_app,
        host=cfg.dashboard.host,
        port=cfg.dashboard.port,
        log_level="info",
    )


@app.command()
def version() -> None:
    """Print the installed Arz version."""
    typer.echo(f"arz {__version__}")


@app.command()
def setup() -> None:
    """Interactive setup wizard — create ~/.arz/config.toml."""
    arz_dir = Path.home() / ".arz"
    arz_dir.mkdir(exist_ok=True)
    config_path = arz_dir / "config.toml"
    if config_path.exists():
        typer.echo(f"Config already exists at {config_path}")
        if not typer.confirm("Overwrite?"):
            return

    provider = typer.prompt(
        "LLM provider", default="claude-code", show_choices=True,
        prompt_suffix=f" [claude-code/kiro-cli]: "
    )
    model = typer.prompt("Model", default="claude-opus-4-7")

    config_path.write_text(
        f"""[provider]
name = "{provider}"
model = "{model}"

[dashboard]
port = 7777
host = "127.0.0.1"
bot_name = "Arzeh"
"""
    )
    typer.echo(f"\nConfig written to {config_path}")
    typer.echo("Run `arz chat` to start.")


if __name__ == "__main__":
    app()
