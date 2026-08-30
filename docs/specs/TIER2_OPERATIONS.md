# Tier 2 — Operational Maturity

> **Priority: medium.** None of this makes arz smarter. All of it makes arz
> something a person can install, keep running, and debug without reading the
> source. This is the difference between a project and a product.

Current CLI surface: `chat, gateway, version, reap, setup, snapshot, restore, eval`.
KiroCrew adds `doctor, logs, service, config, security, policy, telemetry, update`.

---

## 2.1 — `arz doctor`

**Gap:** no diagnostics. When the gateway misbehaves the user reads tracebacks.

**Checks**
- Python version, `uv`/venv health, package version vs latest
- Provider CLIs on `PATH` with versions: `claude`, `codex`, `kiro`, `gemini`, `ollama`
- Provider auth reachability (cheap no-op call per configured provider)
- `~/.arz/` layout: permissions on `.env` (must be 600), database integrity
  (`PRAGMA integrity_check` on `audit.db`, `memory.db`), disk headroom
- Port 8787 (or configured) availability; loopback binding confirmed
- Embedder status — which backend is live, whether Ollama is reachable
  (see [Tier 4 §4.1](TIER4_MEMORY_AND_RENDER.md))
- Sandbox availability for the platform (Tier 1 §1.1)
- Orphaned sessions / stale locks — reuse existing `reaper.py` logic

**Output:** one line per check, `ok / warn / fail` plus a remediation hint.
`--json` for scripting. Non-zero exit if any check fails.

**Files:** `src/arz/doctor.py`, `src/arz/cli.py`

---

## 2.2 — `arz logs`

**Gap:** logs go to stdout and vanish when the terminal closes.

- Gateway writes to `~/.arz/gateway.log` with size-based rotation (10MB × 5).
- `arz logs` (tail 100), `-f` (follow), `-n N`, `--level`, `--session <id>`.
- Structured JSON lines under the human-readable format so `--json` can filter.

**Files:** `src/arz/logging_setup.py`, `src/arz/cli.py`

---

## 2.3 — `arz service install`

**Gap:** the gateway only runs while a terminal holds it. Cron jobs, heartbeat,
and AutoNudge — the entire unattended-autonomy story — die with the shell.

- macOS: write a launchd plist to `~/Library/LaunchAgents/dev.arz.gateway.plist`.
- Linux: write a systemd user unit to `~/.config/systemd/user/arz.service`.
- Subcommands: `install`, `uninstall`, `status`, `restart`.
- `KeepAlive` / `Restart=on-failure`; logs land in the §2.2 file.
- Refuse to install while `security.allow_unsandboxed_exec` is set without an
  explicit `--i-know` flag — unattended plus unsandboxed is the dangerous combo.

**Files:** `src/arz/service.py`, `src/arz/service/templates/*`, `src/arz/cli.py`

---

## 2.4 — `arz security` and `arz config` command groups

Surfaces Tier 1 work on the CLI.

- `arz security events [--since] [--severity]` — read the JSONL sink
- `arz security audit [--session] [--kind]` — query `audit.db`
- `arz security verify` — walk the hash chain (Tier 1 §1.3)
- `arz policy show|validate|explain` (Tier 1 §1.5)
- `arz config get <key>` / `set <key> <value>` / `edit` — typed against
  `config/schema.py`, rejects unknown keys instead of silently writing them

**Files:** `src/arz/cli.py`, `src/arz/dashboard/audit.py`

---

## 2.5 — Distribution

**Docker**
- Multi-arch image, non-root user, `~/.arz` as a declared volume.
- No provider CLIs baked in — mount or install at runtime, since arz is
  provider-agnostic and shipping five CLIs would bloat the image.

**Electron desktop app** (`electron/` already exists)
- Bundle the gateway; start and stop it with the app window.
- Update channel + in-app update check. Ship stable only at first; add
  insider/nightly if release cadence justifies it.
- Tray icon with gateway status, system-wide hotkey to focus.

**Install script**
- `curl -fsSL … | sh` is convenient and is also exactly the pattern arz's own
  deny list flags. Publish it, but also document `uv tool install arz` as the
  reviewable path, and pin checksums in the script.

**Files:** `Dockerfile`, `.dockerignore`, `electron/updater.ts`, `scripts/install.sh`

---

## 2.6 — Turn durability across restart

**Gap:** [`stream_registry.py`](../../src/arz/dashboard/stream_registry.py) says
it plainly — *"On gateway restart all in-flight turns are lost (we don't
snapshot)."* KiroCrew's headline claim is that sessions, schedules, and task
checkpoints survive Gateway restarts.

This is the single operational gap that contradicts a *product* claim rather
than a convenience, which is why it sits in Tier 2 rather than lower.

- Snapshot `StreamState` (event log + cursor) to `~/.arz/streams/{session}.jsonl`
  on every N events or 2s, whichever first.
- On gateway boot, scan for unfinished streams; mark them `interrupted` and
  replay their buffered events to reconnecting clients rather than dropping them.
- Task runner already checkpoints via `TASK_PROGRESS.md` — reuse that idea, and
  make `taskrunner` resume automatically on boot instead of only on request.

**Files:** `src/arz/dashboard/stream_registry.py`, `src/arz/taskrunner.py`,
`tests/test_stream_resume.py`

---

## Build order

1. §2.1 doctor — smallest, highest support value
2. §2.2 logs — prerequisite for debugging everything else
3. §2.6 turn durability — the one that closes a product claim
4. §2.4 CLI groups — lands with Tier 1
5. §2.3 service install — needs §2.2
6. §2.5 distribution — last; it packages whatever the others produce
