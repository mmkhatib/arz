// Analytics — usage + cost as topographic shape.
// Topo (default): area chart of message volume, w/ token + tool sublines.
// Cards: stat blocks w/ sparklines.
// Heatmap: 7×N day-of-week × week grid.

import { useEffect, useMemo, useState } from "react";
import {
  CedarPage,
  CedarPageHeader,
  CedarCard,
  Tag,
  SegSeg,
  TopoLines,
} from "@/components/CedarUI";
import { api } from "@/api/client";

type Variant = "topo" | "cards" | "heatmap";

type DayPoint = { date: string; count: number };

export default function AnalyticsPage() {
  const [variant, setVariant] = useState<Variant>(
    () => (localStorage.getItem("arz:analytics-variant") as Variant) || "topo",
  );
  useEffect(() => { localStorage.setItem("arz:analytics-variant", variant); }, [variant]);

  const [msgs, setMsgs] = useState<DayPoint[]>([]);
  const [toks, setToks] = useState<DayPoint[]>([]);
  const [tools, setTools] = useState<{ name: string; count: number }[]>([]);
  const [provs, setProvs] = useState<{ provider: string; messages: number }[]>([]);

  useEffect(() => {
    api.analyticsMessagesByDay(56).then(setMsgs).catch(() => {});
    api.analyticsTokensByDay(56).then(setToks).catch(() => {});
    api.analyticsToolUsage().then(setTools).catch(() => {});
    api.analyticsProviders().then(setProvs).catch(() => {});
  }, []);

  const totalMsgs = msgs.reduce((a, b) => a + b.count, 0);
  const totalToks = toks.reduce((a, b) => a + b.count, 0);
  const totalTools = tools.reduce((a, b) => a + b.count, 0);

  return (
    <CedarPage>
      <div style={{ position: "relative", overflow: "hidden" }}>
        <TopoLines height={140} opacity={0.5} />
        <CedarPageHeader
          eyebrow="usage + cost"
          title={
            <>
              The <em style={{ fontStyle: "italic", color: "var(--cedar-glow)" }}>topography</em> of usage.
            </>
          }
          sub={`${totalMsgs.toLocaleString()} messages · ${totalToks.toLocaleString()} tokens · ${totalTools.toLocaleString()} tool calls in 56 days.`}
          right={
            <SegSeg<Variant>
              value={variant}
              onChange={setVariant}
              options={[
                { value: "topo", label: "Topo" },
                { value: "cards", label: "Cards" },
                { value: "heatmap", label: "Heatmap" },
              ]}
            />
          }
        />
      </div>
      <div style={{ padding: "24px 32px 32px" }}>
        {variant === "topo" && <TopoView msgs={msgs} toks={toks} provs={provs} tools={tools} />}
        {variant === "cards" && (
          <CardsView msgs={msgs} toks={toks} tools={tools} provs={provs} totalMsgs={totalMsgs} totalToks={totalToks} totalTools={totalTools} />
        )}
        {variant === "heatmap" && <HeatmapView msgs={msgs} />}
      </div>
    </CedarPage>
  );
}

function TopoView({
  msgs,
  toks,
  provs,
  tools,
}: {
  msgs: DayPoint[];
  toks: DayPoint[];
  provs: { provider: string; messages: number }[];
  tools: { name: string; count: number }[];
}) {
  const W = 800;
  const H = 240;
  if (msgs.length === 0) {
    return (
      <CedarCard padding={48}>
        <div style={{ textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
          Not enough activity yet.
        </div>
      </CedarCard>
    );
  }
  const maxM = Math.max(1, ...msgs.map((d) => d.count));
  const maxT = Math.max(1, ...toks.map((d) => d.count));

  const path = (data: DayPoint[], max: number) => {
    if (data.length < 2) return "";
    const step = W / (data.length - 1);
    const pts = data.map((d, i) => {
      const x = i * step;
      const y = H - (d.count / max) * (H - 24) - 12;
      return [x, y];
    });
    const top = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x},${y}`).join(" ");
    return `${top} L${pts[pts.length - 1][0]},${H} L0,${H} Z`;
  };

  const linePath = (data: DayPoint[], max: number) => {
    if (data.length < 2) return "";
    const step = W / (data.length - 1);
    return data
      .map((d, i) => {
        const x = i * step;
        const y = H - (d.count / max) * (H - 24) - 12;
        return `${i === 0 ? "M" : "L"}${x},${y}`;
      })
      .join(" ");
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 280px", gap: 18 }}>
      <CedarCard padding={20}>
        <div
          style={{
            fontSize: 10.5,
            color: "var(--muted)",
            fontFamily: "var(--fm)",
            textTransform: "uppercase",
            letterSpacing: ".12em",
            marginBottom: 10,
          }}
        >
          Messages · 56 days
        </div>
        <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
          <defs>
            <linearGradient id="topo-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--cedar-glow)" stopOpacity="0.4" />
              <stop offset="100%" stopColor="var(--cedar-glow)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {/* Grid lines */}
          {[0.25, 0.5, 0.75].map((g) => (
            <line
              key={g}
              x1="0"
              y1={H * g}
              x2={W}
              y2={H * g}
              stroke="var(--border)"
              strokeDasharray="2 4"
            />
          ))}
          {/* Topo contour layers (using msgs at increasing offsets) */}
          {[0.6, 0.8, 1].map((o, idx) => (
            <path
              key={idx}
              d={path(msgs, maxM)}
              fill={idx === 2 ? "url(#topo-grad)" : "none"}
              stroke="var(--cedar-glow)"
              strokeWidth="1.2"
              opacity={o}
              transform={`translate(0,${(idx - 2) * 8})`}
            />
          ))}
          {/* Tokens subline */}
          <path d={linePath(toks, maxT)} fill="none" stroke="var(--stone)" strokeWidth="1" strokeDasharray="3 3" opacity="0.6" />
        </svg>
        <div style={{ display: "flex", gap: 18, marginTop: 12, fontSize: 11, fontFamily: "var(--fm)", color: "var(--muted)" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 8, height: 8, background: "var(--cedar-glow)", borderRadius: 2 }} />
            messages
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 12, height: 1, background: "var(--stone)" }} />
            tokens
          </span>
        </div>
      </CedarCard>

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <CedarCard padding={16}>
          <div
            style={{
              fontSize: 10.5,
              color: "var(--muted)",
              fontFamily: "var(--fm)",
              textTransform: "uppercase",
              letterSpacing: ".12em",
              marginBottom: 10,
            }}
          >
            Top providers
          </div>
          {provs.slice(0, 5).map((p) => {
            const max = Math.max(1, ...provs.map((x) => x.messages));
            return (
              <div key={p.provider} style={{ marginBottom: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 3 }}>
                  <span style={{ color: "var(--text)" }}>{p.provider}</span>
                  <span style={{ fontFamily: "var(--fm)", color: "var(--muted)" }}>{p.messages}</span>
                </div>
                <div style={{ height: 4, background: "var(--s2)", borderRadius: 99 }}>
                  <div
                    style={{
                      width: `${(p.messages / max) * 100}%`,
                      height: "100%",
                      background: "var(--cedar)",
                      borderRadius: 99,
                    }}
                  />
                </div>
              </div>
            );
          })}
          {provs.length === 0 && <div style={{ fontSize: 12, color: "var(--muted)" }}>—</div>}
        </CedarCard>

        <CedarCard padding={16}>
          <div
            style={{
              fontSize: 10.5,
              color: "var(--muted)",
              fontFamily: "var(--fm)",
              textTransform: "uppercase",
              letterSpacing: ".12em",
              marginBottom: 10,
            }}
          >
            Top tools
          </div>
          {tools.slice(0, 5).map((t) => (
            <div
              key={t.name}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "5px 0",
                borderBottom: "1px solid var(--hairline)",
              }}
            >
              <span style={{ fontSize: 12, color: "var(--text)" }}>{t.name}</span>
              <Tag color="cedar">{t.count}</Tag>
            </div>
          ))}
          {tools.length === 0 && <div style={{ fontSize: 12, color: "var(--muted)" }}>—</div>}
        </CedarCard>
      </div>
    </div>
  );
}

function CardsView({
  msgs,
  toks,
  tools,
  provs,
  totalMsgs,
  totalToks,
  totalTools,
}: {
  msgs: DayPoint[];
  toks: DayPoint[];
  tools: { name: string; count: number }[];
  provs: { provider: string; messages: number }[];
  totalMsgs: number;
  totalToks: number;
  totalTools: number;
}) {
  const cards: { lbl: string; v: string; sub: string; data: DayPoint[]; accent: string }[] = [
    {
      lbl: "Messages",
      v: totalMsgs.toLocaleString(),
      sub: "last 56 days",
      data: msgs,
      accent: "cedar-glow",
    },
    {
      lbl: "Tokens",
      v: totalToks.toLocaleString(),
      sub: "last 56 days",
      data: toks,
      accent: "stone",
    },
    {
      lbl: "Tool calls",
      v: totalTools.toLocaleString(),
      sub: `${tools.length} tools used`,
      data: [],
      accent: "pine",
    },
    {
      lbl: "Providers",
      v: String(provs.length),
      sub: provs[0]?.provider ?? "—",
      data: [],
      accent: "dawn",
    },
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
      {cards.map((c) => (
        <CedarCard key={c.lbl} padding={18}>
          <div
            style={{
              fontSize: 10.5,
              color: "var(--muted)",
              fontFamily: "var(--fm)",
              textTransform: "uppercase",
              letterSpacing: ".12em",
            }}
          >
            {c.lbl}
          </div>
          <div
            style={{
              fontFamily: "var(--fd)",
              fontSize: 36,
              color: "var(--text)",
              lineHeight: 1,
              marginTop: 6,
            }}
          >
            {c.v}
          </div>
          <div
            style={{
              fontSize: 11,
              color: `var(--${c.accent})`,
              fontFamily: "var(--fm)",
              marginTop: 6,
            }}
          >
            {c.sub}
          </div>
          {c.data.length > 1 && <Sparkline data={c.data} accent={c.accent} />}
        </CedarCard>
      ))}
    </div>
  );
}

function Sparkline({ data, accent }: { data: DayPoint[]; accent: string }) {
  const W = 200;
  const H = 36;
  const max = Math.max(1, ...data.map((d) => d.count));
  const step = W / Math.max(1, data.length - 1);
  const path = data
    .map((d, i) => {
      const x = i * step;
      const y = H - (d.count / max) * (H - 4) - 2;
      return `${i === 0 ? "M" : "L"}${x},${y}`;
    })
    .join(" ");
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ marginTop: 10 }}>
      <path d={path} fill="none" stroke={`var(--${accent})`} strokeWidth="1.5" />
    </svg>
  );
}

function HeatmapView({ msgs }: { msgs: DayPoint[] }) {
  const cells = useMemo(() => {
    const map = new Map<string, number>();
    for (const d of msgs) map.set(d.date, d.count);
    const today = new Date();
    const N = 56;
    const out: { date: string; count: number; dow: number }[] = [];
    for (let i = N - 1; i >= 0; i--) {
      const dt = new Date(today.getTime() - i * 86_400_000);
      const key = dt.toISOString().slice(0, 10);
      out.push({ date: key, count: map.get(key) ?? 0, dow: dt.getDay() });
    }
    return out;
  }, [msgs]);

  const max = Math.max(1, ...cells.map((c) => c.count));
  const cols: { date: string; count: number }[][] = [];
  let week: { date: string; count: number }[] = [];
  for (const c of cells) {
    week.push(c);
    if (week.length === 7) {
      cols.push(week);
      week = [];
    }
  }
  if (week.length) cols.push(week);

  return (
    <CedarCard padding={20}>
      <div
        style={{
          fontSize: 10.5,
          color: "var(--muted)",
          fontFamily: "var(--fm)",
          textTransform: "uppercase",
          letterSpacing: ".12em",
          marginBottom: 14,
        }}
      >
        Heatmap · 8 weeks
      </div>
      <div style={{ display: "flex", gap: 4 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginRight: 4 }}>
          {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
            <span
              key={i}
              style={{
                width: 18,
                height: 18,
                fontSize: 9,
                fontFamily: "var(--fm)",
                color: "var(--muted)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {d}
            </span>
          ))}
        </div>
        {cols.map((wk, wi) => (
          <div key={wi} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {wk.map((c) => {
              const intensity = c.count / max;
              return (
                <div
                  key={c.date}
                  title={`${c.date} · ${c.count} msgs`}
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: 4,
                    border: "1px solid var(--border)",
                    background: c.count
                      ? `rgba(118, 200, 156, ${0.15 + intensity * 0.7})`
                      : "var(--surface)",
                  }}
                />
              );
            })}
          </div>
        ))}
      </div>
      <div
        style={{
          marginTop: 18,
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontSize: 10.5,
          color: "var(--muted)",
          fontFamily: "var(--fm)",
        }}
      >
        less
        {[0, 0.25, 0.5, 0.75, 1].map((v, i) => (
          <span
            key={i}
            style={{
              width: 14,
              height: 14,
              borderRadius: 3,
              border: "1px solid var(--border)",
              background: v ? `rgba(118, 200, 156, ${0.15 + v * 0.7})` : "var(--surface)",
            }}
          />
        ))}
        more
      </div>
    </CedarCard>
  );
}
