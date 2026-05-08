// Schedule page — three variants:
//   * Table    — existing ScheduleModal (CRUD + recurrence picker)
//   * Calendar — month grid showing fire counts per day
//   * Timeline — past 7 days timeline with last-run markers
//
// All variants read from the same /api/cron endpoint.

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Clock, Calendar, Activity, Table } from "lucide-react";
import { api, type CronEntry } from "@/api/client";
import ScheduleModal from "@/components/ScheduleModal";
import VariantSwitcher, { useVariant } from "@/components/VariantSwitcher";
import { PageShell, PageHeader } from "@/components/PageShell";

type V = "table" | "calendar" | "timeline";

export default function SchedulePage() {
  const navigate = useNavigate();
  const [variant, setVariant] = useVariant<V>("arz:schedule-variant", "table");

  if (variant === "table") {
    return (
      <div className="flex flex-col w-full h-full">
        <div className="flex items-center justify-end px-4 py-2 border-b border-[var(--border)] bg-[var(--bg)]">
          <Switcher variant={variant} setVariant={setVariant} />
        </div>
        <div className="flex-1 min-h-0">
          <ScheduleModal
            variant="page"
            onJumpToSession={(id) => {
              api.reactivateSession(id)
                .catch(() => {})
                .finally(() => navigate(`/#session=${id}`));
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <PageShell variant="page">
      <PageHeader
        icon={<Clock size={16} />}
        title="Schedule"
        actions={<Switcher variant={variant} setVariant={setVariant} />}
      />
      <div className="flex-1 overflow-y-auto p-6">
        {variant === "calendar" && <CalendarVariant />}
        {variant === "timeline" && <TimelineVariant />}
      </div>
    </PageShell>
  );
}

function Switcher({ variant, setVariant }: { variant: V; setVariant: (v: V) => void }) {
  return (
    <VariantSwitcher
      storageKey="arz:schedule-variant"
      value={variant}
      onChange={setVariant}
      variants={[
        { id: "table",    label: "Table",    icon: <Table size={11} /> },
        { id: "calendar", label: "Calendar", icon: <Calendar size={11} /> },
        { id: "timeline", label: "Timeline", icon: <Activity size={11} /> },
      ]}
    />
  );
}

function CalendarVariant() {
  const [items, setItems] = useState<CronEntry[]>([]);
  useEffect(() => { api.listCrons().then(setItems).catch(() => {}); }, []);

  // Build a 5-week month grid for the current month, count last_run hits per day.
  const cells = useMemo(() => {
    const today = new Date();
    const first = new Date(today.getFullYear(), today.getMonth(), 1);
    const startDow = first.getDay();
    const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
    const grid: { date: Date | null; count: number }[] = [];
    for (let i = 0; i < startDow; i++) grid.push({ date: null, count: 0 });
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(today.getFullYear(), today.getMonth(), d);
      const count = items.filter((c) => {
        if (!c.last_run_at) return false;
        const r = new Date(c.last_run_at * 1000);
        return r.getFullYear() === date.getFullYear() &&
               r.getMonth() === date.getMonth() &&
               r.getDate() === date.getDate();
      }).length;
      grid.push({ date, count });
    }
    while (grid.length % 7 !== 0) grid.push({ date: null, count: 0 });
    return grid;
  }, [items]);

  const monthLabel = new Date().toLocaleString("default", { month: "long", year: "numeric" });
  const todayKey = new Date().toDateString();

  return (
    <div className="max-w-[720px]">
      <h3 className="font-display text-[18px] mb-4 text-[var(--text)]">{monthLabel}</h3>
      <div className="grid grid-cols-7 gap-1 text-[10px] eyebrow text-[var(--muted)] mb-1">
        {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map((d) => <div key={d} className="text-center">{d}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((c, i) => {
          if (!c.date) return <div key={i} className="aspect-square" />;
          const isToday = c.date.toDateString() === todayKey;
          const intensity = Math.min(1, c.count / 4);
          return (
            <div
              key={i}
              className={[
                "aspect-square rounded-md border flex flex-col items-end p-1 text-[11px]",
                isToday ? "border-[var(--cedar)]" : "border-[var(--border)]",
              ].join(" ")}
              style={{ background: c.count ? `rgba(106, 156, 92, ${0.15 + intensity * 0.5})` : undefined }}
              title={c.count ? `${c.count} run${c.count > 1 ? "s" : ""}` : "no runs"}
            >
              <span className="text-[var(--muted)]">{c.date.getDate()}</span>
              {c.count > 0 && <span className="font-mono text-[var(--text)] mt-auto">{c.count}</span>}
            </div>
          );
        })}
      </div>
      <div className="mt-6 text-[12px] text-[var(--muted)]">
        {items.length} scheduled {items.length === 1 ? "task" : "tasks"} · grid shaded by last-run count.
      </div>
    </div>
  );
}

function TimelineVariant() {
  const [items, setItems] = useState<CronEntry[]>([]);
  useEffect(() => { api.listCrons().then(setItems).catch(() => {}); }, []);

  const days = 7;
  const now = Date.now();
  const start = now - days * 86400_000;
  const ticks = Array.from({ length: days }, (_, i) => {
    const t = start + i * 86400_000;
    const d = new Date(t);
    return { t, label: `${d.getMonth() + 1}/${d.getDate()}` };
  });

  return (
    <div className="flex flex-col gap-1">
      <div className="grid gap-2 mb-2 text-[10px] eyebrow text-[var(--muted)]" style={{ gridTemplateColumns: `200px repeat(${days}, 1fr)` }}>
        <span></span>
        {ticks.map((t) => <span key={t.t} className="text-center">{t.label}</span>)}
      </div>
      {items.length === 0 && <div className="text-[12px] text-[var(--muted)]">No scheduled tasks.</div>}
      {items.map((c) => {
        const lastRun = c.last_run_at ? c.last_run_at * 1000 : null;
        const offset = lastRun && lastRun > start
          ? ((lastRun - start) / (now - start)) * 100
          : null;
        return (
          <div key={c.id} className="grid items-center gap-2 py-1.5 border-b border-[var(--border)]/40" style={{ gridTemplateColumns: `200px 1fr` }}>
            <div className="flex flex-col min-w-0">
              <div className="text-[12px] truncate text-[var(--text)]">{c.name}</div>
              <div className="text-[10px] font-mono text-[var(--muted)] truncate">{c.schedule}</div>
            </div>
            <div className="relative h-4 bg-[var(--surface)] rounded">
              {offset !== null && (
                <div
                  className="absolute top-0 bottom-0 w-1 rounded bg-[var(--cedar)]"
                  style={{ left: `${Math.min(99, Math.max(0, offset))}%` }}
                  title={`Last run ${new Date(lastRun!).toLocaleString()}`}
                />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
