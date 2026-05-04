// Schedule UI — table of scheduled tasks + a friendly recurrence picker.
//
// Cron expressions are still the storage format on the backend; the picker
// composes the 5-field expression for common cases (daily / weekly / etc.)
// and `humanize()` decodes the saved cron back into human text for the
// table. An "advanced" toggle still lets power users enter raw cron.

import { useEffect, useMemo, useState } from "react";
import { api } from "@/api/client";
import type { CronEntry } from "@/api/client";
import { Clock, Plus, Trash2, Play, Power, Pencil } from "lucide-react";

interface Props {
  onClose?: () => void;
  onJumpToSession?: (sessionId: string) => void;
  variant?: "modal" | "page";
}

type Frequency = "every_n_min" | "hourly" | "daily" | "weekly" | "monthly" | "advanced";

interface PickerState {
  freq: Frequency;
  every_n: number;        // for every_n_min
  minute: number;         // 0-59
  hour: number;           // 0-23
  dow: number;            // 0 (Sun) - 6 (Sat) — for weekly
  dom: number;            // 1 - 31         — for monthly
  raw: string;            // raw cron when freq == "advanced"
}

const DEFAULT_PICKER: PickerState = {
  freq: "daily",
  every_n: 5,
  minute: 0,
  hour: 9,
  dow: 1,
  dom: 1,
  raw: "0 9 * * *",
};

const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function pickerToCron(p: PickerState): string {
  const m = clampInt(p.minute, 0, 59);
  const h = clampInt(p.hour, 0, 23);
  const dow = clampInt(p.dow, 0, 6);
  const dom = clampInt(p.dom, 1, 31);
  const n = clampInt(p.every_n, 1, 59);
  switch (p.freq) {
    case "every_n_min": return `*/${n} * * * *`;
    case "hourly":      return `${m} * * * *`;
    case "daily":       return `${m} ${h} * * *`;
    case "weekly":      return `${m} ${h} * * ${dow}`;
    case "monthly":     return `${m} ${h} ${dom} * *`;
    case "advanced":    return p.raw.trim();
  }
}

function clampInt(n: number, lo: number, hi: number): number {
  if (Number.isNaN(n)) return lo;
  return Math.max(lo, Math.min(hi, Math.floor(n)));
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

// Decode a 5-field cron back to a friendly string. Falls back to the raw
// expression when the pattern doesn't match a common shape.
function humanize(cron: string): string {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return cron;
  const [m, h, dom, mon, dow] = parts;
  const everyN = m.match(/^\*\/(\d+)$/);
  if (everyN && h === "*" && dom === "*" && mon === "*" && dow === "*") {
    return `Every ${everyN[1]} min`;
  }
  if (m === "*" && h === "*" && dom === "*" && mon === "*" && dow === "*") {
    return "Every minute";
  }
  if (/^\d+$/.test(m) && h === "*" && dom === "*" && mon === "*" && dow === "*") {
    return `Hourly at :${pad(parseInt(m, 10))}`;
  }
  if (/^\d+$/.test(m) && /^\d+$/.test(h) && dom === "*" && mon === "*" && dow === "*") {
    return `Daily at ${pad(parseInt(h, 10))}:${pad(parseInt(m, 10))}`;
  }
  if (/^\d+$/.test(m) && /^\d+$/.test(h) && dom === "*" && mon === "*" && /^\d+$/.test(dow)) {
    return `Weekly · ${DOW_LABELS[parseInt(dow, 10) % 7]} at ${pad(parseInt(h, 10))}:${pad(parseInt(m, 10))}`;
  }
  if (/^\d+$/.test(m) && /^\d+$/.test(h) && /^\d+$/.test(dom) && mon === "*" && dow === "*") {
    return `Monthly · day ${dom} at ${pad(parseInt(h, 10))}:${pad(parseInt(m, 10))}`;
  }
  return cron;
}

function fmtRel(ts: number | null | undefined): string {
  if (!ts) return "—";
  const d = new Date(ts * 1000);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return `${Math.round(diff)}s ago`;
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
  return d.toLocaleDateString();
}

export default function ScheduleModal({ onClose, onJumpToSession, variant = "modal" }: Props) {
  const [items, setItems] = useState<CronEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<CronEntry | "new" | null>(null);

  // Form state
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [picker, setPicker] = useState<PickerState>(DEFAULT_PICKER);
  const [persistentSession, setPersistentSession] = useState(false);
  const handleClose = onClose ?? (() => {});

  const refresh = () =>
    api.listCrons().then(setItems).catch((e) => setError(String(e)));

  useEffect(() => {
    refresh();
    if (variant !== "modal") return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") handleClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [variant]);

  const cronExpr = useMemo(() => pickerToCron(picker), [picker]);

  const startNew = () => {
    setName("");
    setPrompt("");
    setPicker(DEFAULT_PICKER);
    setPersistentSession(false);
    setEditing("new");
  };

  const startEdit = (item: CronEntry) => {
    setName(item.name);
    setPrompt(item.prompt);
    setPersistentSession(!!item.persistent_session);
    // Best-effort decode the cron back into the picker — falls back to
    // the advanced raw input on shapes the picker can't represent.
    setPicker(decodePicker(item.schedule));
    setEditing(item);
  };

  const cancel = () => setEditing(null);

  const save = async () => {
    if (!name.trim() || !prompt.trim() || !cronExpr.trim()) return;
    setError(null);
    try {
      if (editing === "new") {
        await api.createCron(name.trim(), prompt.trim(), cronExpr, true, persistentSession);
      } else if (editing) {
        await api.updateCron(editing.id, {
          name: name.trim(),
          prompt: prompt.trim(),
          schedule: cronExpr,
          persistent_session: persistentSession,
        });
      }
      setEditing(null);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const toggle = async (item: CronEntry) => {
    try { await api.updateCron(item.id, { enabled: !item.enabled }); refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  const del = async (item: CronEntry) => {
    if (!confirm(`Delete "${item.name}"?`)) return;
    try { await api.deleteCron(item.id); refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  const run = async (item: CronEntry) => {
    try { await api.runCronNow(item.id); setTimeout(refresh, 1500); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  const header = (
    <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-[var(--border)]">
      <div className="flex items-center gap-2">
        <Clock size={16} className="text-[var(--cedar)]" />
        <h2 className="text-[15px] font-semibold text-[var(--text)]">Scheduled tasks</h2>
        <span className="text-[12px] text-[var(--muted)]">{items.length}</span>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={startNew}
          className="flex items-center gap-1 px-3 py-1 rounded-md bg-[var(--cedar)] text-white text-[12px] hover:bg-[var(--cedar-lt)]"
        >
          <Plus size={11} /> New schedule
        </button>
        {variant === "modal" && (
          <button onClick={handleClose} className="text-[var(--muted)] hover:text-[var(--text)] text-xl leading-none px-1" aria-label="Close">×</button>
        )}
      </div>
    </div>
  );

  const editor = editing && (
    <div className="border border-[var(--cedar)]/40 rounded-lg p-4 bg-[var(--surface)] flex flex-col gap-3">
      <div className="text-[12px] font-semibold text-[var(--text)]">
        {editing === "new" ? "New schedule" : `Edit · ${editing.name}`}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name (e.g. Morning standup)"
          className="bg-[var(--bg)] border border-[var(--border)] rounded-md px-2 py-1.5 text-[13px] text-[var(--text)] focus:outline-none focus:border-[var(--cedar)]"
        />
        <RecurrencePicker picker={picker} onChange={setPicker} />
      </div>
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="Prompt to run on this schedule…"
        rows={3}
        className="bg-[var(--bg)] border border-[var(--border)] rounded-md px-2 py-1.5 text-[13px] text-[var(--text)] focus:outline-none focus:border-[var(--cedar)] resize-y"
      />
      <div className="flex items-center justify-between flex-wrap gap-2">
        <span className="text-[10px] font-mono text-[var(--muted)]/80">
          cron · {cronExpr || "(invalid)"} · runs <span className="text-[var(--text)]">{humanize(cronExpr)}</span>
        </span>
        <label className="flex items-center gap-2 text-[11px] text-[var(--muted)] cursor-pointer">
          <input
            type="checkbox"
            checked={persistentSession}
            onChange={(e) => setPersistentSession(e.target.checked)}
          />
          Persistent session (reuse chat across runs)
        </label>
      </div>
      <div className="flex justify-end gap-2">
        <button onClick={cancel} className="px-3 py-1 rounded-md text-[12px] text-[var(--muted)] hover:text-[var(--text)]">Cancel</button>
        <button
          onClick={save}
          disabled={!name.trim() || !prompt.trim() || !cronExpr.trim()}
          className="px-3 py-1 rounded-md bg-[var(--cedar)] text-white text-[12px] disabled:opacity-40 hover:bg-[var(--cedar-lt)]"
        >
          {editing === "new" ? "Create" : "Save"}
        </button>
      </div>
    </div>
  );

  const table = (
    <div className="border border-[var(--border)] rounded-lg overflow-hidden bg-[var(--surface)]">
      <table className="w-full text-[13px]">
        <thead className="bg-[var(--bg)]/40">
          <tr className="text-[10px] uppercase tracking-wider text-[var(--muted)]">
            <th className="text-left px-3 py-2 font-medium">Name</th>
            <th className="text-left px-3 py-2 font-medium">Runs</th>
            <th className="text-left px-3 py-2 font-medium">Last run</th>
            <th className="text-left px-3 py-2 font-medium">Status</th>
            <th className="text-right px-3 py-2 font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {items.length === 0 && (
            <tr>
              <td colSpan={5} className="px-3 py-8 text-center text-[var(--muted)]/60">
                No scheduled tasks yet. Click <span className="text-[var(--cedar)]">New schedule</span> to add one.
              </td>
            </tr>
          )}
          {items.map((item) => (
            <tr
              key={item.id}
              className={[
                "border-t border-[var(--border)]/60",
                item.enabled ? "" : "opacity-50",
              ].join(" ")}
            >
              <td className="px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-[var(--text)] truncate max-w-[220px]" title={item.prompt}>{item.name}</span>
                  {item.persistent_session && (
                    <span className="text-[9px] uppercase tracking-wider text-[var(--cedar)] bg-[var(--cedar)]/10 px-1 py-0.5 rounded shrink-0">persist</span>
                  )}
                </div>
                <div className="text-[10px] text-[var(--muted)]/70 truncate max-w-[280px]" title={item.prompt}>{item.prompt}</div>
              </td>
              <td className="px-3 py-2">
                <div className="text-[12px] text-[var(--text)]">{humanize(item.schedule)}</div>
                <div className="text-[10px] font-mono text-[var(--muted)]/60">{item.schedule}</div>
              </td>
              <td className="px-3 py-2 text-[12px] text-[var(--muted)]" title={item.last_run_at ? new Date(item.last_run_at * 1000).toLocaleString() : "never"}>
                {fmtRel(item.last_run_at)}
              </td>
              <td className="px-3 py-2 text-[11px]">
                {!item.enabled ? (
                  <span className="text-[var(--muted)]">paused</span>
                ) : !item.last_status ? (
                  <span className="text-[var(--muted)]/70">scheduled</span>
                ) : item.last_status.startsWith("error") ? (
                  <span className="text-red-400" title={item.last_status}>error</span>
                ) : (
                  <span className="text-green-400">ok</span>
                )}
                {item.last_session_id && onJumpToSession && (
                  <button
                    onClick={() => onJumpToSession(item.last_session_id!)}
                    className="ml-2 text-[10px] underline text-[var(--muted)] hover:text-[var(--text)]"
                  >
                    open
                  </button>
                )}
              </td>
              <td className="px-3 py-2">
                <div className="flex justify-end gap-1">
                  <IconBtn title="Run now" onClick={() => run(item)}><Play size={12} /></IconBtn>
                  <IconBtn title={item.enabled ? "Pause" : "Enable"} onClick={() => toggle(item)}><Power size={12} /></IconBtn>
                  <IconBtn title="Edit" onClick={() => startEdit(item)}><Pencil size={12} /></IconBtn>
                  <IconBtn title="Delete" onClick={() => del(item)} hover="hover:text-red-400"><Trash2 size={12} /></IconBtn>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  const body = (
    <div className="overflow-y-auto px-5 py-4 flex-1 flex flex-col gap-4">
      {editor}
      {table}
      {error && <div className="text-red-400 text-[11px] bg-red-900/20 rounded px-2 py-1">{error}</div>}
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
      onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
    >
      <div className="bg-[var(--bg)] border border-[var(--border)] rounded-2xl shadow-2xl w-full max-w-4xl mx-4 max-h-[85vh] flex flex-col">
        {header}
        {body}
      </div>
    </div>
  );
}

function IconBtn({ children, onClick, title, hover }: { children: React.ReactNode; onClick: () => void; title: string; hover?: string }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`px-1.5 py-1 rounded text-[var(--muted)] ${hover || "hover:text-[var(--cedar)]"} hover:bg-[var(--bg)]`}
    >
      {children}
    </button>
  );
}

function RecurrencePicker({ picker, onChange }: { picker: PickerState; onChange: (p: PickerState) => void }) {
  const set = (patch: Partial<PickerState>) => onChange({ ...picker, ...patch });
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={picker.freq}
        onChange={(e) => set({ freq: e.target.value as Frequency })}
        className="bg-[var(--bg)] border border-[var(--border)] rounded-md px-2 py-1.5 text-[12px] text-[var(--text)] focus:outline-none focus:border-[var(--cedar)]"
      >
        <option value="every_n_min">Every N minutes</option>
        <option value="hourly">Hourly</option>
        <option value="daily">Daily</option>
        <option value="weekly">Weekly</option>
        <option value="monthly">Monthly</option>
        <option value="advanced">Advanced (cron)</option>
      </select>

      {picker.freq === "every_n_min" && (
        <NumberSpin label="every" suffix="min" value={picker.every_n} min={1} max={59} onChange={(every_n) => set({ every_n })} />
      )}
      {picker.freq === "hourly" && (
        <NumberSpin label="at :MM" value={picker.minute} min={0} max={59} onChange={(minute) => set({ minute })} />
      )}
      {picker.freq === "daily" && (
        <TimeBox hour={picker.hour} minute={picker.minute} onChange={(hour, minute) => set({ hour, minute })} />
      )}
      {picker.freq === "weekly" && (
        <>
          <select
            value={picker.dow}
            onChange={(e) => set({ dow: parseInt(e.target.value, 10) })}
            className="bg-[var(--bg)] border border-[var(--border)] rounded-md px-2 py-1.5 text-[12px] text-[var(--text)] focus:outline-none focus:border-[var(--cedar)]"
          >
            {DOW_LABELS.map((l, i) => <option key={i} value={i}>{l}</option>)}
          </select>
          <TimeBox hour={picker.hour} minute={picker.minute} onChange={(hour, minute) => set({ hour, minute })} />
        </>
      )}
      {picker.freq === "monthly" && (
        <>
          <NumberSpin label="day" value={picker.dom} min={1} max={31} onChange={(dom) => set({ dom })} />
          <TimeBox hour={picker.hour} minute={picker.minute} onChange={(hour, minute) => set({ hour, minute })} />
        </>
      )}
      {picker.freq === "advanced" && (
        <input
          value={picker.raw}
          onChange={(e) => set({ raw: e.target.value })}
          placeholder="m h dom mon dow"
          className="flex-1 bg-[var(--bg)] border border-[var(--border)] rounded-md px-2 py-1.5 text-[12px] font-mono text-[var(--text)] focus:outline-none focus:border-[var(--cedar)]"
        />
      )}
    </div>
  );
}

function NumberSpin({ label, suffix, value, min, max, onChange }: { label?: string; suffix?: string; value: number; min: number; max: number; onChange: (n: number) => void }) {
  return (
    <span className="flex items-center gap-1 text-[12px] text-[var(--muted)]">
      {label && <span>{label}</span>}
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(parseInt(e.target.value, 10) || min)}
        className="w-16 bg-[var(--bg)] border border-[var(--border)] rounded-md px-2 py-1.5 text-[12px] text-[var(--text)] focus:outline-none focus:border-[var(--cedar)]"
      />
      {suffix && <span>{suffix}</span>}
    </span>
  );
}

function TimeBox({ hour, minute, onChange }: { hour: number; minute: number; onChange: (h: number, m: number) => void }) {
  return (
    <span className="flex items-center gap-1 text-[12px] text-[var(--muted)]">
      <span>at</span>
      <input
        type="number"
        value={hour}
        min={0}
        max={23}
        onChange={(e) => onChange(clampInt(parseInt(e.target.value, 10), 0, 23), minute)}
        className="w-14 bg-[var(--bg)] border border-[var(--border)] rounded-md px-2 py-1.5 text-[12px] text-[var(--text)] focus:outline-none focus:border-[var(--cedar)]"
      />
      <span>:</span>
      <input
        type="number"
        value={minute}
        min={0}
        max={59}
        onChange={(e) => onChange(hour, clampInt(parseInt(e.target.value, 10), 0, 59))}
        className="w-14 bg-[var(--bg)] border border-[var(--border)] rounded-md px-2 py-1.5 text-[12px] text-[var(--text)] focus:outline-none focus:border-[var(--cedar)]"
      />
    </span>
  );
}

// Decode a cron expression back into picker state. Conservative — anything
// unusual falls into the "advanced" bucket so the user can edit raw text.
function decodePicker(cron: string): PickerState {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return { ...DEFAULT_PICKER, freq: "advanced", raw: cron };
  const [m, h, dom, mon, dow] = parts;
  const everyN = m.match(/^\*\/(\d+)$/);
  if (everyN && h === "*" && dom === "*" && mon === "*" && dow === "*") {
    return { ...DEFAULT_PICKER, freq: "every_n_min", every_n: parseInt(everyN[1], 10), raw: cron };
  }
  if (/^\d+$/.test(m) && h === "*" && dom === "*" && mon === "*" && dow === "*") {
    return { ...DEFAULT_PICKER, freq: "hourly", minute: parseInt(m, 10), raw: cron };
  }
  if (/^\d+$/.test(m) && /^\d+$/.test(h) && dom === "*" && mon === "*" && dow === "*") {
    return { ...DEFAULT_PICKER, freq: "daily", minute: parseInt(m, 10), hour: parseInt(h, 10), raw: cron };
  }
  if (/^\d+$/.test(m) && /^\d+$/.test(h) && dom === "*" && mon === "*" && /^\d+$/.test(dow)) {
    return { ...DEFAULT_PICKER, freq: "weekly", minute: parseInt(m, 10), hour: parseInt(h, 10), dow: parseInt(dow, 10), raw: cron };
  }
  if (/^\d+$/.test(m) && /^\d+$/.test(h) && /^\d+$/.test(dom) && mon === "*" && dow === "*") {
    return { ...DEFAULT_PICKER, freq: "monthly", minute: parseInt(m, 10), hour: parseInt(h, 10), dom: parseInt(dom, 10), raw: cron };
  }
  return { ...DEFAULT_PICKER, freq: "advanced", raw: cron };
}
