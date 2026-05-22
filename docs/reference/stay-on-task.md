# Stay-On-Task & Chat-Rendering Architecture

A reference for building agents that grind on a goal across many turns, tool calls, retries, crashes, and gateway restarts, **and** present that work back to a human user in real time.

Reverse-engineered from MeshClaw 2.5.0 (`__version__ = "2.5.0"`), grounded in actual source. None of it is model-specific or chat-surface-specific. The same agent loop works whether the backend is `kiro-cli`, `claude-agent-acp`, Bedrock, or anything else that streams typed tool-call events; the same rendering pipeline works whether the surface is a React dashboard over WebSocket, a Slack Block Kit thread, a TUI, or all three at once.

> Source files referenced (verified): `session.py`, `task_executor.py`, `taskrunner.py`, `task_models.py`, `task_planner.py`, `context_management.py`, `autonudge.py`, `heartbeat.py`, `dashboard/chat_runner.py`, `slack/handler.py`, `slack/client.py`, `slack/format.py`, `providers/base.py`, `acp/types.py`.

---

## Part 1 — Staying on task

### TL;DR — the seven layers

| Layer | Purpose |
|---|---|
| 1. Persistent session | One long-lived agent process per session_key, queue messages, detect death |
| 2. Streaming tool loop | Inside one turn, drive `text_chunk → permission_request → tool_call → complete` until the model is done |
| 3. Bounded retry budgets | Separate budgets for logic-fail, process-crash, context-overflow, replan |
| 4. Plan + replan loop | Decompose goal into a DAG, execute, on failure ask LLM to revise the *remaining* work |
| 5. Working memory | Structured state (`files_changed`, `decisions`, `blockers`) that survives context compaction |
| 6. Watchdog | Out-of-band loop that detects stall, dead process, global timeout |
| 7. Re-entry | Heartbeat (file-based queue) + AutoNudge (idle-timer self-prompt). Both survive restart |

The first 6 keep one turn productive. The 7th makes the agent "keep going on its own".

### 1. Persistent session: one process, many turns

Common mistake: spawning a fresh agent process per user message. You lose conversation log, KV cache, and any in-process tool state. Instead run **one long-lived agent subprocess per `session_key`** and route every message into the same process.

Invariants (`session.py`):

- One async lock per session — only one turn runs at a time.
- Messages that arrive mid-turn go on a FIFO queue.
- Process liveness checked at the **OS level** (`kill -0`), not by activity timeout. The 600s "stale activity" check in many agent libraries falsely kills idle-but-healthy sessions.
- If the process *did* die, `getOrCreate()` removes the stale entry so the next call cold-starts with `is_new=True` (full context re-injection), instead of trying to reuse a corpse.
- A "warm pool" of pre-spawned agent processes amortizes cold-start cost.

```typescript
import { ChildProcess } from 'node:child_process';

interface AgentSession {
  proc: ChildProcess;
  acp: AcpClient;            // your ACP / process wrapper
  lock: Mutex;               // one turn at a time
  queue: PendingMessage[];   // messages that arrived mid-turn
  agent: string;             // model/agent identifier
  prevTurnCancelled: boolean;
  approvalPolicy: 'interactive' | 'auto';
  createdAt: number;
}

export class SessionManager {
  private sessions = new Map<string, AgentSession>();
  private locks = new Map<string, Mutex>();

  async getOrCreate(key: string, agent: string): Promise<{ session: AgentSession; isNew: boolean }> {
    const existing = this.sessions.get(key);
    if (existing) {
      if (this.isProcAlive(existing.proc)) return { session: existing, isNew: false };
      this.sessions.delete(key);   // stale corpse — fall through to cold-start
    }

    const lock = this.lockFor(key);
    return await lock.run(async () => {
      const again = this.sessions.get(key);
      if (again && this.isProcAlive(again.proc)) return { session: again, isNew: false };
      const session = await this.spawnAndHandshake(key, agent);
      this.sessions.set(key, session);
      return { session, isNew: true };
    });
  }

  private isProcAlive(proc: ChildProcess): boolean {
    if (proc.exitCode !== null || proc.signalCode !== null) return false;
    try { process.kill(proc.pid!, 0); return true; } catch { return false; }
  }

  async reset(key: string): Promise<void> {
    const s = this.sessions.get(key);
    if (!s) return;
    this.sessions.delete(key);
    try { s.proc.kill('SIGTERM'); } catch {}
    setTimeout(() => { try { s.proc.kill('SIGKILL'); } catch {} }, 2000);
  }
}
```

### 2. Streaming tool loop: the actual ReAct engine

A single `prompt()` call to a streaming agent backend does not return once. It **streams events** until the model emits `complete`. Inside that stream, the model can request tool calls, read partial results, request more, and keep going. Your driver loop has to:

1. Forward text chunks to the UI as they arrive.
2. On `permission_request`, decide approve / deny, and call back so the model unblocks.
3. On `tool_call` (auto-approved tools), record it, fire pre-tool hooks.
4. On `complete`, exit the loop.

This is what makes the model "keep going" within a turn — it is not us re-prompting, it is the model deciding it needs another tool call after seeing the previous tool's output.

```typescript
const MID_STREAM_COMPACT_PCT = 90.0;
const RESULT_REDACT_EVERY = 50; // chunks

class ContextOverflow extends Error {
  constructor(public pct: number) { super(`context ${pct}%`); }
}

export async function runTurn(
  session: AgentSession,
  prompt: string,
  hooks: { onToolCall: (name: string) => 'approve' | 'deny'; onText: (s: string) => void },
): Promise<string> {
  let result = '';
  let chunkCount = 0;

  for await (const ev of session.acp.stream(prompt)) {
    switch (ev.kind) {
      case 'text_chunk':
        result += ev.text;
        hooks.onText(ev.text);
        if (++chunkCount % RESULT_REDACT_EVERY === 0) {
          await persistPartial(session, redact(result));
        }
        break;

      case 'permission_request': {
        const decision = hooks.onToolCall(ev.title);
        if (decision === 'deny') { await session.acp.rejectTool(ev.requestId); continue; }
        // Mid-stream context guard: bail BEFORE approving an expensive tool
        // when context is almost full.
        const pct = await session.acp.contextUsagePct();
        if (pct >= MID_STREAM_COMPACT_PCT) {
          await session.acp.rejectTool(ev.requestId);
          throw new ContextOverflow(pct);
        }
        await session.acp.approveTool(ev.requestId);
        break;
      }

      case 'tool_call':
        await fireToolHooks(ev.title, ev.input);
        break;

      case 'complete':
        return result;
    }
  }
  return result;
}
```

The key trick is the **mid-stream context guard**. Without it, the model approves one more 30K-token tool call and blows past the window, forcing a full session reset that loses progress. With it, you abort early, compact, and re-enter.

### 3. Bounded retry budgets: separate counters for separate failure modes

Common bug: one retry counter for everything. A process crash and a logic error are different failures and deserve different budgets. MeshClaw uses four:

```python
# task_models.py (verbatim)
MAX_RETRIES = 3            # logic / test failures
MAX_RECOVERIES = 2         # process crash recoveries — NOT counted as retries
MAX_REPLAN = 2             # plan revision attempts after a task exhausts retries
MAX_TOTAL_TASKS = 50       # hard cap on total tasks (incl. replans)
STALL_TIMEOUT = 3600       # 60 min no progress → notify
STALL_CANCEL_TIMEOUT = 7200  # 2 h → watchdog resets stuck session
```

Plus a parallel set for the orchestrator (`context_management.py`):

```python
MAX_TASK_FAILURES = 3
MAX_STAGE_ROUNDS = 3
MAX_STAGE_ESCALATIONS = 2  # after 2 escalations (= 9 rounds), force-fail
```

When a process crashes, the retry counter does not tick — that was not the model's fault. When the model returns a wrong answer, the *recovery* counter does not tick — the process is fine. When two consecutive attempts hit *the same exact error*, escalate early instead of burning the whole budget on a known-doomed loop.

```typescript
const MAX_RETRIES = 3;
const MAX_RECOVERIES = 2;

export async function executeTask(task: Task, session: AgentSession): Promise<boolean> {
  let attempt = 0;
  let recoveries = 0;
  let compactions = 0;
  let prevError = '';
  let consecutiveSameError = 0;

  while (attempt < MAX_RETRIES) {
    attempt++;
    task.status = 'in_progress';
    task.attempts = attempt;

    try {
      const fullPrompt = await buildTaskPrompt(task, attempt);
      task.result = await runTurn(session, fullPrompt, hooks);
      task.status = 'passed';
      return true;
    } catch (err) {
      if (err instanceof ProcessDied) {
        if (++recoveries > MAX_RECOVERIES) {
          task.status = 'failed';
          task.error = `Process died ${recoveries} times — giving up`;
          return false;
        }
        await sessions.reset(session.key);
        attempt--;        // process crash doesn't count as a retry
        continue;
      }
      if (err instanceof ContextOverflow) {
        if (++compactions > MAX_RECOVERIES) {
          task.status = 'failed';
          task.error = `Context overflow ${compactions} times — giving up`;
          return false;
        }
        await session.acp.compact();
        await session.acp.waitForCompaction(120_000);
        attempt--;        // compaction doesn't count as a retry
        continue;
      }

      task.error = String(err);
      if (task.error === prevError && ++consecutiveSameError >= 2) {
        task.status = 'failed';
        return false;
      }
      prevError = task.error;
      if (attempt < MAX_RETRIES) continue;
      task.status = 'failed';
      return false;
    }
  }
  return false;
}
```

### 4. Plan + replan: when a task fails, ask the LLM what to do next

Single-task agents fail one task and stop. Multi-task agents have a planner that can react.

The flow (`taskrunner.py:_execute_tasks` + `_try_replan`):

1. LLM decomposes the spec into a DAG with dependencies and parallel groups.
2. Tasks execute in dependency order. Each task gets its own `session_key` (isolated context).
3. On task failure (after all retries), call `_try_replan()`: send a prompt with the original spec, the list of completed tasks (with `✅`), the failed task and its error, and the current working memory + git state. Ask for **a new plan for the remaining work only**.
4. Append the new tasks (renumbered, with adjusted dependencies) and continue.
5. Hard cap at `MAX_REPLAN` and `MAX_TOTAL_TASKS` so a pathological loop can't run forever.

The prompt every task sees has a "Full Execution Plan" section showing where it is in the pipeline:

```
## Full Execution Plan (follow strictly)
Execute ONLY what the current task describes. Do not skip ahead or combine tasks.

### Group 1
✅ 1. Read API spec
✅ 2. Generate handler skeleton
### Group 2 (parallel)
🔄 3. Wire route — depends on: 2  ← YOU ARE HERE
⬜ 4. Wire OpenAPI doc — depends on: 2
### Group 3
⬜ 5. Add integration test — depends on: 3, 4
```

This is the single most powerful prompt-engineering trick in the whole codebase. The model sees the cursor (`← YOU ARE HERE`), what is done, and what is pending, every single turn.

```typescript
export function buildTaskPrompt(run: Project, task: Task, attempt: number): string {
  const parts: string[] = [];
  parts.push(
    'You are an autonomous execution agent in a multi-task pipeline.\n' +
    'Execute the current task precisely. Do not describe what you will do — just do it.\n' +
    (attempt > 1 ? `This is retry attempt ${attempt}. Fix the previous error, don't start over.\n` : '')
  );

  if (run.memory.summary()) parts.push(run.memory.summary() + '\n');

  parts.push('## Full Execution Plan (follow strictly)');
  parts.push('Execute ONLY what the current task describes. Do not skip ahead or combine tasks.\n');
  for (const [i, group] of groupParallel(run.tasks).entries()) {
    parts.push(`### Group ${i + 1}` + (group.length > 1 ? ' (parallel)' : ''));
    for (const t of group) {
      const icon = t.status === 'passed' ? '✅' : t.index === task.index ? '🔄' : '⬜';
      const dep = t.dependsOn.length ? ` (depends on: ${t.dependsOn.join(', ')})` : '';
      const here = t.index === task.index ? ' ← YOU ARE HERE' : '';
      parts.push(`${icon} ${t.index}. ${t.title}${dep}${here}`);
    }
  }

  parts.push(`\n## Current Task (${task.index}/${run.tasks.length})\n**${task.title}**\n\n${task.description}\n`);
  if (attempt > 1 && task.error) {
    parts.push(`\n## Previous Attempt Failed (attempt ${attempt - 1})\nError: ${task.error}\n\nFix the error and try again.\n`);
  }
  return parts.join('\n');
}
```

### 5. Working memory: structured state that survives compaction

When context hits 90%, you compact. Compaction is lossy summarization: the model "remembers" what it did but not the exact filenames, decisions, or blockers. So you keep a **separate, untouched** structured record that you re-inject every prompt:

```python
# task_models.py (verbatim)
@dataclass
class WorkingMemory:
    files_changed: list[str] = field(default_factory=list)
    decisions: list[str] = field(default_factory=list)
    blockers: list[str] = field(default_factory=list)

    def update_from_result(self, result: str) -> None:
        for line in result.splitlines():
            stripped = line.strip()
            if any(stripped.startswith(p) for p in
                   ("Created ", "Modified ", "Updated ", "Deleted ", "Wrote ")):
                self.files_changed.append(stripped[:200])
```

```typescript
export class WorkingMemory {
  filesChanged: string[] = [];
  decisions: string[] = [];
  blockers: string[] = [];

  summary(): string {
    const parts = ['## Working Memory'];
    if (this.filesChanged.length) {
      parts.push('### Files Changed');
      this.filesChanged.slice(-20).forEach(f => parts.push(`- ${f}`));
    }
    if (this.decisions.length) {
      parts.push('### Key Decisions');
      this.decisions.slice(-10).forEach(d => parts.push(`- ${d}`));
    }
    if (this.blockers.length) {
      parts.push('### Blockers');
      this.blockers.slice(-5).forEach(b => parts.push(`- ${b}`));
    }
    return parts.length === 1 ? '' : parts.join('\n');
  }

  updateFromResult(result: string): void {
    const re = /^(Created|Modified|Updated|Deleted|Wrote) /;
    for (const line of result.split('\n').map(l => l.trim())) {
      if (re.test(line)) this.filesChanged.push(line.slice(0, 200));
    }
  }
}
```

Track the high-value structured state for *your* domain explicitly. Cheap regex extraction works for files; for decisions and blockers, have the model emit a small JSON block at the end of each task and parse that.

### 6. Watchdog: out-of-band loop that knows the agent is stuck

The agent itself can not reliably detect that it is stalled — if the agent process is wedged, no event fires. So you run a separate task on a 30s tick:

```python
# taskrunner.py:_watchdog_loop (trimmed, verbatim shape)
async def _watchdog_loop(self, run: Project) -> None:
    stall_notified = False
    dead_process_count = 0
    while run.status == "running":
        await asyncio.sleep(_HEARTBEAT_INTERVAL)  # 30s

        step_key = f"{_SESSION_PREFIX}:{run.task_id}:task{run.current_task}"
        alive = await self._sessions.is_provider_alive(step_key)
        if alive is not None and not alive:
            dead_process_count += 1
            if dead_process_count >= _DEAD_THRESHOLD:  # 2 consecutive
                await self._sessions.reset(step_key)
                dead_process_count = 0

        since_last = time.time() - run.last_task_time
        if since_last >= _STALL_CANCEL_TIMEOUT:
            await self._sessions.reset(step_key)        # 2h: force reset
        elif since_last >= _STALL_TIMEOUT and not stall_notified:
            stall_notified = True
            await self._notify("Task may be stalled", ...)  # 60min: notify only
```

```typescript
const HEARTBEAT_MS = 30_000;
const STALL_NOTIFY_MS = 60 * 60_000;
const STALL_CANCEL_MS = 2 * 60 * 60_000;
const DEAD_THRESHOLD = 2;

export function startWatchdog(run: Project, sessions: SessionManager, onNotify: NotifyFn) {
  let deadCount = 0;
  let stallNotified = false;

  return setInterval(async () => {
    if (run.status !== 'running') return;

    const key = `task:${run.taskId}:${run.currentTask}`;
    const alive = sessions.isAlive(key);
    if (alive === false) {
      if (++deadCount >= DEAD_THRESHOLD) {
        await sessions.reset(key);
        onNotify('Watchdog reset: agent process died', run);
        deadCount = 0;
      }
    } else { deadCount = 0; }

    const sinceLast = Date.now() - run.lastTaskTime;
    if (sinceLast >= STALL_CANCEL_MS) {
      await sessions.reset(key);
      onNotify('Watchdog: stall cancel after 2h', run);
    } else if (sinceLast >= STALL_NOTIFY_MS && !stallNotified) {
      stallNotified = true;
      onNotify('Task may be stalled — no progress in 60min', run);
    }
    if (sinceLast < STALL_NOTIFY_MS) stallNotified = false;
  }, HEARTBEAT_MS);
}
```

### 7. Re-entry: Heartbeat + AutoNudge

Layers 1 to 6 keep one turn productive. They do not help when the user has closed the chat tab and you still need the agent to "check on this every 5 minutes until clean". For that you need re-entry mechanisms that survive process restart.

#### 7a. Heartbeat — file-based self-cleaning task queue

A markdown file is the work queue. The service ticks every 60s, reads pending lines, dispatches each to the agent, then **rewrites the file** keeping only tasks the agent flagged as incomplete (`HEARTBEAT_KEEP` sentinel).

```markdown
# HEARTBEAT.md
- [ ] Check CR-12345 for review comments. If found, fix + push and respond HEARTBEAT_KEEP. If clean, notify "CR passed".
- [ ] Poll deployment foo until ACTIVE, respond HEARTBEAT_KEEP while pending.
```

```python
# heartbeat.py (verbatim core)
async def _process_heartbeat_file(self) -> None:
    path = heartbeat_path()
    content = path.read_text(encoding="utf-8").strip()
    tasks = _extract_tasks(content)
    if not tasks or not self._on_task: return

    self._processing = True
    try:
        results = await asyncio.gather(
            *[self._on_task(t, d) for t, d in tasks],
            return_exceptions=True,
        )
        keep: list[tuple[str, str]] = []
        for (text, deliver), result in zip(tasks, results):
            if isinstance(result, BaseException) or _should_keep(result):
                keep.append((text, deliver))   # incomplete or crashed — retain

        lines = _HEADER
        for text, deliver in keep:
            suffix = f"  <!-- deliver:{deliver} -->" if deliver else ""
            lines += f"- {text}{suffix}\n"
        path.write_text(lines, encoding="utf-8")
    finally:
        self._processing = False
```

Why this works:
- **Crash-safe.** If the gateway dies mid-tick the file is unchanged, all tasks come back next start.
- **Self-cleaning.** No manual reaping. Done = removed.
- **Parallel.** `asyncio.gather` runs all pending tasks concurrently.
- **Sentinel-based control.** The agent decides whether to retry by including `HEARTBEAT_KEEP` in its reply. Nothing fancier needed.

```typescript
const HEARTBEAT_FILE = path.join(workspaceDir(), 'HEARTBEAT.md');
const KEEP_SENTINEL = 'HEARTBEAT_KEEP';
const TICK_MS = 60_000;

export class HeartbeatService {
  private timer?: NodeJS.Timeout;
  constructor(private onTask: (text: string, deliver: string) => Promise<string | null>) {}

  start() {
    this.timer = setInterval(() => this.tick().catch(e => console.warn('heartbeat tick failed', e)),
                             TICK_MS);
  }

  private async tick() {
    const content = await fs.readFile(HEARTBEAT_FILE, 'utf-8').catch(() => '');
    const tasks = extractTasks(content);
    if (!tasks.length) return;

    const results = await Promise.allSettled(tasks.map(t => this.onTask(t.text, t.deliver)));
    const keep = tasks.filter((_, i) => {
      const r = results[i];
      if (r.status === 'rejected') return true;
      return shouldKeep(r.value);
    });

    const out = HEADER + keep.map(t => `- ${t.text}${t.deliver ? `  <!-- deliver:${t.deliver} -->` : ''}`).join('\n') + '\n';
    await atomicWrite(HEARTBEAT_FILE, out);
  }
}

function shouldKeep(reply: string | null): boolean {
  return reply != null && reply.toUpperCase().includes(KEEP_SENTINEL);
}
```

#### 7b. AutoNudge — reactive same-session loop

Heartbeat is good when the chat tab is closed. AutoNudge is the opposite: the chat tab is open, the user wants the agent to keep going on its own when idle, but immediately yield if the user types.

```python
# autonudge.py (verbatim core)
def notify_turn_complete(self, slot_key: str) -> None:
    """Called after the agent finishes a turn — (re)arm idle timer."""
    loop = self._find_by_slot(slot_key)
    if not loop or not loop.active: return
    self._arm_timer(loop)

def notify_user_input(self, slot_key: str) -> None:
    """User typed — cancel pending nudge (user takes priority)."""
    loop = self._find_by_slot(slot_key)
    if loop: self._cancel_timer(loop.id)

async def _timer(self, loop: NudgeLoop) -> None:
    await asyncio.sleep(loop.idle_secs)
    if shutdown_event.is_set(): return
    if loop.stop_sentinel_path and Path(loop.stop_sentinel_path).exists():
        await self.remove(loop.id); return
    if loop.max_cycles and loop.cycle_count >= loop.max_cycles:
        await self.update(loop.id, active=False); return
    delivered = await self._on_fire(loop)
    if delivered:
        loop.cycle_count += 1
        loop.last_fire_ts = time.time()
        self._save()    # atomic, fcntl-locked
```

Three control inputs every nudge loop needs:

1. **Idle timer reset.** Fires `idle_secs` after the last turn-complete event.
2. **User input cancel.** Any user message kills the pending timer.
3. **Stop conditions.** `max_cycles`, sentinel file, explicit stop call.

State persists with atomic write (write-temp + fsync + os.replace) and `fcntl` lock so concurrent processes never corrupt it.

```typescript
interface NudgeLoop {
  id: string;
  slotKey: string;
  message: string;
  idleSecs: number;
  maxCycles: number;
  cycleCount: number;
  active: boolean;
  stopSentinelPath?: string;
}

export class AutoNudgeService {
  private loops = new Map<string, NudgeLoop>();
  private timers = new Map<string, NodeJS.Timeout>();

  constructor(private onFire: (loop: NudgeLoop) => Promise<boolean>) {}

  notifyTurnComplete(slotKey: string) {
    const loop = this.findBySlot(slotKey);
    if (loop?.active) this.armTimer(loop);
  }

  notifyUserInput(slotKey: string) {
    const loop = this.findBySlot(slotKey);
    if (loop) this.cancelTimer(loop.id);
  }

  private armTimer(loop: NudgeLoop) {
    this.cancelTimer(loop.id);
    this.timers.set(loop.id, setTimeout(async () => {
      if (loop.stopSentinelPath && existsSync(loop.stopSentinelPath)) { await this.remove(loop.id); return; }
      if (loop.maxCycles && loop.cycleCount >= loop.maxCycles) { loop.active = false; await this.save(); return; }
      const delivered = await this.onFire(loop).catch(() => false);
      if (delivered) {
        loop.cycleCount++;
        await this.save();
      }
      // Don't re-arm here. The next turn-complete event will arm it.
    }, loop.idleSecs * 1000));
  }
}
```

The "do not re-arm in the timer" detail matters. AutoNudge is **reactive**: the surface re-arms after each fire when the next turn completes. That way, if the agent's nudge response itself takes 90s of streaming, the next idle timer does not start counting until that turn completes.

### 8. Stop conditions

A common failure mode of "loop until done" agents is they do not actually stop. Every layer above has bounded stop conditions:

| Layer | Stop conditions |
|---|---|
| Streaming turn | `complete` event, ContextOverflow, ProcessDied, CancelledError |
| Task execute | `MAX_RETRIES`, `MAX_RECOVERIES`, same-error-twice escalation |
| Task pipeline | `MAX_REPLAN`, `MAX_TOTAL_TASKS`, `STALL_CANCEL_TIMEOUT`, global timeout, token budget |
| Watchdog | own death is fine — pipeline finishes or hits its own timeout |
| Heartbeat | per-task: `HEARTBEAT_KEEP` absent → drop. Crash → retain. |
| AutoNudge | `max_cycles`, stop sentinel file, user input, deactivation |

A loop without a stop condition is not an autonomous agent, it is a runaway. Every persistent loop here has at least three (count limit, time limit, kill switch).

---

## Part 2 — Presenting and rendering the chat

The agent loop emits a typed event stream. The chat surface translates events into UI primitives. The same stream can drive multiple surfaces (web dashboard, Slack thread, TUI) at the same time. This section walks the event vocabulary, the segmentation rules, and concrete renderings on each surface.

### The event vocabulary

These are the kinds the agent yields during a turn (`acp/types.py`, re-exported by `providers/base.py`):

| Event kind | Meaning | UI consequence |
|---|---|---|
| `text_chunk` | Streaming visible answer text | Append to current assistant message bubble |
| `thinking_chunk` | Streaming "internal monologue" (reasoning) | Render in a separate, collapsible panel — never the main bubble |
| `tool_call` | Auto-approved tool is now running | Open a tool card with title, kind, purpose, and input preview |
| `tool_result` | Auto-approved tool returned | Mark the matching tool card done, show output preview |
| `permission_request` | Tool needs user approval before running | Open an approval prompt (Approve / Trust / Reject) |
| `agent_switched` | Backend swapped agents (e.g. main → subagent) | Show a quiet system message |
| `compaction_status` | Context-compaction in progress / done / failed | Banner or status pill |
| `clear_status` | Reset any "Thinking…" / "Running tool…" indicator | Clear the status row |
| `complete` | Turn ended | Finalize the streaming message, fire `turn_complete` |

Two cross-cutting signals layered on top:
- **Per-chunk redaction.** Every text/tool field passes through credential + exfiltration-URL redactors *before* it leaves the agent (`redact_credentials()`, `redact_exfiltration_urls()`). The Slack handler also re-runs full-text redaction on the accumulated result before posting, since some patterns can span chunks.
- **Heartbeat keepalive.** During long operations the runner emits a `heartbeat` event every 5s so idle detectors and progress UIs do not assume death.

### Text segmentation: where one bubble ends and the next begins

Naively appending `text_chunk` to a single bubble produces an unreadable wall of text once tools are involved. The runner uses a small state machine (`chat_runner.py`, the `in_tool_group` flag) to split the stream into segments:

```
text_chunk* → tool_call/tool_result* → text_chunk*
   bubble A     tool group              bubble B
```

The rules:

1. Pre-tool text accumulates into bubble A.
2. The first `tool_call` arrives. Flush bubble A (persist it, but do not emit a new "segment" boundary yet — keep the streaming message in place so tool-ordering looks right). Set `in_tool_group = true`.
3. Tool calls and results render as their own cards inside the tool group, in arrival order.
4. The first `text_chunk` after a tool group: if there is buffered assistant text, flush it and broadcast a `chat_segment` event ("close current bubble, start a new one"). Then mark every still-open tool card as done (some tools have no output; tool_result never fires for them, so a fallback completes them once subsequent text arrives). Reset `in_tool_group = false`.
5. `complete` event: flush whatever is left, broadcast final `turn_complete`.

This is what makes mixed text-and-tool turns read cleanly:

```
[bubble] "Looking at the current state of foo.ts..."
  [tool] 🔧 fs_read foo.ts (purpose: "read existing handler")
  [tool] 🔧 fs_read package.json
[bubble] "I'll add a new export and update the import. Here is the plan: ..."
  [tool] 🔧 fs_write foo.ts (5 lines added)
[bubble] "Done. Tests pass."
```

```typescript
// segmentation skeleton (adapted from chat_runner.py)
let assistantText = '';
let inToolGroup = false;
let chunkSeq = 0;

for await (const ev of session.acp.stream(prompt)) {
  if (ev.kind === 'text_chunk') {
    if (inToolGroup) {
      // Closing tools and starting a fresh bubble
      if (assistantText) { flushSegment(slot, assistantText); assistantText = ''; }
      else broadcast('chat_segment', { slot: slot.key });
      // Mark any still-open tool cards as done
      for (const m of slot.messages.slice().reverse()) {
        if (m.role === 'tool' && !m.meta?.done) {
          m.meta = { ...m.meta, done: true };
          if (m.meta.toolCallId) broadcast('tool_result', { slot: slot.key, toolCallId: m.meta.toolCallId, output: '' });
        } else if (m.role !== 'tool' && m.role !== 'permission' && m.role !== 'chunk') break;
      }
      inToolGroup = false;
    }
    chunkSeq++;
    const safeChunk = redactAll(ev.text);
    assistantText += safeChunk;
    slot.append('chunk', safeChunk, 'chunk');
    broadcast('chat_chunk', { slot: slot.key, content: safeChunk, seq: chunkSeq });

  } else if (ev.kind === 'tool_call') {
    // Persist any pre-tool text silently — keep the streaming message in place
    if (!inToolGroup && assistantText) { flushSegment(slot, assistantText, /* broadcast */ false); assistantText = ''; }
    inToolGroup = true;
    broadcast('tool_call', {
      slot: slot.key,
      tool: redactAll(ev.title),
      kind: redactAll(ev.tool_kind),
      tool_call_id: ev.tool_call_id,
      purpose: redactAll((ev.tool_purpose || '').slice(0, 200)),
      input_preview: redactAll((ev.tool_input || '').slice(0, 4000)),
    });
    slot.append('tool', `🔧 ${ev.title}`, 'msg msg-tool', { meta: { tool_call_id: ev.tool_call_id, purpose: ev.tool_purpose } });

  } else if (ev.kind === 'tool_result') {
    const out = redactAll((ev.tool_output || '').slice(0, 8000));
    broadcast('tool_result', { slot: slot.key, tool_call_id: ev.tool_call_id, output: out });
    // Mark matching tool message done so completion state survives reload
    for (const m of slot.messages.slice().reverse()) {
      if (m.role === 'tool' && m.meta?.tool_call_id === ev.tool_call_id) { m.meta.done = true; break; }
    }

  } else if (ev.kind === 'thinking_chunk') {
    broadcast('chat_thinking', { slot: slot.key, content: redactAll(ev.text) });

  } else if (ev.kind === 'complete') {
    if (assistantText) { flushSegment(slot, assistantText); assistantText = ''; }
    broadcast('turn_complete', { slot: slot.key });
    return;
  }
}
```

### Surface 1: web dashboard over WebSocket

The dashboard subscribes to a per-slot WebSocket. The stream receives a typed event for every state transition. A React component renders each event kind to a primitive:

| WS event | Payload | Renders to |
|---|---|---|
| `chat_status` | `{ slot, status: "Thinking…" }` | Pill above the input box |
| `chat_chunk` | `{ slot, content, seq }` | Append to the streaming bubble (content) |
| `chat_thinking` | `{ slot, content }` | Append to the collapsible "thinking" panel |
| `tool_call` | `{ slot, tool, kind, tool_call_id, purpose, input_preview }` | Open a tool card (loading state) |
| `tool_result` | `{ slot, tool_call_id, output }` | Mark the matching tool card done; show output preview |
| `chat_segment` | `{ slot }` | Close the current streaming bubble; next chunks start a fresh one |
| `permission_request` | `{ slot, request_id, title, tool_input, ... }` | Render the approval prompt with Approve / Reject buttons |
| `heartbeat` | `{ slot, ts }` | Reset client-side stall timer; do not render |
| `compaction_status` | `{ slot, type }` | Banner: "Compressing context…" / "Compressed" / "Failed" |
| `turn_complete` | `{ slot }` | Stop the typing indicator |

Two extra mechanics worth copying:

- **Pending message queue.** Messages typed while a turn is in progress get queued in `slot._pending` and fire after the turn completes. Render them as a "queued" badge below the input so users know what is held back.
- **HTTP SSE replay.** A reconnecting client hits `GET /api/slots/{key}/events` and gets the full message history as Server-Sent Events. Same shape as the WebSocket stream. This is how a refresh restores tool cards (because each tool message has `meta.done` persisted on the slot) instead of re-running the turn.

A minimal React renderer:

```tsx
function ChatView({ slotKey }: { slotKey: string }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [streaming, setStreaming] = useState<string>('');
  const [thinking, setThinking] = useState<string>('');
  const [status, setStatus] = useState<string>('');

  useEffect(() => {
    const ws = openSlotWebSocket(slotKey);
    ws.on('chat_status',     ev => setStatus(ev.status));
    ws.on('chat_chunk',      ev => setStreaming(s => s + ev.content));
    ws.on('chat_thinking',   ev => setThinking(s => s + ev.content));
    ws.on('chat_segment',    () => { flush(streaming); setStreaming(''); });
    ws.on('tool_call',       ev => setMessages(m => [...m, { kind: 'tool', ...ev, status: 'running' }]));
    ws.on('tool_result',     ev => setMessages(m => m.map(x => x.tool_call_id === ev.tool_call_id ? { ...x, status: 'done', output: ev.output } : x)));
    ws.on('permission_request', ev => setMessages(m => [...m, { kind: 'approval', ...ev }]));
    ws.on('compaction_status',  ev => setStatus(ev.type === 'in_progress' ? 'Compressing context…' : ''));
    ws.on('turn_complete',   () => setStatus(''));
    return () => ws.close();
  }, [slotKey]);

  return (
    <div>
      {messages.map(m => <MessageRenderer msg={m} />)}
      {streaming && <StreamingBubble text={streaming} />}
      {thinking && <ThinkingPanel text={thinking} />}
      <StatusPill text={status} />
    </div>
  );
}
```

### Surface 2: Slack thread via Block Kit + chat.startStream

Slack does not have a native streaming-text surface, but `chat.startStream` / `chat.appendStream` / `chat.stopStream` give you one (`slack/client.py`). Map the same event stream to it:

| Agent event | Slack call |
|---|---|
| First `text_chunk` of a turn | `chat.startStream(channel, thread_ts, initial_text="Thinking…", task_display_mode="plan")` returns a `ts`. Subsequent chunks go through `chat.appendStream(channel, ts, text)`. |
| `tool_call` | `chat.appendStream(channel, ts, chunks=[{type: "task_update", id, title, status: "in_progress", details: tool_purpose}])` |
| `tool_result` | `chat.appendStream(channel, ts, chunks=[{type: "task_update", id, title, status: "complete"}])` |
| Next `text_chunk` after a tool group | Append as `markdown_text` chunk |
| `permission_request` | Post a separate Block Kit message in the same thread with `_build_approval_blocks(event)` (Approve / Trust session / Reject buttons). Trust is omitted in group channels to limit blast radius. |
| `complete` | `chat.stopStream(channel, ts)`. Do **not** call `chat.update` after; the streamed content already has rich code-block formatting that re-edit would lose. |

Two presentation rules from production:

- **Phase reactions on the user's message.** As the agent works, the runner adds emoji reactions to the parent user message (`StatusReactionController`) — 🟡 thinking, 🔧 running tools, ✅ done, ❌ failed. Survives across page reloads because Slack persists reactions.
- **OPTIONS extraction.** When the agent emits `[OPTIONS: A | B | C]` at the end of its response, the Slack handler strips the tag from the visible text and posts a separate Block Kit `actions` block with checkboxes + Send button (`slack/format.py`). The pattern `\[OPTIONS:\s*(.+?)\]\s*$` is matched against the multiline-anchored end. Bracket hold-back logic in the streaming filter prevents `[OPTIONS:` from leaking into the streamed text — once `[` is seen, subsequent chars are buffered until `]` arrives, then either dropped (it was OPTIONS) or flushed (it was a normal bracket). Up to 10 choices are supported via Slack's checkbox limit.

Approval block builder (verbatim shape from `slack/handler.py`):

```python
def _build_approval_blocks(event: LLMEvent, is_dm: bool = True) -> list[dict]:
    buttons = [
        {"type": "button", "text": {"type": "plain_text", "text": "Approve"},
         "style": "primary", "action_id": _ACTION_APPROVE, "value": event.request_id},
    ]
    if is_dm:  # Trust escalates session permissions — DM only, not group channels
        buttons.append({
            "type": "button", "text": {"type": "plain_text", "text": "Trust session"},
            "action_id": _ACTION_TRUST, "value": event.request_id,
        })
    buttons.append({
        "type": "button", "text": {"type": "plain_text", "text": "Reject"},
        "style": "danger", "action_id": _ACTION_REJECT, "value": event.request_id,
    })
    blocks = [{"type": "section", "text": {"type": "mrkdwn",
              "text": f"🔐 *Tool approval requested:*"}}]
    if event.tool_input:
        blocks.append({"type": "section",
                       "text": {"type": "mrkdwn", "text": f"```{event.tool_input[:2900]}```"}})
    blocks.append({"type": "context", "elements": [{"type": "mrkdwn", "text": footer_with_purpose}]})
    blocks.append({"type": "actions", "elements": buttons})
    return blocks
```

OPTIONS block builder (`slack/format.py`, verbatim):

```python
def build_options_blocks(choices: list[str]) -> list[dict]:
    options = [{"text": {"type": "plain_text", "text": c[:75]}, "value": c[:150]}
               for c in choices[:10]]
    return [{
        "type": "actions",
        "elements": [
            {"type": "checkboxes", "action_id": OPTIONS_CHECKBOXES_ACTION, "options": options},
            {"type": "button", "text": {"type": "plain_text", "text": "Send"},
             "action_id": OPTIONS_SUBMIT_ACTION, "style": "primary"},
        ],
    }]
```

When the user clicks Send, the action handler reads the selected checkboxes, joins them with `, ` and submits as a regular user message into the same thread session. Multi-select means the agent can ask "tick all that apply" questions and get a single coherent reply.

### Surface 3: bidirectional bridge (dashboard ↔ Slack)

Sometimes the same session is visible on two surfaces — for example a dashboard chat that is also linked to a Slack thread for mobile follow-up. The runner mirrors selected events both ways:

- User message in dashboard → blockquote-italic mirror into the linked Slack thread.
- User message in Slack → injected as if typed in the dashboard, queued behind any in-flight turn.
- `tool_call` in either surface → `task_update` in the Slack stream and a tool card on the dashboard.
- `text_chunk` → both `chat.appendStream` and dashboard WS broadcast.

The link is keyed by `session_key`; each side stores the other side's identifiers (`(channel, thread_ts)` for Slack, slot key for dashboard) so a reply on either side reaches the same agent process.

### Persistence and replay: what survives a refresh

Every event mutates a per-slot `messages` list before broadcast. Each entry has:

```python
{
  "role": "user" | "assistant" | "chunk" | "tool" | "permission" | "system",
  "content": str,
  "css": str,
  "meta": {
    "tool_call_id": "...",
    "purpose": "...",
    "done": True/False,    # tool completion survives reload
    ...
  }
}
```

On reconnect, the client requests the slot's history; tool cards re-hydrate with their done state, completed turns render as static bubbles, and only an in-flight turn (if any) keeps streaming live. The atomic-write pattern from §1 (`tempfile + os.replace`) is used here too whenever `messages` is persisted to disk so a crash mid-write never produces a half-list.

### Status indicators

Three visual signals every chat surface should ship with:

1. **Status pill** — `Thinking…` / `Running tool…` / `Compressing context…`. Driven by `chat_status` and `compaction_status` events. Cleared on `clear_status` or `turn_complete`.
2. **Heartbeat dot** — a low-key pulsing indicator while turns are active. Reset every 5s by the `heartbeat` event. If the dot freezes, the watchdog is the next layer that kicks in.
3. **Phase reactions** — Slack-only. Emoji on the parent user message that summarize the turn at a glance for someone scrolling without expanding the thread.

### Streaming-but-not-streaming text safety

Two redaction passes are applied to every visible text payload:

- **Per-chunk** `redact_credentials()` and `redact_exfiltration_urls()` before broadcast. Cheap, but can miss patterns that span chunks.
- **Full-text** redaction at turn-end (Slack handler, before `stop_stream`) since the whole turn's text is now in hand.

The dashboard accepts the per-chunk version as final. Slack overlays the full-text version on the streamed message before stopping the stream so suspicious patterns that only became visible across chunks still get caught.

---

## Appendix: file map (MeshClaw 2.5.0)

```
src/mesh_claw/
├── session.py             1,562 lines — SessionManager, _Session, warm pool, recycle
├── task_executor.py         707 lines — execute_task (the streaming tool loop)
├── taskrunner.py          1,224 lines — TaskRunner, _execute_tasks, _try_replan, _watchdog_loop
├── task_models.py           127 lines — Task, Project, WorkingMemory, MAX_* constants
├── task_planner.py          464 lines — decompose, group_parallel_tasks
├── task_reporter.py         233 lines — progress persistence, notifications
├── context_management.py    631 lines — OrchestrationTracker, plan validation, mid-stream compact
├── autonudge.py             325 lines — NudgeLoop, AutoNudgeService
├── heartbeat.py             221 lines — HeartbeatService, KEEP sentinel handling
│
├── dashboard/chat_runner.py 1,738 lines — event-stream → WebSocket pump, segmentation
├── slack/handler.py         3,200 lines — event-stream → Block Kit, approval, OPTIONS, mirroring
├── slack/client.py            ~700 lines — chat.startStream/appendStream/stopStream wrappers
├── slack/format.py             367 lines — extract_options + build_options_blocks
├── providers/base.py           106 lines — LLMProvider ABC, event kind re-exports
└── acp/types.py                127 lines — AcpEvent dataclass, EVENT_* constants
```

The "stay-on-task" core is ~5,500 lines. The chat-rendering/surface layer adds another ~6,000. Most of the volume is error handling, persistence, and edge cases. The conceptual surface fits in this one document.

### Minimum viable adoption

For "agent that grinds on a goal in a chat panel until done":

- Layers 1 + 2 + 3 (persistent session, streaming tool loop, retry budgets)
- The event vocabulary + segmentation rules (§ Part 2)
- One surface renderer (WebSocket *or* Slack stream) with status pill + tool cards + approval prompts

Add when needed:

- Layer 4 (plan + replan) for multi-step generations
- Layer 5 (working memory) when you start hitting context limits
- Layer 6 (watchdog) once you trust the agent to run unattended longer than 30 minutes
- Layer 7a (heartbeat) for "monitor X until done" with the chat closed
- Layer 7b (autonudge) for "keep going on its own while I watch"
- Bidirectional surface bridge once a single session needs to be visible on multiple devices simultaneously
