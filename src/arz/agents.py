"""AgentRegistry — named provider+config presets stored in ~/.arz/agents/{name}.json."""

from __future__ import annotations

import json
import re
from pathlib import Path

from pydantic import BaseModel


class AgentConfig(BaseModel):
    name: str
    provider: str = "claude-code"
    model: str = ""
    work_dir: str = ""
    system_prompt: str = ""
    approval_mode: str = "normal"
    tool_allowlist: list[str] = []
    description: str = ""
    is_default: bool = False


def _safe_name(name: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_\-]", "_", name)[:128]


class AgentRegistry:
    def __init__(self, directory: Path | None = None) -> None:
        self._dir = directory or (Path.home() / ".arz" / "agents")
        self._dir.mkdir(parents=True, exist_ok=True)

    def _path(self, name: str) -> Path:
        return self._dir / f"{_safe_name(name)}.json"

    def list(self) -> list[AgentConfig]:
        agents: list[AgentConfig] = []
        for p in sorted(self._dir.glob("*.json")):
            try:
                agents.append(AgentConfig(**json.loads(p.read_text(encoding="utf-8"))))
            except Exception:
                pass
        return agents

    def get(self, name: str) -> AgentConfig | None:
        p = self._path(name)
        if not p.exists():
            return None
        try:
            return AgentConfig(**json.loads(p.read_text(encoding="utf-8")))
        except Exception:
            return None

    def save(self, agent: AgentConfig) -> None:
        if agent.is_default:
            for existing in self.list():
                if existing.name != agent.name and existing.is_default:
                    existing.is_default = False
                    self._path(existing.name).write_text(
                        existing.model_dump_json(indent=2), encoding="utf-8"
                    )
        self._path(agent.name).write_text(agent.model_dump_json(indent=2), encoding="utf-8")

    def delete(self, name: str) -> bool:
        p = self._path(name)
        if p.exists():
            p.unlink()
            return True
        return False
