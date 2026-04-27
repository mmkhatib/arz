import { useEffect, useState } from "react";
import { api } from "@/api/client";
import type { CronEntry } from "@/api/client";
import { Clock, Plus, Trash2, Play, Power } from "lucide-react";

interface Props {
  onClose?: () => void;
  onJumpToSession?: (sessionId: string) => void;
  variant?: "modal" | "page";
}

const SCHEDULE_PRESETS: { label: string; expr: string }[] = [
  { label: "Every minute", expr: "* * * * *" },
  { label: "Every 5 minutes", expr: "*/5 * * * *" },
  { label: "Every hour", expr: "0 * * * *" },
  { label: "Every day, 9 AM", expr: "0 9 * * *" },
  { label: "Every Monday, 8 AM", expr: "0 8 * * 1" },
];

export default function ScheduleModal({ onClose, onJumpToSession, variant = "modal" }: Props) {
  const [items, setItems] = useState<CronEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // form state
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [schedule, setSchedule] = useState("0 9 * * *");
  const handleClose = onClose ?? (() => {});

  const refresh = () =>
    api.listCrons().then(setItems).catch((e) => setError(String(e)));

  useEffect(() => {
    refresh();
    if (variant !== "modal") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [variant, handleClose]);

  const create = async () => {
    if (!name.trim() || !prompt.trim() || !schedule.trim()) return;
    setError(null);
    try {
      await api.createCron(name.trim(), prompt.trim(), schedule.trim());
      setName("");
      setPrompt("");
      setSchedule("0 9 * * *");
      setCreating(false);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const toggle = async (item: CronEntry) => {
    try {
      await api.updateCron(item.id, { enabled: !item.enabled });
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const del = async (item: CronEntry) => {
    if (!confirm(`Delete schedule "${item.name}"?`)) return;
    try {
      await api.deleteCron(item.id);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const run = async (item: CronEntry) => {
    try {
      await api.runCronNow(item.id);
      // The cron run is async; refresh after a moment to show the new last_status
      setTimeout(refresh, 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const header = (
    <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-[var(--border)]">
      <div className="flex items-center gap-2">
        <Clock size={16} className="text-[var(--cedar)]" />
        <h2 className="text-[15px] font-semibold text-[var(--text)]">Scheduled tasks</h2>
      </div>
      {variant === "modal" && (
        <button onClick={handleClose} className="text-[var(--muted)] hover:text-[var(--text)] text-xl leading-none" aria-label="Close">×</button>
      )}
    </div>
  );
  const body = (
    <div className="overflow-y-auto px-5 py-4 flex-1">
      <div className="flex items-center justify-between mb-3">
            <span className="text-[12px] text-[var(--muted)]">{items.length} schedule{items.length === 1 ? "" : "s"}</span>
            <button
              onClick={() => setCreating((v) => !v)}
              className="flex items-center gap-1 px-3 py-1 rounded-md bg-[var(--cedar)] text-white text-[12px] hover:bg-[var(--cedar-lt)]"
            >
              <Plus size={11} /> {creating ? "Cancel" : "New schedule"}
            </button>
          </div>

          {creating && (
            <div className="mb-4 border border-[var(--border)] rounded-lg p-3 bg-[var(--surface)] flex flex-col gap-2">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Name (e.g. Morning standup)"
                className="bg-[var(--bg)] border border-[var(--border)] rounded-md px-2 py-1.5 text-[13px] text-[var(--text)] focus:outline-none focus:border-[var(--cedar)]"
              />
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Prompt to run on this schedule…"
                rows={3}
                className="bg-[var(--bg)] border border-[var(--border)] rounded-md px-2 py-1.5 text-[13px] text-[var(--text)] focus:outline-none focus:border-[var(--cedar)] resize-y"
              />
              <div className="flex items-center gap-2">
                <input
                  value={schedule}
                  onChange={(e) => setSchedule(e.target.value)}
                  placeholder="cron expression"
                  className="flex-1 bg-[var(--bg)] border border-[var(--border)] rounded-md px-2 py-1.5 text-[13px] font-mono text-[var(--text)] focus:outline-none focus:border-[var(--cedar)]"
                />
                <select
                  onChange={(e) => { if (e.target.value) setSchedule(e.target.value); }}
                  value=""
                  className="bg-[var(--bg)] border border-[var(--border)] rounded-md px-2 py-1.5 text-[12px] text-[var(--muted)]"
                >
                  <option value="">presets…</option>
                  {SCHEDULE_PRESETS.map((p) => (
                    <option key={p.expr} value={p.expr}>{p.label}</option>
                  ))}
                </select>
              </div>
              <div className="text-[10px] text-[var(--muted)]/60 font-mono">
                Format: minute hour day-of-month month day-of-week
              </div>
              <button
                onClick={create}
                disabled={!name.trim() || !prompt.trim() || !schedule.trim()}
                className="self-end px-4 py-1 rounded-md bg-[var(--cedar)] text-white text-[12px] disabled:opacity-40 hover:bg-[var(--cedar-lt)]"
              >
                Save schedule
              </button>
            </div>
          )}

          <div className="flex flex-col gap-2">
            {items.length === 0 && !creating && (
              <div className="text-center text-[var(--muted)]/60 text-[12px] py-8">
                No scheduled tasks yet. Click “New schedule” to add one.
              </div>
            )}
            {items.map((item) => (
              <div
                key={item.id}
                className={[
                  "flex items-start gap-3 border rounded-lg p-3 bg-[var(--surface)]",
                  item.enabled ? "border-[var(--border)]" : "border-[var(--border)]/40 opacity-60",
                ].join(" ")}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[13px] font-medium text-[var(--text)] truncate">{item.name}</span>
                    <span className="text-[10px] font-mono text-[var(--cedar)] bg-[var(--cedar)]/10 px-1.5 py-0.5 rounded shrink-0">{item.schedule}</span>
                    {!item.enabled && (
                      <span className="text-[10px] uppercase tracking-wider text-[var(--muted)] bg-[var(--bg)] px-1.5 py-0.5 rounded shrink-0">paused</span>
                    )}
                  </div>
                  <pre className="text-[12px] text-[var(--muted)] whitespace-pre-wrap break-words max-h-[80px] overflow-y-auto">
                    {item.prompt}
                  </pre>
                  {item.last_run_at != null && (
                    <div className="mt-2 flex items-center gap-2 text-[10px] text-[var(--muted)]/70 font-mono">
                      <span>last run {new Date(item.last_run_at * 1000).toLocaleString()}</span>
                      <span className={item.last_status?.startsWith("error") ? "text-red-400" : "text-green-400"}>
                        {item.last_status}
                      </span>
                      {item.last_session_id && onJumpToSession && (
                        <button
                          onClick={() => onJumpToSession(item.last_session_id!)}
                          className="underline hover:text-[var(--text)]"
                        >
                          open session
                        </button>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <button
                    onClick={() => run(item)}
                    title="Run now"
                    className="px-2 py-1 rounded text-[var(--muted)] hover:text-[var(--cedar)] hover:bg-[var(--bg)]"
                  >
                    <Play size={12} />
                  </button>
                  <button
                    onClick={() => toggle(item)}
                    title={item.enabled ? "Pause" : "Enable"}
                    className="px-2 py-1 rounded text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--bg)]"
                  >
                    <Power size={12} />
                  </button>
                  <button
                    onClick={() => del(item)}
                    title="Delete"
                    className="px-2 py-1 rounded text-[var(--muted)] hover:text-red-400 hover:bg-[var(--bg)]"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            ))}
          </div>
          {error && <div className="mt-3 text-red-400 text-[11px] bg-red-900/20 rounded px-2 py-1">{error}</div>}
        </div>
  );

  if (variant === "page") {
    return (
      <div className="flex flex-col h-full bg-[var(--bg)] min-w-0 flex-1 overflow-hidden">
        {header}
        {body}
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div className="bg-[var(--bg)] border border-[var(--border)] rounded-2xl shadow-2xl w-full max-w-3xl mx-4 max-h-[85vh] flex flex-col">
        {header}
        {body}
      </div>
    </div>
  );
}
