"""Projects — group a brief, a task list, a memory namespace, and a
linked Channel under one umbrella.

Frontend hits these to render the /projects list and the right-rail
inside ChannelsPage when a channel has a project_id.
"""

from __future__ import annotations

# PM intake — used by the guided "New project" wizard. The PM agent
# turns a small structured payload of user answers into a brief, a
# success-criteria list, and a suggested task breakdown.
import asyncio
import json as _json
import re as _re
import uuid
from dataclasses import asdict
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from arz.dashboard.token_auth import require_token
from arz.projects import Project, Task, TaskStatus, get_project_store

router = APIRouter(dependencies=[Depends(require_token)])


def _project_to_dict(p: Project) -> dict:
    return {
        "id": p.id,
        "name": p.name,
        "brief": p.brief,
        "repo_path": p.repo_path,
        "status": p.status,
        "channel_id": p.channel_id,
        "tasks": [asdict(t) for t in p.tasks],
        "open_tasks": p.open_tasks(),
        "success_criteria": list(p.success_criteria),
        "created_at": p.created_at,
        "updated_at": p.updated_at,
        "autopilot_idle_s": p.autopilot_idle_s,
        "autopilot_max_iterations": p.autopilot_max_iterations,
        "autopilot_iterations": p.autopilot_iterations,
        "budget_tokens": p.budget_tokens,
        "budget_usd_cents": p.budget_usd_cents,
        "spent_tokens": p.spent_tokens,
        "spent_usd_cents": p.spent_usd_cents,
        "max_concurrent_subagents": p.max_concurrent_subagents,
    }


class CreateBody(BaseModel):
    name: str
    brief: str = ""
    repo_path: str = ""
    channel_id: str | None = None
    success_criteria: list[str] = []


class PatchBody(BaseModel):
    name: str | None = None
    brief: str | None = None
    repo_path: str | None = None
    status: Literal["active", "paused", "done", "archived"] | None = None
    channel_id: str | None = None
    success_criteria: list[str] | None = None
    autopilot_idle_s: int | None = None
    autopilot_max_iterations: int | None = None
    budget_tokens: int | None = None
    budget_usd_cents: int | None = None
    max_concurrent_subagents: int | None = None


class TaskCreateBody(BaseModel):
    title: str
    description: str = ""
    assignee: str | None = None
    depends_on: list[str] = []
    priority: str | None = None  # low / normal / high / critical


class TaskPatchBody(BaseModel):
    title: str | None = None
    description: str | None = None
    assignee: str | None = None
    status: TaskStatus | None = None
    depends_on: list[str] | None = None
    artifacts: list[str] | None = None
    priority: str | None = None


@router.get("/api/projects")
async def list_projects() -> list[dict]:
    return [_project_to_dict(p) for p in get_project_store().list()]


@router.get("/api/projects/{project_id}")
async def get_project(project_id: str) -> dict:
    p = get_project_store().get(project_id)
    if not p:
        raise HTTPException(status_code=404, detail="project not found")
    return _project_to_dict(p)


@router.get("/api/projects/{project_id}/files")
async def list_project_files(project_id: str) -> dict:
    """Walk the project's repo_path and return files touched since the
    project was created. Lets the Files tab show what the agents have
    actually generated on disk, not just what they remembered to tag as
    an artifact in their reply.
    """
    from pathlib import Path as _Path

    p = get_project_store().get(project_id)
    if not p:
        raise HTTPException(status_code=404, detail="project not found")
    if not p.repo_path:
        return {"files": []}
    root = _Path(p.repo_path).expanduser()
    if not root.exists() or not root.is_dir():
        return {"files": []}

    declared = {a for t in p.tasks for a in (t.artifacts or [])}

    # Skip the usual noise: VCS, node_modules, virtualenvs, build dirs.
    SKIP_DIRS = {
        ".git",
        ".hg",
        ".svn",
        "node_modules",
        "__pycache__",
        ".venv",
        "venv",
        ".mypy_cache",
        ".pytest_cache",
        ".ruff_cache",
        "dist",
        "build",
        ".next",
        ".turbo",
        ".cache",
        "target",
    }
    SKIP_SUFFIX = (".pyc", ".pyo", ".lock", ".log")

    files: list[dict] = []
    cutoff = float(p.created_at or 0)
    limit = 500  # cap to keep response small
    for path in root.rglob("*"):
        if len(files) >= limit:
            break
        try:
            if any(part in SKIP_DIRS for part in path.parts):
                continue
            if path.is_dir() or path.is_symlink():
                continue
            if path.name.startswith("."):
                continue
            if path.suffix.lower() in SKIP_SUFFIX:
                continue
            st = path.stat()
            if cutoff and st.st_mtime < cutoff - 1:
                continue  # pre-existing file, untouched since project start
            rel = str(path.relative_to(root))
            files.append(
                {
                    "path": str(path),
                    "rel_path": rel,
                    "size": st.st_size,
                    "mtime": st.st_mtime,
                    "declared": str(path) in declared or rel in declared,
                }
            )
        except OSError:
            continue
    files.sort(key=lambda f: f["mtime"], reverse=True)
    return {"files": files, "truncated": len(files) >= limit}


@router.post("/api/projects", status_code=201)
async def create_project(body: CreateBody) -> dict:
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(status_code=422, detail="name required")
    store = get_project_store()
    p = store.create(name=name, brief=body.brief or "", repo_path=body.repo_path or "")
    if body.channel_id:
        p.channel_id = body.channel_id
    if body.success_criteria:
        p.success_criteria = list(body.success_criteria)
    if body.channel_id or body.success_criteria:
        store.save(p)
    return _project_to_dict(p)


@router.patch("/api/projects/{project_id}")
async def patch_project(project_id: str, body: PatchBody) -> dict:
    store = get_project_store()
    p = store.get(project_id)
    if not p:
        raise HTTPException(status_code=404, detail="project not found")
    for field_name, val in body.model_dump(exclude_unset=True).items():
        if val is None:
            continue
        if hasattr(p, field_name):
            setattr(p, field_name, val)
    return _project_to_dict(store.save(p))


@router.delete("/api/projects/{project_id}", status_code=204)
async def delete_project(project_id: str) -> None:
    if not get_project_store().delete(project_id):
        raise HTTPException(status_code=404, detail="project not found")


class KickoffBody(BaseModel):
    members: list[str] = []  # custom agent names; first becomes orchestrator
    initial_message: str = ""


@router.post("/api/projects/{project_id}/kickoff")
async def kickoff_project(project_id: str, body: KickoffBody) -> dict:
    """Wire (or create) a Channel for this project and post the brief +
    open task list to its orchestrator. Returns the channel slug so the
    frontend can route the user straight into the chat."""
    from arz.channel_runner import get_channel_runner
    from arz.channels import ChannelMember, get_channel_store

    store = get_project_store()
    p = store.get(project_id)
    if not p:
        raise HTTPException(status_code=404, detail="project not found")

    ch_store = get_channel_store()

    # Either reuse the linked channel or create a fresh one.
    channel = ch_store.get(p.channel_id) if p.channel_id else None
    if channel is None:
        members_in = body.members or [
            "orchestrator",
            "coder",
            "reviewer",
            "test-writer",
        ]
        members = [
            ChannelMember(agent=m, role="orchestrator" if i == 0 else "specialist")
            for i, m in enumerate(members_in)
            if m.strip()
        ]
        if not members:
            raise HTTPException(status_code=422, detail="at least one member required")
        try:
            channel = ch_store.create(
                p.name,
                members,
                topic=(p.brief.split("\n")[0][:200] if p.brief else f"Kickoff for {p.name}"),
                preset="custom",
            )
        except ValueError as e:
            raise HTTPException(status_code=409, detail=str(e)) from e
        p.channel_id = channel.id
        store.save(p)

    # Compose the kickoff message — orchestrator already gets the brief +
    # task list injected via channel_runner._build_context, so this can be
    # short and action-oriented.
    open_tasks = [t for t in p.tasks if t.status not in ("done", "failed")]
    user_msg = body.initial_message.strip() or (
        f"Kick off project '{p.name}'. There are {len(open_tasks)} open task"
        f"{'' if len(open_tasks) == 1 else 's'} in the project. "
        "Read the brief, decide what to start first, and delegate."
    )

    runner = get_channel_runner()
    if runner is not None:
        # Drive the orchestrator turn in the background — frontend just
        # routes the user into the channel and watches it stream.
        import asyncio as _asyncio

        _asyncio.create_task(runner.post_user(channel.id, user_msg))
    else:
        ch_store.post(channel.id, "user", user_msg)

    p.status = "active"
    store.save(p)
    return {"project_id": p.id, "channel_id": channel.id}


# ── tasks ─────────────────────────────────────────────────────────


@router.post("/api/projects/{project_id}/tasks", status_code=201)
async def create_task(project_id: str, body: TaskCreateBody) -> dict:
    store = get_project_store()
    p = store.get(project_id)
    if not p:
        raise HTTPException(status_code=404, detail="project not found")
    pri = (body.priority or "normal").lower()
    if pri not in ("low", "normal", "high", "critical"):
        pri = "normal"
    task = Task(
        id=uuid.uuid4().hex[:10],
        title=(body.title or "").strip()[:200] or "Untitled",
        description=body.description or "",
        assignee=body.assignee or None,
        depends_on=list(body.depends_on or []),
        priority=pri,  # type: ignore[arg-type]
    )
    p2 = store.add_task(project_id, task)
    if not p2:
        raise HTTPException(status_code=500, detail="add failed")
    return asdict(task)


@router.patch("/api/projects/{project_id}/tasks/{task_id}")
async def patch_task(project_id: str, task_id: str, body: TaskPatchBody) -> dict:
    store = get_project_store()
    changes = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
    p = store.update_task(project_id, task_id, **changes)
    if not p:
        raise HTTPException(status_code=404, detail="task not found")
    task = next((t for t in p.tasks if t.id == task_id), None)
    if task is None:
        raise HTTPException(status_code=404, detail="task not found after update")
    return asdict(task)


class IntakeBody(BaseModel):
    goal: str
    folder: str = ""
    deadline: str = ""
    must_haves: list[str] = []
    nice_to_haves: list[str] = []
    success_metric: str = ""
    constraints: str = ""


class IntakeDraft(BaseModel):
    name: str
    brief: str
    success_criteria: list[str] = []
    tasks: list[dict] = []  # [{title, description?, assignee?}]
    suggested_agents: list[str] = []


_PM_PROMPT_TEMPLATE = """You are a senior product manager helping the user
turn a fuzzy goal into a tight, executable project brief.

## User answers so far
Goal: {goal}
Folder/repo: {folder}
Deadline: {deadline}
Must-haves:
{must_haves}
Nice-to-haves:
{nice_to_haves}
Success metric: {success_metric}
Other constraints: {constraints}

## Output
Produce a single JSON object with these keys:
- name: short project name (max 60 chars, sentence case, no quotes)
- brief: markdown brief (3-6 short paragraphs) covering: goal, scope,
  out-of-scope, key constraints, definition of done.
- success_criteria: 3-7 short, checkable bullet items.
- tasks: 4-10 starter tasks. Each task is an object with:
    title: short imperative phrase
    description: 1-2 sentence elaboration
    assignee: optional agent role (e.g. "coder", "reviewer", "test-writer",
      "designer", "researcher", "doc-updater") — leave empty when unsure.
- suggested_agents: 2-5 agent role names that would be useful on this
  project (e.g. "coder", "reviewer", "designer").

Reply with ONLY the JSON object. No prose, no code fences. Be concrete
and specific; avoid generic filler. If a field is genuinely unknown,
return an empty list or string rather than padding.
"""


def _format_bullets(items: list[str]) -> str:
    if not items:
        return "(none)"
    return "\n".join(f"- {x.strip()}" for x in items if x.strip()) or "(none)"


async def _pm_intake_draft(body: IntakeBody) -> IntakeDraft:
    """Run a single cheap-model call to draft a project from intake."""
    from arz.acp.types import EVENT_COMPLETE, EVENT_TEXT_CHUNK
    from arz.dashboard.routes.sessions import _pick_cheap_model

    prompt = _PM_PROMPT_TEMPLATE.format(
        goal=(body.goal or "").strip() or "(unspecified)",
        folder=(body.folder or "").strip() or "(unspecified)",
        deadline=(body.deadline or "").strip() or "(no hard deadline)",
        must_haves=_format_bullets(body.must_haves),
        nice_to_haves=_format_bullets(body.nice_to_haves),
        success_metric=(body.success_metric or "").strip() or "(unspecified)",
        constraints=(body.constraints or "").strip() or "(none stated)",
    )

    try:
        provider_name, model_name = await _pick_cheap_model(
            fallback_provider="claude-code", fallback_model=""
        )
    except Exception:
        return _fallback_draft(body)

    try:
        if provider_name == "claude-code":
            from arz.providers.claude_code import ClaudeCodeProvider

            provider = ClaudeCodeProvider(model=model_name or None)
        elif provider_name == "ollama":
            from arz.providers.ollama import OllamaProvider

            provider = OllamaProvider(model=model_name or None)
        elif provider_name == "kiro-cli":
            from arz.providers.kiro_cli import KiroCliProvider

            provider = KiroCliProvider(model=model_name or "auto")
        elif provider_name == "codex":
            from arz.providers.codex import CodexProvider

            provider = CodexProvider(model=model_name or None)
        elif provider_name == "gemini":
            from arz.providers.gemini import GeminiProvider

            provider = GeminiProvider(model=model_name or None)
        else:
            return _fallback_draft(body)
    except Exception:
        return _fallback_draft(body)

    text = ""
    try:
        await asyncio.wait_for(provider.start(), timeout=15.0)
        async for ev in provider.stream(prompt):
            if ev.kind == EVENT_TEXT_CHUNK and ev.text:
                text += ev.text
                if len(text) > 8000:
                    break
            elif ev.kind == EVENT_COMPLETE:
                break
    except Exception:
        pass
    finally:
        try:
            await provider.shutdown()
        except Exception:
            pass

    return _parse_draft(text, body)


def _strip_code_fences(s: str) -> str:
    t = s.strip()
    if t.startswith("```"):
        t = _re.sub(r"^```[a-zA-Z]*\n?", "", t)
        if t.endswith("```"):
            t = t[:-3]
    return t.strip()


def _parse_draft(raw: str, body: IntakeBody) -> IntakeDraft:
    cleaned = _strip_code_fences(raw)
    try:
        # Find the first { ... } JSON object even if the model added prose.
        m = _re.search(r"\{.*\}", cleaned, _re.DOTALL)
        obj = _json.loads(m.group(0) if m else cleaned)
        return IntakeDraft(
            name=str(obj.get("name") or "")[:80] or _derive_name(body),
            brief=str(obj.get("brief") or "").strip(),
            success_criteria=[
                str(x).strip() for x in (obj.get("success_criteria") or []) if str(x).strip()
            ],
            tasks=[
                {
                    "title": str(t.get("title") or "").strip()[:200],
                    "description": str(t.get("description") or "").strip(),
                    "assignee": (str(t.get("assignee") or "").strip().lstrip("@") or None),
                }
                for t in (obj.get("tasks") or [])
                if isinstance(t, dict) and (t.get("title") or "").strip()
            ],
            suggested_agents=[
                str(a).strip().lstrip("@")
                for a in (obj.get("suggested_agents") or [])
                if str(a).strip()
            ],
        )
    except Exception:
        return _fallback_draft(body)


def _derive_name(body: IntakeBody) -> str:
    goal = (body.goal or "").strip()
    return (goal.split("\n")[0][:60] or "New project").strip()


def _fallback_draft(body: IntakeBody) -> IntakeDraft:
    """Produce a sane draft from raw inputs when the LLM call fails or
    parses badly. Keeps the wizard usable even offline."""
    bullets_must = _format_bullets(body.must_haves)
    bullets_nice = _format_bullets(body.nice_to_haves)
    brief = (
        f"# {_derive_name(body)}\n\n"
        f"## Goal\n{body.goal.strip() or '(unspecified)'}\n\n"
        f"## Constraints\n{body.constraints.strip() or '(none stated)'}\n\n"
        f"## Must-haves\n{bullets_must}\n\n"
        f"## Nice-to-haves\n{bullets_nice}\n\n"
        f"## Success metric\n{body.success_metric.strip() or '(define before kickoff)'}\n"
    )
    return IntakeDraft(
        name=_derive_name(body),
        brief=brief,
        success_criteria=[m for m in body.must_haves if m.strip()],
        tasks=[],
        suggested_agents=[],
    )


@router.post("/api/projects/intake/draft", response_model=IntakeDraft)
async def project_intake_draft(body: IntakeBody) -> IntakeDraft:
    """Run the PM agent on a structured intake payload. Returns a
    draft project ready for the user to review + edit."""
    return await _pm_intake_draft(body)


@router.delete("/api/projects/{project_id}/tasks/{task_id}", status_code=204)
async def delete_task(project_id: str, task_id: str) -> None:
    store = get_project_store()
    p = store.get(project_id)
    if not p:
        raise HTTPException(status_code=404, detail="project not found")
    new_tasks = [t for t in p.tasks if t.id != task_id]
    if len(new_tasks) == len(p.tasks):
        raise HTTPException(status_code=404, detail="task not found")
    p.tasks = new_tasks
    store.save(p)
