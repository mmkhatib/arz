// Operations — agent management room.
// Two stacked sections per Cedar spec:
//   1) Agent operations: 4-column board (Waiting on you / Running / Idle / Failed)
//   2) Your action items: cedar-drafted to-dos w/ filter pills.

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Check, X as XIcon, Trash2, Pause, Play, AlertTriangle } from "lucide-react";
import {
  CedarPage,
  CedarPageHeader,
  CedarCard,
  Btn,
  TopoLines,
} from "@/components/CedarUI";
import { api, type SessionSummary, type ActionItem } from "@/api/client";

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
}: {
  session: SessionSummary;
  lane: Lane;
  stage: Stage | null;
  onOpen: () => void;
}) {
  const who = `${session.title?.slice(0, 50) || "untitled"}`;
  const model = session.model || providerLabel(session.provider);
  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        padding: 12,
        transition: "all .12s",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = "var(--cedar-line)")}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = "var(--border)")}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 10.5, fontFamily: "var(--fm)", color: "var(--cedar-2)" }}>
          {providerLabel(session.provider)}{session.agent ? ` · ${session.agent}` : ""}
        </span>
        <span style={{ fontSize: 9.5, fontFamily: "var(--fm)", color: "var(--muted)" }}>
          {model.length > 16 ? model.slice(0, 16) + "…" : model}
        </span>
      </div>
      <div style={{ fontSize: 12.5, color: "var(--text)", lineHeight: 1.45 }}>{who}</div>

      {lane === "waiting" && (
        <>
          {stage?.lastAssistantText && (
            <div
              style={{
                fontSize: 11,
                color: "var(--text2)",
                marginTop: 6,
                lineHeight: 1.4,
                maxHeight: 36,
                overflow: "hidden",
                fontStyle: "italic",
              }}
            >
              "{stage.lastAssistantText}…"
            </div>
          )}
          <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
            <Btn size="sm" kind="solid" icon={<Check size={11} />} onClick={onOpen} style={{ flex: 1 }}>
              Open
            </Btn>
          </div>
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
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 6 }}>
            <span style={{ fontSize: 9.5, fontFamily: "var(--fm)", color: "var(--muted)" }}>
              streaming · {session.message_count} msgs
            </span>
            <Btn size="sm" kind="ghost" icon={<Pause size={10} />} onClick={onOpen} />
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
                maxHeight: 36,
                overflow: "hidden",
              }}
            >
              {stage.lastAssistantText}…
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
              fontFamily: "var(--fm)",
              display: "flex",
              alignItems: "flex-start",
              gap: 6,
              lineHeight: 1.4,
            }}
          >
            <AlertTriangle size={11} style={{ color: "var(--ember)", flexShrink: 0, marginTop: 2 }} />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
              {stage?.lastAssistantText?.slice(0, 80) || "session errored"}
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

const LANE_DEFS: { id: Lane; label: string; dot: string; sub: string }[] = [
  { id: "waiting", label: "Waiting on you", dot: "var(--cedar-glow)", sub: "blocked on your decision" },
  { id: "running", label: "Running",        dot: "var(--pine)",       sub: "in flight" },
  { id: "idle",    label: "Idle",           dot: "var(--text3)",      sub: "parked, ready" },
  { id: "failed",  label: "Failed",         dot: "var(--ember)",      sub: "needs attention" },
];

function fmtAge(secs: number): string {
  if (!secs) return "—";
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.round(secs / 60)}m`;
  if (secs < 86400) return `${Math.round(secs / 3600)}h`;
  return `${Math.round(secs / 86400)}d`;
}

type Stage = {
  lastRole: string | null;
  lastTool: string | null;
  lastToolInput: string | null;
  lastAssistantText: string | null;
  errored: boolean;
  elapsedMs: number | null;
  ageSecs: number;
};

export default function BoardPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<SessionSummary[]>([]);
  const [stages, setStages] = useState<Record<string, Stage>>({});
  const [actionItems, setActionItems] = useState<ActionItem[]>([]);
  const [filter, setFilter] = useState<"all" | "open" | "done">("open");
  const [draft, setDraft] = useState("");

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
            const ageSecs =
              last?.created_at != null
                ? Math.round((Date.now() - new Date(last.created_at).getTime()) / 1000)
                : 0;
            const stage: Stage = {
              lastRole: last?.role ?? null,
              lastTool: tc?.name ?? null,
              lastToolInput: typeof tc?.input === "string" ? tc.input : tc?.input != null ? JSON.stringify(tc.input).slice(0, 80) : null,
              lastAssistantText: lastAssistant?.text?.slice(0, 120) ?? null,
              errored: /error|failed|exception|traceback/i.test(lastAssistant?.text ?? ""),
              elapsedMs: lastAssistant?.elapsed_ms ?? null,
              ageSecs,
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
  };

  useEffect(() => {
    refresh();
    const id = window.setInterval(() => { if (!document.hidden) refresh(); }, 5000);
    return () => window.clearInterval(id);
  }, []);

  const lanes: Record<Lane, SessionSummary[]> = { waiting: [], running: [], idle: [], failed: [] };
  for (const s of items.filter((s) => !s.archived)) {
    const st = stages[s.id];
    let lane: Lane;
    if (s.streaming) lane = "running";
    else if (st?.errored) lane = "failed";
    else if (st?.lastRole === "assistant") lane = "waiting";
    else lane = "idle";
    lanes[lane].push(s);
  }

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
          right={<Btn kind="ghost" onClick={refresh}>↻ refresh</Btn>}
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
              <CedarCard key={lane.id} padding={0}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "12px 14px",
                    borderBottom: "1px solid var(--border)",
                  }}
                >
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: lane.dot,
                      boxShadow: lane.id === "running" ? `0 0 6px ${lane.dot}` : undefined,
                    }}
                  />
                  <span style={{ fontSize: 12.5, fontWeight: 500, color: "var(--text)" }}>
                    {lane.label}
                  </span>
                  <span
                    style={{
                      marginLeft: "auto",
                      fontFamily: "var(--fm)",
                      fontSize: 10.5,
                      color: "var(--muted)",
                    }}
                  >
                    {lanes[lane.id].length}
                  </span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 8 }}>
                  {lanes[lane.id].length === 0 && (
                    <div style={{ padding: "18px 14px", fontSize: 11.5, color: "var(--muted)", textAlign: "center" }}>
                      empty
                    </div>
                  )}
                  {lanes[lane.id].map((s) => (
                    <AgentOpCard
                      key={s.id}
                      session={s}
                      lane={lane.id}
                      stage={stages[s.id] ?? null}
                      onOpen={() => navigate(`/?sid=${encodeURIComponent(s.id)}`)}
                    />
                  ))}
                </div>
              </CedarCard>
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
