import { useEffect, useState } from "react";
import { api } from "@/api/client";
import { BarChart3, Download } from "lucide-react";
import { PageShell, PageHeader } from "@/components/PageShell";

interface Props {
  onClose?: () => void;
  variant?: "modal" | "page";
}

export default function AnalyticsModal({ onClose, variant = "modal" }: Props) {
  const handleClose = onClose ?? (() => {});
  const [msgs, setMsgs] = useState<{ date: string; count: number }[]>([]);
  const [tokens, setTokens] = useState<{ date: string; count: number }[]>([]);
  const [tools, setTools] = useState<{ name: string; count: number }[]>([]);
  const [providers, setProviders] = useState<{ provider: string; messages: number }[]>([]);
  const [latency, setLatency] = useState<{ provider: string; samples: number; p50_ms: number; p95_ms: number; avg_ms: number }[]>([]);
  const [days, setDays] = useState(30);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (variant !== "modal") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [variant]);

  useEffect(() => {
    Promise.all([
      api.analyticsMessagesByDay(days),
      api.analyticsTokensByDay(days),
      api.analyticsToolUsage(),
      api.analyticsProviders(),
      api.analyticsLatency(),
    ])
      .then(([m, t, tu, p, l]) => {
        setMsgs(m);
        setTokens(t);
        setTools(tu);
        setProviders(p);
        setLatency(l);
      })
      .catch((e) => setError(String(e)));
  }, [days]);

  const headerActions = (
    <>
      <select
        value={days}
        onChange={(e) => setDays(Number(e.target.value))}
        className="bg-[var(--bg)] border border-[var(--border)] rounded-md px-2 py-1 text-[12px] text-[var(--text)] focus:outline-none focus:border-[var(--cedar)]"
      >
        <option value={7}>7 days</option>
        <option value={14}>14 days</option>
        <option value={30}>30 days</option>
        <option value={90}>90 days</option>
      </select>
      <a
        href={api.analyticsCsvUrl()}
        download
        className="flex items-center gap-1 px-3 py-1 rounded-md bg-[var(--cedar)] text-white text-[12px] hover:bg-[var(--cedar-lt)]"
      >
        <Download size={11} /> CSV
      </a>
    </>
  );

  const header = (
    <PageHeader
      icon={<BarChart3 size={16} />}
      title="Analytics"
      actions={headerActions}
      onClose={variant === "modal" ? handleClose : undefined}
    />
  );

  const panels = (
    <>
      <Panel title="Messages per day"><BarChart series={msgs} /></Panel>
      <Panel title="Tokens per day (in + out)"><BarChart series={tokens} /></Panel>
      <Panel title="Tool usage">
        <Table rows={tools.slice(0, 12).map((t) => [t.name, String(t.count)])} empty="No tools called yet" />
      </Panel>
      <Panel title="Provider breakdown">
        <Table rows={providers.map((p) => [p.provider, String(p.messages)])} empty="No sessions yet" />
      </Panel>
      <Panel title="Latency (assistant turns)" colSpan={2}>
        {latency.length === 0 ? (
          <div className="text-center text-[var(--muted)]/60 text-[12px] py-4">No completed turns yet</div>
        ) : (
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-[var(--muted)]/60">
                <th className="text-left font-normal pb-1">Provider</th>
                <th className="text-right font-normal pb-1">Samples</th>
                <th className="text-right font-normal pb-1">p50 (ms)</th>
                <th className="text-right font-normal pb-1">p95 (ms)</th>
                <th className="text-right font-normal pb-1">avg (ms)</th>
              </tr>
            </thead>
            <tbody>
              {latency.map((l) => (
                <tr key={l.provider} className="border-t border-[var(--border)]/50">
                  <td className="py-1 text-[var(--text)]">{l.provider}</td>
                  <td className="py-1 text-right font-mono text-[var(--muted)]">{l.samples}</td>
                  <td className="py-1 text-right font-mono text-[var(--muted)]">{Math.round(l.p50_ms)}</td>
                  <td className="py-1 text-right font-mono text-[var(--muted)]">{Math.round(l.p95_ms)}</td>
                  <td className="py-1 text-right font-mono text-[var(--muted)]">{Math.round(l.avg_ms)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </>
  );

  return (
    <PageShell variant={variant} maxWidth="max-w-4xl" onClose={handleClose}>
      {header}
      <div className="overflow-y-auto px-5 py-4 flex-1 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 content-start">
        {panels}
      </div>
      {error && <div className="m-3 text-red-400 text-[11px] bg-red-900/20 rounded px-3 py-2">{error}</div>}
    </PageShell>
  );
}

function Panel({ title, children, colSpan }: { title: string; children: React.ReactNode; colSpan?: number }) {
  return (
    <section
      className={["border border-[var(--border)] rounded-lg bg-[var(--surface)] flex flex-col", colSpan === 2 ? "md:col-span-2" : ""].join(" ")}
    >
      <header className="px-4 py-2 border-b border-[var(--border)] text-[10px] uppercase tracking-wider text-[var(--muted)]">{title}</header>
      <div className="p-3">{children}</div>
    </section>
  );
}

function BarChart({ series }: { series: { date: string; count: number }[] }) {
  const max = Math.max(1, ...series.map((s) => s.count));
  if (series.length === 0) return <div className="text-[12px] text-[var(--muted)]/60">No data</div>;
  return (
    <div className="flex items-end gap-0.5 h-24" title={series.map((s) => `${s.date}: ${s.count}`).join("\n")}>
      {series.map((s) => (
        <div
          key={s.date}
          className="flex-1 bg-[var(--cedar)]/60 hover:bg-[var(--cedar)] rounded-t transition-colors"
          style={{ height: `${(s.count / max) * 100}%`, minHeight: s.count > 0 ? 2 : 0 }}
          title={`${s.date}: ${s.count}`}
        />
      ))}
    </div>
  );
}

function Table({ rows, empty }: { rows: string[][]; empty: string }) {
  if (rows.length === 0) return <div className="text-[12px] text-[var(--muted)]/60">{empty}</div>;
  return (
    <table className="w-full text-[12px]">
      <tbody>
        {rows.map(([k, v]) => (
          <tr key={k} className="border-b border-[var(--border)]/40 last:border-b-0">
            <td className="py-1 text-[var(--text)]">{k}</td>
            <td className="py-1 text-right font-mono text-[var(--muted)]">{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
