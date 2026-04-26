"""Hot-reloadable Python tool registry."""

from __future__ import annotations

import importlib.util
import logging
import sys
import threading
import traceback
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Awaitable, Callable

log = logging.getLogger(__name__)

_TOOLS_DIR = Path.home() / ".arz" / "tools"


@dataclass
class ToolSpec:
    name: str
    description: str
    input_schema: dict[str, Any]
    source_path: str
    error: str | None = None
    run: Callable[[dict], Awaitable[str]] | None = None

    def to_public(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "description": self.description,
            "input_schema": self.input_schema,
            "source_path": self.source_path,
            "error": self.error,
        }


class ToolRegistry:
    """Loads tools from a directory; supports manual ``reload()`` for hot updates.

    Module names are prefixed with ``arz_user_tool_`` to avoid colliding with
    anything in ``sys.modules`` and to make removal during reload predictable.
    """

    MODULE_PREFIX = "arz_user_tool_"

    def __init__(self, directory: Path | None = None) -> None:
        self._dir = directory or _TOOLS_DIR
        self._dir.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._tools: dict[str, ToolSpec] = {}
        self.reload()

    @property
    def directory(self) -> Path:
        return self._dir

    def list(self) -> list[ToolSpec]:
        return sorted(self._tools.values(), key=lambda t: t.name)

    def get(self, name: str) -> ToolSpec | None:
        return self._tools.get(name)

    def reload(self) -> int:
        """Re-scan the tools directory. Returns the number of tools loaded."""
        with self._lock:
            # Drop any prior modules so file changes take effect on next import
            for mod_name in list(sys.modules):
                if mod_name.startswith(self.MODULE_PREFIX):
                    del sys.modules[mod_name]

            tools: dict[str, ToolSpec] = {}
            for path in sorted(self._dir.glob("*.py")):
                if path.name.startswith("_"):
                    continue
                spec = self._load_one(path)
                if spec is not None:
                    if spec.name in tools:
                        log.warning("Duplicate tool name %r — keeping %s", spec.name, path)
                    tools[spec.name] = spec
            self._tools = tools
            return len(self._tools)

    def _load_one(self, path: Path) -> ToolSpec | None:
        mod_name = f"{self.MODULE_PREFIX}{path.stem}"
        try:
            mod_spec = importlib.util.spec_from_file_location(mod_name, str(path))
            if mod_spec is None or mod_spec.loader is None:
                return None
            module = importlib.util.module_from_spec(mod_spec)
            sys.modules[mod_name] = module
            mod_spec.loader.exec_module(module)
        except Exception:
            log.exception("Failed to load tool module %s", path)
            return ToolSpec(
                name=path.stem,
                description=f"(failed to load: see error)",
                input_schema={},
                source_path=str(path),
                error=traceback.format_exc(limit=3),
            )

        raw_spec = getattr(module, "tool_spec", None)
        if not isinstance(raw_spec, dict):
            return ToolSpec(
                name=path.stem,
                description="(missing tool_spec dict)",
                input_schema={},
                source_path=str(path),
                error="module is missing tool_spec",
            )
        run_fn = getattr(module, "run", None)
        return ToolSpec(
            name=str(raw_spec.get("name", path.stem)),
            description=str(raw_spec.get("description", "")),
            input_schema=raw_spec.get("input_schema", {}),
            source_path=str(path),
            run=run_fn if callable(run_fn) else None,
            error=None if callable(run_fn) else "module is missing async run(input)",
        )

    async def invoke(self, name: str, payload: dict) -> str:
        """Invoke a tool by name. Raises if not found or run is missing."""
        tool = self.get(name)
        if tool is None:
            raise KeyError(f"unknown tool {name!r}")
        if tool.run is None:
            raise RuntimeError(f"tool {name!r} has no run() callable")
        return await tool.run(payload)
