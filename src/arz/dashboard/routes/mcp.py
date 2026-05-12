"""MCP servers — read + install + register."""

from __future__ import annotations

import asyncio
import json
import os
import re
import shutil
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from arz.dashboard.token_auth import require_token

router = APIRouter(dependencies=[Depends(require_token)])

_OVERRIDES_PATH = Path.home() / ".arz" / "mcp_overrides.json"

_MCP_SOURCES = [
    ("claude", Path.home() / ".claude" / "mcp.json"),
    ("kiro", Path.home() / ".kiro" / "mcp.json"),
]


class McpServer(BaseModel):
    name: str
    command: str = ""
    args: list[str] = []
    env: dict[str, str] = {}
    source: str
    enabled: bool = True
    # Human-readable description shown on the card. Either user-supplied
    # at install time or auto-derived from the source URL.
    description: str = ""
    # Original URL/source string (git URL, npm package, local path) so the
    # capabilities card can link out to the project. Empty for entries
    # that come from ~/.claude or ~/.kiro (no install metadata).
    source_url: str = ""


def _load_overrides() -> dict[str, bool]:
    if _OVERRIDES_PATH.exists():
        try:
            return json.loads(_OVERRIDES_PATH.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {}


def _save_overrides(overrides: dict[str, bool]) -> None:
    _OVERRIDES_PATH.parent.mkdir(parents=True, exist_ok=True)
    _OVERRIDES_PATH.write_text(json.dumps(overrides, indent=2), encoding="utf-8")


def _browseable_url(src: str) -> str:
    """Turn an install source into something you can open in a browser.

    Strips ``.git``, turns ``npm:pkg`` into the npmjs.com page, and leaves
    bare HTTPS URLs alone. Returns "" for local paths (no remote to link).
    """
    s = (src or "").strip()
    if not s:
        return ""
    if s.startswith(("http://", "https://")):
        return s[:-4] if s.endswith(".git") else s
    if s.startswith("npm:"):
        pkg = s[4:].lstrip("/")
        return f"https://www.npmjs.com/package/{pkg}"
    return ""


def _autodescribe(src: str, kind: str) -> str:
    if not src:
        return ""
    if kind == "npm" or src.startswith("npm:"):
        pkg = src.removeprefix("npm:") or src
        return f"npm package: {pkg}"
    if src.startswith(("http://", "https://")):
        return f"From {src.rsplit('/', 1)[-1].removesuffix('.git')}"
    if kind == "local":
        return f"Local: {src}"
    return ""


def _collect_from_dict(
    source: str, mcp_servers: dict, overrides: dict[str, bool]
) -> list[McpServer]:
    out: list[McpServer] = []
    for name, cfg in mcp_servers.items():
        if not isinstance(cfg, dict):
            continue
        key = f"{source}:{name}"
        out.append(
            McpServer(
                name=name,
                command=cfg.get("command", ""),
                args=cfg.get("args", []),
                env=cfg.get("env", {}),
                source=source,
                enabled=overrides.get(key, True),
            )
        )
    return out


@router.get("/api/mcp/servers", response_model=list[McpServer])
async def list_mcp_servers() -> list[McpServer]:
    overrides = _load_overrides()
    servers: list[McpServer] = []

    # Original two locations (kept for completeness)
    for source, path in _MCP_SOURCES:
        if not path.exists():
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        servers.extend(_collect_from_dict(source, data.get("mcpServers", {}), overrides))

    # Arz-managed registry (installed via the UI/API)
    reg = _load_registry()
    for nm, cfg in (reg.get("servers") or {}).items():
        src_url = cfg.get("source") or ""
        servers.append(
            McpServer(
                name=nm,
                command=cfg.get("command", ""),
                args=cfg.get("args", []) or [],
                env=cfg.get("env", {}) or {},
                source="arz",
                enabled=overrides.get(f"arz:{nm}", True),
                description=cfg.get("description") or _autodescribe(src_url, cfg.get("kind") or ""),
                source_url=_browseable_url(src_url),
            )
        )

    # Claude Code's real config: ~/.claude.json (global + per-project)
    claude_json = Path.home() / ".claude.json"
    if claude_json.exists():
        try:
            data = json.loads(claude_json.read_text(encoding="utf-8"))
        except Exception:
            data = {}
        servers.extend(_collect_from_dict("claude", data.get("mcpServers", {}) or {}, overrides))
        for proj_path, proj_cfg in (data.get("projects") or {}).items():
            if not isinstance(proj_cfg, dict):
                continue
            proj_servers = proj_cfg.get("mcpServers", {}) or {}
            if proj_servers:
                src = f"claude:{Path(proj_path).name}"
                servers.extend(_collect_from_dict(src, proj_servers, overrides))

    return servers


@router.post("/api/mcp/servers/{source}/{name}/toggle", response_model=McpServer)
async def toggle_mcp_server(source: str, name: str) -> McpServer:
    overrides = _load_overrides()
    key = f"{source}:{name}"
    overrides[key] = not overrides.get(key, True)
    _save_overrides(overrides)

    # Re-run the full listing so the returned record carries every field
    # (command, args, description, source_url) that the card needs — not
    # just the toggled bit. Otherwise toggling blanks out the card body.
    servers = await list_mcp_servers()
    for s in servers:
        if s.source == source and s.name == name:
            return s
    # Fallback if the source disappeared between toggle and re-list.
    return McpServer(name=name, source=source, enabled=overrides[key])


# ── MCP install from a git repo / npm package / local path ──────────────────


_INSTALL_DIR = Path.home() / ".arz" / "mcp_servers"
_REGISTRY_PATH = Path.home() / ".arz" / "mcp_registry.json"


def _slugify(s: str) -> str:
    out = re.sub(r"[^a-zA-Z0-9_\-]+", "-", s.strip()).strip("-").lower()
    return out[:60] or "mcp"


def _name_from_source(source: str) -> str:
    """Derive a registry name from the source string, with no friendly-name override.

    - ``npm:@scope/pkg`` → ``scope-pkg`` (preserves both halves)
    - ``npm:pkg`` → ``pkg``
    - ``https://host/owner/repo.git`` → ``repo``
    - ``https://host/owner/repo`` → ``repo``
    - ``/abs/path/to/dir`` → ``dir``
    - anything else → slugified whole string
    """
    s = source.strip()
    if s.startswith("npm:"):
        pkg = s[4:].lstrip("/")
        if pkg.startswith("@") and "/" in pkg:
            scope, name = pkg.split("/", 1)
            return _slugify(f"{scope.lstrip('@')}-{name}")
        return _slugify(pkg)
    if s.startswith(("http://", "https://")):
        last = s.rsplit("/", 1)[-1]
        if last.endswith(".git"):
            last = last[:-4]
        return _slugify(last) or "mcp"
    if s.startswith(("/", "~")) or s.startswith("./"):
        from pathlib import Path as _P

        return _slugify(_P(s).expanduser().resolve().name)
    return _slugify(s)


def _load_registry() -> dict:
    if not _REGISTRY_PATH.exists():
        return {"servers": {}}
    try:
        return json.loads(_REGISTRY_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {"servers": {}}


def _save_registry(reg: dict) -> None:
    _REGISTRY_PATH.parent.mkdir(parents=True, exist_ok=True)
    _REGISTRY_PATH.write_text(json.dumps(reg, indent=2), encoding="utf-8")


@router.get("/api/mcp/registry")
async def get_registry() -> dict:
    return _load_registry()


@router.post("/api/mcp/install")
async def install_mcp(request: Request) -> StreamingResponse:
    """Install an MCP server from a git URL, an npm package, or a local path.

    Body: { source: str, name?: str, command?: str, args?: list[str], env?: dict }
        - source: "https://github.com/.../foo.git" | "npm:@scope/pkg" | "/abs/path"
        - name: friendly server name (slug)
        - command/args/env: how to launch the server (defaults inferred when possible)
    """
    body = await request.json()
    source = (body.get("source") or "").strip()
    if not source:
        raise HTTPException(status_code=422, detail="source required")
    # Always derive name from the source; the UI no longer offers a
    # friendly-name override. Body field ``name`` is ignored.
    name = _name_from_source(source)
    command = (body.get("command") or "").strip()
    args = body.get("args") or []
    env = body.get("env") or {}
    description = (body.get("description") or "").strip()
    if not isinstance(args, list) or not isinstance(env, dict):
        raise HTTPException(status_code=422, detail="args must be list, env must be object")

    _INSTALL_DIR.mkdir(parents=True, exist_ok=True)
    target_dir = _INSTALL_DIR / name

    async def gen():
        async def run(argv: list[str], cwd: Path | None = None):
            """Async generator yielding output lines from a subprocess.

            Resolves argv[0] via shutil.which so Windows .cmd / .bat
            shims (npm.cmd, git.cmd, npx.cmd) are picked up — asyncio
            create_subprocess_exec doesn't run PATHEXT lookup itself.
            """
            resolved = shutil.which(argv[0]) or argv[0]
            display = " ".join(argv)
            yield f"$ {display}\n"
            try:
                proc = await asyncio.create_subprocess_exec(
                    resolved,
                    *argv[1:],
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.STDOUT,
                    cwd=str(cwd) if cwd else None,
                    env={**os.environ},
                )
            except FileNotFoundError:
                yield f"error: {argv[0]!r} not on PATH — install it and retry\n"
                yield "[exit 127]\n"
                return
            assert proc.stdout
            while True:
                line = await proc.stdout.readline()
                if not line:
                    break
                yield line.decode(errors="replace")
            rc = await proc.wait()
            yield f"[exit {rc}]\n"

        # Determine install kind
        kind: str
        cmd_default: str = command
        args_default: list[str] = list(args)
        if (
            source.startswith(("http://", "https://"))
            and source.endswith(".git")
            or source.startswith(("http://", "https://"))
        ):
            kind = "git"
        elif source.startswith("npm:"):
            kind = "npm"
        elif source.startswith("/") or source.startswith("~"):
            kind = "local"
        else:
            kind = "git"  # best guess

        try:
            if kind == "git":
                if target_dir.exists():
                    yield f"updating existing clone at {target_dir}\n"
                    async for line in run(["git", "-C", str(target_dir), "pull", "--ff-only"]):
                        yield line
                else:
                    if not shutil.which("git"):
                        yield "error: git not on PATH\n"
                        return
                    async for line in run(
                        ["git", "clone", "--depth", "1", source, str(target_dir)]
                    ):
                        yield line
                # Install: package.json → npm install; pyproject/uv → uv sync; requirements.txt → pip install
                if (target_dir / "package.json").exists() and shutil.which("npm"):
                    async for line in run(["npm", "install"], cwd=target_dir):
                        yield line
                elif (target_dir / "pyproject.toml").exists() and shutil.which("uv"):
                    async for line in run(["uv", "sync"], cwd=target_dir):
                        yield line
                elif (target_dir / "requirements.txt").exists() and shutil.which("pip"):
                    async for line in run(
                        ["pip", "install", "-r", "requirements.txt"], cwd=target_dir
                    ):
                        yield line
                if not cmd_default:
                    # Best-guess launcher
                    if (target_dir / "package.json").exists():
                        cmd_default = "npx"
                        args_default = ["-y", str(target_dir)]
                    elif (target_dir / "pyproject.toml").exists() and shutil.which("uv"):
                        cmd_default = "uv"
                        args_default = [
                            "run",
                            "--directory",
                            str(target_dir),
                            "python",
                            "-m",
                            name.replace("-", "_"),
                        ]

            elif kind == "npm":
                pkg = source[len("npm:") :]
                if not shutil.which("npm"):
                    yield "error: npm not on PATH\n"
                    return
                async for line in run(["npm", "install", "-g", pkg]):
                    yield line
                if not cmd_default:
                    cmd_default = "npx"
                    args_default = ["-y", pkg]

            elif kind == "local":
                src_path = Path(os.path.expanduser(source)).resolve()
                if not src_path.exists():
                    yield f"error: local path {src_path} does not exist\n"
                    return
                if not cmd_default:
                    if (src_path / "package.json").exists():
                        cmd_default = "npx"
                        args_default = ["-y", str(src_path)]
                    elif (src_path / "pyproject.toml").exists() and shutil.which("uv"):
                        cmd_default = "uv"
                        args_default = [
                            "run",
                            "--directory",
                            str(src_path),
                            "python",
                            "-m",
                            name.replace("-", "_"),
                        ]

            if not cmd_default:
                yield "warning: couldn't infer a launch command — set 'command' in the install request explicitly.\n"
        except Exception as e:
            yield f"error during install steps: {e}\n"

        # Register no matter what — even if `npm install` failed, the
        # clone is on disk and the user might want to fix deps manually
        # rather than start over. Without this, the page never shows
        # the server. Toggle off in /capabilities to disable.
        try:
            reg = _load_registry()
            reg.setdefault("servers", {})
            reg["servers"][name] = {
                "name": name,
                "source": source,
                "kind": kind,
                "directory": str(target_dir) if kind in ("git", "local") else None,
                "command": cmd_default,
                "args": args_default,
                "env": env,
                "description": description or _autodescribe(source, kind),
            }
            _save_registry(reg)
            yield f"\n✓ registered MCP server '{name}'\n"
            yield f"command: {cmd_default} {' '.join(args_default)}\n"
            yield "Refresh /capabilities to see it. It'll show up under source: arz.\n"
        except Exception as e:
            yield f"error writing registry: {e}\n"

    return StreamingResponse(gen(), media_type="text/plain")


@router.delete("/api/mcp/registry/{name}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_registry_entry(name: str) -> None:
    reg = _load_registry()
    if name in reg.get("servers", {}):
        # Remove the cloned/installed dir if it lives under our managed directory
        entry = reg["servers"][name]
        d = entry.get("directory")
        if d and Path(d).resolve().is_relative_to(_INSTALL_DIR.resolve()):
            shutil.rmtree(d, ignore_errors=True)
        del reg["servers"][name]
        _save_registry(reg)
        return
    raise HTTPException(status_code=404, detail="not in registry")
