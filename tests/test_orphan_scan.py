"""Tests for orphan-CLI scanner.

We can't spawn real CLI binaries in tests; instead we exercise the
matching logic by feeding fake `ps` output through monkeypatched
subprocess + os.kill.
"""

from __future__ import annotations

import os
from unittest.mock import MagicMock

import pytest


def _fake_ps(stdout: str) -> MagicMock:
    m = MagicMock()
    m.stdout = stdout
    m.returncode = 0
    return m


def test_scan_skips_kiro_desktop(monkeypatch):
    """`kiro_cli_desktop` is the user's standalone app — must NOT be killed."""
    import subprocess

    from arz.reaper import scan_orphan_clis

    monkeypatch.setattr(
        subprocess,
        "run",
        lambda *a, **kw: _fake_ps(
            "  5000     1 /Applications/Kiro CLI.app/Contents/MacOS/kiro_cli_desktop --foo\n"
        ),
    )
    rows = scan_orphan_clis(dry_run=True)
    assert rows == []


def test_scan_skips_ollama_serve(monkeypatch):
    """`ollama serve` is shared infrastructure — never kill it."""
    import subprocess

    from arz.reaper import scan_orphan_clis

    monkeypatch.setattr(
        subprocess,
        "run",
        lambda *a, **kw: _fake_ps("  5001     1 ollama serve\n"),
    )
    rows = scan_orphan_clis(dry_run=True)
    assert rows == []


def test_scan_catches_ollama_run(monkeypatch):
    import subprocess

    from arz.reaper import scan_orphan_clis

    monkeypatch.setattr(
        subprocess,
        "run",
        lambda *a, **kw: _fake_ps("  5002     1 ollama run llama3.2\n"),
    )
    rows = scan_orphan_clis(dry_run=True)
    assert len(rows) == 1
    assert rows[0]["token"] == "ollama run"
    assert rows[0]["pid"] == 5002


def test_scan_catches_orphan_claude(monkeypatch):
    """ppid=1 (init) → definitely orphaned."""
    import subprocess

    from arz.reaper import scan_orphan_clis

    monkeypatch.setattr(
        subprocess,
        "run",
        lambda *a, **kw: _fake_ps("  5003     1 claude --enable-auto-mode\n"),
    )
    rows = scan_orphan_clis(dry_run=True)
    assert len(rows) == 1
    assert rows[0]["token"] == "claude"
    assert rows[0]["killed"] is False  # dry-run


def test_scan_catches_all_known_clis(monkeypatch):
    import subprocess

    from arz.reaper import scan_orphan_clis

    ps_output = (
        "  5010     1 claude --foo\n"
        "  5011     1 kiro-cli --bar\n"
        "  5012     1 codex exec\n"
        "  5013     1 gemini --baz\n"
        "  5014     1 ollama run qwen3\n"
    )
    monkeypatch.setattr(subprocess, "run", lambda *a, **kw: _fake_ps(ps_output))
    rows = scan_orphan_clis(dry_run=True)
    tokens = {r["token"] for r in rows}
    assert tokens == {"claude", "kiro-cli", "codex", "gemini", "ollama run"}


def test_scan_skips_own_children(monkeypatch):
    """Child of THIS process (e.g. a live gateway running a real CLI) is not an orphan."""
    import subprocess

    from arz.reaper import scan_orphan_clis

    our_pid = os.getpid()
    monkeypatch.setattr(
        subprocess,
        "run",
        lambda *a, **kw: _fake_ps(f"  5020  {our_pid} claude --foo\n"),
    )
    rows = scan_orphan_clis(dry_run=True)
    assert rows == []


def test_scan_skips_when_parent_is_alive(monkeypatch):
    """Any live parent (not just arz) means the child isn't an orphan.

    We dropped the "looks-like-arz" check because subagents are spawned
    through Python subprocess wrappers whose cmdline doesn't match
    "arz gateway" but who are still legitimate children.
    """
    import subprocess

    from arz import reaper

    monkeypatch.setattr(
        subprocess,
        "run",
        lambda *a, **kw: _fake_ps("  5030  9999 claude --foo\n"),
    )
    # ppid=9999 alive → skip regardless of cmdline.
    monkeypatch.setattr(reaper, "_pid_alive", lambda pid: True)
    rows = reaper.scan_orphan_clis(dry_run=True)
    assert rows == [], f"expected empty, got {rows}"


def test_scan_returns_empty_on_windows(monkeypatch):
    """Windows path bails out cleanly until wmic support lands."""
    import sys

    from arz.reaper import scan_orphan_clis

    monkeypatch.setattr(sys, "platform", "win32")
    rows = scan_orphan_clis(dry_run=True)
    assert rows == []


def test_scan_handles_ps_failure(monkeypatch):
    import subprocess

    from arz.reaper import scan_orphan_clis

    def boom(*a, **kw):
        raise subprocess.SubprocessError("ps not found")

    monkeypatch.setattr(subprocess, "run", boom)
    rows = scan_orphan_clis(dry_run=True)
    assert rows == []


def test_scan_actually_kills_when_not_dry_run(monkeypatch):
    import subprocess

    from arz.reaper import scan_orphan_clis

    monkeypatch.setattr(
        subprocess,
        "run",
        lambda *a, **kw: _fake_ps("  5099     1 claude --doomed\n"),
    )
    killed_pids: list[int] = []

    def fake_kill(pid, sig):
        killed_pids.append(pid)

    monkeypatch.setattr(os, "kill", fake_kill)
    rows = scan_orphan_clis(dry_run=False)
    assert killed_pids == [5099]
    assert rows[0]["killed"] is True


@pytest.mark.parametrize(
    "command_line",
    [
        # Edge cases: leading dot path, alternate paths, hyphenated args.
        "  6000     1 ./claude --foo",
        "  6001     1 /usr/local/bin/kiro-cli arg1 arg2",
        "  6002     1 /opt/codex/bin/codex exec",
    ],
)
def test_scan_handles_path_variants(monkeypatch, command_line):
    import subprocess

    from arz.reaper import scan_orphan_clis

    monkeypatch.setattr(subprocess, "run", lambda *a, **kw: _fake_ps(command_line + "\n"))
    rows = scan_orphan_clis(dry_run=True)
    assert len(rows) == 1
