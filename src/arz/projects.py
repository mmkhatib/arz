"""Project store — folders under ~/.arz/projects/<id>/ that group a
brief, a task list, and a memory namespace under one umbrella.

Each project has a 1:1 link to a Channel (channel_id). Sessions can be
tagged with a project_id so the activity rail can roll up artifacts
across them.
"""

from __future__ import annotations

import json
import re
import time
import uuid
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Literal

_ROOT = Path.home() / ".arz" / "projects"


def default_workspace_root() -> Path:
    """Where new project workspaces land when the user doesn't pick one.

    Picks the directory next to the running arz checkout so the
    orchestrator never modifies the arz source itself. For example,
    when arz is at ``~/workspace/arz``, projects default to
    ``~/workspace/projects/<slug>/``.

    Falls back to ``~/projects`` when the arz install isn't laid out
    that way (e.g. installed via pip into site-packages).
    """
    here = Path(__file__).resolve()
    # ``arz/projects.py`` → src/arz/projects.py → walk up to repo root
    candidates = [here.parent.parent.parent, here.parent.parent]
    for cand in candidates:
        if (cand / "pyproject.toml").exists() or (cand / "src" / "arz").exists():
            sibling = cand.parent / "projects"
            return sibling
    return Path.home() / "projects"


ProjectStatus = Literal["active", "paused", "done", "archived"]
TaskStatus = Literal["planned", "in_progress", "blocked", "done", "failed"]


@dataclass
class Task:
    id: str
    title: str
    status: TaskStatus = "planned"
    assignee: str | None = None  # @agent name without the @
    description: str = ""
    depends_on: list[str] = field(default_factory=list)
    artifacts: list[str] = field(default_factory=list)
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)
    started_at: float | None = None
    finished_at: float | None = None


@dataclass
class Project:
    id: str
    name: str
    brief: str = ""
    repo_path: str = ""
    status: ProjectStatus = "active"
    channel_id: str | None = None
    tasks: list[Task] = field(default_factory=list)
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)
    # PM-drafted, user-editable success criteria
    success_criteria: list[str] = field(default_factory=list)
    # Walk-away mode config
    autopilot_idle_s: int = 0  # 0 = disabled
    autopilot_max_iterations: int = 50
    autopilot_iterations: int = 0
    budget_tokens: int = 0  # 0 = no cap
    budget_usd_cents: int = 0  # 0 = no cap
    spent_tokens: int = 0
    spent_usd_cents: int = 0
    max_concurrent_subagents: int = 2

    def open_tasks(self) -> int:
        return sum(1 for t in self.tasks if t.status in ("planned", "in_progress", "blocked"))


def _slug(name: str) -> str:
    s = re.sub(r"[^a-zA-Z0-9]+", "-", name.strip().lower()).strip("-")
    return s[:48] or uuid.uuid4().hex[:8]


def _serialize(p: Project) -> dict:
    d = asdict(p)
    return d


def _deserialize(d: dict) -> Project:
    raw_tasks = d.get("tasks") or []
    tasks = [Task(**t) for t in raw_tasks if isinstance(t, dict)]
    fields = {k: v for k, v in d.items() if k != "tasks"}
    fields["tasks"] = tasks
    return Project(**fields)


class ProjectStore:
    """Filesystem-backed store. Each project lives at
    ``~/.arz/projects/<id>/project.json`` with a sibling ``brief.md``,
    ``memory/`` directory, and ``artifacts/`` directory created on
    first save."""

    def __init__(self, root: Path | None = None) -> None:
        self.root = root or _ROOT

    def _project_dir(self, project_id: str) -> Path:
        return self.root / project_id

    def _project_file(self, project_id: str) -> Path:
        return self._project_dir(project_id) / "project.json"

    def _scaffold(self, project_id: str) -> None:
        d = self._project_dir(project_id)
        d.mkdir(parents=True, exist_ok=True)
        (d / "memory").mkdir(exist_ok=True)
        (d / "artifacts").mkdir(exist_ok=True)
        brief = d / "brief.md"
        if not brief.exists():
            brief.write_text(
                "# Project brief\n\n_Orchestrator updates this file as the project evolves._\n",
                encoding="utf-8",
            )

    def list(self) -> list[Project]:
        if not self.root.exists():
            return []
        out: list[Project] = []
        for d in sorted(self.root.iterdir()):
            if not d.is_dir():
                continue
            f = d / "project.json"
            if not f.exists():
                continue
            try:
                out.append(_deserialize(json.loads(f.read_text(encoding="utf-8"))))
            except Exception:
                continue
        return out

    def get(self, project_id: str) -> Project | None:
        f = self._project_file(project_id)
        if not f.exists():
            return None
        try:
            return _deserialize(json.loads(f.read_text(encoding="utf-8")))
        except Exception:
            return None

    def get_by_channel(self, channel_id: str) -> Project | None:
        for p in self.list():
            if p.channel_id == channel_id:
                return p
        return None

    def create(self, name: str, brief: str = "", repo_path: str = "") -> Project:
        self.root.mkdir(parents=True, exist_ok=True)
        pid = _slug(name)
        if self._project_file(pid).exists():
            pid = f"{pid}-{uuid.uuid4().hex[:6]}"
        self._scaffold(pid)
        # If the user didn't pick a folder, drop one next to the arz
        # checkout so subagents have a real working directory and never
        # touch the arz source. Created on demand.
        final_repo = repo_path.strip() if repo_path else ""
        if not final_repo:
            ws = default_workspace_root() / pid
            try:
                ws.mkdir(parents=True, exist_ok=True)
            except Exception:
                pass
            final_repo = str(ws)
        p = Project(id=pid, name=name.strip()[:120], brief=brief, repo_path=final_repo)
        self.save(p)
        return p

    def save(self, p: Project) -> Project:
        self._scaffold(p.id)
        p.updated_at = time.time()
        self._project_file(p.id).write_text(
            json.dumps(_serialize(p), indent=2, default=str),
            encoding="utf-8",
        )
        if p.brief:
            (self._project_dir(p.id) / "brief.md").write_text(p.brief, encoding="utf-8")
        return p

    def delete(self, project_id: str) -> bool:
        d = self._project_dir(project_id)
        if not d.exists():
            return False
        trash = self.root / ".trash"
        trash.mkdir(parents=True, exist_ok=True)
        target = trash / f"{project_id}-{int(time.time())}"
        d.rename(target)
        return True

    # ── tasks ────────────────────────────────────────────────────────
    def add_task(self, project_id: str, task: Task) -> Project | None:
        p = self.get(project_id)
        if not p:
            return None
        if any(t.id == task.id for t in p.tasks):
            return p
        p.tasks.append(task)
        return self.save(p)

    def update_task(self, project_id: str, task_id: str, **changes: object) -> Project | None:
        p = self.get(project_id)
        if not p:
            return None
        for i, t in enumerate(p.tasks):
            if t.id == task_id:
                for k, v in changes.items():
                    if hasattr(t, k) and v is not None:
                        setattr(t, k, v)
                t.updated_at = time.time()
                if t.status == "in_progress" and t.started_at is None:
                    t.started_at = time.time()
                if t.status in ("done", "failed") and t.finished_at is None:
                    t.finished_at = time.time()
                p.tasks[i] = t
                return self.save(p)
        return None


_singleton: ProjectStore | None = None


def get_project_store() -> ProjectStore:
    global _singleton
    if _singleton is None:
        _singleton = ProjectStore()
    return _singleton


_TASK_TAG_RE = re.compile(
    r"<task(?P<attrs>(?:\s+[a-z_]+=\"[^\"]*\")*)\s*"
    r"(?:/>|>(?P<body>.*?)</task>)",
    re.IGNORECASE | re.DOTALL,
)
_ATTR_RE = re.compile(r'([a-z_]+)="([^"]*)"', re.IGNORECASE)


def parse_and_apply_task_tags(text: str, project_id: str) -> tuple[str, list[Task]]:
    """Strip ``<task action="..." ...>...</task>`` tags from *text* and
    persist their effects to the named project.

    Recognised actions:
      * create — title from body, optional ``assignee`` / ``id`` /
        ``depends_on`` (comma-separated). Returns the new task.
      * update — patch fields on the matched ``id``.
      * done   — shorthand for update with status=done.
      * delete — remove the task by id.

    Returns (cleaned_text, [tasks_touched]).
    """
    store = get_project_store()
    p = store.get(project_id)
    if not p:
        return text, []

    touched: list[Task] = []

    def _replace(m: re.Match) -> str:
        attrs = {k.lower(): v for k, v in _ATTR_RE.findall(m.group("attrs") or "")}
        action = (attrs.get("action") or "create").lower()
        body = ""
        try:
            body = (m.group("body") or "").strip()
        except IndexError:
            body = ""

        if action == "create":
            depends = [d.strip() for d in (attrs.get("depends_on") or "").split(",") if d.strip()]
            assignee = (attrs.get("assignee") or "").lstrip("@").strip() or None
            tid = attrs.get("id") or uuid.uuid4().hex[:10]
            existing = next((t for t in p.tasks if t.id == tid), None)
            if existing:
                # idempotent: same id = update fields
                store.update_task(
                    project_id, tid, title=body[:200] or existing.title, assignee=assignee
                )
            else:
                t = Task(
                    id=tid,
                    title=body[:200] or "Untitled",
                    description=body if len(body) > 200 else "",
                    assignee=assignee,
                    depends_on=depends,
                )
                store.add_task(project_id, t)
                touched.append(t)
        elif action == "update":
            tid = attrs.get("id")
            if tid:
                changes: dict[str, object] = {}
                if "status" in attrs:
                    changes["status"] = attrs["status"]
                if "assignee" in attrs:
                    a = attrs["assignee"].lstrip("@").strip()
                    changes["assignee"] = a or None
                if body:
                    changes["description"] = body
                store.update_task(project_id, tid, **changes)
        elif action == "done":
            tid = attrs.get("id")
            if tid:
                store.update_task(project_id, tid, status="done")
        elif action == "delete":
            tid = attrs.get("id")
            if tid:
                p2 = store.get(project_id)
                if p2:
                    p2.tasks = [t for t in p2.tasks if t.id != tid]
                    store.save(p2)
        return ""  # strip the tag from visible text

    cleaned = _TASK_TAG_RE.sub(_replace, text)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned).strip()
    return cleaned, touched


__all__ = [
    "Project",
    "ProjectStatus",
    "ProjectStore",
    "Task",
    "TaskStatus",
    "get_project_store",
    "parse_and_apply_task_tags",
]
