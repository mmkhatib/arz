# Stay-On-Task — Arz Gap Analysis vs MeshClaw 2.5.0

Cross-reference: [`stay-on-task.md`](./stay-on-task.md).

Verdict glyphs: ✅ parity · 🟡 partial · ❌ missing · ➖ N/A for Arz.

---

## Part 1 — Stay-on-task layers

### Layer 1 — Persistent session

| Concern | Arz status | Notes |
|---|---|---|
| One agent process per session_key | ✅ | `ProviderPool` + `SessionManager` |
| Async lock — one turn at a time | ✅ | per-session lock in StreamRegistry |
| FIFO queue for mid-turn user input | ✅ | `state._pending` + queued-message UI |
| OS-level liveness (`kill -0`), not idle timer | 🟡 | reaper uses `_pid_alive` but not for active-session health checks |
| Stale-corpse eviction on cold start | 🟡 | sessions can resume "alive" but provider may be dead — no eviction-and-respawn |
| Warm pool pre-spawn | ✅ | `ProviderPool.warm_pool_size` |

### Layer 2 — Streaming tool loop

| Concern | Arz status | Notes |
|---|---|---|
| Event vocab (text/thinking/tool/permission/compaction/complete) | ✅ | `arz.acp.types` mirrors MeshClaw 1:1 |
| `_run_turn` driver consumes events + emits SSE | ✅ | |
| Mid-stream context guard (>90% → abort before tool approve) | ❌ | no early-bail; relies on provider self-limit |
| Provider compaction request from gateway | ❌ | no `acp.compact()` wrapper called by chat route |
| Per-chunk persist of partial assistant text | ✅ | `state.full_reply` survives client disconnect |

### Layer 3 — Bounded retry budgets

| Concern | Arz status | Notes |
|---|---|---|
| Separate counter for logic-fail vs process-crash | ❌ | only `_MAX_RETRIES_PER_STEP=3` lumped together |
| `MAX_REPLAN` cap | ❌ | no replan path at all |
| Same-error-twice escalation | 🟡 | goal loop has frustration counter (3× same reason → hard-reset). Task runner has nothing similar |
| `MAX_TOTAL_TASKS` global cap | ❌ | no global task cap |
| `STALL_TIMEOUT` (60min notify) | ❌ | |
| `STALL_CANCEL_TIMEOUT` (2h force-reset) | ❌ | |

### Layer 4 — Plan + replan

| Concern | Arz status | Notes |
|---|---|---|
| LLM decomposes spec into DAG | 🟡 | `task_planner` + projects/tasks exist; less rigorous grouping |
| Per-task isolated session | 🟡 | tasks fire as subagent calls — context isolation OK, but no per-task session_key |
| "Full Execution Plan" prompt with ✅/🔄/⬜ + `← YOU ARE HERE` | ❌ | task prompts don't carry the full DAG state |
| `_try_replan` on task failure | ❌ | failure currently just halts the task |
| Working-memory + git-state injection into replan prompt | ❌ | |

### Layer 5 — Working memory

| Concern | Arz status | Notes |
|---|---|---|
| Per-run `WorkingMemory` (`files_changed`, `decisions`, `blockers`) | ❌ | Arz has cross-session semantic memory (different scope). No per-task scratchpad. |
| Re-injection every prompt | ❌ | |
| Auto-extract `Created/Modified/Updated/Deleted/Wrote` lines | ❌ | |
| Structured JSON "decisions" emitted at task end | ❌ | |

### Layer 6 — Watchdog

| Concern | Arz status | Notes |
|---|---|---|
| 30s tick checking active sessions | ❌ | reaper sweeps orphan CLIs but not active-session stalls |
| Dead-process re-detection during turn | ❌ | |
| 60min notify on no-progress | ❌ | |
| 2h force-reset on stall | ❌ | |

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
| `thinking_chunk` | ❌ | event type defined but no SSE emit + no collapsible panel in frontend |
| `tool_call` | ✅ | SSE `tool_call` → InlineToolStrip + Activity rail Tools tab |
| `tool_result` | ✅ | SSE `tool_result` → marks tool card done |
| `permission_request` | ✅ | approval prompt |
| `agent_switched` | ❌ | no event/rendering |
| `compaction_status` | 🟡 | event type defined; not emitted to SSE; no UI banner |
| `clear_status` | ❌ | |
| `complete` | ✅ | sse_complete |

### Segmentation

| Concern | Arz status |
|---|---|
| `text_chunk* → tool_group → text_chunk*` bubble split | 🟡 — inline tool strip renders inside one bubble; no explicit `chat_segment` boundary |
| First tool flushes pre-text bubble | ❌ — no flush + restart pattern |
| Open-tool fallback completion on next text | ❌ |
| Heartbeat keepalive every 5s during long ops | ❌ |

### Status indicators

| Concern | Arz status |
|---|---|
| Status pill ("Thinking…" / "Running tool…" / "Compressing context…") | 🟡 — partial via thinking dots; no compaction state |
| Heartbeat dot during turns | 🟡 — frontend doesn't render an explicit pulse |
| Phase reactions (per-message emoji summarising turn) | ❌ |

### Redaction

| Concern | Arz status |
|---|---|
| Per-chunk credential redactor | ❌ — relies on provider not leaking |
| Per-chunk exfiltration-URL redactor | ❌ |
| Full-text redaction pass at turn-end | ❌ |

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
| OPTIONS extraction `[OPTIONS: A | B | C]` → button group | ❌ |

---

## Prioritised upgrade list

Top of the list = biggest user-facing payoff right now (goal loop reliability + visible streaming state). Bottom = nice-to-have once the core is solid.

### Tier 1 — Goal-loop reliability (close immediate gaps)

1. **Mid-stream context guard.** Before approving a `permission_request`, poll `provider.context_usage_pct()`; if ≥90% abort, call `provider.compact()`, then re-enter the turn. Prevents the runaway-tool-then-OOM failure mode. *Layer 2.*

2. **Watchdog tick.** 30s background task per active session: check provider alive, check time-since-last-event. At 60min emit a `stall_notify` marker; at 2h force-reset + emit `stall_cancel` marker. *Layer 6.*

3. **Separate retry counters.** Split current `_MAX_RETRIES_PER_STEP` into `MAX_RETRIES` (logic fail) + `MAX_RECOVERIES` (process crash) + `MAX_COMPACTIONS` (context overflow). Process crash + compaction don't tick the logic counter. *Layer 3.*

4. **Stale-corpse eviction.** On session resume, if provider PID dead → tear down + cold-start with `is_new=True` rather than reusing a corpse. *Layer 1.*

### Tier 2 — Chat-render parity

5. **Thinking-chunk panel.** Plumb `EVENT_THINKING_CHUNK` → new `chat_thinking` SSE event → collapsible "thinking" panel beside the bubble (not inline). *Chat layer.*

6. **Compaction status banner.** Plumb `EVENT_COMPACTION_STATUS` → SSE → top-of-chat banner ("Compressing context…" / "Compressed" / "Failed"). *Chat layer.*

7. **Explicit segment boundary.** Emit `chat_segment` SSE event when stream transitions from tool-group back to text. Frontend closes current bubble + opens fresh one instead of cramming everything into a single bubble with mid-stream tool cards. *Chat layer.*

8. **Heartbeat keepalive event.** Emit a 5s heartbeat SSE chunk during any turn taking >5s. Frontend uses it to drive a pulsing dot indicator + reset its client-side stall timer. *Chat layer.*

### Tier 3 — Plan + replan + working memory

9. **`_try_replan` for taskrunner.** On task failure after retries, prompt the LLM with completed tasks (✅) + failed task + error + working memory. Ask for revised plan of remaining work. Append new tasks (renumbered, deps adjusted). Cap at `MAX_REPLAN`. *Layer 4.*

10. **"Full Execution Plan" task prompt.** Every task gets a header showing ✅/🔄/⬜ across all tasks with `← YOU ARE HERE`. The single biggest prompt-engineering win in MeshClaw. *Layer 4.*

11. **`WorkingMemory` per Project.** Track `files_changed` / `decisions` / `blockers` extracted from task results. Re-inject summary into every task prompt. Survives compaction because we maintain it ourselves. *Layer 5.*

### Tier 4 — Polish + safety

12. **Credential + exfiltration-URL redactor.** Per-chunk regex pass on outgoing text + tool input before broadcast. Full-text re-redaction at turn-end. *Chat safety.*

13. **Phase reactions / status emoji on user message.** Bubble-level emoji indicator (🟡 thinking → 🔧 running tools → ✅ done / ❌ failed). Persists across reload. Quick scannable summary without scrolling the bubble. *Chat layer.*

14. **OPTIONS extractor.** Strip trailing `[OPTIONS: A | B | C]` from visible text + render checkboxes-and-send-button input below the bubble. Multi-select. *Chat layer.*

15. **Heartbeat file UX.** Surface `~/.arz/HEARTBEAT.md` in the Operations page — list view + add/remove rows. Show next-fire countdown + last-fire timestamp + KEEP / drop state per row. *Layer 7a polish.*

16. **AutoNudge stop sentinel surfaced.** Toggle in UI to set/clear a per-session stop sentinel file. *Layer 7b polish.*

### Tier 5 — Out of scope but tracked

- Slack surface + bidirectional bridge — only if/when remote-control via Slack ships.

---

## Quick-take

Arz already nails layers 1, 7a, 7b and most of the event vocab. The visible deficit is rendering (no thinking panel, no compaction banner, no segment boundary, no heartbeat pulse) + the loop safety net (no context guard, no watchdog, no replan, no working memory).

**Highest leverage 4 to ship next** (covers user's "I see goal:done then nothing" + watchdog gap + the most visible chat-render gap):

1. Watchdog tick (#2)
2. Mid-stream context guard (#1)
3. Thinking-chunk panel (#5)
4. Compaction status banner (#6)

The plan+replan layer (#9–11) is a bigger sprint and unblocks autonomous "build me a CR" workflows but isn't required for the current goal loop.
