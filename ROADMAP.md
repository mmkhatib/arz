# Arz — Product Roadmap

> Arz is a personal AI runtime: a self-hosted, provider-agnostic shell that routes your conversations to any LLM CLI (Claude Code, Kiro, etc.), persists sessions, manages workspace files, and grows into a full ambient intelligence layer.

---

## Shipped

### Phase 0 — Scaffold
- FastAPI gateway + uvicorn (`arz gateway`)
- React 19 + Vite + Tailwind frontend
- Cedar green (#2d6a4f) design system + CSS variable tokens
- Static file serving (frontend dist embedded in Python package)

### Phase 1 — Provider Core
- `LLMProvider` ABC — pluggable backend abstraction
- `claude-code` and `kiro-cli` provider implementations
- Global provider config in `~/.arz/config.yaml`
- SSE streaming from provider → frontend (`text_chunk`, `tool_call`, `complete`, `error` events)

### Phase 2 — Sessions & Memory
- Session dataclass (id, title, surface, messages, timestamps, color, work_dir, provider)
- `SessionManager`: create, get, list_active, list_inactive, reactivate, save, load_all
- Persistent JSON storage at `~/.arz/sessions/{id}.json`
- `MemoryStore` ABC with `MarkdownStore` and `LessonsStore` (SQLite) implementations
- `VectorStore` stub (sqlite-vec wired, queries not yet exposed)

### Phase 3 — Dashboard UX
- Session sidebar with color dots, live message counts, relative timestamps
- Provider badge per session (CC / Kiro)
- `CollapsibleToolGroup` — tool call accordion with input/output rendering
- `ActivityPane` — 4-tab panel: Tools, Files, Subagents, Log
- Streaming typewriter effect on assistant messages
- YOLO mode toggle (auto-approve tool calls)
- Auto-titling sessions from first assistant message

### Phase 4 — Provider Picker & Session History
- Per-session provider selection at creation time (stored in session JSON)
- `NewSessionModal` — provider radio buttons with global default pre-selected
- `GET /api/sessions/history` + `POST /api/sessions/{id}/reactivate`
- Collapsible history section in sidebar; "Resume" button restores inactive sessions
- Native session resume via `SessionMap` (maps arz IDs → provider session IDs)

### Phase 5 — File Viewer
- `GET /api/sessions/{id}/files` — walks workspace, returns `{path, rel_path, name, ext, size}`
- Files tab: workspace scan on activation + 5-second auto-refresh
- Merged live-touched + workspace file list (deduped; live-dot indicator)
- `FileViewer` full-pane takeover with type-aware renderers:
  - **CodeView** — hljs syntax highlighting + synchronized line-number gutter
  - **JsonView** — collapsible tree (depth-2 collapse, color-coded primitives)
  - **CsvView** — table with sticky header, quoted-field parsing, 500-row cap
  - **HtmlView** — sandboxed `<iframe srcDoc>`
  - **MarkdownView** — react-markdown
  - **ImageView** — native img tag via `/api/files/read`
  - **BinaryView** — placeholder for unrenderable types

---

## Near Term

### Settings Panel
- In-app settings page (gear icon) replacing the current placeholder
- Global provider switch (Claude Code ↔ Kiro-cli)
- Model selection per provider (e.g., `claude-opus-4-7`, `claude-sonnet-4-6`)
- Token auth toggle + key display
- Dashboard port configuration
- YOLO mode persistent preference

### Search
- Full-text search across all sessions and messages
- `GET /api/search?q=` endpoint backed by SQLite FTS5
- Search bar in sidebar with live results; clicking a result opens session at that message
- Filter by provider, date range

### Keyboard Shortcuts
- `Cmd+K` — new session
- `Cmd+F` — search
- `Cmd+[` / `Cmd+]` — previous / next session
- `Cmd+W` — close / archive current session
- `Escape` — close FileViewer / modal
- Shortcut cheat-sheet overlay (`?`)

### Token & Cost Tracking
- Parse `usage` field from provider SSE events
- Display input/output token counts per message
- Running total in session header
- Per-provider cost estimates (configurable $/token rates in settings)

### File Upload to Workspace
- Drag-and-drop or file picker in InputBar
- Files copied to `session.work_dir`; appear in Files tab immediately
- Image files rendered inline in the chat as user messages

---

## Mid Term

### Memory Browser
- `Memory` tab in ActivityPane (or dedicated settings section)
- List saved MarkdownStore entries and LessonsStore rows
- Inline edit, delete, search across memories
- `POST /api/memory` + `DELETE /api/memory/{id}` endpoints
- Expose VectorStore semantic search: `GET /api/memory/search?q=` using sqlite-vec

### Cron / Scheduled Sessions
- Define recurring prompts on a schedule (cron expression or interval)
- `GET /api/cron`, `POST /api/cron`, `DELETE /api/cron/{id}`
- Cron sessions run in background; results appear in session history
- Notification badge on sidebar when a cron session completes

### Subagent Orchestration UI
- `Subagents` tab in ActivityPane shows spawned sub-sessions (already tracked in backend)
- Visual tree: parent session → child subagents with status (running / complete / error)
- Click a subagent row to jump to its session
- Session detail shows "spawned by" parent link

### Export & Share
- Export session to Markdown (download button in session header)
- Export as JSON (full raw message history)
- Copy session link (deep link to specific session, requires token auth to open)

### Multi-Model Sessions
- Mid-session model switch (drop-down in InputBar header)
- Model recorded per-message so history shows which model answered what
- Compare view: send same prompt to two models side-by-side

### Terminal Output Viewer
- `bash`, `run_command`, `execute_code` tool results rendered with ANSI color support
- Collapsible terminal block instead of raw text dump
- Copy button on terminal blocks

---

## Long Term

### Core Module Refactor
- Extract `core/` module: `SessionManager`, `MessageRouter`, `EventBus`
- Zero imports from `surfaces/` or `providers/` inside `core/`
- All surfaces and providers depend inward on `core/` only
- Enables clean multi-surface routing (same session reachable from dashboard + Slack)

### Messaging Surfaces
- **Slack** surface: receive messages in a DM, stream replies, tool approval via reactions
- **Telegram** surface: same pattern; owner-lock via chat_id allowlist
- **WhatsApp** surface (via Twilio or Meta API)
- **TUI** surface: `arz tui` — terminal UI using Textual or Rich
- All surfaces share the same `SessionManager` — no duplicated session logic

### Mobile / PWA
- Progressive Web App manifest + service worker for offline shell
- Push notifications (via Web Push) when long-running sessions complete
- Mobile-optimized layout: full-screen chat, swipe to open sidebar

### Vector Memory & RAG
- Complete `VectorStore` implementation with sqlite-vec
- Auto-embed session messages (background job, configurable model)
- `@recall` command in InputBar: semantic search over memory before sending
- Context injection: top-N relevant memories prepended to system prompt automatically

### Plugin / Tool Registry
- Define custom tools in `~/.arz/tools/` as Python files
- Hot-reload tool registry without server restart
- Tool marketplace UI: browse, install, toggle built-in tools
- Per-session tool allowlist

### Multi-User & Auth
- Optional login system (username + password, or SSO via OAuth)
- Per-user session isolation
- Shared sessions: invite another user to view/contribute to a session
- Audit log: all tool calls, file reads, shell commands

### Analytics & Observability
- Session analytics dashboard: messages/day, tokens/day, tool usage breakdown
- Provider latency tracking (p50/p95 per provider)
- Error rate by provider/model
- Export analytics as CSV

---

## Principles (Non-Negotiable)

- **Provider-agnostic** — no provider types leak into core or frontend
- **Local-first** — all data in `~/.arz/`, no cloud dependency
- **Deny-by-default security** — path reads, shell exec, network calls are gated
- **Dashboard binds 127.0.0.1** — `0.0.0.0` requires explicit opt-in + token auth
- **Async-first** — no blocking calls in request paths
- **Thin surfaces** — surfaces translate events; no session logic inside adapters
