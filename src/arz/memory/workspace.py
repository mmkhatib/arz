"""Workspace scoping for the memory layer.

MeshClaw blueprint §1.7: different projects/teams shouldn't pollute each
other's preferences. One memory dir per workspace.

Default workspace = ``"default"`` so existing single-workspace installs
keep their on-disk paths exactly where they are (``~/.arz/memory/``,
``~/.arz/memory.db``). Switching to a named workspace remaps both
markdown + sqlite paths to ``~/.arz/workspace/<name>/...``.

The active workspace is held in module state — switched at runtime via
``set_active_workspace()`` from the dashboard or surface manager. Never
read from a config file at import time so a single gateway can host
multiple users on different workspaces over time.
"""

from __future__ import annotations

import re
from pathlib import Path

import structlog

log = structlog.get_logger(__name__)

_DEFAULT = "default"
_active: str = _DEFAULT
_NAME_RE = re.compile(r"^[a-z0-9][a-z0-9_-]*$")


def get_active_workspace() -> str:
    return _active


def set_active_workspace(name: str) -> str:
    """Switch the active workspace. Name must be lowercase alphanumeric
    + underscore/hyphen — anything else falls back to 'default'.

    Returns the name that actually got set so callers can echo back what
    landed (rather than what they asked for).
    """
    global _active
    name = (name or "").strip().lower()
    if not name or not _NAME_RE.match(name):
        log.warning("invalid workspace name; falling back to 'default'", asked=name)
        _active = _DEFAULT
    else:
        _active = name
    return _active


def memory_dir() -> Path:
    """Path of the markdown memory directory for the active workspace.

    The default workspace keeps the legacy ``~/.arz/memory/`` location so
    existing installs aren't disrupted. Named workspaces land under
    ``~/.arz/workspace/<name>/memory/``.
    """
    if _active == _DEFAULT:
        return Path.home() / ".arz" / "memory"
    return Path.home() / ".arz" / "workspace" / _active / "memory"


def db_path() -> Path:
    """Path of the sqlite memory.db for the active workspace.

    Same default-vs-named split as ``memory_dir``.
    """
    if _active == _DEFAULT:
        return Path.home() / ".arz" / "memory.db"
    return Path.home() / ".arz" / "workspace" / _active / "memory.db"


def list_workspaces() -> list[str]:
    """All known workspace names — `default` + every dir under
    ``~/.arz/workspace/``."""
    out = [_DEFAULT]
    root = Path.home() / ".arz" / "workspace"
    if root.exists():
        for p in sorted(root.iterdir()):
            if p.is_dir() and p.name != _DEFAULT:
                out.append(p.name)
    return out
