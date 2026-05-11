// Analytics — usage as terrain. Three layouts per design:
//   * Mountain  (default) — area-chart "mountain" of token volume + 3 stat cards
//   * Grid                 — heatmap + tools + provider mix (colored per LLM)
//   * Breakdown            — per-day table, expandable per-LLM, sortable + filterable

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Download, Search } from "lucide-react";
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
type ProvDay = { date: string; provider: string; messages: number; tokens: number };

function dow(date: string): string {
  const d = new Date(date + "T00:00:00");
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()];
}

// Smart unit picker — keeps the headline readable for tiny accounts and
// big ones alike. < 1k stays raw; < 1M shows k; otherwise M with 2 dp.
function fmtTokens(n: number): string {
  if (n < 1000) return n.toLocaleString();
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

// Provider color palette — matches the chat-side badges so a "Claude"
// arc reads the same here as a "Claude" pill in the SessionList.
const PROVIDER_COLORS: Record<string, string> = {
  "claude-code": "#e8884a",
  "kiro-cli": "#5fa0d6",
  "codex": "#6abf7c",
  "gemini": "#7cb8c8",
  "ollama": "#c878d6",
  "anthropic": "#a884e8",
  "(unset)": "var(--muted)",
};
function colorForProvider(p: string): string {
  return PROVIDER_COLORS[p] || "var(--cedar-2)";
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
  const [byDayByProv, setByDayByProv] = useState<ProvDay[]>([]);

  useEffect(() => {
    api.analyticsMessagesByDay(84).then(setMsgsAll).catch(() => {});
    api.analyticsTokensByDay(84).then(setToksAll).catch(() => {});
    api.analyticsToolUsage().then(setTools).catch(() => {});
    api.analyticsProviders().then(setProvs).catch(() => {});
    api.analyticsByDayByProvider(84).then(setByDayByProv).catch(() => {});
  }, []);

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
          sub={`${fmtTokens(totalTokens)} tokens · ${totalMsgs.toLocaleString()} messages · ${totalTools.toLocaleString()} tool calls over the last 84 days.`}
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
                  const rows: string[] = ["date,provider,messages,tokens"];
                  for (const r of byDayByProv) {
                    rows.push(`${r.date},${r.provider},${r.messages},${r.tokens}`);
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
        {variant === "breakdown" && <BreakdownView rows={byDayByProv} />}
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
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
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
  const last7Total = tokens.reduce((s, d) => s + d.count, 0);
  const avgPerDay = Math.round(totalTokens / 84);

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
              {fmtTokens(last7Total)}
            </span>
            <span style={{ fontSize: 13, color: "var(--cedar-2)" }}>
              {totalTokens.toLocaleString()} cumulative
            </span>
          </div>
        </div>
        <div style={{ position: "relative" }}>
          <svg
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            style={{ width: "100%", height: H, display: "block" }}
            onMouseMove={(e) => {
              const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
              const rel = (e.clientX - rect.left) / rect.width;
              const idx = Math.round(rel * (pts.length - 1));
              if (idx >= 0 && idx < pts.length) setHoverIdx(idx);
            }}
            onMouseLeave={() => setHoverIdx(null)}
          >
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
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={hoverIdx === i ? 6 : 4}
                  fill="var(--surface)"
                  stroke="var(--cedar-glow)"
                  strokeWidth="2"
                />
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
            {hoverIdx !== null && (
              <line
                x1={pts[hoverIdx].x}
                x2={pts[hoverIdx].x}
                y1={0}
                y2={H}
                stroke="var(--cedar-line)"
                strokeWidth="1"
                strokeDasharray="2 3"
              />
            )}
          </svg>
          {hoverIdx !== null && (
            <div
              style={{
                position: "absolute",
                left: `${(pts[hoverIdx].x / W) * 100}%`,
                top: 8,
                transform: "translateX(-50%)",
                background: "var(--surface)",
                border: "1px solid var(--cedar-line)",
                borderRadius: 6,
                padding: "5px 9px",
                fontFamily: "var(--fm)",
                fontSize: 11.5,
                color: "var(--text)",
                whiteSpace: "nowrap",
                pointerEvents: "none",
                boxShadow: "0 2px 6px rgba(0,0,0,.25)",
              }}
            >
              <span style={{ color: "var(--cedar-glow)" }}>{pts[hoverIdx].d.date}</span>
              <span style={{ color: "var(--muted)", margin: "0 6px" }}>·</span>
              <span>{pts[hoverIdx].d.count.toLocaleString()} tokens</span>
            </div>
          )}
        </div>
      </CedarCard>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }}>
        {[
          { lbl: "Tokens · 84d", v: fmtTokens(totalTokens), sub: "cumulative", a: "dawn" },
          { lbl: "Tool calls · 84d", v: totalTools.toLocaleString(), sub: "across all sessions", a: "cedar" },
          { lbl: "Avg per day", v: fmtTokens(avgPerDay), sub: "tokens/day", a: "stone" },
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
  // Build 84 days, grouped by week-column. Track week starts for the
  // month labels at the bottom.
  const { weeks, monthLabels } = useMemo(() => {
    const map = new Map<string, number>();
    for (const d of msgs) map.set(d.date, d.count);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    // Snap to the start of this week (Sun). Then go back 12 weeks for
    // a clean rectangular grid.
    const startOfThisWeek = new Date(today);
    startOfThisWeek.setDate(today.getDate() - today.getDay());
    const start = new Date(startOfThisWeek);
    start.setDate(startOfThisWeek.getDate() - 11 * 7);
    const ws: { date: string; count: number }[][] = [];
    const ml: { week: number; label: string }[] = [];
    let lastMonth = -1;
    for (let w = 0; w < 12; w++) {
      const col: { date: string; count: number }[] = [];
      for (let d = 0; d < 7; d++) {
        const dt = new Date(start.getTime() + (w * 7 + d) * 86_400_000);
        const key = dt.toISOString().slice(0, 10);
        col.push({ date: key, count: map.get(key) ?? 0 });
        if (d === 0) {
          const m = dt.getMonth();
          if (m !== lastMonth) {
            lastMonth = m;
            ml.push({
              week: w,
              label: dt.toLocaleString(undefined, { month: "short" }),
            });
          }
        }
      }
      ws.push(col);
    }
    return { weeks: ws, monthLabels: ml };
  }, [msgs]);
  const max = Math.max(1, ...weeks.flat().map((c) => c.count));

  const provTotal = provs.reduce((s, p) => s + p.messages, 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <CedarCard padding={20}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 14, marginBottom: 18 }}>
          <span style={{ fontFamily: "var(--fd)", fontSize: 22, color: "var(--text)" }}>Activity heatmap</span>
          <span style={{ fontSize: 11.5, color: "var(--muted)" }}>last 12 weeks · darker = more messages</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 8 }}>
          {/* Y axis — every weekday */}
          <div
            style={{
              display: "grid",
              gridTemplateRows: "repeat(7, 16px)",
              gap: 3,
              fontSize: 9.5,
              color: "var(--muted)",
              fontFamily: "var(--fm)",
              alignItems: "center",
            }}
          >
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
              <div key={d} style={{ lineHeight: "16px" }}>{d}</div>
            ))}
          </div>
          {/* Cells + month axis */}
          <div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(12, 1fr)",
                gap: 3,
              }}
            >
              {weeks.map((col, wi) => (
                <div key={wi} style={{ display: "grid", gridTemplateRows: "repeat(7, 16px)", gap: 3 }}>
                  {col.map((c) => {
                    const v = c.count / max;
                    const bg = c.count === 0
                      ? "var(--s2)"
                      : v < 0.25
                      ? "rgba(118, 200, 156, .25)"
                      : v < 0.6
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
              ))}
            </div>
            {/* Month axis */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(12, 1fr)",
                gap: 3,
                marginTop: 6,
                fontSize: 9.5,
                color: "var(--muted)",
                fontFamily: "var(--fm)",
              }}
            >
              {Array.from({ length: 12 }).map((_, wi) => {
                const ml = monthLabels.find((m) => m.week === wi);
                return <div key={wi}>{ml?.label ?? ""}</div>;
              })}
            </div>
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
              marginBottom: 10,
            }}
          >
            Provider mix
          </div>
          {provs.length === 0 ? (
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>—</div>
          ) : (
            <ProviderMixBar provs={provs} total={provTotal} />
          )}
        </CedarCard>
      </div>
    </div>
  );
}

function ProviderMixBar({
  provs,
  total,
}: {
  provs: { provider: string; messages: number }[];
  total: number;
}) {
  if (total === 0) return null;
  // Stacked horizontal bar — each segment a different provider color.
  let cum = 0;
  return (
    <div>
      <div
        style={{
          display: "flex",
          height: 14,
          width: "100%",
          borderRadius: 7,
          overflow: "hidden",
          background: "var(--s3)",
        }}
      >
        {provs.map((p) => {
          const pct = (p.messages / total) * 100;
          cum += pct;
          return (
            <div
              key={p.provider}
              title={`${p.provider} · ${p.messages.toLocaleString()} msgs (${pct.toFixed(1)}%)`}
              style={{
                width: `${pct}%`,
                background: colorForProvider(p.provider),
              }}
            />
          );
        })}
      </div>
      <div
        style={{
          marginTop: 14,
          display: "flex",
          flexDirection: "column",
          gap: 6,
          fontSize: 11.5,
          fontFamily: "var(--fm)",
        }}
      >
        {provs.map((p) => {
          const pct = (p.messages / total) * 100;
          return (
            <div
              key={p.provider}
              style={{
                display: "grid",
                gridTemplateColumns: "12px 1fr 60px 40px",
                alignItems: "center",
                gap: 8,
              }}
            >
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 3,
                  background: colorForProvider(p.provider),
                }}
              />
              <span style={{ color: "var(--text)" }}>{p.provider}</span>
              <span style={{ color: "var(--text3)", textAlign: "right" }}>
                {p.messages.toLocaleString()}
              </span>
              <span style={{ color: "var(--text3)", textAlign: "right" }}>
                {pct.toFixed(1)}%
              </span>
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: 8, fontSize: 10.5, color: "var(--muted)", fontFamily: "var(--fm)" }}>
        cum {cum.toFixed(0)}% · {total.toLocaleString()} msgs total
      </div>
    </div>
  );
}

// ── Breakdown — per-day table, expandable per-LLM, sortable + searchable ──
function BreakdownView({ rows }: { rows: ProvDay[] }) {
  type SortKey = "date" | "messages" | "tokens";
  const [sort, setSort] = useState<SortKey>("date");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [q, setQ] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [providerFilter, setProviderFilter] = useState<string>("all");

  // Pivot into day rows with per-provider breakdown.
  const days = useMemo(() => {
    const map = new Map<string, { date: string; messages: number; tokens: number; perProvider: ProvDay[] }>();
    for (const r of rows) {
      const cur = map.get(r.date) || { date: r.date, messages: 0, tokens: 0, perProvider: [] };
      cur.messages += r.messages;
      cur.tokens += r.tokens;
      cur.perProvider.push(r);
      map.set(r.date, cur);
    }
    return Array.from(map.values());
  }, [rows]);

  const providers = useMemo(() => {
    const s = new Set<string>();
    for (const r of rows) s.add(r.provider);
    return ["all", ...Array.from(s).sort()];
  }, [rows]);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return days.filter((d) => {
      if (providerFilter !== "all") {
        const hasIt = d.perProvider.some((p) => p.provider === providerFilter && (p.messages > 0 || p.tokens > 0));
        if (!hasIt) return false;
      }
      if (!query) return true;
      if (d.date.includes(query) || dow(d.date).toLowerCase().includes(query)) return true;
      return d.perProvider.some((p) => p.provider.toLowerCase().includes(query));
    });
  }, [days, q, providerFilter]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    const mult = dir === "asc" ? 1 : -1;
    arr.sort((a, b) => {
      if (sort === "date") return mult * a.date.localeCompare(b.date);
      if (sort === "messages") return mult * (a.messages - b.messages);
      return mult * (a.tokens - b.tokens);
    });
    return arr;
  }, [filtered, sort, dir]);

  const flip = (k: SortKey) => {
    if (sort === k) setDir(dir === "asc" ? "desc" : "asc");
    else { setSort(k); setDir(k === "date" ? "desc" : "desc"); }
  };

  const toggle = (date: string) =>
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(date)) n.delete(date); else n.add(date);
      return n;
    });

  return (
    <CedarCard padding={0}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "12px 16px",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <div style={{ position: "relative", flex: 1, maxWidth: 280 }}>
          <Search
            size={12}
            style={{
              position: "absolute",
              left: 9,
              top: "50%",
              transform: "translateY(-50%)",
              color: "var(--muted)",
            }}
          />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by date, day, or provider…"
            style={{
              width: "100%",
              padding: "6px 10px 6px 26px",
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              color: "var(--text)",
              fontSize: 12,
              fontFamily: "var(--fn)",
            }}
          />
        </div>
        <select
          value={providerFilter}
          onChange={(e) => setProviderFilter(e.target.value)}
          style={{
            padding: "6px 10px",
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            color: "var(--text)",
            fontSize: 12,
            fontFamily: "var(--fn)",
          }}
        >
          {providers.map((p) => (
            <option key={p} value={p}>{p === "all" ? "All providers" : p}</option>
          ))}
        </select>
        <span style={{ fontSize: 11, fontFamily: "var(--fm)", color: "var(--muted)" }}>
          {sorted.length} day{sorted.length === 1 ? "" : "s"}
        </span>
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
        <thead>
          <tr style={{ borderBottom: "1px solid var(--border)" }}>
            <th style={thStyle()} />
            <th style={thStyle()} onClick={() => flip("date")} className="cursor-pointer">
              Date {sort === "date" ? (dir === "asc" ? "↑" : "↓") : ""}
            </th>
            <th style={thStyle()}>Day</th>
            <th style={thStyle()} onClick={() => flip("messages")} className="cursor-pointer">
              Messages {sort === "messages" ? (dir === "asc" ? "↑" : "↓") : ""}
            </th>
            <th style={thStyle()} onClick={() => flip("tokens")} className="cursor-pointer">
              Tokens {sort === "tokens" ? (dir === "asc" ? "↑" : "↓") : ""}
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 && (
            <tr>
              <td colSpan={5} style={{ padding: 32, textAlign: "center", color: "var(--muted)" }}>
                No data matches your filter.
              </td>
            </tr>
          )}
          {sorted.map((d) => {
            const isOpen = expanded.has(d.date);
            return (
              <Fragment key={d.date}>
                <tr style={{ borderBottom: "1px solid var(--hairline)", cursor: "pointer" }} onClick={() => toggle(d.date)}>
                  <td style={{ padding: "8px 0 8px 18px", width: 24, color: "var(--muted)" }}>
                    {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                  </td>
                  <td style={{ padding: "12px 18px", fontFamily: "var(--fm)", color: "var(--text2)" }}>{d.date}</td>
                  <td style={{ padding: "12px 18px", color: "var(--text)" }}>{dow(d.date)}</td>
                  <td style={{ padding: "12px 18px", color: "var(--text)" }}>{d.messages.toLocaleString()}</td>
                  <td style={{ padding: "12px 18px", fontFamily: "var(--fm)", color: "var(--cedar-2)" }}>
                    {d.tokens.toLocaleString()}
                  </td>
                </tr>
                {isOpen && (
                  <tr style={{ background: "var(--s2)", borderBottom: "1px solid var(--hairline)" }}>
                    <td />
                    <td colSpan={4} style={{ padding: "8px 18px 12px" }}>
                      <table style={{ width: "100%", fontSize: 11.5, fontFamily: "var(--fm)" }}>
                        <thead>
                          <tr style={{ color: "var(--muted)" }}>
                            <th style={{ textAlign: "left", padding: "4px 0", fontWeight: 500 }}>Provider</th>
                            <th style={{ textAlign: "right", padding: "4px 8px", fontWeight: 500 }}>Messages</th>
                            <th style={{ textAlign: "right", padding: "4px 8px", fontWeight: 500 }}>Tokens</th>
                            <th style={{ textAlign: "right", padding: "4px 0", fontWeight: 500 }}>% of day</th>
                          </tr>
                        </thead>
                        <tbody>
                          {d.perProvider
                            .filter((p) => providerFilter === "all" || p.provider === providerFilter)
                            .sort((a, b) => b.tokens - a.tokens || b.messages - a.messages)
                            .map((p) => {
                              const pct =
                                d.tokens > 0
                                  ? (p.tokens / d.tokens) * 100
                                  : d.messages > 0
                                  ? (p.messages / d.messages) * 100
                                  : 0;
                              return (
                                <tr key={p.provider}>
                                  <td style={{ padding: "4px 0", color: "var(--text)" }}>
                                    <span
                                      style={{
                                        display: "inline-block",
                                        width: 8,
                                        height: 8,
                                        borderRadius: 2,
                                        background: colorForProvider(p.provider),
                                        marginRight: 7,
                                      }}
                                    />
                                    {p.provider}
                                  </td>
                                  <td style={{ textAlign: "right", padding: "4px 8px", color: "var(--text2)" }}>
                                    {p.messages.toLocaleString()}
                                  </td>
                                  <td style={{ textAlign: "right", padding: "4px 8px", color: "var(--cedar-2)" }}>
                                    {p.tokens.toLocaleString()}
                                  </td>
                                  <td style={{ textAlign: "right", padding: "4px 0", color: "var(--text3)" }}>
                                    {pct.toFixed(1)}%
                                  </td>
                                </tr>
                              );
                            })}
                        </tbody>
                      </table>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </CedarCard>
  );
}

function thStyle(): React.CSSProperties {
  return {
    padding: "12px 18px",
    textAlign: "left",
    fontSize: 10.5,
    fontFamily: "var(--fm)",
    textTransform: "uppercase",
    letterSpacing: ".1em",
    color: "var(--muted)",
    fontWeight: 500,
    cursor: "pointer",
    userSelect: "none",
  };
}

// React.Fragment shorthand used above
import { Fragment } from "react";
