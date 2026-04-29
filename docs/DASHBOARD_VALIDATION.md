# Dashboard validation — page-by-page issues

Validation run: 2026-04-28. Server: http://127.0.0.1:7777.

Methodology: hit every endpoint each page mounts, inspect the page component
for hooks-rules violations / undefined props, audit which Phase 1–10 backends
have no UI yet.

---

## Endpoint health (all pass)

| Page | Endpoints | HTTP |
|---|---|---|
| `/` (chat) | `/sessions`, `/settings` | 200 |
| `/overview` | `/overview` | 200 |
| `/agents` | `/agents` | 200 |
| `/memory` | `/memory/markdown`, `/memory/lessons`, `/memory/files`, `/memory/search` | 200 |
| `/schedule` | `/cron` | 200 |
| `/analytics` | `/analytics/messages-by-day`, `/analytics/tokens-by-day`, `/analytics/tool-usage`, `/analytics/providers`, `/analytics/latency` | 200 |
| `/capabilities` | `/mcp/servers`, `/prompts`, `/tools` | 200 |
| `/models` | `/installer/status` | 200 |
| `/settings` | `/settings` | 200 |
| `/shortcuts` | (static) | n/a |

Backend-only (no UI yet, but routers respond): `/lessons`, `/hooks`,
`/heartbeat`, `/subagents`, `/channels`, `/taskrun`, `/memory/files`. All 200.

---

## Real bugs

### / (chat)
- [minor] Lessons stored via the new `POST /api/lessons` endpoint **don't show
  up** in the Memory page — Memory page reads from the OLD
  `/memory/lessons` (SQLite-backed `LessonsStore`), not the new
  `/lessons` (jsonl-backed `LessonStore`). The new store is what auto-injects
  on every chat turn, so lessons added via the LLM tool `learn_add` are
  invisible to the user. **Fix:** add a "Lessons" tab to MemoryModal that
  reads from `/api/lessons`.
  Repro: `POST /api/lessons` → check Memory page → not there.

### /memory
- [missing-ui] The new memory-files store (`~/.arz/memory/preferences.md`,
  `projects.md`) auto-injects into every prompt but has no UI to edit them.
  Endpoint `/api/memory/files` works. **Fix:** new "Memory Files" tab in
  MemoryModal with a textarea editor for each file.

### /capabilities
- [missing-ui] Hooks config (`~/.arz/hooks.json`) — auto_approve_tools,
  auto_replies, deny patterns — has no UI. Endpoint `/api/hooks` works.
  **Fix:** new "Hooks" tab in CapabilitiesModal.

### Autonomy backend (no UI for any of it)
- [missing-ui] **Subagents** — list/create endpoint works but no page lets
  the user see what spawned, what's running, or what the result was.
- [missing-ui] **Channels** — multi-agent A2A spaces fully implemented
  backend-side; no page to create / view.
- [missing-ui] **Heartbeat** — checklist file at `~/.arz/HEARTBEAT.md` is
  edited by the user with `vim`; no in-app editor or live "tick log" view.
- [missing-ui] **Task runner** — POST /api/taskrun kicks off a multi-step
  decompose-execute-verify; no page to submit specs or watch progress.

  **Proposed fix:** one new `/autonomy` page with 4 tabs (Subagents,
  Channels, Heartbeat, Tasks) — keeps the nav from sprawling.

### /models (LLMInstallerPage)
- [minor] No in-app way to mark a freshly-pulled Ollama model as the
  session's model — installer pulls work, but the model picker in the chat
  doesn't list Ollama models. **Out of scope** for this fix cut; tracked in
  the original plan as Phase 10b (OllamaProvider).

### /settings
- [verified-fixed] `useTheme()` was previously called after early return
  (Rules-of-Hooks violation). Fixed in prior commit; the hook is now at the
  top of the function.

### General
- [minor] `frontend/src/pages/LLMInstallerPage.tsx:63` calls `fetch()`
  directly for the install stream rather than going through `api.installTarget`.
  This works (the api wrapper returns a `Response`), but auth header isn't
  applied — only works because token-auth defaults are loose for localhost.
  **Fix:** route through `api.installTarget(target)`.

---

## Scope-of-fix this pass

In priority order:

1. **`/autonomy` page (new)** — tabs: Subagents · Channels · Heartbeat · Tasks ✅ shipped
2. **MemoryModal: + Auto-inject Lessons tab** (reads new `/api/lessons`) ✅ shipped
3. **MemoryModal: + Memory Files tab** (preferences.md, projects.md) ✅ shipped
4. **CapabilitiesModal: + Hooks tab** ✅ shipped
5. **LLMInstallerPage: route through `api.installTarget`** ✅ shipped

## Smoke-test outcomes after fixes

```
lessons:       create #N → pin → delete = 201/200/204 ✓
memory-files:  GET → PUT = 200/204 ✓
hooks:         PUT → GET round-trips = 204/200 ✓
channels:      create → post → delete = 201/201/204 ✓
heartbeat:     GET = 200, content present ✓
```

Refresh the browser to pick up the new bundle. New nav entries: **Autonomy**
(top-level), Memory page now has **Auto-inject Lessons** + **Memory Files**
tabs, Capabilities has a new **Hooks** tab.
