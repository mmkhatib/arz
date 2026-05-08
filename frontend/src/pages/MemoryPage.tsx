// Memory — what Arzeh remembers.
// Three layouts: Rings (default), List, Forest. Rings is a radial SVG of
// memory items by strength, List is a sortable dense table, Forest is
// tag-grouped tree clusters.

import { useEffect, useMemo, useState } from "react";
import { Brain } from "lucide-react";
import {
  CedarPage,
  CedarPageHeader,
  CedarCard,
  Btn,
  Tag,
  SegSeg,
  TopoLines,
} from "@/components/CedarUI";
import { api } from "@/api/client";

type Variant = "rings" | "list" | "forest";

type Lesson = { id: number; category: string; text: string; pinned: boolean; created_at: number };

type Memory = {
  id: string;
  kind: "lesson" | "fact" | "preference";
  title: string;
  body: string;
  tags: string[];
  strength: number;
  created: number;
};

function lessonToMemory(l: Lesson): Memory {
  const cat = (l.category || "knowledge").toLowerCase();
  const kind: Memory["kind"] = cat.startsWith("pref") ? "preference" : cat.startsWith("fact") ? "fact" : "lesson";
  const lines = (l.text || "").split("\n");
  const title = lines[0]?.slice(0, 90) || "(untitled)";
  const body = lines.slice(1).join(" ").trim() || lines[0] || "";
  // Heuristic strength: pinned = 0.95, else falls off with age.
  const ageDays = (Date.now() / 1000 - (l.created_at || 0)) / 86400;
  const strength = l.pinned ? 0.95 : Math.max(0.4, Math.min(0.9, 1 - ageDays / 60));
  return { id: String(l.id), kind, title, body, tags: [cat], strength, created: l.created_at };
}

const KIND_COLOR: Record<Memory["kind"], string> = {
  lesson: "var(--cedar-glow)",
  fact: "var(--stone)",
  preference: "var(--dawn)",
};
const KIND_TAG: Record<Memory["kind"], "cedar" | "stone" | "dawn"> = {
  lesson: "cedar",
  fact: "stone",
  preference: "dawn",
};

export default function MemoryPage() {
  const [variant, setVariant] = useState<Variant>(() => {
    return (localStorage.getItem("arz:memory-variant") as Variant) || "rings";
  });
  useEffect(() => { localStorage.setItem("arz:memory-variant", variant); }, [variant]);

  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [stats, setStats] = useState<{ markdown: number; lessons: number; vectors: number } | null>(null);

  useEffect(() => {
    api.listLessons().then(setLessons).catch(() => {});
    api.memoryStats().then(setStats).catch(() => {});
  }, []);

  const memories = useMemo(() => lessons.map(lessonToMemory), [lessons]);

  return (
    <CedarPage>
      <div style={{ position: "relative", overflow: "hidden" }}>
        <TopoLines height={120} opacity={0.5} />
        <CedarPageHeader
          eyebrow="what arzeh holds"
          title={
            <>
              The <em style={{ fontStyle: "italic", color: "var(--cedar-glow)" }}>memory grove</em>.
            </>
          }
          sub={
            stats
              ? `${stats.lessons} lessons · ${stats.markdown} notes · ${stats.vectors} vectors. Strength fades with disuse.`
              : "Loading memory…"
          }
          right={
            <SegSeg<Variant>
              value={variant}
              onChange={setVariant}
              options={[
                { value: "rings", label: "Rings" },
                { value: "list", label: "List" },
                { value: "forest", label: "Forest" },
              ]}
            />
          }
        />
      </div>
      <div style={{ padding: "24px 32px 32px" }}>
        {variant === "rings" && <RingsView memories={memories} />}
        {variant === "list" && <ListView memories={memories} />}
        {variant === "forest" && <ForestView memories={memories} />}
      </div>
    </CedarPage>
  );
}

function RingsView({ memories }: { memories: Memory[] }) {
  const [hovered, setHovered] = useState<Memory | null>(null);
  if (memories.length === 0) {
    return <Empty />;
  }

  // Layout: 3 strength bands (Recent, Strong, Core) — concentric circles.
  // Each memory is a dot whose distance from center inverts strength.
  const W = 520;
  const H = 520;
  const cx = W / 2;
  const cy = H / 2;
  const bands = [
    { label: "Core", min: 0.85, r: 80 },
    { label: "Strong", min: 0.65, r: 145 },
    { label: "Recent", min: 0, r: 220 },
  ];

  const placed = memories.map((m, i) => {
    const band = bands.find((b) => m.strength >= b.min) ?? bands[bands.length - 1];
    const angle = (i / memories.length) * Math.PI * 2;
    const r = band.r * (0.6 + Math.random() * 0.35);
    return {
      m,
      x: cx + Math.cos(angle) * r,
      y: cy + Math.sin(angle) * r,
    };
  });

  return (
    <div style={{ display: "grid", gridTemplateColumns: `${W}px 1fr`, gap: 28, alignItems: "start" }}>
      <CedarCard padding={0} style={{ position: "relative", overflow: "hidden" }}>
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
          {/* Concentric guide rings */}
          {bands.map((b) => (
            <g key={b.label}>
              <circle cx={cx} cy={cy} r={b.r} fill="none" stroke="var(--cedar-line)" strokeDasharray="2 4" />
              <text
                x={cx + b.r + 6}
                y={cy + 4}
                fontFamily="var(--fm)"
                fontSize="9"
                fill="var(--muted)"
                style={{ textTransform: "uppercase", letterSpacing: ".12em" }}
              >
                {b.label}
              </text>
            </g>
          ))}
          {/* Memory dots */}
          {placed.map(({ m, x, y }) => {
            const isHovered = hovered?.id === m.id;
            return (
              <circle
                key={m.id}
                cx={x}
                cy={y}
                r={isHovered ? 9 : 5}
                fill={KIND_COLOR[m.kind]}
                opacity={0.4 + m.strength * 0.6}
                onMouseEnter={() => setHovered(m)}
                onMouseLeave={() => setHovered(null)}
                style={{ cursor: "pointer", transition: "r .15s" }}
              />
            );
          })}
          {/* Center mark */}
          <circle cx={cx} cy={cy} r="4" fill="var(--cedar)" />
        </svg>
      </CedarCard>

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <CedarCard padding={18}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <Brain size={14} />
            <span style={{ fontSize: 13, fontWeight: 500 }}>Inspector</span>
          </div>
          {hovered ? (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <Tag color={KIND_TAG[hovered.kind]}>{hovered.kind}</Tag>
                <span style={{ fontSize: 11, fontFamily: "var(--fm)", color: "var(--muted)" }}>
                  strength {Math.round(hovered.strength * 100)}%
                </span>
              </div>
              <h3
                style={{
                  fontFamily: "var(--fd)",
                  fontSize: 20,
                  margin: "6px 0 6px",
                  color: "var(--text)",
                  lineHeight: 1.25,
                }}
              >
                {hovered.title}
              </h3>
              {hovered.body && (
                <p style={{ fontSize: 13, color: "var(--text2)", lineHeight: 1.6, margin: 0 }}>
                  {hovered.body}
                </p>
              )}
            </>
          ) : (
            <div style={{ fontSize: 12.5, color: "var(--muted)" }}>
              Hover a dot to inspect. Closer to center = stronger memory.
            </div>
          )}
        </CedarCard>

        <CedarCard padding={18}>
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
            Legend
          </div>
          {(["lesson", "fact", "preference"] as const).map((k) => (
            <div key={k} style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 0" }}>
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  background: KIND_COLOR[k],
                  flexShrink: 0,
                }}
              />
              <span style={{ fontSize: 12, color: "var(--text)" }}>{k}</span>
              <span
                style={{
                  marginLeft: "auto",
                  fontFamily: "var(--fm)",
                  fontSize: 10.5,
                  color: "var(--muted)",
                }}
              >
                {memories.filter((m) => m.kind === k).length}
              </span>
            </div>
          ))}
        </CedarCard>
      </div>
    </div>
  );
}

function ListView({ memories }: { memories: Memory[] }) {
  if (memories.length === 0) return <Empty />;
  return (
    <CedarCard padding={0}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "100px 1fr 80px 100px",
          gap: 14,
          padding: "10px 18px",
          borderBottom: "1px solid var(--border)",
          fontFamily: "var(--fm)",
          fontSize: 10.5,
          color: "var(--muted)",
          textTransform: "uppercase",
          letterSpacing: ".12em",
        }}
      >
        <span>Kind</span>
        <span>Memory</span>
        <span>Strength</span>
        <span>Created</span>
      </div>
      {memories.map((m) => (
        <div
          key={m.id}
          style={{
            display: "grid",
            gridTemplateColumns: "100px 1fr 80px 100px",
            gap: 14,
            padding: "12px 18px",
            borderBottom: "1px solid var(--hairline)",
            alignItems: "center",
          }}
        >
          <Tag color={KIND_TAG[m.kind]}>{m.kind}</Tag>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, color: "var(--text)", fontWeight: 500 }}>{m.title}</div>
            {m.body && (
              <div
                style={{
                  fontSize: 11.5,
                  color: "var(--text3)",
                  marginTop: 3,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {m.body}
              </div>
            )}
          </div>
          <div
            style={{
              height: 6,
              borderRadius: 99,
              background: "var(--s2)",
              border: "1px solid var(--border)",
              position: "relative",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                bottom: 0,
                width: `${Math.round(m.strength * 100)}%`,
                background: "var(--cedar-glow)",
              }}
            />
          </div>
          <span style={{ fontFamily: "var(--fm)", fontSize: 10.5, color: "var(--muted)" }}>
            {m.created ? new Date(m.created * 1000).toLocaleDateString() : ""}
          </span>
        </div>
      ))}
    </CedarCard>
  );
}

function ForestView({ memories }: { memories: Memory[] }) {
  if (memories.length === 0) return <Empty />;
  const groves: Record<string, Memory[]> = {};
  for (const m of memories) {
    const tag = m.tags[0] || "general";
    (groves[tag] ||= []).push(m);
  }
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 14 }}>
      {Object.entries(groves).map(([tag, items]) => (
        <CedarCard key={tag} padding={16}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <span
              style={{
                fontFamily: "var(--fm)",
                fontSize: 10.5,
                color: "var(--muted)",
                textTransform: "uppercase",
                letterSpacing: ".14em",
              }}
            >
              {tag}
            </span>
            <span
              style={{
                fontFamily: "var(--fm)",
                fontSize: 10.5,
                color: "var(--cedar-2)",
              }}
            >
              {items.length}
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {items.map((m) => (
              <div key={m.id} style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: KIND_COLOR[m.kind],
                    marginTop: 6,
                    flexShrink: 0,
                  }}
                />
                <span style={{ fontSize: 12.5, color: "var(--text)", lineHeight: 1.45 }}>
                  {m.title}
                </span>
              </div>
            ))}
          </div>
        </CedarCard>
      ))}
    </div>
  );
}

function Empty() {
  return (
    <CedarCard padding={48}>
      <div style={{ textAlign: "center", color: "var(--muted)" }}>
        <Brain size={28} style={{ marginBottom: 12, color: "var(--text3)" }} />
        <div style={{ fontFamily: "var(--fd)", fontSize: 22, color: "var(--text)" }}>
          The grove is bare.
        </div>
        <div style={{ fontSize: 13, marginTop: 8 }}>
          Have a conversation — Arzeh remembers what matters.
        </div>
        <div style={{ marginTop: 14 }}>
          <Btn kind="solid" onClick={() => (window.location.href = "/")}>
            Start a chat
          </Btn>
        </div>
      </div>
    </CedarCard>
  );
}
