"""Arz CLI entry point."""

from __future__ import annotations

import asyncio
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

            async for event in provider.stream(message):
                if event.kind == EVENT_TEXT_CHUNK and event.text:
                    print(event.text, end="", flush=True)

                elif event.kind == EVENT_PERMISSION_REQUEST:
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
    auto_approve: Annotated[
        bool, typer.Option("--auto-approve", help="Auto-approve all tool calls")
    ] = False,
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
        # Skip GET access logs for endpoints the dashboard polls every few
        # seconds. They drown out everything that actually matters.
        _SKIP = (
            "/api/health",
            "/api/cron",
            "/api/overview",
            "/api/sessions",
            "/api/memory/stats",
            "/api/installer/status",
            "/api/chat/",  # SSE reattach + polling status
            "/api/settings",
            "/api/channels",  # active-channel poll fires every 2s
            "/api/projects",  # detail-page poll fires every 15s
            "/api/folders",
            "/api/agents",
            "/api/action-items",
            "/api/mcp/servers",
            "/api/lessons",
            "/api/memory/files",
            "/api/tools",
            "/api/prompts",
            "/api/heartbeat",
            "/api/subagents",
            "/api/taskrun",
            "/api/audit",
            "/api/analytics",
            "/api/files/read",
            "/api/sessions/history",
        )

        def filter(self, record: logging.LogRecord) -> bool:
            msg = record.getMessage()
            # Only quiet GETs — POST/PATCH/DELETE always log so the
            # important state-changing requests stay visible.
            if ' "GET ' not in msg:
                return True
            return not any(p in msg for p in self._SKIP)

    logging.getLogger("uvicorn.access").addFilter(_QuietPolling())

    # Honor cfg.log_level for the root logger + uvicorn + structlog stdlib
    # bridge. WARNING / ERROR really do silence INFO chatter; default INFO
    # keeps prior behavior. Settings PATCH also calls into this path live.
    from arz.dashboard.routes.settings import apply_log_level as _apply_lvl

    _apply_lvl(cfg.log_level)

    typer.echo(f"Arz gateway starting at http://{cfg.dashboard.host}:{cfg.dashboard.port}")
    uvicorn.run(
        web_app,
        host=cfg.dashboard.host,
        port=cfg.dashboard.port,
        log_level=(cfg.log_level or "info").lower(),
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
        "LLM provider",
        default="claude-code",
        show_choices=True,
        prompt_suffix=" [claude-code/kiro-cli]: ",
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


@app.command()
def snapshot(
    out: Annotated[Path | None, typer.Option("--out", "-o", help="Output .tar.gz path")] = None,
    include_sessions: Annotated[bool, typer.Option(help="Include session JSON files")] = True,
) -> None:
    """Bundle ~/.arz/ into a portable tar.gz archive."""
    import tarfile
    import time as _t

    arz = Path.home() / ".arz"
    if not arz.exists():
        raise typer.BadParameter(f"{arz} does not exist — nothing to snapshot")
    out = out or Path.cwd() / f"arz-snapshot-{_t.strftime('%Y%m%d-%H%M%S')}.tar.gz"
    typer.echo(f"Snapshotting {arz} → {out}")
    with tarfile.open(out, "w:gz") as tf:
        for entry in arz.iterdir():
            if entry.name == "sessions" and not include_sessions:
                continue
            # Skip transient + secret-like artifacts.
            if entry.name in {"owned_pids.json", ".cache", "tmp"}:
                continue
            tf.add(entry, arcname=entry.name)
    size_kb = out.stat().st_size / 1024
    typer.echo(f"Wrote {size_kb:.1f} KiB")


@app.command()
def restore(
    archive: Annotated[Path, typer.Argument(help="Snapshot .tar.gz to restore")],
    mode: Annotated[str, typer.Option(help="merge | replace")] = "merge",
    dry_run: Annotated[bool, typer.Option("--dry-run", help="Preview only")] = False,
) -> None:
    """Restore a snapshot. ``merge`` adds files (skipping conflicts);
    ``replace`` overwrites existing files."""
    import shutil
    import tarfile

    if not archive.exists():
        raise typer.BadParameter(f"{archive} not found")
    if mode not in ("merge", "replace"):
        raise typer.BadParameter("--mode must be merge or replace")
    arz = Path.home() / ".arz"
    arz.mkdir(exist_ok=True)
    typer.echo(f"Restoring {archive} → {arz} (mode={mode}, dry-run={dry_run})")
    added = skipped = overwritten = 0
    with tarfile.open(archive, "r:gz") as tf:
        for member in tf.getmembers():
            target = arz / member.name
            if target.exists():
                if mode == "merge":
                    skipped += 1
                    typer.echo(f"  skip   {member.name}")
                    continue
                if not dry_run:
                    if target.is_dir():
                        shutil.rmtree(target)
                    else:
                        target.unlink()
                overwritten += 1
                typer.echo(f"  replace {member.name}")
            else:
                added += 1
                typer.echo(f"  add    {member.name}")
            if not dry_run:
                tf.extract(member, arz)
    typer.echo(f"\nDone: added={added} overwritten={overwritten} skipped={skipped}")


@app.command(name="eval")
def eval_cmd(
    scenarios: Annotated[str, typer.Option(help="Comma-separated scenario IDs or 'all'")] = "all",
    config: Annotated[Path | None, typer.Option("--config", "-c")] = None,
    cross_provider: Annotated[
        bool,
        typer.Option(
            "--cross-provider",
            help="Run every scenario against every installed provider (claude-code, kiro-cli, codex, gemini, ollama).",
        ),
    ] = False,
) -> None:
    """Run the memory eval harness against the configured provider.

    Use ``--cross-provider`` to fan out across every installed CLI on the
    box. Memory-pipeline scenarios (memory-write-recall,
    memory-restart-recall, memory-forget) are designed for that mode.
    """
    from arz.eval import run_eval

    cfg = load_config(config)
    chosen = (
        None if scenarios.strip().lower() == "all" else [s.strip() for s in scenarios.split(",")]
    )
    asyncio.run(run_eval(cfg, scenarios=chosen, cross_provider=cross_provider))


if __name__ == "__main__":
    app()
