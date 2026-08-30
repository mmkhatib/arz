# Tier 3 — Extensibility & Reach

> **Priority: lowest — and mostly a trap.** This tier is where KiroCrew's ~1000
> contributors and AWS distribution will always out-execute a solo project.
> Chasing it item-for-item is a treadmill.
>
> The recommendation is to build **§3.1 (App Kit)** because it turns arz's own
> pages into a plugin surface and lets other people close the rest of this tier
> for you, plus **§3.4 (webhooks)** because it is small and unblocks reactive
> work. Treat §3.2 and §3.3 as demand-driven, not roadmap items.

---

## 3.1 — App Kit  *(build this one)*

**Gap:** arz has a tool registry (`~/.arz/tools/`, `tools/registry.py`) but no
way to package a *user-facing* extension. Every one of arz's 16 frontend pages
is hardcoded into the bundle.

**Why this one is worth it:** arz already has more dashboard surface than
KiroCrew (Analytics, Board, Autopilot, Autonomy, Compare, Projects,
Capabilities, LLM Installer). An app format turns that from a fixed feature list
into a platform, and it is the only Tier 3 item that makes the *other* Tier 3
items somebody else's contribution rather than your backlog.

**App format** — a directory under `~/.arz/apps/<slug>/`:

```
manifest.json    { slug, name, version, arz_version, permissions[], routes[] }
backend.py       optional — registers scoped FastAPI routes under /api/apps/<slug>
ui.js            optional — ES module default-exporting a React component
skills/*.md      optional — markdown skills registered while the app is enabled
tools/*.py       optional — reuse the existing tool loader
```

**Runtime**
- Dashboard mounts `ui.js` lazily at `/apps/<slug>`; nav entry from the manifest.
- Backend routes are namespaced and permission-scoped — an app declares
  `permissions: ["sessions:read", "memory:write"]` and gets a capability-checked
  client, never the raw `SessionManager`.
- Lifecycle hooks: `on_install`, `on_enable`, `on_disable`, `on_session_start`,
  `on_turn_complete`. Reuse the existing `core/event_bus.py`.
- Apps run in the Tier 1 sandbox like any other subprocess work.

**Security note:** an app format is an arbitrary-code-execution format. It must
ship *after* Tier 1 §1.1 and §1.5, not before. Installs are local-path only at
first — no registry, no remote fetch, until there is a signing story.

**Files:** `src/arz/apps/{loader,manifest,permissions}.py`,
`src/arz/dashboard/routes/apps.py`, `frontend/src/pages/AppsPage.tsx`,
`frontend/src/appHost.tsx`

---

## 3.2 — Additional messaging channels  *(demand-driven)*

arz has Slack, Telegram, WhatsApp. KiroCrew adds Discord, Teams, Webex, WeCom, WeChat.

`MessagingSurface` already exists and the three current surfaces average ~150
lines each, so each new one is roughly a day. But shipping five channels nobody
asked for is five more auth flows to maintain.

**Recommendation:** add Discord only (largest developer overlap, simplest
outbound-only auth). Leave the rest until someone asks — and once §3.1 lands,
a channel can ship as an app instead of a core surface.

**Files:** `src/arz/surfaces/discord/surface.py`

---

## 3.3 — Incognito / ephemeral sessions  *(small, do it opportunistically)*

**Gap:** no `incognito` anywhere in `src/`. Every session writes to memory,
lessons, episodic store, and the consolidator's nightly rollup.

- `Session.ephemeral: bool` (nullable — old session JSON keeps loading).
- When set: skip `inline_learn` extraction, skip `post_turn_extract`, skip
  episodic writes, exclude from `consolidator.py`, and delete the session JSON
  on close rather than moving it to history.
- UI: toggle in `NewSessionModal`, persistent badge in the session header so the
  state is never ambiguous.

**Files:** `src/arz/session/session.py`, `src/arz/inline_learn.py`,
`src/arz/post_turn_extract.py`, `src/arz/consolidator.py`,
`frontend/src/components/NewSessionModal.tsx`

---

## 3.4 — Authenticated webhooks  *(build this one)*

**Gap:** arz reacts to chat, cron, and heartbeat — but nothing external can
*trigger* it. WhatsApp already needs a webhook route mounted on the gateway
(`surfaces/whatsapp/surface.py` notes this), so half the plumbing is implied.

- `POST /api/hooks/{name}` — HMAC-SHA256 signature over the raw body, per-hook
  secret in `~/.arz/.env`, replay window on a timestamp header.
- A hook maps to: start a session with a template prompt, fire a subagent, or
  run a task spec. Payload available to the prompt as `{{payload.*}}`.
- Rate-limited per hook; every fire lands in the Tier 1 audit log.
- Unattended by definition — hooks run under `strict` sandbox (Tier 1 §1.1).

**Files:** `src/arz/dashboard/routes/webhooks.py`, `src/arz/webhooks.py`,
`frontend/src/pages/AutonomyPage.tsx` (hook management UI)

---

## Explicitly not doing

- **Chasing the full channel list.** See §3.2.
- **A public app registry.** Local installs only until signing exists.
- **Telemetry.** KiroCrew needs it to justify headcount. arz is local-first;
  shipping a phone-home would cost more trust than the data is worth.
- **Managed Python / one-line installer parity.** `uv tool install arz` is the
  reviewable path and arz's own deny patterns flag pipe-to-shell.

---

## Build order

1. §3.4 webhooks — small, unblocks reactive automation, no dependencies
2. §3.3 incognito — small, mostly nullable-field plumbing
3. §3.1 App Kit — **gated on Tier 1 §1.1 + §1.5 landing first**
4. §3.2 Discord — only if asked
