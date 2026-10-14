"""Live model catalog — ask each provider which models it serves today.

Hard-coded model lists rot: a CLI update retires "claude-opus-4-7" and every
picker keeps offering it. Each provider gets discovered from the most
authoritative source it exposes, falling back to a small static list only
when discovery is impossible:

* claude-code — the CLI's aliases (``opus``, ``sonnet``…) always resolve to
  the newest model of that family, so they never go stale. Labels show the
  concrete ID the alias last resolved to, read from Claude Code's own
  transcripts. With ``ANTHROPIC_API_KEY`` set, ``/v1/models`` adds pinned IDs.
* anthropic — ``GET /v1/models`` (needs ``ANTHROPIC_API_KEY``).
* codex — ``~/.codex/models_cache.json``, which the Codex CLI refreshes from
  OpenAI on its own; only ``visibility == "list"`` entries, in its order.
* kiro-cli — ``kiro-cli chat --list-models --format json`` (skipped when not
  logged in: an unauthenticated call opens a browser login).
* gemini — gemini-cli's model aliases (``auto``, ``pro``, ``flash``…), which
  the CLI routes to the current generation itself.
* ollama — the models actually pulled.

Results are cached per provider for ``_TTL_S``.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import shutil
import time
from dataclasses import asdict, dataclass
from pathlib import Path

import httpx

_TTL_S = 600.0


@dataclass
class ModelInfo:
    id: str
    label: str
    default: bool = False


# Claude Code aliases, newest-first preference for the default.
_CLAUDE_ALIASES: list[tuple[str, str]] = [
    ("opus", "Opus"),
    ("fable", "Fable"),
    ("sonnet", "Sonnet"),
    ("haiku", "Haiku"),
]
_CLAUDE_DEFAULT_ALIAS = "opus"

# Used only when the Anthropic API can't be reached.
_ANTHROPIC_FALLBACK: list[ModelInfo] = [
    ModelInfo("claude-opus-5-5", "Claude Opus 5.5", default=True),
    ModelInfo("claude-fable-5-1", "Claude Fable 5.1"),
    ModelInfo("claude-sonnet-5-5", "Claude Sonnet 5.5"),
    ModelInfo("claude-haiku-5-5", "Claude Haiku 5.5"),
]

_GEMINI_ALIASES: list[ModelInfo] = [
    ModelInfo("auto", "Auto (Gemini picks)", default=True),
    ModelInfo("pro", "Pro (latest)"),
    ModelInfo("flash", "Flash (latest)"),
    ModelInfo("flash-lite", "Flash-Lite (latest)"),
]

_KIRO_FALLBACK: list[ModelInfo] = [ModelInfo("auto", "Auto", default=True)]

_cache: dict[str, tuple[float, list[ModelInfo]]] = {}


def _home() -> Path:
    return Path(os.path.expanduser("~"))


# ── claude-code ────────────────────────────────────────────────────

_CLAUDE_ID_RE = re.compile(r'"model"\s*:\s*"(claude-(opus|sonnet|haiku|fable)-[0-9][a-z0-9.-]*)"')


def _claude_resolved_ids(max_files: int = 30, tail_bytes: int = 200_000) -> dict[str, str]:
    """Family → newest concrete model ID seen in recent Claude Code transcripts."""
    root = _home() / ".claude" / "projects"
    try:
        files = sorted(root.glob("*/*.jsonl"), key=lambda p: p.stat().st_mtime, reverse=True)
    except OSError:
        return {}
    out: dict[str, str] = {}
    for path in files[:max_files]:
        try:
            with path.open("rb") as fh:
                size = fh.seek(0, os.SEEK_END)
                fh.seek(max(0, size - tail_bytes))
                text = fh.read().decode("utf-8", "replace")
        except OSError:
            continue
        # Newest file first; within a file the last mention is newest.
        latest: dict[str, str] = {}
        for m in _CLAUDE_ID_RE.finditer(text):
            latest[m.group(2)] = m.group(1)
        for fam, mid in latest.items():
            out.setdefault(fam, mid)
        if len(out) == len(_CLAUDE_ALIASES):
            break
    return out


def _pretty_claude(model_id: str) -> str:
    """claude-opus-5-5 → Opus 5.5; claude-haiku-4-5-20251001 → Haiku 4.5."""
    m = re.match(r"claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$", model_id)
    if not m:
        return model_id
    ver = m.group(2) + (f".{m.group(3)}" if m.group(3) else "")
    return f"{m.group(1).capitalize()} {ver}"


def _claude_code_models(api_models: list[ModelInfo]) -> list[ModelInfo]:
    resolved = _claude_resolved_ids()
    out = []
    for alias, name in _CLAUDE_ALIASES:
        concrete = resolved.get(alias)
        label = f"{_pretty_claude(concrete)} (latest {name})" if concrete else f"{name} (latest)"
        out.append(ModelInfo(alias, label, default=alias == _CLAUDE_DEFAULT_ALIAS))
    out.extend(ModelInfo(m.id, m.label) for m in api_models)
    return out


async def _anthropic_api_models() -> list[ModelInfo]:
    key = os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        return []
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            r = await client.get(
                "https://api.anthropic.com/v1/models",
                params={"limit": 100},
                headers={"x-api-key": key, "anthropic-version": "2023-06-01"},
            )
            r.raise_for_status()
            data = r.json().get("data", [])
    except Exception:
        return []
    # API returns newest first.
    return [ModelInfo(d["id"], d.get("display_name") or d["id"]) for d in data if d.get("id")]


# ── codex ──────────────────────────────────────────────────────────


def _codex_models() -> list[ModelInfo]:
    path = _home() / ".codex" / "models_cache.json"
    try:
        data = json.loads(path.read_text())
    except (OSError, ValueError):
        return []
    rows = [m for m in data.get("models", []) if isinstance(m, dict) and m.get("slug")]
    rows = [m for m in rows if m.get("visibility", "list") == "list"]
    rows.sort(key=lambda m: m.get("priority", 1_000))
    return [
        ModelInfo(m["slug"], m.get("display_name") or m["slug"], default=i == 0)
        for i, m in enumerate(rows)
    ]


# ── kiro-cli ───────────────────────────────────────────────────────


async def _run(argv: list[str], timeout: float) -> str | None:
    try:
        proc = await asyncio.create_subprocess_exec(
            *argv,
            stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
    except OSError:
        return None
    try:
        out, _ = await asyncio.wait_for(proc.communicate(), timeout)
    except TimeoutError:
        proc.kill()
        return None
    return out.decode("utf-8", "replace") if proc.returncode == 0 else None


def parse_kiro_models(text: str) -> list[ModelInfo]:
    """Accepts the JSON shapes kiro-cli has emitted: a list of strings or
    objects, or an object wrapping that list under ``models``."""
    try:
        data = json.loads(text)
    except ValueError:
        return []
    default_id = None
    if isinstance(data, dict):
        default_id = data.get("default_model") or data.get("defaultModel")
        data = data.get("models") or data.get("available_models") or []
    out: list[ModelInfo] = []
    for row in data if isinstance(data, list) else []:
        if isinstance(row, str):
            out.append(ModelInfo(row, row))
        elif isinstance(row, dict):
            mid = row.get("model_id") or row.get("modelId") or row.get("id") or row.get("name")
            if mid:
                label = row.get("model_name") or row.get("display_name") or row.get("name") or mid
                out.append(ModelInfo(mid, label, default=bool(row.get("default"))))
    if default_id:
        for m in out:
            m.default = m.id == default_id
    return out


async def _kiro_models() -> list[ModelInfo]:
    if not shutil.which("kiro-cli"):
        return []
    who = await _run(["kiro-cli", "whoami"], 10)
    if who is None or "not logged in" in who.lower():
        return []
    text = await _run(["kiro-cli", "chat", "--list-models", "--format", "json"], 20)
    return parse_kiro_models(text) if text else []


# ── ollama ─────────────────────────────────────────────────────────


async def _ollama_models() -> list[ModelInfo]:
    from arz.installer import list_installed_ollama_models

    try:
        rows = await list_installed_ollama_models()
    except Exception:
        return []
    return [ModelInfo(r["name"], r["name"], default=i == 0) for i, r in enumerate(rows)]


# ── public ─────────────────────────────────────────────────────────

PROVIDERS = ("claude-code", "anthropic", "codex", "kiro-cli", "gemini", "ollama")


async def _discover(provider: str) -> tuple[list[ModelInfo], str]:
    """Returns (models, source) — source tells the UI how fresh the list is."""
    if provider == "claude-code":
        return _claude_code_models(await _anthropic_api_models()), "cli-aliases"
    if provider == "anthropic":
        api = await _anthropic_api_models()
        if api:
            api[0].default = True
            return api, "api"
        return [ModelInfo(**asdict(m)) for m in _ANTHROPIC_FALLBACK], "fallback"
    if provider == "codex":
        rows = _codex_models()
        return (rows, "cli-cache") if rows else ([], "unavailable")
    if provider == "kiro-cli":
        rows = await _kiro_models()
        return (rows, "cli") if rows else (list(_KIRO_FALLBACK), "fallback")
    if provider == "gemini":
        return list(_GEMINI_ALIASES), "cli-aliases"
    if provider == "ollama":
        return await _ollama_models(), "local"
    return [], "unknown"


_sources: dict[str, str] = {}


async def list_models(provider: str, *, refresh: bool = False) -> list[ModelInfo]:
    hit = _cache.get(provider)
    if hit and not refresh and time.monotonic() - hit[0] < _TTL_S:
        return hit[1]
    models, source = await _discover(provider)
    _cache[provider] = (time.monotonic(), models)
    _sources[provider] = source
    return models


async def catalog(*, refresh: bool = False) -> dict[str, dict]:
    results = await asyncio.gather(*(list_models(p, refresh=refresh) for p in PROVIDERS))
    return {
        p: {"models": [asdict(m) for m in ms], "source": _sources.get(p, "unknown")}
        for p, ms in zip(PROVIDERS, results, strict=True)
    }


async def default_model(provider: str) -> str | None:
    models = await list_models(provider)
    for m in models:
        if m.default:
            return m.id
    return models[0].id if models else None


# Cheap/fast model per provider for side tasks (goal judging, titles).
CHEAP_MODEL: dict[str, str] = {
    "claude-code": "haiku",
    "gemini": "flash-lite",
    "anthropic": "claude-haiku-5-5",
}


def cheap_codex_model() -> str | None:
    rows = _codex_models()
    for m in rows:
        if "mini" in m.id:
            return m.id
    return rows[-1].id if rows else None


_CLAUDE_PINNED_RE = re.compile(r"^claude-(opus|sonnet|haiku|fable)-\d")


def normalize_model(provider: str, model: str | None) -> str:
    """Map a stale saved model ID onto one the provider still serves.

    Sessions and configs persist whatever the picker offered at the time
    (``claude-opus-4-7``); once the CLI retires it every turn hard-fails.
    claude-code pinned IDs become their family alias unless the live API
    list still has them; codex IDs missing from Codex's cache fall back to
    the CLI default (""). Anything we can't judge passes through unchanged.
    """
    model = (model or "").strip()
    if not model:
        return model
    if provider == "claude-code":
        m = _CLAUDE_PINNED_RE.match(model)
        if not m:
            return model
        hit = _cache.get(provider)
        if hit and any(x.id == model for x in hit[1]):
            return model
        return m.group(1)
    if provider == "codex":
        live = _codex_models()
        if live and not any(x.id == model for x in live):
            return ""
    return model
