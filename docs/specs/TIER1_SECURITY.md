# Tier 1 — Security Hardening

> **Priority: highest.** This is the only tier where "arz is worse than KiroCrew"
> is a defensible technical objection rather than a difference in surface area.
> `STEERING.md` claims deny-by-default security; today the code does not back
> that claim on process execution.

Reference: KiroCrew ships OS-level sandboxing, 137 deny patterns, an append-only
security event log with `security verify`, and a tightest-wins policy ceiling.

---

## 1.1 — OS-level sandbox for agent subprocesses

**Gap:** zero sandbox code in `src/`. Every provider subprocess and every
`execute_bash` tool call runs with the full privileges of the gateway process.

**Target behaviour**

- Config key `security.sandbox` — `auto` (default) | `standard` | `strict` | `off`.
- macOS: wrap exec in `sandbox-exec` with a generated Seatbelt profile.
- Linux: user namespaces via `bwrap` when present; fall back to `unshare`.
- Unsupported platform + `auto` → refuse to exec, log a security event, surface
  a dashboard warning. Escape hatch: `security.allow_unsandboxed_exec: true`.

**Profile tiers**

| Mode | Filesystem | Network | Notes |
|---|---|---|---|
| `standard` | rw on `session.work_dir` + tmp; ro on system paths | allowed | default for `auto` |
| `strict` | rw on `session.work_dir` only | denied | for cron / heartbeat / unattended subagents |
| `off` | unrestricted | allowed | requires explicit opt-in |

**Files**
- `src/arz/security/sandbox.py` — profile generation + `wrap_command()`
- `src/arz/security/profiles/{seatbelt.sb.tmpl,bwrap.args.tmpl}`
- `src/arz/providers/base.py` — route every spawn through `wrap_command()`
- `src/arz/config/schema.py` — `security.sandbox`, `security.allow_unsandboxed_exec`

**Acceptance**
- Test: a tool call writing outside `work_dir` fails under `standard`.
- Test: a network call fails under `strict`.
- Test: `auto` on an unsupported platform refuses rather than running bare.
- Conformance test applied to every provider (per `STEERING.md` testing rule).

---

## 1.2 — Expand deny patterns (~15 → 120+)

**Gap:** [`deny_patterns.py`](../../src/arz/security/deny_patterns.py) is 114
lines with roughly 15 patterns. KiroCrew bundles 137.

**Categories to cover**
- Destructive fs: `rm -rf /`, `rm -rf ~`, `mkfs`, `dd of=/dev/…`, `shred`,
  `find … -delete` on broad roots, `chmod -R 777 /`
- Git: `push --force` to default branches, `reset --hard` with unstaged work,
  `clean -xfd`, history rewrite on shared refs
- Remote code execution: pipe-to-shell in all forms (`curl|sh`, `wget|bash`,
  `iwr|iex`), `eval "$(…)"`, `source <(curl …)`
- Credential exfiltration: reads of `~/.ssh`, `~/.aws`, `~/.config/gcloud`,
  `~/.kube`, `~/.docker/config.json`, `.env`, keychain / `security find-…`
- Package-manager escalation: `npm i -g`, `pip install --break-system-packages`,
  `brew install` with sudo, postinstall-script bypasses
- Database: `DROP DATABASE`/`TRUNCATE` without a backup flag
- Network egress to paste/tunnel hosts (already partly in `dashboard/redact.py`
  — consolidate into one place)
- Process/system: `kill -9 1`, `systemctl disable`, firewall flushes,
  `launchctl unload` of security agents

**Structure change:** each pattern becomes a record, not a bare regex —
`{id, pattern, severity: deny|warn, category, rationale}` — so the dashboard can
explain *why* something was blocked and policy can selectively relax a category.

**Files**
- `src/arz/security/deny_patterns.py` (restructure + expand)
- `src/arz/security/patterns/*.toml` (optional: data out of code)
- `tests/test_deny_patterns.py` — table-driven, one case per pattern

---

## 1.3 — Tamper-evident audit log

**Gap:** [`audit.py`](../../src/arz/dashboard/audit.py) is a plain SQLite table.
Any process with file access can rewrite history undetectably. No verify path.

**Target behaviour**
- Add `prev_hash` and `hash` columns. `hash = sha256(prev_hash || canonical_json(event))`.
- Genesis row on database creation.
- Mirror to append-only `~/.arz/security_events.jsonl` for events with
  `severity >= warn` (survives database corruption; matches KiroCrew's layout).
- `arz security verify` walks the chain and reports the first divergence.
- Dashboard: integrity badge on the audit view.

**Files**
- `src/arz/dashboard/audit.py` — schema migration + `verify_chain()`
- `src/arz/security/events.py` — JSONL sink
- `src/arz/cli.py` — `security` command group (see Tier 2 §2.4)
- `tests/test_audit_chain.py` — verify detects insert / update / delete

---

## 1.4 — Environment and path guards at exec time

**Gap:** redaction happens on *output*. Nothing strips the environment handed to
a subprocess, and nothing blocks reads of protected paths before they happen.

**Target behaviour**
- Allowlist the env passed to agent subprocesses. Drop everything matching
  `*_TOKEN`, `*_KEY`, `*_SECRET`, `AWS_*`, `ANTHROPIC_*`, `OPENAI_*`, `GH_*`
  unless the provider declares a need in `LLMProvider.required_env`.
- Protected-path list checked before any `fs_read`/`fs_write` tool executes:
  `~/.ssh`, `~/.aws`, `~/.arz/.env`, `~/.config/gcloud`, `~/.kube`, keychains.
- Both feed the same security-event sink as §1.3.

**Files**
- `src/arz/security/env_guard.py`
- `src/arz/security/paths.py`
- `src/arz/providers/base.py` — apply `required_env` allowlist on spawn

---

## 1.5 — Policy ceiling

**Gap:** no equivalent of KiroCrew's `policy show|validate|explain`.

**Target behaviour**
- Optional `~/.arz/policy.yaml` (and a system path for managed installs).
- Composition is **tightest-wins**: runtime config can never widen what policy
  allows. Sandbox mode, deny categories, allowed egress hosts, telemetry,
  approval mode, and unattended-autonomy toggles are all policy-capped.
- `arz policy show` (effective), `validate` (lint), `explain <action>` (which
  rule decided, and why).

**Files**
- `src/arz/security/policy.py`
- `src/arz/config/loader.py` — apply the ceiling after merge
- `tests/test_policy_ceiling.py` — config cannot widen policy

---

## Build order

1. §1.2 deny patterns — no dependencies, immediate value
2. §1.3 audit chain — needed as the sink for everything else
3. §1.4 env/path guards — feeds §1.3
4. §1.1 sandbox — largest piece, benefits from the event sink existing
5. §1.5 policy ceiling — composes over all of the above
