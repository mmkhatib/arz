// Analytics — usage as terrain. Three layouts per design:
//   * Mountain  (default) — area-chart "mountain" of token volume + 3 stat cards
//   * Grid                 — 12wk × 7d heatmap + Top tools + Provider mix
//   * Breakdown            — per-day data table

import { useEffect, useMemo, useState } from "react";
import { Download } from "lucide-react";
import {
  CedarPage,
  CedarPageHeader,
  CedarCard,
  Btn,
  SegSeg,
  TopoLines,
} from "@/components/CedarUI";
import { api } from "@/api/client";

type Variant = "mountain" | "grid" | "breakdown";
type DayPoint = { date: string; count: number };

function dow(date: string): string {
  const d = new Date(date + "T00:00:00");
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()];
}

export default function AnalyticsPage() {
  const [variant, setVariant] = useState<Variant>(
    () => (localStorage.getItem("arz:analytics-variant") as Variant) || "mountain",
  );
  useEffect(() => { localStorage.setItem("arz:analytics-variant", variant); }, [variant]);

  const [msgsAll, setMsgsAll] = useState<DayPoint[]>([]);
  const [toksAll, setToksAll] = useState<DayPoint[]>([]);
  const [tools, setTools] = useState<{ name: string; count: number }[]>([]);
  const [provs, setProvs] = useState<{ provider: string; messages: number }[]>([]);

  useEffect(() => {
    api.analyticsMessagesByDay(84).then(setMsgsAll).catch(() => {});
    api.analyticsTokensByDay(84).then(setToksAll).catch(() => {});
    api.analyticsToolUsage().then(setTools).catch(() => {});
    api.analyticsProviders().then(setProvs).catch(() => {});
  }, []);

  // Last 7 days for the mountain hero
  const last7Tokens = toksAll.slice(-7);
  const totalTokens = toksAll.reduce((s, d) => s + d.count, 0);
  const totalMsgs = msgsAll.reduce((s, d) => s + d.count, 0);
  const totalTools = tools.reduce((s, t) => s + t.count, 0);

  return (
    <CedarPage>
      <div style={{ position: "relative", overflow: "hidden" }}>
        <TopoLines height={140} opacity={0.5} />
        <CedarPageHeader
          eyebrow="terrain"
          title={
            <>
              The week's <em style={{ fontStyle: "italic", color: "var(--cedar-glow)" }}>shape</em>.
            </>
          }
          sub={`${(totalTokens / 1e6).toFixed(2)}M tokens · ${totalMsgs.toLocaleString()} messages · ${totalTools.toLocaleString()} tool calls over the last 84 days.`}
          right={
            <>
              <SegSeg<Variant>
                value={variant}
                onChange={setVariant}
                options={[
                  { value: "mountain", label: "Mountains" },
                  { value: "grid", label: "Grid" },
                  { value: "breakdown", label: "Breakdown" },
                ]}
              />
              <Btn
                icon={<Download size={12} />}
                onClick={() => {
                  const rows: string[] = ["date,messages,tokens"];
                  const tokMap = new Map(toksAll.map((t) => [t.date, t.count]));
                  for (const m of msgsAll) {
                    rows.push(`${m.date},${m.count},${tokMap.get(m.date) ?? 0}`);
                  }
                  const blob = new Blob([rows.join("\n")], { type: "text/csv" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `arz-analytics-${new Date().toISOString().slice(0, 10)}.csv`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
              >
                CSV
              </Btn>
            </>
          }
        />
      </div>
      <div style={{ padding: "24px 32px 32px" }}>
        {variant === "mountain" && (
          <MountainView tokens={last7Tokens} totalTokens={totalTokens} totalTools={totalTools} />
        )}
        {variant === "grid" && <GridView msgs={msgsAll} tools={tools} provs={provs} />}
        {variant === "breakdown" && <BreakdownView msgs={msgsAll} toks={toksAll} />}
      </div>
    </CedarPage>
  );
}

// ── Mountain ────────────────────────────────────────────────
function MountainView({
  tokens,
  totalTokens,
  totalTools,
}: {
  tokens: DayPoint[];
  totalTokens: number;
  totalTools: number;
}) {
  const W = 800;
  const H = 240;
  if (tokens.length === 0) {
    return (
      <CedarCard padding={48}>
        <div style={{ textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
          Not enough activity yet.
        </div>
      </CedarCard>
    );
  }
  const max = Math.max(1, ...tokens.map((d) => d.count));
  const pts = tokens.map((d, i) => ({
    x: (i / Math.max(1, tokens.length - 1)) * W,
    y: H - (d.count / max) * (H - 30),
    d,
  }));
  const path = pts.map((p, i) => (i === 0 ? `M${p.x},${H} L${p.x},${p.y}` : `L${p.x},${p.y}`)).join(" ") + ` L${W},${H}Z`;
  const line = pts.map((p, i) => (i === 0 ? "M" : "L") + `${p.x},${p.y}`).join(" ");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <CedarCard padding={0} style={{ overflow: "hidden" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)" }}>
          <div
            style={{
              fontSize: 11,
              fontFamily: "var(--fm)",
              color: "var(--muted)",
              textTransform: "uppercase",
              letterSpacing: ".1em",
            }}
          >
            Tokens, last 7 days
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 14, marginTop: 4 }}>
            <span style={{ fontFamily: "var(--fd)", fontSize: 38, color: "var(--text)" }}>
              {(tokens.reduce((s, d) => s + d.count, 0) / 1e6).toFixed(2)}M
            </span>
            <span style={{ fontSize: 13, color: "var(--cedar-2)" }}>
              {totalTokens.toLocaleString()} cumulative
            </span>
          </div>
        </div>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: H, display: "block" }}>
          <defs>
            <linearGradient id="mtn" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--cedar-glow)" stopOpacity="0.4" />
              <stop offset="100%" stopColor="var(--cedar-glow)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[0.25, 0.5, 0.75].map((p, i) => (
            <line key={i} x1="0" x2={W} y1={H * p + 15} y2={H * p + 15} stroke="var(--border)" strokeDasharray="2 4" />
          ))}
          <path d={path} fill="url(#mtn)" />
          <path d={line} fill="none" stroke="var(--cedar-glow)" strokeWidth="2" />
          {pts.map((p, i) => (
            <g key={i}>
              <circle cx={p.x} cy={p.y} r="4" fill="var(--surface)" stroke="var(--cedar-glow)" strokeWidth="2" />
              <text
                x={p.x}
                y={H - 6}
                textAnchor="middle"
                fontFamily="var(--fm)"
                fontSize="10"
                fill="var(--muted)"
              >
                {dow(p.d.date)}
              </text>
            </g>
          ))}
        </svg>
      </CedarCard>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }}>
        {[
          { lbl: "Tokens · 84d", v: (totalTokens / 1e6).toFixed(2) + "M", sub: "cumulative", a: "dawn" },
          { lbl: "Tool calls · 84d", v: totalTools.toLocaleString(), sub: "across all sessions", a: "cedar" },
          { lbl: "Avg per day", v: Math.round(totalTokens / 84 / 1000) + "k", sub: "tokens/day", a: "stone" },
        ].map((x) => (
          <CedarCard key={x.lbl} padding={16}>
            <div
              style={{
                fontSize: 10.5,
                fontFamily: "var(--fm)",
                color: "var(--muted)",
                textTransform: "uppercase",
                letterSpacing: ".1em",
              }}
            >
              {x.lbl}
            </div>
            <div style={{ fontFamily: "var(--fd)", fontSize: 30, color: "var(--text)", marginTop: 6, lineHeight: 1 }}>
              {x.v}
            </div>
            <div style={{ fontSize: 11, color: `var(--${x.a})`, marginTop: 6, fontFamily: "var(--fm)" }}>{x.sub}</div>
          </CedarCard>
        ))}
      </div>
    </div>
  );
}

// ── Grid — 12wk × 7d heatmap + tool/provider mix ────────────
function GridView({
  msgs,
  tools,
  provs,
}: {
  msgs: DayPoint[];
  tools: { name: string; count: number }[];
  provs: { provider: string; messages: number }[];
}) {
  const cells = useMemo(() => {
    const map = new Map<string, number>();
    for (const d of msgs) map.set(d.date, d.count);
    const today = new Date();
    const N = 84;
    const out: { date: string; count: number; dow: number }[] = [];
    for (let i = N - 1; i >= 0; i--) {
      const dt = new Date(today.getTime() - i * 86_400_000);
      const key = dt.toISOString().slice(0, 10);
      out.push({ date: key, count: map.get(key) ?? 0, dow: dt.getDay() });
    }
    return out;
  }, [msgs]);
  const max = Math.max(1, ...cells.map((c) => c.count));

  const provMax = Math.max(1, ...provs.map((p) => p.messages));
  const provTotal = provs.reduce((s, p) => s + p.messages, 0);
  const top = provs[0];
  const topPct = top && provTotal > 0 ? Math.round((top.messages / provTotal) * 100) : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <CedarCard padding={20}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 14, marginBottom: 18 }}>
          <span style={{ fontFamily: "var(--fd)", fontSize: 22, color: "var(--text)" }}>Activity heatmap</span>
          <span style={{ fontSize: 11.5, color: "var(--muted)" }}>last 12 weeks · darker = more messages</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 8 }}>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-around",
              fontSize: 9.5,
              color: "var(--muted)",
              fontFamily: "var(--fm)",
            }}
          >
            {["Mon", "Wed", "Fri", "Sun"].map((d) => (
              <div key={d}>{d}</div>
            ))}
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(12, 1fr)",
              gridTemplateRows: "repeat(7, 14px)",
              gap: 3,
            }}
          >
            {cells.map((c) => {
              const v = c.count / max;
              const bg = v < 0.15
                ? "var(--s2)"
                : v < 0.4
                ? "rgba(118, 200, 156, .25)"
                : v < 0.7
                ? "rgba(118, 200, 156, .55)"
                : "var(--cedar-glow)";
              return (
                <div
                  key={c.date}
                  title={`${c.date} · ${c.count} msgs`}
                  style={{ background: bg, borderRadius: 2 }}
                />
              );
            })}
          </div>
        </div>
      </CedarCard>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <CedarCard padding={20}>
          <div
            style={{
              fontSize: 11,
              color: "var(--muted)",
              fontFamily: "var(--fm)",
              textTransform: "uppercase",
              letterSpacing: ".1em",
            }}
          >
            Top tools
          </div>
          {tools.length === 0 && (
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>—</div>
          )}
          {tools.slice(0, 5).map((t) => {
            const tmax = Math.max(1, ...tools.map((x) => x.count));
            return (
              <div
                key={t.name}
                style={{
                  display: "grid",
                  gridTemplateColumns: "100px 1fr 50px",
                  alignItems: "center",
                  gap: 10,
                  padding: "8px 0",
                  fontSize: 12,
                }}
              >
                <span style={{ fontFamily: "var(--fm)", color: "var(--text2)" }}>{t.name}</span>
                <div style={{ height: 6, background: "var(--s3)", borderRadius: 99, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${(t.count / tmax) * 100}%`, background: "var(--cedar-glow)" }} />
                </div>
                <span style={{ fontFamily: "var(--fm)", color: "var(--text3)", textAlign: "right" }}>{t.count}</span>
              </div>
            );
          })}
        </CedarCard>
        <CedarCard padding={20}>
          <div
            style={{
              fontSize: 11,
              color: "var(--muted)",
              fontFamily: "var(--fm)",
              textTransform: "uppercase",
              letterSpacing: ".1em",
            }}
          >
            Provider mix
          </div>
          {provs.length === 0 ? (
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>—</div>
          ) : (
            <>
              <svg viewBox="0 0 100 50" style={{ width: "100%", height: 120, marginTop: 8 }}>
                <path
                  d="M10 45 A 35 35 0 0 1 80 45"
                  fill="none"
                  stroke="var(--s3)"
                  strokeWidth="10"
                  strokeLinecap="round"
                />
                <path
                  d={`M10 45 A 35 35 0 0 1 ${10 + (topPct / 100) * 70} ${
                    45 - Math.sin((topPct / 100) * Math.PI) * 35
                  }`}
                  fill="none"
                  stroke="var(--cedar-glow)"
                  strokeWidth="10"
                  strokeLinecap="round"
                />
                <text x="45" y="30" textAnchor="middle" fontFamily="var(--fd)" fontSize="14" fill="var(--text)">
                  {topPct}%
                </text>
                <text
                  x="45"
                  y="42"
                  textAnchor="middle"
                  fontFamily="var(--fm)"
                  fontSize="5"
                  fill="var(--muted)"
                >
                  {top?.provider?.toUpperCase() ?? ""}
                </text>
              </svg>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 8,
                  fontSize: 11,
                  fontFamily: "var(--fm)",
                  marginTop: 6,
                  justifyContent: "center",
                }}
              >
                {provs.slice(0, 4).map((p, i) => (
                  <span
                    key={p.provider}
                    style={{
                      color: i === 0 ? "var(--cedar-glow)" : "var(--stone)",
                    }}
                  >
                    ● {p.provider} {provTotal ? Math.round((p.messages / provTotal) * 100) + "%" : ""}
                  </span>
                ))}
              </div>
            </>
          )}
          <div style={{ marginTop: 8, fontSize: 11, color: "var(--muted)", fontFamily: "var(--fm)" }}>
            {provMax > 0 ? `top: ${top?.messages} msgs` : ""}
          </div>
        </CedarCard>
      </div>
    </div>
  );
}

// ── Breakdown — per-day table ───────────────────────────────
function BreakdownView({ msgs, toks }: { msgs: DayPoint[]; toks: DayPoint[] }) {
  const tokMap = new Map(toks.map((t) => [t.date, t.count]));
  return (
    <CedarCard padding={0}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
        <thead>
          <tr style={{ borderBottom: "1px solid var(--border)" }}>
            {["Date", "Day", "Messages", "Tokens"].map((h) => (
              <th
                key={h}
                style={{
                  padding: "12px 18px",
                  textAlign: "left",
                  fontSize: 10.5,
                  fontFamily: "var(--fm)",
                  textTransform: "uppercase",
                  letterSpacing: ".1em",
                  color: "var(--muted)",
                  fontWeight: 500,
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {msgs.length === 0 && (
            <tr>
              <td colSpan={4} style={{ padding: 32, textAlign: "center", color: "var(--muted)" }}>
                No data yet.
              </td>
            </tr>
          )}
          {msgs.slice(-30).reverse().map((d) => (
            <tr key={d.date} style={{ borderBottom: "1px solid var(--hairline)" }}>
              <td style={{ padding: "12px 18px", fontFamily: "var(--fm)", color: "var(--text2)" }}>{d.date}</td>
              <td style={{ padding: "12px 18px", color: "var(--text)" }}>{dow(d.date)}</td>
              <td style={{ padding: "12px 18px", color: "var(--text)" }}>{d.count.toLocaleString()}</td>
              <td style={{ padding: "12px 18px", fontFamily: "var(--fm)", color: "var(--cedar-2)" }}>
                {(tokMap.get(d.date) ?? 0).toLocaleString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </CedarCard>
  );
}
