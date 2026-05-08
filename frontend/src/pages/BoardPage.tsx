// Operations — 4-lane Kanban for in-flight sessions + Action Items panel.
//
// Lanes (Cedar spec):
//   * Waiting  — session has a pending tool permission request, or assistant
//     turn done waiting for user reply.
//   * Running  — provider is actively streaming.
//   * Idle     — fresh / quiet sessions.
//   * Failed   — last turn errored (best-effort: detected via streaming-flag
//     dropouts; placeholder until we surface a structured error flag).
//
// Action Items panel: TODO list shared across the workspace. Items can be
// added by the user or auto-drafted by an LLM emitting a `<todo>` tag in a
// reply. Stored server-side (~/.arz/action-items.json) so they sync across
// machines.

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Columns3,
  Wrench,
  Hand,
  Bot,
  Clock,
  AlertTriangle,
  Plus,
  Check,
  X as XIcon,
  Trash2,
} from "lucide-react";
import { api, type SessionSummary, type ActionItem } from "@/api/client";
import { PageShell, PageHeader } from "@/components/PageShell";

type Lane = "waiting" | "running" | "idle" | "failed";

function classifySession(s: SessionSummary, hint: { lastRole: string | null }): Lane {
  if (s.streaming) return "running";
  if (hint.lastRole === "assistant") return "waiting";
  return "idle";
}

const LANE_DEFS: { id: Lane; label: string; icon: React.ReactNode; color: string }[] = [
  { id: "waiting", label: "Waiting",  icon: <Hand size={14} />,           color: "border-amber-400/60" },
  { id: "running", label: "Running",  icon: <Wrench size={14} />,         color: "border-blue-400/50" },
  { id: "idle",    label: "Idle",     icon: <Clock size={14} />,          color: "border-[var(--border)]" },
  { id: "failed",  label: "Failed",   icon: <AlertTriangle size={14} />,  color: "border-red-400/60" },
];

export default function BoardPage() {
  const [items, setItems] = useState<SessionSummary[]>([]);
  const [lastRoles, setLastRoles] = useState<Record<string, string | null>>({});
  const [actionItems, setActionItems] = useState<ActionItem[]>([]);
  const [showDone, setShowDone] = useState(false);
  const [draft, setDraft] = useState("");

  const refreshSessions = async () => {
    try {
      const data = await api.fetchSessions();
      setItems(data);
      const subset = data.slice(0, 30);
      const roles = await Promise.all(
        subset.map(async (s) => {
          try {
            const d = await api.getSession(s.id);
            return [s.id, d.messages.length ? d.messages[d.messages.length - 1].role : null] as const;
          } catch {
            return [s.id, null] as const;
          }
        }),
      );
      setLastRoles(Object.fromEntries(roles));
    } catch {
      // ignore
    }
  };

  const refreshActions = async () => {
    try {
      setActionItems(await api.listActionItems());
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    refreshSessions();
    refreshActions();
    const id = window.setInterval(() => {
      if (document.hidden) return;
      refreshSessions();
      refreshActions();
    }, 5000);
    return () => window.clearInterval(id);
  }, []);

  const lanes: Record<Lane, SessionSummary[]> = { waiting: [], running: [], idle: [], failed: [] };
  for (const s of items) {
    const lane = classifySession(s, { lastRole: lastRoles[s.id] ?? null });
    lanes[lane].push(s);
  }

  const submitDraft = async () => {
    const t = draft.trim();
    if (!t) return;
    setDraft("");
    try {
      const created = await api.createActionItem(t);
      setActionItems((prev) => [...prev, created]);
    } catch {
      // ignore
    }
  };

  const setStatus = async (id: string, status: "open" | "done" | "dismissed") => {
    setActionItems((prev) => prev.map((i) => (i.id === id ? { ...i, status } : i)));
    try { await api.patchActionItem(id, { status }); } catch {}
  };

  const removeItem = async (id: string) => {
    setActionItems((prev) => prev.filter((i) => i.id !== id));
    try { await api.deleteActionItem(id); } catch {}
  };

  const visibleActions = actionItems.filter((i) => showDone || i.status === "open");
  const openCount = actionItems.filter((i) => i.status === "open").length;

  return (
    <PageShell variant="page">
      <PageHeader
        icon={<Columns3 size={16} />}
        title="Operations"
        count={`${items.length} active · ${openCount} todo`}
        actions={
          <button
            onClick={() => { refreshSessions(); refreshActions(); }}
            className="text-[12px] text-[var(--muted)] hover:text-[var(--text)] px-2 py-1 rounded-md hover:bg-[var(--surface)]"
          >
            ↻ refresh
          </button>
        }
      />
      <div className="flex-1 overflow-auto p-4 flex flex-col gap-4 min-h-0">
        {/* Lanes */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 min-h-[40vh]">
          {LANE_DEFS.map((lane) => (
            <div key={lane.id} className={`flex flex-col bg-[var(--surface)] border ${lane.color} rounded-lg overflow-hidden`}>
              <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border)] text-[12px] uppercase tracking-wider text-[var(--muted)]">
                {lane.icon}
                <span>{lane.label}</span>
                <span className="ml-auto font-mono text-[11px]">{lanes[lane.id].length}</span>
              </div>
              <div className="flex-1 overflow-y-auto px-2 py-2 flex flex-col gap-1">
                {lanes[lane.id].length === 0 && (
                  <div className="text-center text-[11px] text-[var(--muted)]/50 py-3">empty</div>
                )}
                {lanes[lane.id].map((s) => (
                  <Link
                    key={s.id}
                    to={`/?sid=${encodeURIComponent(s.id)}`}
                    className="block px-2 py-1.5 rounded-md hover:bg-[var(--bg)] border border-transparent hover:border-[var(--border)] transition-colors"
                    title={s.title}
                  >
                    <div className="text-[13px] text-[var(--text)] truncate">{s.title || "untitled"}</div>
                    <div className="flex items-center gap-2 mt-0.5 text-[10px] text-[var(--muted)] font-mono">
                      <span>{s.message_count} msgs</span>
                      {s.provider && <span>· {s.provider}</span>}
                      {s.autonudge_goal && <span className="text-amber-400">· auto</span>}
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Action Items */}
        <div className="flex flex-col bg-[var(--surface)] border border-[var(--border)] rounded-lg overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border)] text-[12px] uppercase tracking-wider text-[var(--muted)]">
            <Bot size={14} />
            <span>Action Items</span>
            <span className="font-mono text-[11px]">{openCount} open</span>
            <button
              onClick={() => setShowDone((v) => !v)}
              className="ml-auto text-[10px] normal-case tracking-normal text-[var(--muted)] hover:text-[var(--text)]"
            >
              {showDone ? "hide done" : "show all"}
            </button>
          </div>
          <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border)]">
            <Plus size={13} className="text-[var(--muted)]" />
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submitDraft(); }}
              placeholder="Add a todo… (LLMs can also draft these via <todo> tags)"
              className="flex-1 bg-transparent text-[13px] text-[var(--text)] placeholder-[var(--muted)] focus:outline-none"
            />
            <button
              onClick={submitDraft}
              disabled={!draft.trim()}
              className="text-[11px] px-2 py-0.5 rounded-md bg-[var(--cedar-dim)] text-[var(--text)] hover:bg-[var(--cedar)]/30 disabled:opacity-40"
            >
              Add
            </button>
          </div>
          <div className="flex flex-col divide-y divide-[var(--border)]/50">
            {visibleActions.length === 0 && (
              <div className="px-4 py-6 text-center text-[12px] text-[var(--muted)]">
                {actionItems.length === 0 ? "No action items yet." : "No open items."}
              </div>
            )}
            {visibleActions.map((it) => (
              <div key={it.id} className="flex items-center gap-2 px-3 py-2">
                <button
                  onClick={() => setStatus(it.id, it.status === "done" ? "open" : "done")}
                  className={[
                    "w-4 h-4 shrink-0 rounded border flex items-center justify-center transition-colors",
                    it.status === "done"
                      ? "bg-[var(--cedar)] border-[var(--cedar)] text-white"
                      : "border-[var(--border)] hover:border-[var(--cedar)]",
                  ].join(" ")}
                  title={it.status === "done" ? "Re-open" : "Mark done"}
                >
                  {it.status === "done" && <Check size={10} />}
                </button>
                <div className="flex-1 min-w-0">
                  <div
                    className={[
                      "text-[13px] truncate",
                      it.status === "open" ? "text-[var(--text)]" : "text-[var(--muted)] line-through",
                    ].join(" ")}
                  >
                    {it.text}
                  </div>
                  <div className="text-[10px] font-mono text-[var(--muted)]/70 flex items-center gap-2">
                    <span>{it.source_kind === "agent" ? "agent" : "you"}</span>
                    {it.session_id && (
                      <Link
                        to={`/?sid=${encodeURIComponent(it.session_id)}`}
                        className="hover:text-[var(--cedar)]"
                        title="Open source session"
                      >
                        ↗ session
                      </Link>
                    )}
                  </div>
                </div>
                {it.status === "open" && (
                  <button
                    onClick={() => setStatus(it.id, "dismissed")}
                    className="text-[var(--muted)] hover:text-[var(--text)] p-1 rounded hover:bg-[var(--bg)]"
                    title="Dismiss"
                  >
                    <XIcon size={12} />
                  </button>
                )}
                <button
                  onClick={() => removeItem(it.id)}
                  className="text-[var(--muted)] hover:text-red-400 p-1 rounded hover:bg-[var(--bg)]"
                  title="Delete"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </PageShell>
  );
}
