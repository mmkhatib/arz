// Operations — agent management room.
// Two stacked sections per Cedar spec:
//   1) Agent operations: 4-column board (Waiting on you / Running / Idle / Failed)
//   2) Your action items: cedar-drafted to-dos w/ filter pills.

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ageSecs, fmtAge, plainExcerpt, shortModelLabel } from "@/utils/format";
import { Plus, Check, X as XIcon, Trash2, Pause, Play, AlertTriangle, RefreshCw, ChevronDown } from "lucide-react";
import {
  CedarPage,
  CedarPageHeader,
  CedarCard,
  Btn,
  TopoLines,
} from "@/components/CedarUI";
import { api, type SessionSummary, type ActionItem, type ActionItemPriority } from "@/api/client";

type Lane = "waiting" | "running" | "idle" | "failed";

function providerLabel(p: string | null | undefined): string {
  if (!p) return "?";
  if (p === "kiro-cli") return "Kiro";
  if (p === "codex") return "Codex";
  if (p === "gemini") return "Gemini";
  if (p === "claude-code") return "CC";
  if (p === "ollama") return "Ollama";
  return p;
}

function AgentOpCard({
  session,
  lane,
  stage,
  onOpen,
  approval,
  onApprove,
  onDeny,
  onTrust,
  onStop,
}: {
  session: SessionSummary;
  lane: Lane;
  stage: Stage | null;
  onOpen: () => void;
  approval?: PendingApproval | null;
  onApprove?: (a: PendingApproval) => void;
  onDeny?: (a: PendingApproval) => void;
  onTrust?: (a: PendingApproval) => void;
  onStop?: (s: SessionSummary) => void;
}) {
  const who = `${session.title?.slice(0, 50) || "untitled"}`;
  const fullModel = session.model || providerLabel(session.provider);
  const model = shortModelLabel(session.model) || providerLabel(session.provider);
  const agentLabel = session.agent
    ? `@${session.agent}`
    : `@${providerLabel(session.provider).toLowerCase()}`;
  return (
    <div
      onClick={onOpen}
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        padding: 12,
        transition: "all .12s",
        cursor: "pointer",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = "var(--cedar-line)";
        e.currentTarget.style.background = "var(--s2)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = "var(--border)";
        e.currentTarget.style.background = "var(--surface)";
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
        <span
          style={{
            fontSize: 10.5,
            fontFamily: "var(--fm)",
            color: "var(--cedar-2)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            minWidth: 0,
          }}
          title={session.agent || providerLabel(session.provider)}
        >
          {agentLabel}
        </span>
        <span
          style={{ fontSize: 9.5, fontFamily: "var(--fm)", color: "var(--muted)", flexShrink: 0 }}
          title={fullModel}
        >
          {model}
        </span>
      </div>
      <div style={{ fontSize: 12.5, color: "var(--text)", lineHeight: 1.45 }}>{who}</div>

      {lane === "waiting" && (
        <>
          {approval ? (
            <>
              <div
                style={{
                  marginTop: 6,
                  padding: "7px 9px",
                  background: "var(--cedar-dim)",
                  borderLeft: "2px solid var(--cedar-glow)",
                  borderRadius: 3,
                  fontSize: 11,
                  color: "var(--text2)",
                  fontFamily: "var(--fm)",
                  lineHeight: 1.4,
                }}
              >
                <div style={{ color: "var(--cedar-glow)", fontWeight: 500, marginBottom: 2 }}>
                  Wants to run <span style={{ fontFamily: "var(--fm)" }}>{approval.tool_name || "tool"}</span>
                </div>
                {approval.tool_input && (
                  <div
                    title={approval.tool_input}
                    style={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      color: "var(--text3)",
                    }}
                  >
                    {approval.tool_input.slice(0, 90)}
                  </div>
                )}
              </div>
              <div style={{ display: "flex", gap: 6, marginTop: 10 }} onClick={(e) => e.stopPropagation()}>
                <Btn
                  size="sm"
                  kind="solid"
                  icon={<Check size={11} />}
                  onClick={() => onApprove?.(approval)}
                  style={{ flex: 1 }}
                >
                  Approve
                </Btn>
                <Btn
                  size="sm"
                  kind="outline"
                  onClick={() => onTrust?.(approval)}
                  title="Approve + auto-approve all remaining tools this session"
                >
                  Trust
                </Btn>
                <Btn
                  size="sm"
                  kind="ghost"
                  icon={<XIcon size={11} />}
                  onClick={() => onDeny?.(approval)}
                  title="Deny"
                />
              </div>
            </>
          ) : (
            <>
              {stage?.lastAssistantText && (
                <div
                  style={{
                    fontSize: 11,
                    color: "var(--text2)",
                    marginTop: 6,
                    lineHeight: 1.4,
                    overflow: "hidden",
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                  }}
                  title={stage.lastAssistantText}
                >
                  {stage.lastAssistantText}
                </div>
              )}
              <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
                <Btn size="sm" kind="solid" icon={<Check size={11} />} onClick={onOpen} style={{ flex: 1 }}>
                  Open
                </Btn>
              </div>
            </>
          )}
          <div style={{ fontSize: 9.5, fontFamily: "var(--fm)", color: "var(--muted)", marginTop: 6 }}>
            waiting {fmtAge(stage?.ageSecs ?? 0)} · {session.message_count} msgs
            {stage?.elapsedMs != null && ` · ${(stage.elapsedMs / 1000).toFixed(1)}s last reply`}
          </div>
        </>
      )}

      {lane === "running" && (
        <>
          {stage?.lastTool && (
            <div
              style={{
                fontSize: 11,
                color: "var(--cedar-2)",
                marginTop: 6,
                fontFamily: "var(--fm)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={stage.lastToolInput ?? ""}
            >
              ⚒ {stage.lastTool}{stage.lastToolInput ? ` · ${stage.lastToolInput.slice(0, 40)}` : ""}
            </div>
          )}
          <div style={{ marginTop: 9, height: 3, background: "var(--s2)", borderRadius: 2, overflow: "hidden" }}>
            <div
              style={{
                width: "100%",
                height: "100%",
                background:
                  "linear-gradient(90deg, transparent, var(--cedar-glow), transparent)",
                animation: "cedarShimmer 1.6s linear infinite",
                backgroundSize: "200% 100%",
              }}
            />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8 }} onClick={(e) => e.stopPropagation()}>
            <span style={{ fontSize: 9.5, fontFamily: "var(--fm)", color: "var(--muted)", marginRight: "auto" }}>
              streaming · {session.message_count} msgs
            </span>
            <Btn size="sm" kind="outline" onClick={onOpen}>Open</Btn>
            <Btn
              size="sm"
              kind="ghost"
              icon={<Pause size={10} />}
              onClick={() => onStop?.(session)}
              title="Stop this turn"
            />
          </div>
        </>
      )}

      {lane === "idle" && (
        <>
          {stage?.lastAssistantText && (
            <div
              style={{
                fontSize: 11,
                color: "var(--text3)",
                marginTop: 6,
                lineHeight: 1.4,
                overflow: "hidden",
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
              }}
              title={stage.lastAssistantText}
            >
              {stage.lastAssistantText}
            </div>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
            <span style={{ fontSize: 9.5, fontFamily: "var(--fm)", color: "var(--muted)" }}>
              idle {fmtAge(stage?.ageSecs ?? 0)} · {session.message_count} msgs
            </span>
            <div style={{ flex: 1 }} />
            <Btn size="sm" kind="outline" icon={<Play size={10} />} onClick={onOpen}>Open</Btn>
          </div>
        </>
      )}

      {lane === "failed" && (
        <>
          <div
            style={{
              marginTop: 8,
              padding: "7px 9px",
              background: "var(--ember-dim)",
              borderLeft: "2px solid var(--ember)",
              borderRadius: 3,
              fontSize: 11,
              color: "var(--text2)",
              display: "flex",
              alignItems: "flex-start",
              gap: 6,
              lineHeight: 1.4,
            }}
          >
            <AlertTriangle size={11} style={{ color: "var(--ember)", flexShrink: 0, marginTop: 2 }} />
            <span
              title={stage?.lastAssistantText ?? ""}
              style={{ overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", minWidth: 0 }}
            >
              {stage?.lastAssistantText || "Session errored"}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8 }}>
            <Btn size="sm" kind="outline" icon={<Play size={10} />} onClick={onOpen} style={{ flex: 1 }}>
              Retry
            </Btn>
            <Btn size="sm" kind="ghost" onClick={onOpen}>Trace</Btn>
          </div>
        </>
      )}
    </div>
  );
}

// Replies older than this drop from "Waiting on you" to "Idle".
const WAITING_STALE_SECS = 3 * 86400;
// Cards shown per lane before the "Show N more" fold.
const LANE_PREVIEW = 6;

const LANE_DEFS: { id: Lane; label: string; dot: string; sub: string }[] = [
  { id: "waiting", label: "Waiting on you", dot: "var(--cedar-glow)", sub: "blocked on your decision" },
  { id: "running", label: "Running",        dot: "var(--pine)",       sub: "in flight" },
  { id: "idle",    label: "Idle",           dot: "var(--text3)",      sub: "parked, ready" },
  { id: "failed",  label: "Failed",         dot: "var(--ember)",      sub: "needs attention" },
];

type Stage = {
  lastRole: string | null;
  lastTool: string | null;
  lastToolInput: string | null;
  lastAssistantText: string | null;
  errored: boolean;
  elapsedMs: number | null;
  ageSecs: number;
};

type PendingApproval = {
  request_id: string;
  session_id: string;
  tool_name: string;
  tool_input: string;
  title: string;
  created_at: number;
};

export default function BoardPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<SessionSummary[]>([]);
  const [stages, setStages] = useState<Record<string, Stage>>({});
  const [actionItems, setActionItems] = useState<ActionItem[]>([]);
  const [approvals, setApprovals] = useState<PendingApproval[]>([]);
  const [filter, setFilter] = useState<"all" | "open" | "done">("open");
  const [draft, setDraft] = useState("");
  const [expandedLanes, setExpandedLanes] = useState<Set<Lane>>(new Set());

  const refresh = async () => {
    try {
      const data = await api.fetchSessions();
      setItems(data);
      const subset = data.slice(0, 30);
      const stagesArr = await Promise.all(
        subset.map(async (s) => {
          try {
            const d = await api.getSession(s.id);
            const last = d.messages[d.messages.length - 1];
            const lastAssistant = [...d.messages].reverse().find((m) => m.role === "assistant");
            const tc = (last?.tool_calls?.[last.tool_calls.length - 1] || lastAssistant?.tool_calls?.[lastAssistant.tool_calls.length - 1]) as
              | { name?: string; input?: unknown }
              | undefined;
            const age = ageSecs(last?.created_at);
            const stage: Stage = {
              lastRole: last?.role ?? null,
              lastTool: tc?.name ?? null,
              lastToolInput: typeof tc?.input === "string" ? tc.input : tc?.input != null ? JSON.stringify(tc.input).slice(0, 80) : null,
              lastAssistantText: plainExcerpt(lastAssistant?.text, 220) || null,
              // Judge the readable text only — raw widget HTML/code is full of
              // "error" (onerror=, catch blocks) and misfiled healthy turns.
              errored: /\b(error|exception|traceback|failed)\b/i.test(plainExcerpt(lastAssistant?.text, 300)),
              elapsedMs: lastAssistant?.elapsed_ms ?? null,
              ageSecs: age,
            };
            return [s.id, stage] as const;
          } catch {
            return [s.id, null] as const;
          }
        }),
      );
      const map: Record<string, Stage> = {};
      for (const [id, st] of stagesArr) if (st) map[id] = st;
      setStages(map);
    } catch {}
    try {
      setActionItems(await api.listActionItems());
    } catch {}
    try {
      setApprovals(await api.listApprovals());
    } catch {}
  };

  useEffect(() => {
    refresh();
    const id = window.setInterval(() => { if (!document.hidden) refresh(); }, 5000);
    return () => window.clearInterval(id);
  }, []);

  // Pending-approval map by session id — drives the waiting lane override
  // and lets each card know whether it has actionable buttons.
  const approvalsBySession = useMemo(() => {
    const out: Record<string, PendingApproval> = {};
    for (const a of approvals) {
      // First-come-first-served per session is fine — usually only one
      // approval is open at a time.
      if (!out[a.session_id]) out[a.session_id] = a;
    }
    return out;
  }, [approvals]);

  const lanes: Record<Lane, SessionSummary[]> = { waiting: [], running: [], idle: [], failed: [] };
  for (const s of items.filter((s) => !s.archived)) {
    const st = stages[s.id];
    let lane: Lane;
    if (approvalsBySession[s.id]) lane = "waiting";
    else if (s.streaming) lane = "running";
    else if (st?.errored) lane = "failed";
    // A reply nobody answered in days isn't "waiting on you" any more —
    // it's parked. Keeps the lane to what actually wants a decision.
    else if (st?.lastRole === "assistant" && st.ageSecs < WAITING_STALE_SECS) lane = "waiting";
    else lane = "idle";
    lanes[lane].push(s);
  }

  const onApprove = async (a: PendingApproval) => {
    setApprovals((p) => p.filter((x) => x.request_id !== a.request_id));
    try { await api.approveRequest(a.request_id); } catch {} finally { refresh(); }
  };
  const onDeny = async (a: PendingApproval) => {
    setApprovals((p) => p.filter((x) => x.request_id !== a.request_id));
    try { await api.rejectRequest(a.request_id); } catch {} finally { refresh(); }
  };
  const onTrust = async (a: PendingApproval) => {
    // Approve THIS call, AND flip the session into trust mode so the
    // remaining approvals in this turn fly through.
    setApprovals((p) => p.filter((x) => x.request_id !== a.request_id));
    try {
      await api.setApprovalMode(a.session_id, "trust");
      await api.approveRequest(a.request_id);
    } catch {} finally { refresh(); }
  };
  const onStop = async (s: SessionSummary) => {
    try { await api.stopChat(s.id); } catch {} finally { refresh(); }
  };

  const submitDraft = async () => {
    const t = draft.trim(); if (!t) return; setDraft("");
    try {
      const created = await api.createActionItem(t);
      setActionItems((p) => [...p, created]);
    } catch {}
  };

  const setStatus = async (id: string, status: "open" | "done" | "dismissed") => {
    setActionItems((p) => p.map((i) => (i.id === id ? { ...i, status } : i)));
    try { await api.patchActionItem(id, { status }); } catch {}
  };

  const cyclePriority = async (id: string) => {
    const next: Record<ActionItemPriority, ActionItemPriority> = {
      low: "normal",
      normal: "high",
      high: "low",
    };
    setActionItems((p) => p.map((i) => (i.id === id ? { ...i, priority: next[i.priority] } : i)));
    try {
      const cur = actionItems.find((i) => i.id === id);
      if (cur) await api.patchActionItem(id, { priority: next[cur.priority] });
    } catch {}
  };

  const removeItem = async (id: string) => {
    setActionItems((p) => p.filter((i) => i.id !== id));
    try { await api.deleteActionItem(id); } catch {}
  };

  const visibleActions = actionItems.filter((i) => filter === "all" || (filter === "done" ? i.status === "done" : i.status === "open"));
  const openCount = actionItems.filter((i) => i.status === "open").length;
  const doneCount = actionItems.filter((i) => i.status === "done").length;

  return (
    <CedarPage>
      <div style={{ position: "relative", overflow: "hidden" }}>
        <TopoLines height={130} opacity={0.5} />
        <CedarPageHeader
          eyebrow="agent management"
          title={
            <>
              The <em style={{ fontStyle: "italic", color: "var(--cedar-glow)" }}>operations room</em>.
            </>
          }
          sub={`${items.length} active sessions · ${openCount} open todos · ${doneCount} done`}
          right={<Btn kind="ghost" icon={<RefreshCw size={12} />} onClick={refresh}>Refresh</Btn>}
        />
      </div>

      <div style={{ padding: "24px 32px 32px", display: "flex", flexDirection: "column", gap: 24 }}>
        {/* Agent operations — 4-lane board */}
        <section>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              marginBottom: 12,
              fontFamily: "var(--fm)",
              fontSize: 10.5,
              color: "var(--muted)",
              textTransform: "uppercase",
              letterSpacing: ".14em",
            }}
          >
            <span style={{ width: 18, height: 1, background: "var(--cedar-glow)" }} />
            Agent operations
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
            {LANE_DEFS.map((lane) => (
              <div key={lane.id} style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, padding: "0 4px" }}>
                  <span
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: "50%",
                      background: lane.dot,
                      boxShadow: lane.id === "running" ? `0 0 8px ${lane.dot}` : undefined,
                      animation: lane.id === "running" ? "arz-pulse 1.6s infinite" : undefined,
                      flexShrink: 0,
                    }}
                  />
                  <span style={{ fontFamily: "var(--fd)", fontSize: 16, color: "var(--text)" }}>
                    {lane.label}
                  </span>
                  <span
                    style={{
                      fontFamily: "var(--fm)",
                      fontSize: 10.5,
                      color: "var(--muted)",
                    }}
                  >
                    {lanes[lane.id].length}
                  </span>
                </div>
                <div
                  style={{
                    fontFamily: "var(--fm)",
                    fontSize: 10,
                    color: "var(--muted)",
                    marginBottom: 10,
                    padding: "0 4px",
                  }}
                >
                  {lane.sub}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {lanes[lane.id].length === 0 && (
                    <div
                      style={{
                        padding: "18px 14px",
                        fontSize: 11.5,
                        color: "var(--muted)",
                        textAlign: "center",
                        border: "1px dashed var(--hairline)",
                        borderRadius: 8,
                        fontFamily: "var(--fm)",
                      }}
                    >
                      Nothing here
                    </div>
                  )}
                  {(expandedLanes.has(lane.id) ? lanes[lane.id] : lanes[lane.id].slice(0, LANE_PREVIEW)).map((s) => (
                    <AgentOpCard
                      key={s.id}
                      session={s}
                      lane={lane.id}
                      stage={stages[s.id] ?? null}
                      approval={approvalsBySession[s.id] ?? null}
                      onApprove={onApprove}
                      onDeny={onDeny}
                      onTrust={onTrust}
                      onStop={onStop}
                      onOpen={() => navigate(`/?sid=${encodeURIComponent(s.id)}`)}
                    />
                  ))}
                  {lanes[lane.id].length > LANE_PREVIEW && (
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedLanes((prev) => {
                          const next = new Set(prev);
                          if (next.has(lane.id)) next.delete(lane.id);
                          else next.add(lane.id);
                          return next;
                        })
                      }
                      className="flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-[var(--hairline)] py-2 text-[11px] font-mono text-[var(--muted)] hover:text-[var(--text)] hover:border-[var(--cedar-line)] transition-colors"
                    >
                      <ChevronDown
                        size={12}
                        style={{ transform: expandedLanes.has(lane.id) ? "rotate(180deg)" : undefined, transition: "transform .15s" }}
                      />
                      {expandedLanes.has(lane.id) ? "Show less" : `Show ${lanes[lane.id].length - LANE_PREVIEW} more`}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Action items */}
        <section>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              marginBottom: 12,
              fontFamily: "var(--fm)",
              fontSize: 10.5,
              color: "var(--muted)",
              textTransform: "uppercase",
              letterSpacing: ".14em",
            }}
          >
            <span style={{ width: 18, height: 1, background: "var(--cedar-glow)" }} />
            Your action items
          </div>
          <CedarCard padding={0}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "12px 16px",
                borderBottom: "1px solid var(--border)",
              }}
            >
              {(["all", "open", "done"] as const).map((f) => {
                const count =
                  f === "all" ? actionItems.length : f === "open" ? openCount : doneCount;
                return (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    style={{
                      padding: "5px 10px",
                      borderRadius: 99,
                      border: `1px solid ${f === filter ? "var(--cedar-line)" : "var(--border)"}`,
                      background: f === filter ? "var(--cedar-dim)" : "transparent",
                      color: f === filter ? "var(--cedar-glow)" : "var(--text2)",
                      fontFamily: "var(--fn)",
                      fontSize: 11.5,
                      cursor: "pointer",
                      textTransform: "capitalize",
                    }}
                  >
                    {f} <span style={{ fontFamily: "var(--fm)", fontSize: 10, opacity: 0.7 }}>{count}</span>
                  </button>
                );
              })}
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "10px 16px",
                borderBottom: "1px solid var(--border)",
              }}
            >
              <Plus size={13} style={{ color: "var(--muted)" }} />
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") submitDraft(); }}
                placeholder="Add a todo… (LLMs auto-draft via <todo> tags)"
                style={{
                  flex: 1,
                  background: "transparent",
                  border: "none",
                  outline: "none",
                  fontSize: 13,
                  color: "var(--text)",
                  fontFamily: "var(--fn)",
                }}
              />
              <Btn size="sm" kind="solid" onClick={submitDraft} disabled={!draft.trim()}>
                Add
              </Btn>
            </div>
            <div>
              {visibleActions.length === 0 && (
                <div style={{ padding: 24, textAlign: "center", fontSize: 12.5, color: "var(--muted)" }}>
                  {actionItems.length === 0 ? "Cedar will draft action items here as you work." : "No items in this view."}
                </div>
              )}
              {visibleActions.map((it) => (
                <div
                  key={it.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "12px 16px",
                    borderBottom: "1px solid var(--hairline)",
                  }}
                >
                  <button
                    onClick={() => setStatus(it.id, it.status === "done" ? "open" : "done")}
                    title={it.status === "done" ? "Re-open" : "Mark done"}
                    style={{
                      width: 18,
                      height: 18,
                      borderRadius: 5,
                      border: `1px solid ${it.status === "done" ? "var(--cedar)" : "var(--border)"}`,
                      background: it.status === "done" ? "var(--cedar)" : "transparent",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      cursor: "pointer",
                    }}
                  >
                    {it.status === "done" && <Check size={11} color="#fff" />}
                  </button>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 13,
                        color: it.status === "open" ? "var(--text)" : "var(--text3)",
                        textDecoration: it.status === "done" ? "line-through" : "none",
                      }}
                    >
                      {it.text}
                    </div>
                    <div
                      style={{
                        fontSize: 10.5,
                        color: "var(--muted)",
                        fontFamily: "var(--fm)",
                        marginTop: 3,
                        display: "flex",
                        gap: 6,
                      }}
                    >
                      <span>
                        {it.source_kind === "agent" ? "drafted by Cedar" : "you"}
                      </span>
                      {it.session_id && (
                        <a
                          href={`/?sid=${encodeURIComponent(it.session_id)}`}
                          style={{ color: "var(--cedar-2)", textDecoration: "none" }}
                        >
                          ↗ session
                        </a>
                      )}
                    </div>
                  </div>
                  <PriorityPill priority={it.priority} done={it.status === "done"} onClick={() => cyclePriority(it.id)} />
                  {it.status === "open" && (
                    <Btn size="sm" kind="ghost" icon={<XIcon size={11} />} onClick={() => setStatus(it.id, "dismissed")} title="Dismiss" />
                  )}
                  <Btn size="sm" kind="ghost" icon={<Trash2 size={11} />} onClick={() => removeItem(it.id)} title="Delete" />
                </div>
              ))}
            </div>
            <div
              style={{
                padding: "10px 16px",
                fontSize: 10.5,
                fontFamily: "var(--fm)",
                color: "var(--muted)",
                borderTop: "1px solid var(--border)",
                fontStyle: "italic",
              }}
            >
              Cedar drafts these from your conversations and memory.
            </div>
          </CedarCard>
        </section>
      </div>
    </CedarPage>
  );
}

function PriorityPill({
  priority,
  done,
  onClick,
}: {
  priority: ActionItemPriority;
  done: boolean;
  onClick: () => void;
}) {
  const color: Record<ActionItemPriority, string> = {
    high: "var(--cedar-glow)",
    normal: "var(--cedar-2)",
    low: "var(--text3)",
  };
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      title={`Priority: ${priority} — click to cycle`}
      style={{
        background: "transparent",
        border: `1px solid ${color[priority]}`,
        color: color[priority],
        borderRadius: 3,
        padding: "2px 7px",
        fontSize: 9.5,
        fontFamily: "var(--fm)",
        textTransform: "uppercase",
        letterSpacing: ".08em",
        cursor: "pointer",
        opacity: done ? 0.4 : 1,
      }}
    >
      {priority}
    </button>
  );
}
