"""Orphan-process reaper.

Tracks every PID the gateway spawns for an LLM CLI (claude-code, codex,
kiro-cli, gemini, ollama runner). On startup, kills any PID listed in the
prior run's manifest that's still alive — those are orphans from a hard
crash. Periodically prunes manifest entries whose process has exited.

No external dependency: stdlib only. Cross-platform safe — the manifest
records (pid, command_token) so a recycled PID owned by an unrelated
process is not killed.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import signal
from dataclasses import asdict, dataclass
from pathlib import Path

log = logging.getLogger(__name__)

_MANIFEST = Path.home() / ".arz" / "owned_pids.json"
_DEFAULT_INTERVAL = 300.0  # 5 min


@dataclass
class _Entry:
    pid: int
    cmd: str  # short token used to verify before killing (e.g. "kiro-cli")


class OrphanReaper:
    """Track owned PIDs, reap orphans from prior runs, sweep dead entries."""

    def __init__(
        self,
        manifest: Path | None = None,
        interval_s: float = _DEFAULT_INTERVAL,
    ) -> None:
        self._path = manifest or _MANIFEST
        self._interval = interval_s
        self._owned: dict[int, _Entry] = {}
        self._task: asyncio.Task | None = None

    # ── public ──────────────────────────────────────────────────────────────

    def register(self, pid: int | None, cmd: str) -> None:
        if not pid:
            return
        self._owned[pid] = _Entry(pid=pid, cmd=cmd)
        self._save()

    def unregister(self, pid: int | None) -> None:
        if pid and pid in self._owned:
            del self._owned[pid]
            self._save()

    async def start(self) -> None:
        """Reap orphans from any prior run, then begin the sweep loop."""
        prior = self._load_prior()
        for entry in prior:
            if entry.pid in self._owned:
                continue
            if not _pid_alive(entry.pid):
                continue
            if not _cmd_matches(entry.pid, entry.cmd):
                # PID was recycled by an unrelated process — leave it alone.
                continue
            try:
                os.kill(entry.pid, signal.SIGTERM)
                log.warning(
                    "Reaped orphan PID %d (%s) from prior gateway run",
                    entry.pid,
                    entry.cmd,
                )
            except ProcessLookupError:
                pass
            except PermissionError:
                log.warning("No permission to reap PID %d (%s)", entry.pid, entry.cmd)
        self._save()
        if self._task is None:
            self._task = asyncio.create_task(self._loop(), name="orphan-reaper")

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None

    # ── internal ────────────────────────────────────────────────────────────

    async def _loop(self) -> None:
        while True:
            try:
                await asyncio.sleep(self._interval)
                self._sweep_dead()
            except asyncio.CancelledError:
                raise
            except Exception:
                log.exception("Orphan reaper sweep raised")

    def _sweep_dead(self) -> None:
        dead = [pid for pid in self._owned if not _pid_alive(pid)]
        for pid in dead:
            self._owned.pop(pid, None)
        if dead:
            log.info("Pruned %d dead PIDs from owned-pid manifest", len(dead))
            self._save()

    def _load_prior(self) -> list[_Entry]:
        try:
            raw = json.loads(self._path.read_text())
        except (FileNotFoundError, json.JSONDecodeError):
            return []
        out: list[_Entry] = []
        for item in raw:
            try:
                out.append(_Entry(pid=int(item["pid"]), cmd=str(item.get("cmd", ""))))
            except (KeyError, TypeError, ValueError):
                continue
        return out

    def _save(self) -> None:
        try:
            self._path.parent.mkdir(parents=True, exist_ok=True)
            self._path.write_text(
                json.dumps([asdict(e) for e in self._owned.values()], indent=2)
            )
        except OSError:
            log.warning("Could not persist owned-pid manifest", exc_info=True)


def _pid_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        # Process exists but is owned by someone else — alive.
        return True


def _cmd_matches(pid: int, token: str) -> bool:
    """Best-effort: confirm the running PID's executable contains *token*.

    Falls back to True (kill anyway) if we can't determine the command —
    safer than leaving real orphans alive forever.
    """
    if not token:
        return True
    try:
        import sys

        if sys.platform == "linux":
            cmdline = Path(f"/proc/{pid}/cmdline").read_text(errors="replace")
            return token in cmdline
        if sys.platform == "darwin":
            import subprocess

            out = subprocess.run(
                ["ps", "-p", str(pid), "-o", "command="],
                capture_output=True,
                text=True,
                timeout=2,
            )
            return token in out.stdout
        if sys.platform == "win32":
            import subprocess

            out = subprocess.run(
                ["wmic", "process", "where", f"ProcessId={pid}", "get", "CommandLine"],
                capture_output=True,
                text=True,
                timeout=2,
            )
            return token.lower() in out.stdout.lower()
    except Exception:
        return True
    return True


# ── module singleton ───────────────────────────────────────────────────────
_singleton: OrphanReaper | None = None


def get_reaper() -> OrphanReaper:
    global _singleton
    if _singleton is None:
        _singleton = OrphanReaper()
    return _singleton
