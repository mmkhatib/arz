# Arz ⇄ MeshClaw Parity — Execution Plan

Goal: bring the seven differentiating MeshClaw subsystems into arz, generic across
every installed LLM provider (claude-code, codex, anthropic, kiro-cli, ollama, …).
Drop everything Amazon/Kiro-specific.

Add one new surface — an LLM Installer page that detects + installs CLIs and
local-runtime models (Ollama, gemma, llama3, qwen, deepseek-coder, …).

---

## Constraints

- **Provider-agnostic.** No code paths that assume Kiro/AWS/Amazon. Anything that
  must format output for a specific provider lives behind a `name` switch.
- **Optional features.** Each subsystem must be opt-in; arz must still launch and
  serve a single chat session if every new feature is disabled.
- **Backwards-compatible session storage.** New fields are nullable; old session
  JSON keeps loading.
- **No new transitive deps unless they buy real value.** Use stdlib + what's
  already vendored (sqlite3, pydantic, fastapi, structlog).

---

## Phase 1 — Steered system prompt

**What MeshClaw does:** `agents/prompt.md` is loaded and prepended to every
turn, teaching the model about MeshClaw's MCP tools, redaction rules, subagent
patterns, etc.

**Arz adaptation:**
- Bundled file: `src/arz/prompts/base.md` (committed, generic, no Kiro mentions)
- Per-agent override: `AgentConfig.system_prompt` already exists — use it
- Resolution order at session start:
  1. agent's `system_prompt` if set
  2. else `~/.arz/prompts/base.md` if user customised it
  3. else bundled `src/arz/prompts/base.md`
- Provider integration: the chat route already passes `system_prompt` for
  claude-code; extend to all providers via a uniform `prepended_system: str`
  argument on `LLMProvider`.
- **Files:** `src/arz/prompts/base.md`, `src/arz/prompts/loader.py`,
  `src/arz/dashboard/routes/chat.py` (call loader),
  `src/arz/providers/{claude_code,codex,kiro_cli,anthropic}.py` (accept prompt).

---

## Phase 2 — Lessons store + auto-inject

**What MeshClaw does:** `learn.py` keeps a JSONL of up to 200 corrections; every
turn pulls the most relevant ones and injects them as a `<lessons>` block.

**Arz adaptation:**
- Storage: `~/.arz/lessons.jsonl` — `{ id, category, text, pinned, created_at }`
- Cap at 200 entries (LRU eviction; pinned entries never evicted).
- Auto-inject on every chat turn: scan lessons by keyword overlap with the user
  message + always include pinned + always include `category=preference`. Cap
  injection at ~6k chars total.
- API: `GET/POST/DELETE /api/lessons` + `POST /api/lessons/{id}/pin`.
- UI: a tab inside the existing Memory page.
- **Files:** `src/arz/lessons.py`, `src/arz/dashboard/routes/lessons.py`,
  `frontend/src/components/MemoryModal.tsx` (Lessons tab).

---

## Phase 3 — Persistent memory files

**What MeshClaw does:** `~/.meshclaw/workspace/memory/` has `preferences.md`,
`projects.md`, `history/YYYY-MM-DD.md`, all FTS5-indexed.

**Arz adaptation:**
- Storage:
  - `~/.arz/memory/preferences.md` (user style, tone, dont-do-X)
  - `~/.arz/memory/projects.md` (active projects, deadlines)
  - `~/.arz/memory/history/YYYY-MM-DD.md` (auto-generated summaries)
- Auto-inject:
  - `preferences.md` (capped 1k chars) into every turn
  - `projects.md` (capped 2k chars) into every turn
- Search: SQLite FTS5 index at `~/.arz/memory/index.db`, rebuilt on file change
  (mtime-driven).
- History rollover: nightly cron job at 03:00 — summarise yesterday's sessions
  and append to today-1.md.
- API: `GET/PUT /api/memory/files/{file}` + `GET /api/memory/search?q=`.
- UI: tab inside Memory page with file editor + search box.
- **Files:** `src/arz/memory/store.py`, `src/arz/memory/index.py` (FTS5),
  `src/arz/dashboard/routes/memory.py` (extend),
  `frontend/src/components/MemoryModal.tsx` (Memory Files tab).

---

## Phase 4 — Custom toolbelt (MCP-style local tools)

**What MeshClaw does:** `mcp_core.py` exposes `spawn_run`, `learn_add`,
`task_run`, `wait`, `register_hook`, `send_message` to the LLM. Plus
`mcp_cron.py` for cron CRUD.

**Arz adaptation:** reuse the existing `~/.arz/tools/` Python tool loader.
Each tool is a single file with `tool_spec` + `async run(input)`. Bundled tools:
- `spawn_run.py` — fire a subagent (Phase 5)
- `wait.py` — async sleep up to 1800s
- `learn_add.py`, `learn_list.py`, `learn_remove.py` — proxy to lessons store
- `register_hook.py` — write to `~/.arz/hooks/<name>.json` (Phase 7 reads these)
- `send_message.py` — generic message send (channels Phase 6 / surfaces)
- `cron_add.py`, `cron_list.py`, `cron_pause.py`, `cron_remove.py` — proxy
  to existing CronRegistry
- `task_run.py` — Phase 8 entry point

**Files:** `src/arz/tools/builtin/` (new dir, bundled). Copy/symlink into
`~/.arz/tools/` on first run.

---

## Phase 5 — Subagents

**What MeshClaw does:** `subagent.py` spawns an isolated background session,
captures the result, injects it back as a `[Subagent completion event]` message
into the parent session.

**Arz adaptation:**
- New service: `SubagentManager` in `src/arz/subagents.py`.
- Spawns a fresh `Session` (with its own provider/model from the agent config),
  runs one turn with the supplied prompt, captures the assistant reply.
- Parent session ID + completion text persisted to `~/.arz/subagents/{id}.json`.
- Result auto-injected into the parent on the next turn as a system-role message
  prefixed with `[subagent:{name}]`.
- Bound: max 3 concurrent across the whole gateway, each with a 30-min timeout.
- API: `POST /api/subagents` + `GET /api/subagents/{id}`.
- UI: progress strip on the chat panel showing live subagents.
- **Files:** `src/arz/subagents.py`,
  `src/arz/dashboard/routes/subagents.py`,
  `frontend/src/components/SubagentStrip.tsx`,
  `src/arz/tools/builtin/spawn_run.py`.

---

## Phase 6 — Channels (multi-agent A2A)

**What MeshClaw does:** `channel.py` is a shared chat space among up to 3
agents, with @mention routing, listen modes, approval policy, and a per-turn
A2A budget.

**Arz adaptation:**
- Channel: `{ id, name, members[]{agent_name, listen_mode, approval}, messages[] }`
  stored at `~/.arz/channels/{id}.json`.
- listen_mode: `ALL` | `MENTION` | `SILENT`.
- approval: `ALL` | `WRITES` | `TRUSTED`.
- Max 3 A2A exchanges per parent turn (drops the loop on ping-pong).
- New page: `/channels` with channel list + chat UI.
- API: `GET/POST/PATCH /api/channels`, `POST /api/channels/{id}/post`.
- **Files:** `src/arz/channels.py`,
  `src/arz/dashboard/routes/channels.py`,
  `frontend/src/components/ChannelsModal.tsx`,
  `frontend/src/pages/ChannelsPage.tsx`.

---

## Phase 7 — Heartbeat

**What MeshClaw does:** `heartbeat.py` reads `HEARTBEAT.md` on a 60s loop;
each unchecked checklist item is run as a task. `HEARTBEAT_KEEP` marker
retains incomplete items for the next cycle.

**Arz adaptation:**
- File: `~/.arz/HEARTBEAT.md` — markdown checklist
- Background loop in the gateway (asyncio task) at 60s tick.
- Each `- [ ]` line becomes a one-shot subagent run; `- [x]` lines are skipped;
  lines containing `<!-- KEEP -->` survive to next cycle even if completed.
- Pluggable interval via `dashboard.heartbeat_interval_s` config.
- API: `GET/PUT /api/heartbeat` for read/edit.
- UI: card on the Overview page.
- **Files:** `src/arz/heartbeat.py`,
  `src/arz/dashboard/routes/heartbeat.py`,
  `frontend/src/components/OverviewModal.tsx` (heartbeat card).

---

## Phase 8 — Task runner

**What MeshClaw does:** `taskrunner.py` decomposes a markdown spec into ordered
steps, executes each with retry/self-review, checkpoint-resumes via
`TASK_PROGRESS.md`.

**Arz adaptation:**
- Entry: `POST /api/taskrun` body `{ spec: str, agent: str | None }` or load
  from a markdown file path.
- Steps:
  1. Decompose: one LLM turn → list of steps.
  2. Execute: each step is a subagent run.
  3. Verify: one LLM turn checks acceptance vs the spec.
  4. Checkpoint: write `TASK_PROGRESS.md` after each step.
  5. Resume: if `TASK_PROGRESS.md` exists, skip done steps.
- Retry: up to 3 logic retries + 2 crash recoveries per step.
- UI: page with current task, step list, progress %.
- **Files:** `src/arz/taskrunner.py`,
  `src/arz/dashboard/routes/taskrunner.py`,
  `frontend/src/pages/TaskRunnerPage.tsx`,
  `src/arz/tools/builtin/task_run.py`.

---

## Phase 9 — Hooks + security

**What MeshClaw does:** `hooks.py` lets you auto-approve / auto-reply / deny
based on patterns. `defaults.json` ships 91 deny patterns + credential redaction.

**Arz adaptation:**
- Generic deny patterns in `src/arz/security/deny_patterns.py`
  (NO Amazon/AWS/Kiro patterns):
  - `rm -rf /` and similar
  - `git push --force` (warn unless explicit override)
  - `curl ... | sh` (pipe-to-shell)
  - `eval "$(...)"`
  - dropping DB tables with no backup flag
  - dumping `env` to public surfaces
  - touching `~/.ssh`, `~/.aws/credentials`, `~/.config/gcloud`
- Credential redaction: regex sweep before saving any text to disk or returning
  to a non-local surface (matches AWS keys, GCP keys, GitHub tokens, OpenAI
  keys, Anthropic keys, generic `Bearer …` headers).
- Hook config: `~/.arz/hooks.json` — `{ auto_approve_tools, auto_replies, deny }`.
- Wired into the chat route's permission_request handler.
- **Files:** `src/arz/security/deny_patterns.py`,
  `src/arz/security/redaction.py`,
  `src/arz/hooks.py`,
  `src/arz/dashboard/routes/hooks.py`,
  `frontend/src/components/HooksTab.tsx` (in Capabilities or Settings).

---

## Phase 10 — LLM Installer page (new)

A new top-level page that:
1. Detects installed CLIs: `claude`, `codex`, `kiro`, `ollama`, `lm-studio`.
2. Lists Ollama models the user already has (`ollama list`).
3. Offers one-click installs for popular local models (gemma3:4b, llama3.2:3b,
   qwen2.5-coder:7b, deepseek-coder-v2:lite, phi3:mini, mistral:7b).
4. Offers installs for the CLIs themselves (`brew install ollama`,
   `npm i -g @openai/codex`, etc.) on macOS — best-effort only.
5. After install, the LLM is automatically available as a provider via a new
   `OllamaProvider` (separate, smaller piece — Phase 10b).

**Phase 10a (this cut):**
- `GET /api/installer/status` → `{ cli: { claude, codex, kiro, ollama }, models: [...] }`
- `POST /api/installer/install` body `{ target: "ollama" | "codex" | "model:gemma3:4b" }`
  — runs a shell command in the background, streams stdout via SSE.
- Frontend `LLMInstallerPage.tsx` with cards.

**Phase 10b (deferred unless time):**
- `OllamaProvider(LLMProvider)` that calls `ollama run <model>` interactively
  or hits `http://127.0.0.1:11434/api/chat`.
- Add to the provider factory in `chat.py`.

**Files:** `src/arz/installer.py`, `src/arz/dashboard/routes/installer.py`,
`frontend/src/pages/LLMInstallerPage.tsx`,
`src/arz/providers/ollama.py`.

---

## Build order (dependency-driven)

1. Phase 1 (system prompt) — foundational, unblocks everything else
2. Phase 2 (lessons) — needed by Phase 4 tools
3. Phase 9 (security) — needed by hooks before subagents go autonomous
4. Phase 5 (subagents) — needed by Phases 6, 7, 8
5. Phase 4 (toolbelt) — depends on 2 + 5
6. Phase 6 (channels)
7. Phase 7 (heartbeat) — depends on 5
8. Phase 8 (task runner) — depends on 5
9. Phase 3 (memory files + FTS5) — orthogonal, can ship anytime
10. Phase 10 (LLM installer) — orthogonal

---

## Out of scope for this cut

- Slack surface (MeshClaw's `slack/gateway.py`) — arz already renders in the
  browser; Slack is a follow-up.
- Mwinit terminal / kiro-cli auth flow — Amazon-specific.
- CloudWatch RUM stats — AWS-specific.
- Vector embeddings via Ollama in memory — defer until ollama is wired (10b).
