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
    size_gb: float       # download size on disk (default Q4_0 quant)
    ram_gb: float = 0.0  # typical RAM/VRAM headroom needed at runtime
    context: int = 0     # max context window in tokens
    license: str = ""    # short license tag, e.g. "Gemma", "Apache-2.0"
    gpu: str = "optional"  # "optional" | "recommended" | "required"


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
        name="gemini",
        binaries=("gemini",),
        description="Google Gemini CLI — coding agent with stream-json + ACP support.",
        install_macos=["npm", "install", "-g", "@google/gemini-cli"],
        install_linux=["npm", "install", "-g", "@google/gemini-cli"],
        docs_url="https://github.com/google-gemini/gemini-cli",
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
    # ── Embedding models — for semantic memory recall, not chat ──
    ModelTarget(
        "ollama:qwen3-embedding:0.6b", "ollama", "qwen3-embedding:0.6b", "Qwen3 Embedding (0.6B)",
        "Embedding model — powers semantic memory recall. Recommended.",
        size_gb=0.6, ram_gb=2.0, context=8192, license="Apache-2.0", gpu="optional",
    ),
    ModelTarget(
        "ollama:nomic-embed-text:latest", "ollama", "nomic-embed-text:latest", "Nomic Embed Text",
        "Alternative embedding model — good general-purpose semantic vectors.",
        size_gb=0.3, ram_gb=1.5, context=2048, license="Apache-2.0", gpu="optional",
    ),

    # ── Gemma 3 family ──
    ModelTarget(
        "ollama:gemma3:1b", "ollama", "gemma3:1b", "Gemma 3 (1B)",
        "Tiny Gemma — runs anywhere; quick draft / autocomplete model.",
        size_gb=0.8, ram_gb=4.0, context=32_768, license="Gemma", gpu="optional",
    ),
    ModelTarget(
        "ollama:gemma3:4b", "ollama", "gemma3:4b", "Gemma 3 (4B)",
        "Google's lightweight general-purpose model. Good default.",
        size_gb=3.3, ram_gb=8.0, context=128_000, license="Gemma", gpu="optional",
    ),
    ModelTarget(
        "ollama:gemma3:12b", "ollama", "gemma3:12b", "Gemma 3 (12B)",
        "Mid-size Gemma — strong general assistant.",
        size_gb=8.1, ram_gb=16.0, context=128_000, license="Gemma", gpu="recommended",
    ),
    ModelTarget(
        "ollama:gemma3:27b", "ollama", "gemma3:27b", "Gemma 3 (27B)",
        "Largest Gemma — frontier-quality reasoning.",
        size_gb=17.0, ram_gb=32.0, context=128_000, license="Gemma", gpu="recommended",
    ),

    # ── Llama family ──
    ModelTarget(
        "ollama:llama3.2:3b", "ollama", "llama3.2:3b", "Llama 3.2 (3B)",
        "Meta's small Llama — fast on any laptop.",
        size_gb=2.0, ram_gb=6.0, context=128_000, license="Llama 3", gpu="optional",
    ),
    ModelTarget(
        "ollama:llama3.1:8b", "ollama", "llama3.1:8b", "Llama 3.1 (8B)",
        "Meta's mid-size Llama; broadly capable.",
        size_gb=4.7, ram_gb=12.0, context=128_000, license="Llama 3.1", gpu="recommended",
    ),

    # ── Qwen family ──
    ModelTarget(
        "ollama:qwen2.5-coder:7b", "ollama", "qwen2.5-coder:7b", "Qwen 2.5 Coder (7B)",
        "Alibaba's coding-tuned Qwen — great for codegen.",
        size_gb=4.7, ram_gb=12.0, context=131_072, license="Apache-2.0", gpu="recommended",
    ),
    ModelTarget(
        "ollama:qwen2.5:14b", "ollama", "qwen2.5:14b", "Qwen 2.5 (14B)",
        "Larger Qwen for richer reasoning.",
        size_gb=9.0, ram_gb=20.0, context=131_072, license="Apache-2.0", gpu="recommended",
    ),
    ModelTarget(
        "ollama:qwen2.5:32b", "ollama", "qwen2.5:32b", "Qwen 2.5 (32B)",
        "Top-tier open Qwen — frontier reasoning. Needs serious hardware.",
        size_gb=20.0, ram_gb=40.0, context=131_072, license="Apache-2.0", gpu="recommended",
    ),

    # ── Coding-specialised ──
    ModelTarget(
        "ollama:deepseek-coder-v2:16b", "ollama", "deepseek-coder-v2:16b", "DeepSeek Coder v2 (16B)",
        "Strong open coding model — MoE; lower active-param cost.",
        size_gb=9.0, ram_gb=18.0, context=128_000, license="DeepSeek", gpu="recommended",
    ),

    # ── Microsoft Phi / Mistral / Mixtral ──
    ModelTarget(
        "ollama:phi3:mini", "ollama", "phi3:mini", "Phi-3 Mini (3.8B)",
        "Microsoft's compact reasoning model.",
        size_gb=2.3, ram_gb=6.0, context=128_000, license="MIT", gpu="optional",
    ),
    ModelTarget(
        "ollama:mistral:7b", "ollama", "mistral:7b", "Mistral (7B)",
        "Mistral's classic open base model.",
        size_gb=4.1, ram_gb=10.0, context=32_768, license="Apache-2.0", gpu="recommended",
    ),
    ModelTarget(
        "ollama:mixtral:8x7b", "ollama", "mixtral:8x7b", "Mixtral (8x7B)",
        "Mixture-of-experts; higher quality. Needs serious hardware.",
        size_gb=26.0, ram_gb=48.0, context=32_768, license="Apache-2.0", gpu="required",
    ),
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
            "ram_gb": m.ram_gb,
            "context": m.context,
            "license": m.license,
            "gpu": m.gpu,
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


async def list_loaded_ollama_models() -> list[dict]:
    """Models currently held in VRAM/RAM by Ollama (`ollama ps`)."""
    if not shutil.which("ollama"):
        return []
    try:
        proc = await asyncio.create_subprocess_exec(
            "ollama", "ps",
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
        )
        out, _ = await proc.communicate()
    except Exception:
        return []
    if proc.returncode != 0:
        return []
    rows: list[dict] = []
    for i, line in enumerate(out.decode(errors="replace").splitlines()):
        if i == 0 or not line.strip():
            continue
        parts = line.split()
        if len(parts) < 2:
            continue
        rows.append({
            "name": parts[0],
            "id": parts[1] if len(parts) > 1 else "",
            "size": parts[2] if len(parts) > 2 else "",
            "processor": parts[3] if len(parts) > 3 else "",
            "until": " ".join(parts[5:]) if len(parts) > 5 else "",
        })
    return rows


async def _ollama_chat(model: str, *, keep_alive: int | str) -> tuple[bool, str]:
    """Hit Ollama's /api/chat with an empty message — used for load/unload.

    keep_alive=-1     → keep loaded indefinitely
    keep_alive=0      → eject from memory now
    keep_alive="5m"   → keep loaded for 5 minutes
    """
    import json as _json
    import urllib.request
    body = _json.dumps({
        "model": model,
        "messages": [],
        "keep_alive": keep_alive,
    }).encode("utf-8")
    req = urllib.request.Request(
        "http://127.0.0.1:11434/api/chat",
        data=body,
        method="POST",
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            text = resp.read().decode("utf-8", errors="replace")
            return resp.status < 400, text
    except Exception as e:
        return False, str(e)


async def load_ollama_model(model: str) -> tuple[bool, str]:
    return await _ollama_chat(model, keep_alive=-1)


async def eject_ollama_model(model: str) -> tuple[bool, str]:
    return await _ollama_chat(model, keep_alive=0)


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
