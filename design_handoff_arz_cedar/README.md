# Handoff: Arz Cedar Redesign

## Overview

Arz is a personal AI dashboard — your home for orchestrating multiple LLM CLIs (Claude Code, Kiro, Codex, Gemini), running scheduled jobs, managing memory, watching channels, and steering autonomous agents. This redesign rebuilds the entire frontend around a cedar-and-mountain visual identity, with reworked information architecture, an operations-room board, real activity rails, agent collaboration channels, and tightened conversation management.

The design covers **every screen** in the app, plus three layout variations each for Memory, Schedule, and Analytics (toggled via the in-design Tweaks panel).

## About the Design Files

The files in this bundle are **design references** built as a single React-via-Babel HTML prototype. They are **not** production code to copy directly.

The task is to **recreate these designs in the existing Arz frontend codebase** (`frontend/`, React + TypeScript + Vite, with the existing component library and route structure). Use the prototype HTML/JSX as the source of truth for visual style, layout, copy, and interaction patterns — but implement against the real backend, real router, real state, and real data shapes that already exist in the app.

If a design pattern conflicts with an existing convention in the codebase, prefer the codebase convention and ask before diverging.

## Fidelity

**High-fidelity.** Final colors, typography, spacing, iconography, and interaction states are decided. Recreate pixel-faithfully using the codebase's existing libraries and patterns. Exact hex values and spacing live in `redesign/tokens.css` — port them into the codebase's existing token system rather than hard-coding.

## How to view the prototype

Just **open `Arz Cedar Redesign.html` directly in a browser** — double-click it or drag it into a tab. It's a single self-contained file (all JSX inlined, only external dependency is React + Babel from CDN, so you need internet on first open).

The left sidebar navigates between every page. The bottom-right "Tweaks" toggle exposes runtime knobs (theme, density, memory layout variant, etc.). Hold ⌘K (or Ctrl+K) to open the search palette.

## Files in this bundle

| File | Role |
|---|---|
| `Arz Cedar Redesign.html` | The whole prototype — open in a browser. All JSX is inlined; no build step. |
| `redesign/tokens.css` | All design tokens (colors, type, spacing, motion). **Port these first.** Same tokens are embedded in the HTML, this is the standalone reference. |

---

## Design Tokens

### Colors — Dark theme (default)

| Token | Hex | Use |
|---|---|---|
| `--bg` | `#0b1210` | App background |
| `--surface` | `#111a16` | Sidebars, cards, header |
| `--s2` | `#16211c` | Hover/secondary surface |
| `--s3` | `#1c2922` | Tertiary surface |
| `--border` | `#243228` | Default borders |
| `--border2` | `#2d3e33` | Stronger borders |
| `--hairline` | `rgba(228,222,204,.06)` | Inner dividers |
| `--cedar` | `#4a8a6a` | Primary brand |
| `--cedar-2` | `#5fa080` | Brand accent text |
| `--cedar-deep` | `#2d6a4f` | Pressed brand |
| `--cedar-glow` | `#76c89c` | Highlight, active state, focus |
| `--cedar-dim` | `rgba(74,138,106,.12)` | Tinted surfaces |
| `--cedar-line` | `rgba(74,138,106,.35)` | Tinted borders |
| `--text` | `#e6dfd1` | Primary text |
| `--text2` | `#a4b3a8` | Secondary text |
| `--text3` | `#758578` | Tertiary text |
| `--muted` | `#5a6c63` | Muted/meta text |
| `--dawn` | `#d9986e` | Warning / preference accent |
| `--stone` | `#7090a8` | Neutral accent / Kiro brand |
| `--ember` | `#c0654a` | Error / destructive |
| `--pine` | `#88a890` | Success |

### Colors — Light theme

Light theme inverts surfaces to a warm parchment palette (`--bg: #f5f1e6`, `--surface: #fbf8ef`) and deepens cedar greens for AA contrast. Full mapping in `redesign/tokens.css` under `[data-theme="light"]`.

### Typography

| Token | Stack | Use |
|---|---|---|
| `--fd` | `"Instrument Serif", "Cormorant Garamond", Georgia, serif` | Display / page titles / poetic flourishes |
| `--fn` | `"DM Sans", -apple-system, system-ui, sans-serif` | Body, UI |
| `--fm` | `"JetBrains Mono", "DM Mono", ui-monospace, monospace` | Timestamps, code, IDs, eyebrows |

Body sits at 14px / 1.55 line-height. Page title sizes range 22–32px. Eyebrow labels are 10–10.5px monospace, uppercase, `.16em` letter-spacing. Italic em is used inside titles for poetic emphasis (e.g. *"thriving"*, *"operations room"*).

### Radii, density, motion

- Radii: `--r: 8px`, `--r2: 12px`, `--r3: 18px`
- Density modes (`[data-density]`): compact / cozy / airy — adjust `--pad`, `--pad2`, `--pad3`, `--row`, `--gap`
- Shadows: `--shadow-1` (subtle), `--shadow-2` (card lift)
- Animations: `bounce` (typing dots), `pulse` (live status), `fadeUp`, `slideRight`, `grow` (memory rings)

### Iconography

All icons are inline 16×16 SVG strokes drawn in `foundation.jsx` (`IC.*`). Stroke width 1.4–1.6, rounded linecap/linejoin, currentColor fill. Icons use organic, slightly hand-drawn forms — keep that character if you swap to a library (`lucide` is the closest match in feel; the existing icons are deliberately simpler than `phosphor` or `heroicons`).

---

## Information Architecture

Sidebar nav, top to bottom:

1. **Overview** — landing dashboard
2. **Chat** — primary work surface, three-pane layout
3. **Memory** — what Arzeh remembers (3 layouts: Rings / List / Forest)
4. **Schedule** — cron jobs (3 layouts: Calendar / Timeline / Grid)
5. **Analytics** — usage + cost (3 layouts: Topo / Cards / Heatmap)
6. **Capabilities** — MCP tools and integrations
7. **Channels** — agent collaboration rooms
8. **Agents** — custom agent personas (LLM-agnostic)
9. **Models** — LLM CLI / cloud / local model installers
10. **Autopilot** — autonomous rules
11. **Autonomy** — log of actions taken without asking
12. **Operations** — agent management board (waiting / running / idle / failed) + your action items
13. **Settings**

A top header sits above all pages with: breadcrumb, ⌘K search (indexes pages + active sessions + history), theme toggle (light/dark), notifications, avatar.

---

## Screens

### Overview

- Hero: poetic greeting with live italicized adjective ("thriving") tied to system state
- Right rail: "What changed today?" + "New chat" CTAs
- Active conversations card (clickable rows → Chat)
- Quick stats grid: memory count, active jobs, autopilot triggers, weekly tokens

### Chat — primary surface

Three-pane layout: **Conversations sidebar (228px) · Main thread · Activity rail (300px)**.

#### Conversations sidebar
- Header: "Conversations" eyebrow + new-chat icon
- List of sessions, sorted with **pinned** items at top (hairline divider before unpinned section)
- Each row: leading pin glyph (visible only when pinned), title, relative time, provider tag (CC / Kiro)
- **Hover toolbar** on each row: Pin/Unpin · Rename · Archive
- Click row → set active session
- **History drawer** pinned to bottom: collapsible section with all archived/older conversations. Click any row to restore it as an active session (it returns to the top of the active list).

#### Main thread
- Header: 48px tall — title, pinned glyph (if pinned), provider tag, message count + relative time, ✦ Rename-with-AI icon button (calls active model to rename), Export, more-menu
- Messages rendered as bubbles, auto-scrolled to bottom on new message
- Streaming indicator: three pulsing cedar-glow dots
- Composer:
  - Auto-resizing textarea (1–10 rows)
  - Pill-shaped dropdown selectors below: **CLI** (Claude Code / Kiro / Codex / Gemini), **Agent** (Coder / Reviewer / Test writer / Researcher / SRE), **Model** (frontier / fast / local options), **Approval** (Normal / Reads / Trust / YOLO with descriptions)
  - Right side: paperclip, send (Enter sends, Shift+Enter newline)

#### Activity rail (right)
Tabbed: **Tools · Files · Subagents · Log** — each tab shows a count badge.

- **Tools** — chronological tool calls (Read, Grep, Edit, Write, Bash) with done check; "Roots growing" memory write callout below
- **Files** — workspace files touched this turn, color-coded by status (edited cedar / created pine / deleted ember / read muted) with `+lines / −lines` deltas. Click to expand a content preview with View-diff / Open. Status counts at top, "Review all" + Export at bottom.
- **Subagents** — card per spawned subagent with status dot (running pulse / complete / idle / failed), role description, live progress bar for runners, error trace for failures, model + steps + token meta. Click to expand contextual actions per state (Pause/Watch · Start · View output/Promote to memory · Retry/Trace). "Spawn subagent" footer.
- **Log** — raw SSE event stream as monospaced log with type glyphs (✦ asst · ⚒ tool · ⊚ subagent · ◉ memory · › user · ! warn). Filter pills across the top. Live-streaming indicator + `.jsonl` export at bottom.

### Memory — 3 variants

Toggle via `tweaks.memoryVariant`:

- **Rings** (default): radial SVG with three concentric strength bands (Recent / Strong / Core); each memory is a dot colored by kind (lesson cedar / fact stone / preference dawn). Hover a dot → inspector panel updates with title, body, tags, strength %.
- **List**: dense table — kind chip · title · body excerpt · tags · strength bar · created date. Sortable columns.
- **Forest**: tree-cluster grouping by tag domain. Each tag is a small grove; memories are leaves; trunk thickness = recall frequency.

### Schedule — 3 variants

- **Calendar**: month grid with cron jobs scattered as cedar dots on their next-fire days
- **Timeline**: horizontal day strip showing today's schedule, "now" line as ember vertical
- **Grid**: detailed table with cron expr, prompt, surface (email/slack/in-app), state, next fire, last run, run count

### Analytics — 3 variants

- **Topo** (default): topographic-line area chart of message volume over 12 weeks, with cost/token sublines
- **Cards**: stat blocks (sessions, msgs, tokens in/out, cost) with sparklines
- **Heatmap**: 7×12 grid, darker cell = more activity that day

### Capabilities

MCP tool registry — grouped by domain (code / data / messaging / web). Each tool: icon, name, vendor, description, install/configure state. Add-tool drawer with search + "from MCP marketplace".

### Channels

Agent collaboration rooms (Slack-style). Channel list left, member chips up top (each chip shows a small model dot indicating which agent is which CLI/model). Message thread renders @mentions inline with the cedar-glow color. Composer at bottom. Empty state: cedar sapling 🌱 with "kick things off" prompt.

### Agents

Custom agent personas, **LLM-agnostic** — each agent is a system prompt + tool allowlist + approval policy that any of the four CLIs can run. Left rail: agent list with status pulse. Right pane: inspector with role, system prompt (collapsible code block), tools, approval default, compatibility row showing which CLIs can run this agent. Edit / Duplicate / Delete actions.

### Models

Three sections, each with a header band:

- **CLIs** — Claude Code, Kiro, Codex, Gemini. Cards show vendor, version, description, tags, install/run state, "default" badge, Install / Set default actions.
- **Cloud models** — frontier API models (Opus 4.7, Haiku 4.5, GPT-5, Gemini 2.5). Cards show context window, cost, configured/needs-key state, primary badge.
- **Local models** — Ollama-style local pulls (Qwen, Llama, Mistral). Cards show size, RAM requirement, Pull / Start / Stop actions.

### Operations (was "Board")

The **agent management room**. Two stacked sections:

#### Agent operations
4-column board:
1. **Waiting on you** (cedar-glow dot) — agents blocked on your decision. Each card: agent name + CLI, model, task, *italic why-blocked reason*, **Approve** + Open buttons, "waiting Xm · session" footer.
2. **Running** (pine dot, pulsing glow) — in-flight agents. Each card: progress bar, %, ETA, pause icon.
3. **Idle** (text3 dot) — parked, ready. "Idle Xm" + Resume button.
4. **Failed** (dawn-tinted) — error message in a left-bordered callout, Retry + Trace buttons.

#### Your action items
Cedar-drafted to-dos pulled from chats, memory, and autopilot flags.
- Filter pills: All / Open / Done with count
- Each row: checkbox toggle, task text (line-through when done), source ("from chat · s2", "from memory", "autopilot flag"), due date, priority chip (high cedar-glow / med cedar-2 / low text3)
- Footer note: "Cedar drafts these from your conversations and memory" + "Add manually"

### Autopilot

Rule list — `WHEN <condition> THEN <action>` cards. Each card shows trigger count, on/off toggle. Add-rule button. Quiet-hours panel.

### Autonomy

Reverse-chronological log of actions Arzeh took without asking. Right-side trust dial (slider) — moving it left brings more decisions back to you for approval. Each entry shows action, justification, whether it was reversible, "review" link.

### Settings

Standard sectioned settings (account, theme, density, notifications, keyboard shortcuts, data export). Use existing codebase patterns.

---

## Interactions & Behavior

- **⌘K / Ctrl+K**: open search palette (indexes pages, active sessions, history)
- **Pin conversation**: hover toolbar on row → pin icon → row sorts to top with cedar-glow leading glyph
- **Rename with AI**: ✦ icon in chat header → calls active model with the conversation context to generate a new title; row shows "renaming…" while in flight
- **Restore from history**: click any row in the History drawer → it moves back to active conversations
- **Tweaks panel**: bottom-right toggle → floating panel with theme switch, density, memory/schedule/analytics layout variants, and other runtime knobs. Persisted via `__edit_mode_set_keys` postMessage.
- **Approval gate** (chat composer): YOLO state shows ember outline as a danger signal
- **Streaming**: assistant bubbles fade-up on arrival; typing dots bounce until first delta lands
- **Memory ring hover**: dot scales to r=9, halo ring appears, inspector panel updates
- **Agent ops Approve**: in real impl, sends approval to backend, agent resumes from blocked state

### Animations / motion

| Element | Duration | Easing |
|---|---|---|
| Bubble fade-up | 220ms | ease |
| General fade-in | 250ms | ease |
| Slide-right (sidebar reveal) | 250ms | cubic-bezier(.2,.7,.3,1) |
| Pulse (live indicators) | 1.6s loop | ease-in-out |
| Bounce (typing dots) | 1.2s loop, staggered .2s | ease-in-out |
| Rename loading | 700ms (mock) | — |
| Hover state transitions | 100–150ms | linear |

---

## State Management

The prototype uses local React `useState` everywhere — there is no shared store. In the real codebase, follow whatever pattern is already established (Zustand, Redux Toolkit, React Query for server state, etc.). State surfaces that need real backing:

- **Sessions** (active list, history, pinned set) — should sync to backend; pin/archive/rename/restore are all server mutations
- **Active session ID** — URL-routed (`/chat/:sessionId`) so conversations are linkable
- **Messages** — server-streamed via SSE; the rail's Log tab listens to the same stream
- **Tools / Files / Subagents** — derived from message stream events
- **Memory** — server-fetched; mutations go through `/api/memory/*`
- **Crons** — `/api/schedule/*`
- **Operations** (waiting/running/idle/failed agents) — server-pushed status; "Approve" is a mutation
- **TODOs (action items)** — server-stored; Cedar's auto-drafted ones are flagged separately from manual entries
- **Theme + density** — `data-theme` and `data-density` attributes on `<html>`, persisted to localStorage

---

## Mock Data Shapes

All in `redesign/foundation.jsx` under `MOCK`. Use these as a reference for the real type definitions:

- `SESSIONS: { id, title, provider, msgs, updated_at, pinned? }[]`
- `HISTORY: { id, title, msgs, updated_at }[]`
- `MSGS: { id, role: 'user'|'asst', ts, text, elapsed?, model?, usage?: {in,out} }[]`
- `MEMORIES: { id, kind: 'lesson'|'fact'|'preference', title, body, tags: string[], strength: 0..1, created }[]`
- `CRONS: { id, name, expr, prompt, surface: 'email'|'slack'|'in-app', state: 'on'|'off', next, last, runs }[]`
- `TOOL_ENTRIES: { callId, name, input, done }[]`
- `WORKSPACE_FILES: { path, status: 'edited'|'created'|'deleted'|'read', added, removed, ts, preview }[]`
- `SUBAGENTS: { id, name, role, status: 'running'|'complete'|'idle'|'failed', progress?, err?, model, steps, tokens, spawned, parent }[]`
- `SSE_LOG: { ts, level: 'sys'|'user'|'asst'|'tool'|'sub'|'memory'|'warn', msg, detail }[]`
- `AI_OPS: { 'Waiting on you' | 'Running' | 'Idle' | 'Failed': OpCard[] }` — each column has a different card shape (see foundation.jsx)
- `TODOS: { id, t, src, due, done, priority: 'high'|'med'|'low' }[]`
- `AUTOPILOT_RULES: { id, name, when, then, state, triggered }[]`
- `CHANNELS: { id, name, kind, desc, status, stats, color, members? }[]`
- `CUSTOM_AGENTS: { id, name, emoji, color, role, desc, tools, approval, systemPrompt, uses, lastUsed }[]`
- `CLIS / CLOUD_MODELS / LOCAL_MODELS` — see foundation.jsx for fields

---

## Implementation Notes for Claude Code

1. **Start with tokens.** Port `redesign/tokens.css` into the existing CSS variable system (or Tailwind theme, or styled-components theme — whatever the codebase uses). All other work depends on these.
2. **Build the shell next.** Top header + sidebar + page router. Match the sidebar nav order and labels exactly.
3. **Then chat.** It's the most complex page and exercises the most primitives. Once Chat works, the other pages reuse the same `Card`, `Btn`, `Tag`, `SegSeg` patterns.
4. **Prefer the codebase's existing components** over recreating prototype primitives. The prototype's `Btn`/`Card`/`Tag` are minimal stand-ins.
5. **Don't ship the Tweaks panel.** It's a design-time tool; production gets a real Settings page.
6. **Memory / Schedule / Analytics variants**: pick one as the default per page and keep the others reachable via a layout switcher in the page header (the prototype already exposes this via `SegSeg`).
7. **Iconography**: the prototype uses ~30 hand-rolled SVG icons in `IC`. Map each to your icon library equivalent (`lucide-react` is closest in feel) — list of names: chat, memory, schedule, analytics, caps, channels, agents, models, autopilot, autonomy, board, settings, plus, more, close, check, edit, trash, pin, spark, clip, wrench, llm, bot, download, copy, play, pause, search, cron, history (use clock), refresh.
8. **Empty states matter.** Every collection has a designed empty state in the prototype — port them.

---

## Open Questions

- Do you want the cedar visual language (italic display serif, organic SVG icons, topographic backgrounds) to extend to system emails / notifications, or stay confined to the dashboard?
- The Operations page assumes server-pushed agent status — confirm the SSE/websocket schema before implementing.
- "Rename with AI" calls the active CLI's model — confirm whether this should use a cheap model (Haiku) regardless of session model, to keep cost predictable.
