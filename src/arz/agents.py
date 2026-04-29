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


_SEED_AGENTS: list[AgentConfig] = [
    AgentConfig(
        name="general",
        description="Balanced general-purpose assistant — defaults to Claude Code with normal approvals.",
        provider="claude-code",
        approval_mode="normal",
        is_default=True,
    ),
    AgentConfig(
        name="code-reviewer",
        description="Reviews diffs and PRs for bugs, security, and style. Read-mostly so trust_reads is sane.",
        provider="claude-code",
        approval_mode="trust_reads",
        system_prompt=(
            "You are a senior code reviewer. Read the changed files, identify bugs, "
            "security issues, performance pitfalls, and style/architecture concerns. "
            "Quote specific lines. Be concise and actionable. Don't rewrite the change "
            "unless asked — point at the problem and recommend a fix."
        ),
    ),
    AgentConfig(
        name="test-writer",
        description="Writes unit and integration tests for existing code with minimal scaffolding.",
        provider="claude-code",
        approval_mode="trust_reads",
        system_prompt=(
            "You write tests, not features. Read the target code, understand its public "
            "API and edge cases, then add tests that match the project's existing testing "
            "framework and conventions. Cover the golden path plus the obvious edge cases. "
            "Don't introduce new dependencies."
        ),
    ),
    AgentConfig(
        name="bug-fixer",
        description="Reproduces, isolates, and fixes a reported bug. Treats root cause, not symptom.",
        provider="claude-code",
        approval_mode="normal",
        system_prompt=(
            "You are debugging. First reproduce the bug or read the failing test/log, "
            "then locate the root cause — not the symptom. Propose a minimal fix and "
            "verify it. If you can't reproduce, ask for the missing context before changing code."
        ),
    ),
    AgentConfig(
        name="architect",
        description="Plans implementations and weighs trade-offs without writing code. Read-only mode.",
        provider="claude-code",
        approval_mode="trust_reads",
        system_prompt=(
            "You are a software architect. Read the relevant code, then produce an "
            "implementation plan: critical files to change, ordering, risks, and trade-offs. "
            "Don't write code unless explicitly asked — your output is design, not patches."
        ),
    ),
    AgentConfig(
        name="researcher",
        description="Investigates a question across the codebase, the web, and docs. Reports findings.",
        provider="claude-code",
        approval_mode="trust_reads",
        system_prompt=(
            "You are researching, not coding. Search files, the web, and any available "
            "docs to answer the user's question. Cite sources (file:line for code, URLs "
            "for the web). Distinguish what you've verified from what you're inferring."
        ),
    ),
    AgentConfig(
        name="refactorer",
        description="Performs targeted refactors without changing behavior. Tests must keep passing.",
        provider="claude-code",
        approval_mode="normal",
        system_prompt=(
            "You refactor: improve structure without changing behavior. Run the tests "
            "before and after to prove behavior is preserved. Don't expand scope — if "
            "you spot an unrelated issue, mention it but don't fix it."
        ),
    ),
    AgentConfig(
        name="security-auditor",
        description="Looks for vulns: injection, auth, secret leaks, dependency CVEs, etc.",
        provider="claude-code",
        approval_mode="trust_reads",
        system_prompt=(
            "You are a security reviewer. Hunt for common classes of vulnerability: "
            "injection (SQL/cmd/template), broken auth, hard-coded secrets, unsafe "
            "deserialization, SSRF, path traversal, race conditions, and outdated "
            "dependencies. Report findings with severity, file:line, and a fix sketch."
        ),
    ),
    AgentConfig(
        name="docs-writer",
        description="Writes or updates READMEs, docstrings, and inline docs based on the actual code.",
        provider="claude-code",
        approval_mode="trust_reads",
        system_prompt=(
            "You write documentation that matches the code. Read what's actually there "
            "before writing — don't invent APIs. Match the project's existing voice. "
            "Be direct: explain what something does and why a user would care, not "
            "implementation trivia."
        ),
    ),
    AgentConfig(
        name="codex",
        description="OpenAI Codex CLI — autonomous coding agent for hands-off iteration.",
        provider="codex",
        model="gpt-5.4",
        approval_mode="yolo",
    ),
]


class AgentRegistry:
    def __init__(self, directory: Path | None = None) -> None:
        self._dir = directory or (Path.home() / ".arz" / "agents")
        self._dir.mkdir(parents=True, exist_ok=True)
        self._seed_if_empty()

    def _seed_if_empty(self) -> None:
        marker = self._dir / ".seeded"
        if marker.exists():
            return
        if any(self._dir.glob("*.json")):
            marker.write_text("", encoding="utf-8")
            return
        for agent in _SEED_AGENTS:
            self._path(agent.name).write_text(agent.model_dump_json(indent=2), encoding="utf-8")
        marker.write_text("", encoding="utf-8")

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
