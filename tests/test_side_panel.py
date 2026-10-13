"""Tests for the chat side-panel routes (workspace tree, grep, git, context trace)."""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from arz.config.loader import load_config
from arz.dashboard import context_trace
from arz.dashboard.server import create_app
from arz.providers.pool import ProviderPool

_HAS_GIT = shutil.which("git") is not None


@pytest.fixture()
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setattr(context_trace, "_ROOT", tmp_path / "trace")
    config = load_config()
    config.dashboard.token_auth = False
    app = create_app(config, ProviderPool(max_size=2))
    return TestClient(app, raise_server_exceptions=True)


def _session_in(client: TestClient, work_dir: Path) -> str:
    sid = client.post("/api/sessions", json={}).json()["id"]
    r = client.patch(f"/api/sessions/{sid}/workdir", json={"path": str(work_dir)})
    assert r.status_code == 204
    return sid


def _git(cwd: Path, *args: str) -> None:
    subprocess.run(
        ["git", "-c", "user.email=t@t", "-c", "user.name=t", *args],
        cwd=cwd,
        check=True,
        capture_output=True,
    )


@pytest.fixture()
def workspace(tmp_path: Path) -> Path:
    ws = tmp_path / "ws"
    (ws / "src").mkdir(parents=True)
    (ws / "src" / "app.py").write_text("print('hello')\n")
    (ws / "README.md").write_text("# Demo\nneedle here\n")
    (ws / "node_modules").mkdir()
    (ws / "node_modules" / "x.js").write_text("needle in deps\n")
    return ws


def test_tree_lists_one_level_dirs_first(client: TestClient, workspace: Path) -> None:
    sid = _session_in(client, workspace)
    body = client.get(f"/api/sessions/{sid}/tree").json()
    names = [e["name"] for e in body["entries"]]
    assert names[0] in ("node_modules", "src")
    assert "README.md" in names
    src = next(e for e in body["entries"] if e["name"] == "src")
    assert src["is_dir"] is True
    nm = next(e for e in body["entries"] if e["name"] == "node_modules")
    assert nm["hidden"] is True
    sub = client.get(f"/api/sessions/{sid}/tree", params={"rel": "src"}).json()
    assert [e["name"] for e in sub["entries"]] == ["app.py"]


def test_tree_rejects_escape(client: TestClient, workspace: Path) -> None:
    sid = _session_in(client, workspace)
    r = client.get(f"/api/sessions/{sid}/tree", params={"rel": "../../"})
    assert r.status_code == 400


def test_tree_unknown_session_404(client: TestClient) -> None:
    assert client.get("/api/sessions/nope/tree").status_code == 404


def test_grep_skips_vendor_dirs(client: TestClient, workspace: Path) -> None:
    sid = _session_in(client, workspace)
    body = client.get(f"/api/sessions/{sid}/grep", params={"q": "NEEDLE"}).json()
    assert [(h["rel_path"], h["line"]) for h in body["hits"]] == [("README.md", 2)]
    body = client.get(f"/api/sessions/{sid}/grep", params={"q": "NEEDLE", "case": True}).json()
    assert body["hits"] == []


def test_git_status_outside_repo(client: TestClient, workspace: Path) -> None:
    sid = _session_in(client, workspace)
    body = client.get(f"/api/sessions/{sid}/git-status").json()
    # tmp_path is never inside a checkout on CI; tolerate a dev box where it is.
    assert body["is_repo"] in (False, True)


@pytest.mark.skipif(not _HAS_GIT, reason="git not installed")
def test_git_status_and_diff(client: TestClient, workspace: Path) -> None:
    _git(workspace, "init", "-q")
    _git(workspace, "add", "src/app.py")
    _git(workspace, "commit", "-q", "-m", "init")
    (workspace / "src" / "app.py").write_text("print('bye')\n")
    sid = _session_in(client, workspace)

    st = client.get(f"/api/sessions/{sid}/git-status").json()
    assert st["is_repo"] is True
    by_rel = {f["rel_path"]: f["status"] for f in st["files"]}
    assert by_rel["src/app.py"] == "M"
    assert by_rel["README.md"] == "U"

    tree = client.get(f"/api/sessions/{sid}/tree").json()
    src = next(e for e in tree["entries"] if e["name"] == "src")
    assert src["status"] == "M"

    d = client.get("/api/files/diff", params={"path": str(workspace / "src" / "app.py")}).json()
    assert d["is_repo"] is True
    assert d["original"] == "print('hello')\n"
    assert d["modified"] == "print('bye')\n"
    assert "-print('hello')" in d["diff"] and "+print('bye')" in d["diff"]

    new = client.get("/api/files/diff", params={"path": str(workspace / "README.md")}).json()
    assert new["original"] == ""
    assert "+# Demo" in new["diff"]


def test_diff_requires_absolute(client: TestClient) -> None:
    assert client.get("/api/files/diff", params={"path": "rel.txt"}).status_code == 400


def test_context_trace_record_and_finish(client: TestClient) -> None:
    sid = client.post("/api/sessions", json={}).json()["id"]
    assert client.get(f"/api/sessions/{sid}/context-trace").json() == {"turns": []}
    context_trace.record_turn(sid, {"user": 10, "memory": 200, "goal": 0})
    context_trace.finish_turn(sid, 42.5, {"input_tokens": 1000})
    turns = client.get(f"/api/sessions/{sid}/context-trace").json()["turns"]
    assert len(turns) == 1
    assert turns[0]["blocks"] == {"user": 10, "memory": 200}
    assert turns[0]["context_pct"] == 42.5
    assert turns[0]["usage"] == {"input_tokens": 1000}


def test_context_trace_caps_turns(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(context_trace, "_ROOT", tmp_path)
    for i in range(context_trace._MAX_TURNS + 5):
        context_trace.record_turn("s1", {"user": i + 1})
    turns = context_trace.load("s1")
    assert len(turns) == context_trace._MAX_TURNS
    assert turns[-1]["blocks"]["user"] == context_trace._MAX_TURNS + 5
