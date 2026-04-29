"""LLM installer — detect installed CLIs and pull popular local models.

Knows about:
    CLIs: claude, codex, kiro, ollama, lm-studio
    Local models (via Ollama): a curated list of popular small models.

Install commands are best-effort — they prefer brew on macOS and npm where
relevant. The runner streams stdout for progress.
"""

from __future__ import annotations

import asyncio
import os
import platform
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import AsyncIterator


@dataclass(frozen=True)
class CliTarget:
    name: str
    binaries: tuple[str, ...]   # binaries to look for (in order)
    extra_paths: tuple[str, ...] = ()  # absolute fallback paths to probe
    description: str = ""
    install_macos: list[str] | None = None        # argv tokens
    install_linux: list[str] | None = None
    docs_url: str = ""


@dataclass(frozen=True)
class ModelTarget:
    id: str              # "ollama:gemma3:4b" etc.
    runtime: str         # "ollama"
    name: str            # tag passed to `ollama pull`
    label: str
    description: str
    size_gb: float


CLI_TARGETS: list[CliTarget] = [
    CliTarget(
        name="ollama",
        binaries=("ollama",),
        description="Local model runtime; runs gemma, llama, qwen, etc. on your machine.",
        install_macos=["brew", "install", "ollama"],
        install_linux=["sh", "-c", "curl -fsSL https://ollama.com/install.sh | sh"],
        docs_url="https://ollama.com/download",
    ),
    CliTarget(
        name="codex",
        binaries=("codex",),
        description="OpenAI Codex CLI — autonomous coding agent.",
        install_macos=["npm", "install", "-g", "@openai/codex"],
        install_linux=["npm", "install", "-g", "@openai/codex"],
        docs_url="https://github.com/openai/codex",
    ),
    CliTarget(
        name="claude",
        binaries=("claude",),
        description="Anthropic Claude Code CLI.",
        install_macos=["npm", "install", "-g", "@anthropic-ai/claude-code"],
        install_linux=["npm", "install", "-g", "@anthropic-ai/claude-code"],
        docs_url="https://docs.claude.com/en/docs/claude-code/overview",
    ),
    CliTarget(
        name="kiro",
        binaries=("kiro-cli", "kiro"),
        extra_paths=(str(Path.home() / ".local" / "bin" / "kiro-cli"),),
        description="Kiro CLI — Amazon's open-source coding agent.",
        install_macos=None,
        install_linux=None,
        docs_url="https://github.com/aws/kiro-cli",
    ),
    CliTarget(
        name="lm-studio",
        binaries=("lms",),
        description="LM Studio — desktop runtime for local models.",
        install_macos=["brew", "install", "--cask", "lm-studio"],
        install_linux=None,
        docs_url="https://lmstudio.ai/",
    ),
]

MODEL_TARGETS: list[ModelTarget] = [
    ModelTarget("ollama:gemma3:4b",        "ollama", "gemma3:4b",        "Gemma 3 (4B)",        "Google's lightweight general-purpose model. Good default.", 3.3),
    ModelTarget("ollama:gemma3:12b",       "ollama", "gemma3:12b",       "Gemma 3 (12B)",       "Larger Gemma — needs ~12 GB RAM.", 8.1),
    ModelTarget("ollama:llama3.2:3b",      "ollama", "llama3.2:3b",      "Llama 3.2 (3B)",      "Meta's small Llama — fast on any laptop.", 2.0),
    ModelTarget("ollama:llama3.1:8b",      "ollama", "llama3.1:8b",      "Llama 3.1 (8B)",      "Meta's mid-size Llama; broadly capable.", 4.7),
    ModelTarget("ollama:qwen2.5-coder:7b", "ollama", "qwen2.5-coder:7b", "Qwen 2.5 Coder (7B)", "Alibaba's coding-tuned Qwen.", 4.7),
    ModelTarget("ollama:qwen2.5:14b",      "ollama", "qwen2.5:14b",      "Qwen 2.5 (14B)",      "Larger Qwen for richer reasoning. ~16 GB RAM.", 9.0),
    ModelTarget("ollama:deepseek-coder-v2:16b", "ollama", "deepseek-coder-v2:16b", "DeepSeek Coder v2 (16B)", "Strong open coding model.", 9.0),
    ModelTarget("ollama:phi3:mini",        "ollama", "phi3:mini",        "Phi-3 Mini (3.8B)",   "Microsoft's compact reasoning model.", 2.3),
    ModelTarget("ollama:mistral:7b",       "ollama", "mistral:7b",       "Mistral (7B)",        "Mistral's classic open base model.", 4.1),
    ModelTarget("ollama:mixtral:8x7b",     "ollama", "mixtral:8x7b",     "Mixtral (8x7B)",      "Mixture-of-experts; higher quality, ~30 GB RAM.", 26.0),
]


def _find_binary(target: CliTarget) -> str | None:
    for name in target.binaries:
        p = shutil.which(name)
        if p:
            return p
    for extra in target.extra_paths:
        if Path(extra).exists() and os.access(extra, os.X_OK):
            return extra
    return None


def detect_clis() -> list[dict]:
    out: list[dict] = []
    for target in CLI_TARGETS:
        path = _find_binary(target)
        out.append({
            "name": target.name,
            "binary": target.binaries[0],
            "description": target.description,
            "installed": path is not None,
            "path": path,
            "docs_url": target.docs_url,
            "installable_here": _install_argv(target) is not None,
        })
    return out


def list_model_targets() -> list[dict]:
    return [
        {
            "id": m.id,
            "runtime": m.runtime,
            "name": m.name,
            "label": m.label,
            "description": m.description,
            "size_gb": m.size_gb,
        }
        for m in MODEL_TARGETS
    ]


async def list_installed_ollama_models() -> list[dict]:
    if not shutil.which("ollama"):
        return []
    try:
        proc = await asyncio.create_subprocess_exec(
            "ollama", "list",
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
        )
        out, _ = await proc.communicate()
    except Exception:
        return []
    if proc.returncode != 0:
        return []
    rows: list[dict] = []
    for i, line in enumerate(out.decode(errors="replace").splitlines()):
        if i == 0:
            continue
        parts = line.split()
        if len(parts) < 2:
            continue
        rows.append({"name": parts[0], "id": parts[1] if len(parts) > 1 else "", "size": parts[2] if len(parts) > 2 else ""})
    return rows


def _install_argv(target: CliTarget) -> list[str] | None:
    sysname = platform.system().lower()
    if "darwin" in sysname or sysname == "darwin":
        return target.install_macos
    if "linux" in sysname:
        return target.install_linux
    return None


def install_argv_for(target_name: str) -> list[str] | None:
    """Return the argv to install a CLI or pull a model. None if unsupported here."""
    if target_name.startswith("model:"):
        ref = target_name.split(":", 1)[1]
        # ref should look like "ollama:gemma3:4b" — split first colon only.
        runtime, _, model_tag = ref.partition(":")
        if runtime == "ollama" and model_tag:
            if not shutil.which("ollama"):
                return None
            return ["ollama", "pull", model_tag]
        return None
    for t in CLI_TARGETS:
        if t.name == target_name:
            argv = _install_argv(t)
            return argv
    return None


async def stream_install(argv: list[str]) -> AsyncIterator[str]:
    """Run the install command and yield stdout/stderr lines."""
    proc = await asyncio.create_subprocess_exec(
        *argv,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
        env={**os.environ},
    )
    assert proc.stdout
    try:
        while True:
            line = await proc.stdout.readline()
            if not line:
                break
            yield line.decode(errors="replace")
    finally:
        rc = await proc.wait()
        yield f"\n[exit {rc}]\n"
