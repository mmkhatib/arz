"""Arz CLI entry point."""

from __future__ import annotations

import typer

from arz import __version__

app = typer.Typer(
    help="Arz — personal AI agent runtime. Your cedar in the cloud.",
    no_args_is_help=True,
)


@app.command()
def version() -> None:
    """Print the installed Arz version."""
    typer.echo(f"arz {__version__}")


@app.command()
def chat() -> None:
    """Start an interactive chat session."""
    typer.echo("Chat surface not yet implemented — ships in Phase 1.")
    raise typer.Exit(code=1)


@app.command()
def gateway() -> None:
    """Run the Arz gateway (dashboard + messaging surfaces)."""
    typer.echo("Gateway not yet implemented — ships in Phase 3.")
    raise typer.Exit(code=1)


if __name__ == "__main__":
    app()
