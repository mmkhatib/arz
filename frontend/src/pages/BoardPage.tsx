// Board view — 4-lane Kanban for in-flight sessions.
//
// Lanes:
//   * Approval — session has a pending tool permission request
//     (today we approximate this via the `streaming` flag + a near-time
//     poll; the hook stays simple until we surface a richer "needs
//     approval" flag from the server).
//   * Your Turn — session is idle, last message was assistant.
//   * Working — provider is actively streaming.
//   * Idle — anything else (e.g. fresh session waiting for user).
//
// Cards link straight back into /chat so the user can pick up the
// conversation. Refreshes every 5s (cheap — same /api/sessions used by
// the sidebar).

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Columns3, Wrench, Hand, Bot, Clock } from "lucide-react";
import { api, type SessionSummary } from "@/api/client";

type Lane = "approval" | "your_turn" | "working" | "idle";

function classifySession(s: SessionSummary, hint: { lastRole: string | null }): Lane {
  if (s.streaming) return "working";
  // No structured "needs_approval" flag yet; default Approval lane stays
  // empty until we wire that signal through. For now: anything streaming
  // that's been streaming a while could be flagged via overview, but the
  // cheap-poll path doesn't have it.
  if (hint.lastRole === "assistant") return "your_turn";
  return "idle";
}

const LANE_DEFS: { id: Lane; label: string; icon: React.ReactNode; color: string }[] = [
  { id: "approval", label: "Approval", icon: <Hand size={14} />, color: "border-amber-400/60" },
  { id: "your_turn", label: "Your Turn", icon: <Bot size={14} />, color: "border-[var(--cedar)]/50" },
  { id: "working", label: "Working", icon: <Wrench size={14} />, color: "border-blue-400/50" },
  { id: "idle", label: "Idle", icon: <Clock size={14} />, color: "border-[var(--border)]" },
];

export default function BoardPage() {
  const [items, setItems] = useState<SessionSummary[]>([]);
  const [lastRoles, setLastRoles] = useState<Record<string, string | null>>({});

  const refresh = async () => {
    try {
      const data = await api.fetchSessions();
      setItems(data);
      // Best-effort fetch the trailing role for each session so we can put
      // assistant-tail items in "Your Turn". Keep the request count small
      // by only checking the top 30.
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

  useEffect(() => {
    refresh();
    const id = window.setInterval(() => { if (!document.hidden) refresh(); }, 5000);
    return () => window.clearInterval(id);
  }, []);

  const lanes: Record<Lane, SessionSummary[]> = { approval: [], your_turn: [], working: [], idle: [] };
  for (const s of items) {
    const lane = classifySession(s, { lastRole: lastRoles[s.id] ?? null });
    lanes[lane].push(s);
  }

  return (
    <div className="flex flex-col h-full bg-[var(--bg)] min-w-0 flex-1 overflow-hidden">
      <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-[var(--border)]">
        <div className="flex items-center gap-2">
          <Columns3 size={16} className="text-[var(--cedar)]" />
          <h2 className="text-[15px] font-semibold text-[var(--text)]">Board</h2>
          <span className="text-[12px] text-[var(--muted)]">{items.length} active</span>
        </div>
        <button
          onClick={refresh}
          className="text-[11px] text-[var(--muted)] hover:text-[var(--text)] px-2 py-1 rounded"
        >
          ↻ refresh
        </button>
      </div>
      <div className="flex-1 overflow-x-auto overflow-y-hidden p-4">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 h-full">
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
      </div>
    </div>
  );
}
