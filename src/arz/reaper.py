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

# Basenames of CLI binaries this gateway spawns. The startup scan
# kills any matching process whose parent PID isn't a live arz
# gateway — covers the `Ctrl+C 15 times → 15 orphans` case where
# the manifest never got the chance to record them.
#
# IMPORTANT: matched by argv[0] BASENAME (or strict prefix), not
# substring — otherwise the user's own Kiro Desktop app (which runs
# `kiro_cli_desktop`) would get killed.
_CLI_BASENAMES: frozenset[str] = frozenset(
    {
        "claude",  # claude-code provider uses `claude`
        "kiro-cli",
        "codex",
        "gemini",
        # Plain `ollama` only counts when followed by a "run" subcommand
        # (handled separately in scan loop). `ollama serve` is shared
        # infrastructure and must never be killed by us.
        "ollama",
    }
)


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
        """Reap orphans from any prior run, then begin the sweep loop.

        Runs both passes:
          1. Manifest-based reap (PIDs we recorded last run).
          2. Aggressive scan (any process matching known CLI tokens
             whose parent isn't a live arz instance).
        """
        # 2. Aggressive scan first — covers Ctrl+C-orphaned procs whose
        # manifest entries we never got to write. Catches the
        # "15 stuck instances" case directly.
        try:
            rows = scan_orphan_clis(dry_run=False)
            killed = sum(1 for r in rows if r["killed"])
            if killed:
                log.warning("Startup orphan scan killed %d stray CLI(s)", killed)
        except Exception:
            log.exception("Startup orphan scan failed")

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
                # Periodic aggressive scan. Catches orphans spawned
                # by a sibling gateway that crashed mid-run between
                # our last startup and now.
                try:
                    rows = scan_orphan_clis(dry_run=False)
                    killed = sum(1 for r in rows if r["killed"])
                    if killed:
                        log.warning("Periodic orphan scan killed %d stray CLI(s)", killed)
                except Exception:
                    log.exception("Periodic orphan scan failed")
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
            self._path.write_text(json.dumps([asdict(e) for e in self._owned.values()], indent=2))
        except OSError:
            log.warning("Could not persist owned-pid manifest", exc_info=True)


def _pid_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    import sys

    if sys.platform == "win32":
        # os.kill(pid, 0) on Windows isn't a "ping" — Python translates it
        # into TerminateProcess(pid, 0) via Win32, which depending on the
        # target binary throws OSError(WinError 11) "incorrect format"
        # instead of cleanly answering. Use OpenProcess + GetExitCodeProcess
        # via ctypes so we get a real liveness check.
        try:
            import ctypes
            from ctypes import wintypes

            PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
            STILL_ACTIVE = 259
            kernel32 = ctypes.windll.kernel32
            handle = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, int(pid))
            if not handle:
                # ERROR_INVALID_PARAMETER (87) → pid not found = dead.
                # Anything else (5 access denied etc.) → assume alive
                # so we don't reap-and-forget a real orphan.
                err = ctypes.get_last_error()
                return err not in (87,)
            try:
                code = wintypes.DWORD()
                if not kernel32.GetExitCodeProcess(handle, ctypes.byref(code)):
                    return True
                return code.value == STILL_ACTIVE
            finally:
                kernel32.CloseHandle(handle)
        except Exception:
            # If ctypes lookup itself blew up, fall through to assuming
            # alive — false-positive is better than a startup crash.
            return True

    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        # Process exists but is owned by someone else — alive.
        return True
    except OSError:
        # Catch-all defensive: e.g. Windows shouldn't reach here after the
        # branch above, but if it ever does, don't crash the gateway start.
        return True


def scan_orphan_clis(dry_run: bool = False) -> list[dict]:
    """Aggressive sweep — scan every process on the box for known CLI
    tokens and reap those whose parent is dead or isn't this gateway.

    Returns a list of ``{"pid", "ppid", "cmd", "killed"}`` rows so the
    caller can log or surface to the UI. Designed to run on gateway
    startup AND be available via ``arz reap`` for one-shot cleanup.

    Skips processes whose parent matches our own PID — that's a live
    gateway's child, not an orphan.
    """
    import sys

    if sys.platform == "win32":
        # Windows: skip for now. The manifest-based reaper still works
        # there; aggressive scan can be added later via wmic.
        return []

    import subprocess

    our_pid = os.getpid()
    try:
        out = subprocess.run(
            ["ps", "-A", "-o", "pid=,ppid=,command="],
            capture_output=True,
            text=True,
            timeout=5,
        )
    except (subprocess.SubprocessError, OSError) as e:
        log.warning("orphan scan failed to run ps: %s", e)
        return []

    rows: list[dict] = []
    for line in out.stdout.splitlines():
        line = line.strip()
        if not line:
            continue
        # `ps` output: "PID PPID COMMAND..."
        parts = line.split(None, 2)
        if len(parts) < 3:
            continue
        try:
            pid = int(parts[0])
            ppid = int(parts[1])
        except ValueError:
            continue
        cmd = parts[2]
        # Match by argv[0] basename so we only catch the actual CLI
        # binaries we spawn — not e.g. `kiro_cli_desktop` (user's
        # Kiro Desktop app) or any binary that incidentally contains
        # "claude" in its path.
        try:
            argv0 = cmd.split()[0] if cmd.split() else ""
        except Exception:
            continue
        basename = argv0.rsplit("/", 1)[-1]
        token_hit = None
        if basename in _CLI_BASENAMES:
            # Special case ollama — only `ollama run …` is ours.
            # Skip `ollama serve` / `ollama pull` / etc.
            if basename == "ollama":
                rest = cmd.split(None, 1)[1] if len(cmd.split(None, 1)) > 1 else ""
                if not rest.startswith("run "):
                    continue
                token_hit = "ollama run"
            else:
                token_hit = basename
        if not token_hit:
            continue
        # Skip if parent is ourselves — that's a live child of THIS
        # gateway, not an orphan.
        if ppid == our_pid:
            continue
        # Skip if parent is alive AND looks like a live gateway
        # (python/uvicorn process owning this CLI). The simple check:
        # ppid != 1 (init) and ppid alive and is python.
        if ppid > 1 and _pid_alive(ppid) and _looks_like_arz_parent(ppid):
            continue
        # Orphan. Kill it.
        killed = False
        if not dry_run:
            try:
                os.kill(pid, signal.SIGTERM)
                killed = True
                log.warning(
                    "Reaped orphan CLI pid=%d ppid=%d token=%s cmd=%s",
                    pid,
                    ppid,
                    token_hit,
                    cmd[:200],
                )
            except ProcessLookupError:
                pass
            except PermissionError:
                log.warning("No permission to kill orphan pid=%d (%s)", pid, token_hit)
        rows.append(
            {
                "pid": pid,
                "ppid": ppid,
                "cmd": cmd[:200],
                "token": token_hit,
                "killed": killed,
            }
        )
    return rows


def _looks_like_arz_parent(pid: int) -> bool:
    """True if PID's command line looks like a live gateway process.

    Used by ``scan_orphan_clis`` to avoid killing the children of a
    legitimate concurrent arz instance running on the same machine.
    """
    import subprocess
    import sys

    try:
        if sys.platform == "linux":
            cmdline = Path(f"/proc/{pid}/cmdline").read_text(errors="replace")
        else:
            out = subprocess.run(
                ["ps", "-p", str(pid), "-o", "command="],
                capture_output=True,
                text=True,
                timeout=2,
            )
            cmdline = out.stdout
    except (OSError, subprocess.SubprocessError):
        return False
    low = cmdline.lower()
    # Live gateway: "arz gateway" / "python ... arz/cli.py gateway"
    # / "uvicorn ... arz.dashboard". Plain "python" alone isn't enough.
    return ("arz gateway" in low) or ("arz/cli" in low) or ("arz.dashboard" in low)


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
