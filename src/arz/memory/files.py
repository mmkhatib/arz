"""Persistent memory files at ~/.arz/memory/.

Files:
    preferences.md  — durable user preferences (style, dont-do-X, tone).
    projects.md     — active projects, deadlines, ownership.
    history/YYYY-MM-DD.md  — daily summaries.

Auto-injects preferences (cap 1k chars) and projects (cap 2k chars) into
every chat turn via render_for_prompt().
"""

from __future__ import annotations

from datetime import date
from pathlib import Path

_DIR = Path.home() / ".arz" / "memory"
_PREF_CAP = 1000
_PROJ_CAP = 2000
_MEM_CAP = 2000

_DEFAULT_PREFERENCES = """\
# Preferences

Durable user preferences that auto-inject into every turn (capped at ~1k chars).
Edit freely. One short bullet per line.

- example: I prefer terse responses with no trailing summaries
- example: when refactoring, prefer one bundled PR over many small ones
"""

_DEFAULT_PROJECTS = """\
# Active projects

What's currently in flight (capped at ~2k chars). Edit freely.

- example: arz — multi-provider agent runtime
"""


def _ensure_defaults() -> None:
    _DIR.mkdir(parents=True, exist_ok=True)
    (_DIR / "history").mkdir(parents=True, exist_ok=True)
    pref = _DIR / "preferences.md"
    if not pref.exists():
        pref.write_text(_DEFAULT_PREFERENCES, encoding="utf-8")
    proj = _DIR / "projects.md"
    if not proj.exists():
        proj.write_text(_DEFAULT_PROJECTS, encoding="utf-8")


class MemoryFiles:
    def __init__(self) -> None:
        _ensure_defaults()
        self._dir = _DIR

    @property
    def base_dir(self) -> Path:
        return self._dir

    def read(self, name: str) -> str:
        p = self._safe_path(name)
        if not p.exists():
            return ""
        return p.read_text(encoding="utf-8")

    def write(self, name: str, content: str) -> None:
        p = self._safe_path(name)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content, encoding="utf-8")

    def list_history(self) -> list[str]:
        hd = self._dir / "history"
        if not hd.exists():
            return []
        return sorted(p.name for p in hd.glob("*.md"))

    def append_history(self, entry: str) -> Path:
        hd = self._dir / "history"
        hd.mkdir(parents=True, exist_ok=True)
        today = hd / f"{date.today().isoformat()}.md"
        prev = today.read_text(encoding="utf-8") if today.exists() else ""
        sep = "\n\n---\n\n" if prev else ""
        today.write_text(prev + sep + entry.strip() + "\n", encoding="utf-8")
        return today

    def render_for_prompt(self) -> str:
        out: list[str] = []
        pref = self.read("preferences.md").strip()
        if pref:
            if len(pref) > _PREF_CAP:
                pref = pref[:_PREF_CAP] + "…"
            out.append(f"<preferences>\n{pref}\n</preferences>")
        proj = self.read("projects.md").strip()
        if proj:
            if len(proj) > _PROJ_CAP:
                proj = proj[:_PROJ_CAP] + "…"
            out.append(f"<projects>\n{proj}\n</projects>")
        mem = self.read("memory.md").strip()
        if mem:
            if len(mem) > _MEM_CAP:
                # Tail-cap so the most recent self-written memories survive.
                mem = "…" + mem[-_MEM_CAP:]
            out.append(f"<memory_notes>\n{mem}\n</memory_notes>")
        return "\n\n".join(out)

    def _safe_path(self, name: str) -> Path:
        if name in ("preferences.md", "projects.md", "memory.md"):
            return self._dir / name
        if name.startswith("history/") and name.endswith(".md") and "/" not in name[len("history/"):]:
            return self._dir / name
        raise ValueError(f"refusing to access memory file {name!r}")


_singleton: MemoryFiles | None = None


def get_memory_files() -> MemoryFiles:
    global _singleton
    if _singleton is None:
        _singleton = MemoryFiles()
    return _singleton
