# Stay-On-Task — Arz Gap Analysis vs MeshClaw 2.5.0

Cross-reference: [`stay-on-task.md`](./stay-on-task.md).

Verdict glyphs: ✅ parity · 🟡 partial · ❌ missing · ➖ N/A for Arz.

> **Re-verified 2026-09-05 against the code (v0.8.28).** Everything in the
> old Tier 1–4 list below had already shipped; the table rows and the
> prioritised list were both stale and were read as a to-do more than once.
> Rows are corrected in place. Check the source before trusting a ❌ here —
> and update this file in the same commit that closes a gap.

---

## Part 1 — Stay-on-task layers

### Layer 1 — Persistent session

| Concern | Arz status | Notes |
|---|---|---|
| One agent process per session_key | ✅ | `ProviderPool` + `SessionManager` |
| Async lock — one turn at a time | ✅ | per-session lock in StreamRegistry |
| FIFO queue for mid-turn user input | ✅ | `state._pending` + queued-message UI |
| OS-level liveness (`kill -0`), not idle timer | 🟡 | reaper uses `_pid_alive` but not for active-session health checks |
| Stale-corpse eviction on cold start | ✅ | `pool.get` drops a dead entry and re-creates |
| Warm pool pre-spawn | ✅ | `ProviderPool.warm_pool_size` |

### Layer 2 — Streaming tool loop

| Concern | Arz status | Notes |
|---|---|---|
| Event vocab (text/thinking/tool/permission/compaction/complete) | ✅ | `arz.acp.types` mirrors MeshClaw 1:1 |
| `_run_turn` driver consumes events + emits SSE | ✅ | |
| Mid-stream context guard (>90% → abort before tool approve) | ✅ | `routes/chat.py` rejects the tool at ≥90% + emits a `context-guard` marker |
| Provider compaction request from gateway | ❌ | no `acp.compact()` wrapper called by chat route |
| Per-chunk persist of partial assistant text | ✅ | `state.full_reply` survives client disconnect |

### Layer 3 — Bounded retry budgets

| Concern | Arz status | Notes |
|---|---|---|
| Separate counter for logic-fail vs process-crash | ✅ | `taskrunner.py` — `_MAX_RETRIES` / `_MAX_RECOVERIES` / `_MAX_COMPACTIONS` |
| `MAX_REPLAN` cap | ✅ | `_MAX_REPLAN = 2` in `taskrunner.py` |
| Same-error-twice escalation | 🟡 | goal loop has frustration counter (3× same reason → hard-reset). Task runner has nothing similar |
| `MAX_TOTAL_TASKS` global cap | ❌ | no global task cap |
| `STALL_TIMEOUT` (60min notify) | ❌ | |
| `STALL_CANCEL_TIMEOUT` (2h force-reset) | ❌ | |

### Layer 4 — Plan + replan

| Concern | Arz status | Notes |
|---|---|---|
| LLM decomposes spec into DAG | 🟡 | `task_planner` + projects/tasks exist; less rigorous grouping |
| Per-task isolated session | 🟡 | tasks fire as subagent calls — context isolation OK, but no per-task session_key |
| "Full Execution Plan" prompt with ✅/🔄/⬜ + `← YOU ARE HERE` | ✅ | `_build_step_prompt` rebuilds it on every attempt |
| `_try_replan` on task failure | ✅ | `taskrunner.py:_try_replan`, appends revised steps and keeps running |
| Working-memory + git-state injection into replan prompt | 🟡 | working memory yes; git state not gathered |

### Layer 5 — Working memory

| Concern | Arz status | Notes |
|---|---|---|
| Per-run `WorkingMemory` (`files_changed`, `decisions`, `blockers`) | ✅ | `taskrunner.WorkingMemory`, accumulated across steps |
| Re-injection every prompt | ✅ | `_build_step_prompt` opens with `memory.summary()` |
| Auto-extract `Created/Modified/Updated/Deleted/Wrote` lines | ✅ | `WorkingMemory.update_from_result` |
| Structured JSON "decisions" emitted at task end | 🟡 | `DECISION:` / `BLOCKER:` lines are parsed; no JSON envelope |

### Layer 6 — Watchdog

| Concern | Arz status | Notes |
|---|---|---|
| 30s tick checking active sessions | ✅ | `stream_registry.watchdog_loop` |
| Dead-process re-detection during turn | ✅ | watchdog + `pool.get` evicts a dead provider |
| 60min notify on no-progress | ✅ | `_STALL_NOTIFY_S` |
| 2h force-reset on stall | ✅ | `_STALL_CANCEL_S` |

### Layer 7a — Heartbeat (file-based task queue)

| Concern | Arz status | Notes |
|---|---|---|
| `~/.arz/HEARTBEAT.md` queue | ✅ | `heartbeat.py` module exists |
| 60s tick | ✅ | (verify interval) |
| `HEARTBEAT_KEEP` sentinel | ✅ | (verify) |
| Crash-safe rewrite (atomic) | ✅ | |

### Layer 7b — AutoNudge

| Concern | Arz status | Notes |
|---|---|---|
| Idle timer reset on turn-complete | ✅ | `notify_turn_complete` |
| User input cancels pending nudge | ✅ | |
| Max-cycles cap | ✅ | `autonudge_max_iterations` |
| Stop sentinel file | 🟡 | not surfaced in UI |
| State persistence (atomic + fcntl) | 🟡 | persists on session, not its own atomic file |

---

## Part 2 — Chat rendering

### Event vocabulary mapping

| Event | Arz status | Surfaces |
|---|---|---|
| `text_chunk` | ✅ | SSE `chat_chunk` → bubble |
| `thinking_chunk` | ✅ | `sse_thinking` → collapsible panel in `ChatPanel` |
| `tool_call` | ✅ | SSE `tool_call` → InlineToolStrip + Activity rail Tools tab |
| `tool_result` | ✅ | SSE `tool_result` → marks tool card done |
| `permission_request` | ✅ | approval prompt |
| `agent_switched` | ❌ | no event/rendering |
| `compaction_status` | ✅ | `sse_compaction` → banner |
| `clear_status` | ❌ | |
| `complete` | ✅ | sse_complete |

### Segmentation

| Concern | Arz status |
|---|---|
| `text_chunk* → tool_group → text_chunk*` bubble split | ✅ — `sse_segment` emits the boundary |
| First tool flushes pre-text bubble | ❌ — no flush + restart pattern |
| Open-tool fallback completion on next text | ❌ |
| Heartbeat keepalive every 5s during long ops | ✅ — `sse_heartbeat` |

### Status indicators

| Concern | Arz status |
|---|---|
| Status pill ("Thinking…" / "Running tool…" / "Compressing context…") | 🟡 — partial via thinking dots; no compaction state |
| Heartbeat dot during turns | 🟡 — frontend doesn't render an explicit pulse |
| Phase reactions (per-message emoji summarising turn) | ❌ |

### Redaction

| Concern | Arz status |
|---|---|
| Per-chunk credential redactor | ✅ — `dashboard/redact.py::redact_chunk` |
| Per-chunk exfiltration-URL redactor | ✅ — same module |
| Full-text redaction pass at turn-end | ✅ — `redact_full` |

### Persistence + replay

| Concern | Arz status |
|---|---|
| Per-slot messages list with structured role+meta | ✅ — `state.events` + saved Message objects |
| Tool cards re-hydrate with done state | ✅ — `tool_calls` persisted on Message |
| HTTP SSE replay on reconnect | ✅ — `_sse_subscribe` replays `state.events` |
| Atomic write of message log | 🟡 — JSON file written by SessionManager.save (verify atomicity) |

### Surfaces

| Concern | Arz status |
|---|---|
| Dashboard via SSE | ✅ |
| Slack thread | ➖ — out of scope unless added |
| Bidirectional bridge | ➖ |
| OPTIONS extraction `[OPTIONS: A | B | C]` → button group | ✅ — `extractOptions` + chips under the bubble (v0.8.29) |

---

## What is actually left (2026-09-05)

Everything in the previous Tier 1–4 list has shipped. Remaining, roughly by
payoff:

1. **Git state in the replan prompt.** `_try_replan` sends spec + completed
   steps + working memory; MeshClaw also sends `git status` / diff summary so
   the new plan reflects the tree as it stands.
2. **Structured decisions envelope.** `DECISION:` / `BLOCKER:` lines are
   parsed but never emitted as JSON at task end, so nothing downstream can
   consume them.
3. **Phase reactions.** No per-message status emoji (🟡 thinking → 🔧 tools →
   ✅ done) surviving reload.
4. **Tool-call undo/redo** (KiroCrew ↶/↷ on a completed tool call).
5. **Slash-command menu** in the chat input.
6. **AutoNudge stop sentinel + HEARTBEAT.md** are not surfaced in the UI.

Shipped since this doc was last accurate: mid-turn steer (v0.8.28), widget
action channel + OPTIONS chips (v0.8.29).
