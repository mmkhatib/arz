"""ProjectStore — basic CRUD + task lifecycle."""

from __future__ import annotations

from pathlib import Path

import pytest

from arz.projects import ProjectStore, Task


@pytest.fixture
def store(tmp_path: Path) -> ProjectStore:
    return ProjectStore(root=tmp_path)


def test_create_and_get(store: ProjectStore) -> None:
    p = store.create(name="Auth refactor", brief="Replace cookies with OIDC.")
    assert p.id
    assert p.name == "Auth refactor"
    fetched = store.get(p.id)
    assert fetched is not None
    assert fetched.brief == "Replace cookies with OIDC."


def test_list_returns_saved_projects(store: ProjectStore) -> None:
    store.create("A")
    store.create("B")
    items = store.list()
    assert {p.name for p in items} == {"A", "B"}


def test_brief_md_persisted(store: ProjectStore) -> None:
    p = store.create(name="brief test", brief="# Hello\nworld")
    brief_md = store.root / p.id / "brief.md"
    assert brief_md.exists()
    assert "Hello" in brief_md.read_text()


def test_task_lifecycle(store: ProjectStore) -> None:
    p = store.create(name="Tasks demo")
    task = Task(id="t1", title="implement auth")
    p2 = store.add_task(p.id, task)
    assert p2 is not None
    assert len(p2.tasks) == 1

    p3 = store.update_task(p.id, "t1", status="in_progress")
    assert p3 is not None
    assert p3.tasks[0].status == "in_progress"
    assert p3.tasks[0].started_at is not None

    p4 = store.update_task(p.id, "t1", status="done")
    assert p4 is not None
    assert p4.tasks[0].status == "done"
    assert p4.tasks[0].finished_at is not None


def test_get_by_channel(store: ProjectStore) -> None:
    p = store.create("x")
    p.channel_id = "ch-abc"
    store.save(p)
    found = store.get_by_channel("ch-abc")
    assert found is not None
    assert found.id == p.id


def test_delete_moves_to_trash(store: ProjectStore) -> None:
    p = store.create("temp")
    assert store.delete(p.id) is True
    assert store.get(p.id) is None
    trash = store.root / ".trash"
    assert trash.exists()
    assert any(p.id in d.name for d in trash.iterdir())


def test_task_tags_create_update_done_delete(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from arz import projects as proj_mod

    test_store = ProjectStore(root=tmp_path)
    monkeypatch.setattr(proj_mod, "_singleton", test_store)

    p = test_store.create("tag demo")

    text = (
        "I'll plan it out.\n"
        '<task action="create" id="t1" assignee="@coder">implement auth</task>'
        '<task action="create" id="t2" assignee="@reviewer" '
        'depends_on="t1">review the patch</task>\n'
        "Done planning."
    )
    cleaned, touched = proj_mod.parse_and_apply_task_tags(text, p.id)
    assert "implement auth" not in cleaned
    assert "review the patch" not in cleaned
    assert "Done planning." in cleaned
    assert len(touched) == 2

    p2 = test_store.get(p.id)
    assert p2 is not None
    titles = {t.title for t in p2.tasks}
    assert titles == {"implement auth", "review the patch"}
    review = next(t for t in p2.tasks if t.id == "t2")
    assert review.depends_on == ["t1"]
    assert review.assignee == "reviewer"

    cleaned2, _ = proj_mod.parse_and_apply_task_tags(
        '<task action="update" id="t1" status="in_progress"/>',
        p.id,
    )
    p3 = test_store.get(p.id)
    assert p3 is not None
    t1 = next(t for t in p3.tasks if t.id == "t1")
    assert t1.status == "in_progress"

    proj_mod.parse_and_apply_task_tags('<task action="done" id="t1"/>', p.id)
    t1b = next(t for t in test_store.get(p.id).tasks if t.id == "t1")  # type: ignore[union-attr]
    assert t1b.status == "done"

    proj_mod.parse_and_apply_task_tags('<task action="delete" id="t2"/>', p.id)
    p4 = test_store.get(p.id)
    assert p4 is not None
    assert all(t.id != "t2" for t in p4.tasks)


def test_open_tasks_counts_correctly(store: ProjectStore) -> None:
    p = store.create("x")
    store.add_task(p.id, Task(id="a", title="x", status="planned"))
    store.add_task(p.id, Task(id="b", title="y", status="in_progress"))
    store.add_task(p.id, Task(id="c", title="z", status="done"))
    p2 = store.get(p.id)
    assert p2 is not None
    assert p2.open_tasks() == 2
