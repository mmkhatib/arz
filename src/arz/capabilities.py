"""Capability Registry — what the orchestrator agent can call on.

Single source of truth that summarises everything the orchestrator
might delegate to:

* Installed LLM CLIs (claude-code, kiro-cli, codex, gemini, ollama).
* Cloud models reachable through those CLIs, tagged by tier
  (frontier / fast / cheap).
* Local Ollama models with size + RAM hints.
* Custom agent profiles from ~/.arz/agents/.
* MCP servers from ~/.claude/.mcp.json + ~/.kiro/mcp.json.
* Builtin tool registry.

The text rendering produced by ``capabilities_block()`` is meant to be
injected at the top of an orchestrator's system prompt so it can pick
the right specialist (cheap model for trivial classification, frontier
for deep design work) rather than blindly using its own model.
"""

from __future__ import annotations

import json
import shutil
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Literal

# ── Static knowledge of CLI installs ──────────────────────────────
# Same set the installer page surfaces; mirrored here so the
# capability block stays accurate without bouncing through
# /api/installer/status (which is async and not cheap to call).
_CLI_BINS: dict[str, str] = {
    "claude-code": "claude",
    "kiro-cli": "kiro",
    "codex": "codex",
    "gemini": "gemini",
    "ollama": "ollama",
}

# ── Cloud model tiers ─────────────────────────────────────────────
# Conservative subset; the orchestrator only needs hints, not exact
# pricing. Tiers are a hint, not a hard guarantee — a frontier model
# may still be cheap for a small request.
ModelTier = Literal["frontier", "fast", "cheap"]


@dataclass
class CloudModel:
    name: str
    provider: str
    tier: ModelTier
    context_k: int
    note: str = ""


_CLOUD_MODELS: list[CloudModel] = [
    CloudModel("claude-opus-4-8", "claude-code", "frontier", 200, "deep reasoning, agentic"),
    CloudModel("claude-opus-4-7", "claude-code", "frontier", 200, "deep reasoning, agentic"),
    CloudModel("claude-haiku-4-5", "claude-code", "cheap", 200, "fast & inexpensive"),
    CloudModel("gpt-5", "codex", "frontier", 400, "long-doc, structured output"),
    CloudModel("gemini-2.5-pro", "gemini", "frontier", 2000, "very long context"),
    CloudModel("gemini-2.5-flash", "gemini", "fast", 1000, "fast & multimodal"),
]


@dataclass
class LocalModel:
    name: str
    size_gb: float
    ram_gb: int
    note: str = ""


@dataclass
class AgentProfile:
    name: str
    provider: str
    model: str
    role: str
    approval_mode: str
    is_default: bool = False


@dataclass
class McpServerSummary:
    name: str
    source: str
    enabled: bool


@dataclass
class CapabilitySnapshot:
    clis: dict[str, bool]  # binary -> installed?
    cloud_models: list[CloudModel]
    local_models: list[LocalModel]
    agents: list[AgentProfile]
    mcps: list[McpServerSummary]
    builtin_tools: list[str]
    max_concurrent_subagents: int = 3

    def to_dict(self) -> dict:
        return {
            "clis": self.clis,
            "cloud_models": [asdict(m) for m in self.cloud_models],
            "local_models": [asdict(m) for m in self.local_models],
            "agents": [asdict(a) for a in self.agents],
            "mcps": [asdict(m) for m in self.mcps],
            "builtin_tools": list(self.builtin_tools),
            "max_concurrent_subagents": self.max_concurrent_subagents,
        }


def _detect_clis() -> dict[str, bool]:
    return {name: shutil.which(binary) is not None for name, binary in _CLI_BINS.items()}


def _list_local_models() -> list[LocalModel]:
    """Best-effort sync read of installed Ollama models. Returns [] if
    the ollama CLI isn't on PATH or the registry parse fails — orchestrator
    can still operate without local model awareness."""
    if not shutil.which("ollama"):
        return []
    try:
        import subprocess  # noqa: PLC0415

        out = subprocess.run(
            ["ollama", "list"],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
        rows: list[LocalModel] = []
        for line in (out.stdout or "").splitlines()[1:]:
            parts = line.split()
            if not parts:
                continue
            name = parts[0]
            size = 0.0
            for p in parts:
                if p.endswith("GB") or p.endswith("MB"):
                    try:
                        size = float(p.rstrip("GBM"))
                        if p.endswith("MB"):
                            size /= 1024.0
                    except ValueError:
                        pass
            rows.append(
                LocalModel(name=name, size_gb=round(size, 1), ram_gb=int(max(2, size * 1.4)))
            )
        return rows
    except Exception:
        return []


def _list_agents() -> list[AgentProfile]:
    try:
        from arz.agents import AgentRegistry

        reg = AgentRegistry()
        return [
            AgentProfile(
                name=a.name,
                provider=a.provider,
                model=a.model or "",
                role=(a.description or a.name)[:120],
                approval_mode=a.approval_mode,
                is_default=bool(a.is_default),
            )
            for a in reg.list()
        ]
    except Exception:
        return []


def _list_mcps() -> list[McpServerSummary]:
    """Read MCP server lists from common config files. Mirrors the
    surface the Capabilities page already shows."""
    out: list[McpServerSummary] = []
    overrides_path = Path.home() / ".arz" / "mcp_overrides.json"
    overrides: dict[str, bool] = {}
    if overrides_path.exists():
        try:
            overrides = json.loads(overrides_path.read_text(encoding="utf-8"))
        except Exception:
            overrides = {}

    for path, source in [
        (Path.home() / ".claude" / ".mcp.json", "claude"),
        (Path.home() / ".kiro" / "mcp.json", "kiro"),
    ]:
        if not path.exists():
            continue
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
            servers = raw.get("mcpServers") or raw.get("servers") or {}
            for name, _spec in servers.items():
                key = f"{source}:{name}"
                enabled = overrides.get(key, True)
                out.append(McpServerSummary(name=name, source=source, enabled=enabled))
        except Exception:
            continue
    return out


def _list_builtin_tools() -> list[str]:
    try:
        from arz.tools.registry import list_tools  # type: ignore[attr-defined]

        return [t.name for t in list_tools()]
    except Exception:
        return []


def snapshot(max_concurrent: int = 3) -> CapabilitySnapshot:
    """Collect a fresh snapshot. Cheap — runs synchronously in a
    handful of file/subprocess reads. Caching is the caller's
    responsibility (e.g. the channel runner re-snapshots every minute)."""
    return CapabilitySnapshot(
        clis=_detect_clis(),
        cloud_models=list(_CLOUD_MODELS),
        local_models=_list_local_models(),
        agents=_list_agents(),
        mcps=_list_mcps(),
        builtin_tools=_list_builtin_tools(),
        max_concurrent_subagents=max_concurrent,
    )


def capabilities_block(snap: CapabilitySnapshot | None = None) -> str:
    """Render a compact text block to inject in an orchestrator's system
    prompt. Format is markdown-ish; keep it short — orchestrator is
    optimising, not learning, on this content.
    """
    s = snap or snapshot()
    lines: list[str] = ["<capabilities>", ""]
    installed = [name for name, ok in s.clis.items() if ok]
    missing = [name for name, ok in s.clis.items() if not ok]
    if installed:
        lines.append(f"Installed CLIs: {', '.join(installed)}")
    if missing:
        lines.append(f"Available but not installed: {', '.join(missing)}")
    lines.append("")

    if s.cloud_models:
        lines.append("Cloud models (pick by tier):")
        for m in s.cloud_models:
            tier_tag = {"frontier": "🌲 frontier", "fast": "💨 fast", "cheap": "🪙 cheap"}[m.tier]
            note = f" — {m.note}" if m.note else ""
            lines.append(f"  - {m.name} ({m.provider}, {tier_tag}, ~{m.context_k}k ctx){note}")
        lines.append("")

    if s.local_models:
        lines.append(
            "Local Ollama models (zero-cost, slower, run them when the task is small "
            "or the user wants to stay offline):"
        )
        for m in s.local_models:
            lines.append(f"  - {m.name} ({m.size_gb}GB, ~{m.ram_gb}GB RAM)")
        lines.append("")

    if s.agents:
        lines.append("Custom agents (you can delegate by name):")
        for a in s.agents:
            star = " ★default" if a.is_default else ""
            lines.append(
                f"  - @{a.name} (provider={a.provider}, model={a.model or 'default'}, "
                f"approval={a.approval_mode}{star}) — {a.role}"
            )
        lines.append("")

    if s.mcps:
        on = [f"{m.source}:{m.name}" for m in s.mcps if m.enabled]
        off = [f"{m.source}:{m.name}" for m in s.mcps if not m.enabled]
        if on:
            lines.append(f"MCP servers (enabled): {', '.join(on)}")
        if off:
            lines.append(f"MCP servers (disabled): {', '.join(off)}")
        lines.append("")

    if s.builtin_tools:
        lines.append(f"Builtin tools available: {', '.join(s.builtin_tools)}")
        lines.append("")

    lines.append(
        f"Concurrency: at most {s.max_concurrent_subagents} subagents can run in parallel. "
        "Delegate by @-mentioning agents in your reply; the runner spawns them in parallel "
        "where possible."
    )
    lines.append("</capabilities>")
    return "\n".join(lines)


__all__ = [
    "AgentProfile",
    "CapabilitySnapshot",
    "CloudModel",
    "LocalModel",
    "McpServerSummary",
    "capabilities_block",
    "snapshot",
]


# Default snapshot that other modules can import without spinning up
# their own. Refreshed lazily via ``snapshot()`` when callers need a
# current view (e.g. after the user installs a new agent).
_default_snapshot: CapabilitySnapshot | None = None


def get_capabilities(force_refresh: bool = False) -> CapabilitySnapshot:
    global _default_snapshot
    if _default_snapshot is None or force_refresh:
        _default_snapshot = snapshot()
    return _default_snapshot


# Field marker for the dataclass so the linter sees `field` is used.
_ = field
