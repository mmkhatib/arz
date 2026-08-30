# Tier 4 — Memory Quality & Render/Files Pipeline

> Findings from investigating two areas directly: how arz's memory compares to
> KiroCrew's, and how work flows from an agent turn through to rendered output
> and the Files panel.
>
> **Headline: arz's memory architecture is ahead of KiroCrew's. Its default
> retrieval quality is behind.** One config default and one missing download
> account for most of the difference. That makes §4.1 the highest
> value-per-hour item in the entire comparison.

---

## Part A — Memory

### What arz already has that KiroCrew does not

13 modules under `src/arz/memory/`. Several layers have no KiroCrew equivalent
described anywhere in its docs:

| Layer | File | Notes |
|---|---|---|
| Single prompt-assembly seam | `context.py` (366) | every caller — chat, subagent, heartbeat, task step, cron — goes through `build_prefix()`. Blocks are cited, so the model can attribute a claim to its source. |
| Semantic facts with decay | `semantic.py` (638) | confidence, contradiction handling, hybrid scoring across keyword + cosine + **recency** + **frequency**, prompt-injection detection and redaction *on write*, per-write audit |
| Episodic with importance | `episodic.py` (277) | length-aware cosine thresholds (≥0.55 short, ≥0.42 long) to counter embedding dilution; importance-weighted LRU eviction |
| Intent tracking | `intent.py` (217) | second retrieval pass keyed on *what the user is working on*, so terse turns ("ok keep going") still retrieve well. No LLM call — regex + token frequency. |
| History compression | `compress.py` (135) | head + tail verbatim, middle summarized, for re-injection after restart |
| Workspace scoping | `workspace.py` (83) | per-workspace memory dirs so projects don't cross-pollute |
| FTS5 across everything | `fts.py` (348) | preferences, projects, daily history, lessons, notes in one ranked index |

Injection detection on memory *writes* is the standout — a poisoned tool result
cannot silently become a durable fact. KiroCrew documents redaction on output
but nothing equivalent on the write path.

### 4.1 — Replace the default embedder  ✅ *shipped*

> **Landed.** `embedding_model` now defaults to `"auto"` (local → ollama → hash).
> `LocalEmbedder` runs MiniLM in-process via the optional `arz[embeddings]`
> extra, downloading in the background while FTS serves queries. Every embedder
> has a stable `id`; `vector_docs` and `episodic_memories` persist it, the vec0
> table rebuilds on change, and `reembed_pending()` backfills. Degradation is no
> longer silent — `GET /api/memory/embedder` reports the live backend and why.
>
> **Two things the implementation turned up that this spec did not predict:**
>
> 1. **Relevance gates were model-specific and hardcoded.** Measured on this
>    repo's own prose, a genuine paraphrase scores 0.074 under the hash
>    fingerprint and 0.244 under MiniLM — against episodic gates of 0.55/0.42.
>    Episodic recall was returning nothing for paraphrases, and swapping the
>    model alone would not have fixed it. Gates are now declared per-embedder.
> 2. **`semantic._hybrid_score` re-encoded the query once per fact** — 2N
>    encodes per ranking pass. Free at microseconds-per-encode with the hash
>    fingerprint, a serious regression at milliseconds-per-encode with a real
>    model. The query is now encoded once and fact vectors are memoised.


**Gap:** `MemoryConfig.embedding_model` defaults to `"hash"`
([`config/schema.py:42`](../../src/arz/config/schema.py)). `HashEmbedder` is a
character-3-gram fingerprint whose own docstring says it is *"not as good as a
real model … useful for deterministic local testing and as a baseline."*

Every semantic path — `episodic.search`, `semantic._cosine_score`, the recall
block in `build_prefix` — runs on that fingerprint out of the box. The good
option (`OllamaEmbedder`) requires the user to already run Ollama *and* to have
manually pulled a model, then silently falls back when they haven't.

So: sophisticated retrieval machinery scoring against near-meaningless vectors.
KiroCrew ships worse machinery with real embeddings and wins the comparison on
output quality.

**Target behaviour**
- Bundle an in-process embedder with no external service: `fastembed` or ONNX
  Runtime + `all-MiniLM-L6-v2` (~90MB, CPU, no torch).
- Download on first gateway start, in the background, to `~/.arz/models/`.
  Verify checksum. Keyword/FTS retrieval serves every query until it is ready —
  never block a turn on a download.
- Config becomes `embedding_model: "auto"` → bundled model, falling back
  `ollama → hash` in that order. Keep `"hash"` reachable for deterministic tests.
- Mirror override (`ARZ_EMBED_MODEL_URL`) for airgapped installs.
- Surface which backend is live in `arz doctor` and on the Memory page — the
  current silent fallback is the real bug, independent of model quality.
- **Re-embed on backend change.** Vectors from different embedders are not
  comparable; mixing them silently corrupts every cosine score. Store
  `embedder_id` per row, detect the change, re-embed in the background.

**Files:** `src/arz/memory/embedder.py`, `src/arz/config/schema.py`,
`src/arz/memory/{episodic,vector}.py` (embedder_id column + migration),
`src/arz/doctor.py`, `frontend/src/pages/MemoryPage.tsx`

**Acceptance**
- Fresh install with no Ollama returns semantically-related recall for a
  paraphrased query that shares no character n-grams with the stored fact.
- Switching embedder triggers re-embed, and no query mixes vector spaces.

### 4.2 — Skill synthesis from repeated patterns

**Gap:** KiroCrew claims it will *"synthesize reusable skills from repeated
patterns."* arz has `skills.py` and a nightly `consolidator.py` ("dream"), but
consolidation produces memory entries, not skills.

The pieces already exist — `consolidator.py` walks recent sessions and extracts
structured output; `skills.py` loads markdown skills; `suggestions.py` proves
the background-LLM-analysis pattern works. This is wiring, not new architecture.

- Extend the nightly consolidator: detect procedures repeated ≥3 times across
  sessions, draft a markdown skill, write it to `~/.arz/skills/_proposed/`.
- Never auto-enable. Proposed skills land in a review queue on the Memory or
  Capabilities page with accept / edit / reject.

**Files:** `src/arz/consolidator.py`, `src/arz/skills.py`,
`src/arz/dashboard/routes/skills.py`, `frontend/src/pages/CapabilitiesPage.tsx`

---

## Part B — Work, rendering, and the Files panel

### How it currently works

The turn pipeline is genuinely well-designed:

1. `POST /api/chat` creates a `StreamState` and spawns a background asyncio task
   driving the provider. **The run is decoupled from the HTTP connection** —
   [`stream_registry.py`](../../src/arz/dashboard/stream_registry.py).
2. The task pushes SSE events into a durable per-turn event log *and* fans out
   to subscribed client queues. Client disconnect kills only the subscriber.
3. `GET /api/chat/{id}/stream` replays buffered events, then follows live.
4. Frontend renders text through `CedarMarkdown`; `MessageContent.tsx` splits
   out inline widget tags and renders those as sandboxed iframes.
5. `useTouchedFiles.ts` watches tool-call events and infers which files were
   touched; `ActivityPane` merges that with a workspace scan and auto-switches
   to the Files tab on first touch.
6. `FileViewer` (1105 lines) renders by type, with Monaco editing, `Cmd+S` save,
   SSE live-reload via `useFileWatch`, TOC, and source-anchored comments.

Reconnect-safe streaming is better than a naive SSE implementation and better
than what most comparable projects ship. The weaknesses are all in step 5.

### 4.3 — Files panel: replace heuristic detection with provider truth

**Gap — this is the root cause of "files don't show in the panel."**

[`useTouchedFiles.ts`](../../frontend/src/hooks/useTouchedFiles.ts) detects file
activity by matching tool names against a hardcoded `FILE_TOOLS` set (~20 names)
and digging for paths under a hardcoded `PATH_KEYS` list (~10 keys). Its own
comment calls it a *"lenient list."*

Consequences:
- Any provider emitting a tool name outside that set → the file **silently**
  never appears. No error, no log — it just isn't there.
- arz supports five providers with independently-evolving tool vocabularies, so
  this list is permanently out of date by construction.
- `routes/files.py::_recover_from_history` (added in `f4ec3be`) exists purely to
  paper over this — recovering files from chat history after the fact. That is
  the symptom, not the fix.

**Target behaviour**
- Move detection **server-side** into the provider adapters. Each `LLMProvider`
  declares its own file-op tool mapping and emits a first-class
  `file_touched: {path, op: read|write|edit, tool}` SSE event.
- The frontend consumes that event and stops inferring anything.
- Providers that genuinely can't report file ops fall back to a filesystem diff
  of `session.work_dir` around the turn — accurate for writes regardless of tool
  naming.
- Add a conformance test per `STEERING.md`: every provider must map its file
  tools, asserted for all five implementations. That converts a silent gap into
  a failing test the moment a provider adds a tool.
- Keep `_recover_from_history` as a repair path, but it should stop being load-bearing.

**Files:** `src/arz/providers/base.py` (`file_tool_map`, emit `file_touched`),
`src/arz/providers/{claude_code,codex,gemini,kiro_cli,ollama}.py`,
`src/arz/dashboard/routes/chat.py`, `frontend/src/hooks/useTouchedFiles.ts`
(consume, don't infer), `tests/test_provider_file_events.py`

### 4.4 — Replace 5-second polling with the existing event stream

**Gap:** `ActivityPane.tsx:518` polls `GET /api/sessions/{id}/files` every 5s
while the Files tab is open — an unconditional full workspace walk per session
per 5s, for every connected client.

arz already has both better mechanisms: SSE fan-out (`stream_registry`) and a
single-file mtime watcher (`/api/files/watch`, used by `useFileWatch`).

- Emit `workspace_changed` on the session's existing SSE stream, debounced ~500ms.
- Trigger from the §4.3 `file_touched` events plus an mtime scan on the same
  debounce, so externally-edited files still appear.
- Frontend refetches the list on that event only. Keep a slow 60s poll purely as
  a safety net.

**Files:** `src/arz/dashboard/routes/files.py`,
`src/arz/dashboard/stream_registry.py`,
`frontend/src/components/ActivityPane.tsx`

### 4.5 — Render-path gaps

- **No virtualization.** `ActivityPane` (1103 lines) and `FileViewer` (1105)
  render full lists. Long sessions with hundreds of tool calls will degrade.
  Virtualize the tool list and the file list.
- **Widget iframes** — confirm `sandbox` attributes are restrictive (no
  `allow-same-origin` alongside `allow-scripts`, which together defeat the
  sandbox). `STEERING.md` forbids trusting raw LLM output in a browser; the
  widget path is exactly where that rule gets tested.
- **Binary/large files** — `FileViewer` caps reads; verify the cap is surfaced
  in the UI rather than silently truncating.

**Files:** `frontend/src/components/{ActivityPane,FileViewer,Widget}.tsx`

---

## Build order

1. **§4.1 embedder** — highest value-per-hour in the whole comparison
2. **§4.3 provider-truth file events** — fixes the panel's root cause
3. §4.4 event-driven refresh — trivial once §4.3 lands
4. §4.5 render hardening — sandbox audit first, virtualization when sessions grow
5. §4.2 skill synthesis — wiring on top of existing consolidator
