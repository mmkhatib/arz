import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/api/client";
import type { OverviewResponse } from "@/api/client";
import { LayoutDashboard, CheckCircle, XCircle, Circle } from "lucide-react";
import { PageShell, PageHeader } from "@/components/PageShell";

interface Props {
  onClose?: () => void;
  variant?: "modal" | "page";
}

function relTime(ts: number): string {
  const diff = Date.now() / 1000 - ts;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

const KIND_COLORS: Record<string, string> = {
  session_start: "text-green-400",
  session_end: "text-[var(--muted)]",
  message: "text-blue-400",
  tool_call: "text-amber-400",
  error: "text-red-400",
};

export default function OverviewModal({ onClose, variant = "modal" }: Props) {
  const handleClose = onClose ?? (() => {});
  const navigate = useNavigate();
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = () =>
    api.getOverview(10).then(setData).catch((e) => setError(String(e)));

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 30_000);
    if (variant === "modal") {
      const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") handleClose(); };
      document.addEventListener("keydown", onKey);
      return () => { clearInterval(t); document.removeEventListener("keydown", onKey); };
    }
    return () => clearInterval(t);
  }, [variant]);

  const header = (
    <PageHeader
      icon={<LayoutDashboard size={16} />}
      title="Overview"
      onClose={variant === "modal" ? handleClose : undefined}
    />
  );

  const body = !data ? (
    <div className="flex items-center justify-center flex-1 text-[var(--muted)] text-[13px]">
      {error ? error : "Loading…"}
    </div>
  ) : (
    <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-5">
      {/* Count cards — click to jump to that section */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
        {[
          { label: "Active Sessions", value: data.counts.sessions_active, to: "/" },
          { label: "History", value: data.counts.sessions_history, to: "/" },
          { label: "Schedule", value: data.counts.crons, to: "/schedule" },
          { label: "Agents", value: data.counts.agents ?? 0, to: "/agents" },
          { label: "Lessons", value: data.counts.memory_lessons, to: "/memory" },
          { label: "Memory Notes", value: data.counts.memory_notes, to: "/memory" },
          { label: "Subagents", value: data.counts.subagents ?? 0, to: "/autonomy" },
          { label: "Channels", value: data.counts.channels ?? 0, to: "/autonomy" },
          { label: "Tasks", value: data.counts.tasks ?? 0, to: "/autonomy" },
          { label: "MCP Servers", value: data.counts.mcp_servers ?? 0, to: "/capabilities" },
        ].map((c) => (
          <button
            key={c.label}
            onClick={() => { if (c.to) { variant === "modal" ? handleClose() : null; navigate(c.to); } }}
            className="border border-[var(--border)] rounded-lg p-3 bg-[var(--surface)] flex flex-col gap-1 text-left hover:border-[var(--cedar)]/40 hover:bg-[var(--cedar)]/5 transition-colors"
          >
            <div className="text-[10px] uppercase tracking-wider text-[var(--muted)]">{c.label}</div>
            <div className="text-[24px] font-semibold text-[var(--text)] font-mono leading-none">{c.value}</div>
          </button>
        ))}
      </div>

      {/* Provider status */}
      <div className="border border-[var(--border)] rounded-lg bg-[var(--surface)] overflow-hidden">
        <div className="px-4 py-2 border-b border-[var(--border)] text-[10px] uppercase tracking-wider text-[var(--muted)]">Providers</div>
        <table className="w-full text-[12px]">
          <tbody>
            {data.providers.map((p) => (
              <tr key={p.name} className="border-b border-[var(--border)]/40 last:border-b-0">
                <td className="px-4 py-2 text-[var(--text)] font-mono">{p.name}</td>
                <td className="px-4 py-2">
                  {p.installed ? (
                    <span className="flex items-center gap-1 text-green-400"><CheckCircle size={11} /> installed</span>
                  ) : (
                    <span className="flex items-center gap-1 text-[var(--muted)]/60"><XCircle size={11} /> not found</span>
                  )}
                </td>
                <td className="px-4 py-2 font-mono text-[10px] text-[var(--muted)]/60 truncate max-w-[200px]">
                  {p.binary_path ?? (p.name === "anthropic" ? "sdk" : "—")}
                </td>
                <td className="px-4 py-2">
                  {p.is_active && (
                    <span className="text-[10px] uppercase tracking-wider text-[var(--cedar)] bg-[var(--cedar)]/10 px-2 py-0.5 rounded font-semibold">active</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Provider pool */}
      {data.pool && (
        <div className="border border-[var(--border)] rounded-lg bg-[var(--surface)]">
          <div className="px-4 py-2 border-b border-[var(--border)] text-[10px] uppercase tracking-wider text-[var(--muted)]">Provider pool</div>
          <div className="px-4 py-3 flex flex-wrap gap-6 text-[12px]">
            <Stat label="Active" value={`${data.pool.active} / ${data.pool.max_size}`} />
            <Stat
              label="Warm"
              value={`${data.pool.warm}${data.pool.warm_target > 0 ? ` / ${data.pool.warm_target}` : ""}`}
              warn={data.pool.warm_target > 0 && data.pool.warm < data.pool.warm_target}
            />
            {data.pool.warm_target === 0 && (
              <span className="text-[11px] text-[var(--muted)]/60 italic">
                Warm pool disabled. Set <code className="font-mono">[dashboard] warm_pool_size</code> in config.toml to pre-spawn providers.
              </span>
            )}
          </div>
        </div>
      )}

      {/* Cron health */}
      <div className="border border-[var(--border)] rounded-lg bg-[var(--surface)]">
        <div className="px-4 py-2 border-b border-[var(--border)] text-[10px] uppercase tracking-wider text-[var(--muted)]">Cron health</div>
        <div className="px-4 py-3 flex flex-wrap gap-6 text-[12px]">
          <Stat label="Total" value={data.cron_health.total} />
          <Stat label="Enabled" value={data.cron_health.enabled} />
          <Stat
            label="Last fired"
            value={data.cron_health.last_run_at ? relTime(data.cron_health.last_run_at) : "never"}
          />
          <Stat
            label="Errors (24h)"
            value={data.cron_health.error_count_24h}
            warn={data.cron_health.error_count_24h > 0}
          />
        </div>
      </div>

      {/* Recent activity */}
      <div className="border border-[var(--border)] rounded-lg bg-[var(--surface)]">
        <div className="px-4 py-2 border-b border-[var(--border)] text-[10px] uppercase tracking-wider text-[var(--muted)]">Recent activity</div>
        {data.recent_activity.length === 0 ? (
          <div className="px-4 py-6 text-center text-[var(--muted)]/60 text-[12px]">No activity yet</div>
        ) : (
          <div className="flex flex-col divide-y divide-[var(--border)]/40">
            {data.recent_activity.map((e) => (
              <div key={e.id} className="px-4 py-2 flex items-center gap-3 text-[12px]">
                <Circle size={6} className={KIND_COLORS[e.kind] ?? "text-[var(--muted)]"} fill="currentColor" />
                <span className="font-mono text-[10px] text-[var(--cedar)] bg-[var(--cedar)]/10 px-1.5 py-0.5 rounded shrink-0">{e.kind}</span>
                <span className="text-[var(--text)] flex-1 truncate">{e.summary}</span>
                <span className="text-[10px] text-[var(--muted)]/60 shrink-0 font-mono">{relTime(e.ts)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <PageShell variant={variant} maxWidth="max-w-4xl" onClose={handleClose}>
      {header}
      {body}
    </PageShell>
  );
}

function Stat({ label, value, warn }: { label: string; value: string | number; warn?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="text-[10px] uppercase tracking-wider text-[var(--muted)]">{label}</div>
      <div className={["font-mono font-semibold", warn ? "text-red-400" : "text-[var(--text)]"].join(" ")}>{value}</div>
    </div>
  );
}
