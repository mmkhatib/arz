// Analytics — three variants:
//   * Topo    — existing AnalyticsModal layered dashboard
//   * Cards   — KPI summary cards
//   * Heatmap — day×hour activity heatmap

import { useEffect, useMemo, useState } from "react";
import { BarChart3, LayoutGrid, Activity, Grid3x3 } from "lucide-react";
import AnalyticsModal from "@/components/AnalyticsModal";
import VariantSwitcher, { useVariant } from "@/components/VariantSwitcher";
import { PageShell, PageHeader } from "@/components/PageShell";
import { api } from "@/api/client";

type V = "topo" | "cards" | "heatmap";

export default function AnalyticsPage() {
  const [variant, setVariant] = useVariant<V>("arz:analytics-variant", "topo");

  if (variant === "topo") {
    return (
      <div className="flex flex-col w-full h-full">
        <div className="flex items-center justify-end px-4 py-2 border-b border-[var(--border)] bg-[var(--bg)]">
          <Switcher variant={variant} setVariant={setVariant} />
        </div>
        <div className="flex-1 min-h-0">
          <AnalyticsModal variant="page" />
        </div>
      </div>
    );
  }

  return (
    <PageShell variant="page">
      <PageHeader
        icon={<BarChart3 size={16} />}
        title="Analytics"
        actions={<Switcher variant={variant} setVariant={setVariant} />}
      />
      <div className="flex-1 overflow-y-auto p-6">
        {variant === "cards" && <CardsVariant />}
        {variant === "heatmap" && <HeatmapVariant />}
      </div>
    </PageShell>
  );
}

function Switcher({ variant, setVariant }: { variant: V; setVariant: (v: V) => void }) {
  return (
    <VariantSwitcher
      storageKey="arz:analytics-variant"
      value={variant}
      onChange={setVariant}
      variants={[
        { id: "topo",    label: "Dashboard", icon: <Activity size={11} /> },
        { id: "cards",   label: "Cards",     icon: <LayoutGrid size={11} /> },
        { id: "heatmap", label: "Heatmap",   icon: <Grid3x3 size={11} /> },
      ]}
    />
  );
}

function CardsVariant() {
  const [msgs, setMsgs] = useState<{ date: string; count: number }[]>([]);
  const [toks, setToks] = useState<{ date: string; count: number }[]>([]);
  const [tools, setTools] = useState<{ name: string; count: number }[]>([]);
  const [provs, setProvs] = useState<{ provider: string; messages: number }[]>([]);

  useEffect(() => {
    api.analyticsMessagesByDay(30).then(setMsgs).catch(() => {});
    api.analyticsTokensByDay(30).then(setToks).catch(() => {});
    api.analyticsToolUsage().then(setTools).catch(() => {});
    api.analyticsProviders().then(setProvs).catch(() => {});
  }, []);

  const totalMsgs = msgs.reduce((a, b) => a + b.count, 0);
  const totalToks = toks.reduce((a, b) => a + b.count, 0);
  const totalTools = tools.reduce((a, b) => a + b.count, 0);
  const topTool = tools[0]?.name ?? "—";
  const topProv = provs[0]?.provider ?? "—";

  const cards = [
    { label: "Messages (30d)",     value: totalMsgs.toLocaleString() },
    { label: "Tokens (30d)",       value: totalToks.toLocaleString() },
    { label: "Tool calls (30d)",   value: totalTools.toLocaleString() },
    { label: "Top tool",           value: topTool },
    { label: "Top provider",       value: topProv },
    { label: "Active providers",   value: String(provs.length) },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
      {cards.map((c) => (
        <div key={c.label} className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-4">
          <div className="eyebrow text-[var(--muted)]">{c.label}</div>
          <div className="font-display text-[26px] mt-1 text-[var(--text)]">{c.value}</div>
        </div>
      ))}
    </div>
  );
}

function HeatmapVariant() {
  const [data, setData] = useState<{ date: string; count: number }[]>([]);
  useEffect(() => { api.analyticsMessagesByDay(56).then(setData).catch(() => {}); }, []);

  // 8 weeks × 7 days grid
  const weeks = useMemo(() => {
    const map = new Map<string, number>();
    for (const d of data) map.set(d.date, d.count);
    const today = new Date();
    const cells: { date: string; count: number; dow: number }[] = [];
    for (let i = 55; i >= 0; i--) {
      const dt = new Date(today.getTime() - i * 86400_000);
      const key = dt.toISOString().slice(0, 10);
      cells.push({ date: key, count: map.get(key) ?? 0, dow: dt.getDay() });
    }
    return cells;
  }, [data]);

  const max = Math.max(1, ...weeks.map((c) => c.count));
  // Group into 8 weeks of 7 days, day-of-week aligned.
  const cols: { date: string; count: number }[][] = [];
  let week: { date: string; count: number }[] = [];
  for (const c of weeks) {
    week.push(c);
    if (week.length === 7) { cols.push(week); week = []; }
  }
  if (week.length) cols.push(week);

  return (
    <div>
      <h3 className="font-display text-[18px] mb-3 text-[var(--text)]">Last 8 weeks</h3>
      <div className="flex gap-1">
        {cols.map((wk, wi) => (
          <div key={wi} className="flex flex-col gap-1">
            {wk.map((c) => {
              const intensity = c.count / max;
              return (
                <div
                  key={c.date}
                  className="w-4 h-4 rounded-sm border border-[var(--border)]"
                  style={{ background: c.count ? `rgba(106, 156, 92, ${0.15 + intensity * 0.7})` : "transparent" }}
                  title={`${c.date} · ${c.count} msgs`}
                />
              );
            })}
          </div>
        ))}
      </div>
      <div className="mt-4 flex items-center gap-2 text-[10px] text-[var(--muted)]">
        <span>less</span>
        {[0, 0.25, 0.5, 0.75, 1].map((v, i) => (
          <span key={i} className="w-3 h-3 rounded-sm border border-[var(--border)]"
                style={{ background: v ? `rgba(106, 156, 92, ${0.15 + v * 0.7})` : "transparent" }} />
        ))}
        <span>more</span>
      </div>
    </div>
  );
}
