"""MarkdownStore — file-based memory using ~/.arz/memory/<key>.md."""

from __future__ import annotations

import re
from pathlib import Path

from arz.memory.store import MemoryStore

_MEMORY_DIR = Path.home() / ".arz" / "memory"


def _safe_name(key: str) -> str:
    """Sanitize key to a safe filename (no path traversal)."""
    return re.sub(r"[^a-zA-Z0-9_\-]", "_", key)[:128]


class MarkdownStore(MemoryStore):
    """Stores each memory entry as a markdown file on disk."""

    def __init__(self, directory: Path | None = None) -> None:
        self._dir = directory or _MEMORY_DIR
        self._dir.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> Path:
        return self._dir / f"{_safe_name(key)}.md"

    def save(self, key: str, content: str) -> None:
        self._path(key).write_text(content, encoding="utf-8")

    def load(self, key: str) -> str | None:
        p = self._path(key)
        return p.read_text(encoding="utf-8") if p.exists() else None

    def list(self) -> list[str]:
        return [p.stem for p in sorted(self._dir.glob("*.md"))]

    def search(self, query: str, k: int = 5) -> list[tuple[str, str]]:
        """Naive keyword search across all markdown files."""
        terms = query.lower().split()
        results: list[tuple[int, str, str]] = []
        for key in self.list():
            content = self.load(key) or ""
            score = sum(content.lower().count(t) for t in terms)
            if score > 0:
                results.append((score, key, content))
        results.sort(reverse=True)
        return [(key, content) for _, key, content in results[:k]]
