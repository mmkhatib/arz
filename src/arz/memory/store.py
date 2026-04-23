"""MemoryStore ABC — pluggable memory backends."""

from __future__ import annotations

from abc import ABC, abstractmethod


class MemoryStore(ABC):
    """Abstract persistent key-value + search memory."""

    @abstractmethod
    def save(self, key: str, content: str) -> None:
        """Persist content under key."""

    @abstractmethod
    def load(self, key: str) -> str | None:
        """Load content by key, or None if not found."""

    @abstractmethod
    def list(self) -> list[str]:
        """Return all known keys."""

    @abstractmethod
    def search(self, query: str, k: int = 5) -> list[tuple[str, str]]:
        """Return up to k (key, content) pairs most relevant to query."""
