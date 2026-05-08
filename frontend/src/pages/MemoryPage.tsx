// Memory page — three variants per Cedar redesign:
//   * List   — existing detailed Memory modal
//   * Rings  — donut breakdown of memory item kinds
//   * Forest — grouped category tree

import { useEffect, useState } from "react";
import { List, CircleDot, TreePine, Brain } from "lucide-react";
import MemoryModal from "@/components/MemoryModal";
import VariantSwitcher, { useVariant } from "@/components/VariantSwitcher";
import { PageShell, PageHeader } from "@/components/PageShell";
import { api } from "@/api/client";

type Lesson = { id: number; category: string; text: string; pinned: boolean; created_at: number };

type V = "list" | "rings" | "forest";

export default function MemoryPage() {
  const [variant, setVariant] = useVariant<V>("arz:memory-variant", "list");

  if (variant === "list") {
    return (
      <div className="flex flex-col w-full h-full">
        <VariantBar variant={variant} setVariant={setVariant} />
        <div className="flex-1 min-h-0">
          <MemoryModal variant="page" />
        </div>
      </div>
    );
  }

  return (
    <PageShell variant="page">
      <PageHeader
        icon={<Brain size={16} />}
        title="Memory"
        actions={<VariantSwitcherInline variant={variant} setVariant={setVariant} />}
      />
      <div className="flex-1 overflow-y-auto p-6">
        {variant === "rings" && <RingsVariant />}
        {variant === "forest" && <ForestVariant />}
      </div>
    </PageShell>
  );
}

function VariantBar({ variant, setVariant }: { variant: V; setVariant: (v: V) => void }) {
  return (
    <div className="flex items-center justify-end px-4 py-2 border-b border-[var(--border)] bg-[var(--bg)]">
      <VariantSwitcherInline variant={variant} setVariant={setVariant} />
    </div>
  );
}

function VariantSwitcherInline({ variant, setVariant }: { variant: V; setVariant: (v: V) => void }) {
  return (
    <VariantSwitcher
      storageKey="arz:memory-variant"
      value={variant}
      onChange={setVariant}
      variants={[
        { id: "list",   label: "List",   icon: <List size={11} /> },
        { id: "rings",  label: "Rings",  icon: <CircleDot size={11} /> },
        { id: "forest", label: "Forest", icon: <TreePine size={11} /> },
      ]}
    />
  );
}

function RingsVariant() {
  const [stats, setStats] = useState<{ markdown: number; lessons: number; vectors: number } | null>(null);
  useEffect(() => { api.memoryStats().then(setStats).catch(() => {}); }, []);
  if (!stats) return <div className="text-[12px] text-[var(--muted)]">Loading…</div>;
  const total = Math.max(1, stats.markdown + stats.lessons + stats.vectors);
  const slices = [
    { label: "Markdown notes", value: stats.markdown, color: "var(--cedar)" },
    { label: "Lessons",        value: stats.lessons,  color: "var(--cedar-glow)" },
    { label: "Vector chunks",  value: stats.vectors,  color: "var(--cedar-deep)" },
  ];
  let acc = 0;
  const C = 2 * Math.PI * 64;
  return (
    <div className="flex flex-col md:flex-row gap-8 items-center">
      <svg width="180" height="180" viewBox="0 0 180 180" className="shrink-0">
        <g transform="translate(90,90) rotate(-90)">
          <circle r="64" fill="none" stroke="var(--border)" strokeWidth="18" />
          {slices.map((s) => {
            const len = (s.value / total) * C;
            const off = (acc / total) * C;
            acc += s.value;
            return (
              <circle
                key={s.label}
                r="64"
                fill="none"
                stroke={s.color}
                strokeWidth="18"
                strokeDasharray={`${len} ${C}`}
                strokeDashoffset={-off}
              />
            );
          })}
        </g>
        <text x="90" y="86" textAnchor="middle" className="font-display fill-[var(--text)]" style={{ fontSize: 22 }}>
          {total === 1 ? 0 : total}
        </text>
        <text x="90" y="106" textAnchor="middle" className="fill-[var(--muted)]" style={{ fontSize: 10 }}>
          items
        </text>
      </svg>
      <div className="flex flex-col gap-3 text-[13px]">
        {slices.map((s) => (
          <div key={s.label} className="flex items-center gap-3">
            <span className="w-3 h-3 rounded-sm shrink-0" style={{ background: s.color }} />
            <span className="flex-1 text-[var(--text)]">{s.label}</span>
            <span className="font-mono text-[var(--muted)] w-10 text-right">{s.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ForestVariant() {
  const [lessons, setLessons] = useState<Lesson[]>([]);
  useEffect(() => { api.listLessons().then(setLessons).catch(() => {}); }, []);
  const groups: Record<string, Lesson[]> = {};
  for (const l of lessons) (groups[l.category] ||= []).push(l);
  if (lessons.length === 0) return <div className="text-[12px] text-[var(--muted)]">No lessons yet.</div>;
  return (
    <div className="flex flex-col gap-6">
      {Object.entries(groups).map(([cat, items]) => (
        <section key={cat}>
          <h3 className="eyebrow text-[var(--muted)] mb-2">{cat} · {items.length}</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {items.map((it) => (
              <div
                key={it.id}
                className="px-3 py-2 rounded-md bg-[var(--surface)] border border-[var(--border)] text-[12px] text-[var(--text)]"
              >
                {it.pinned && <span className="mr-1 text-[var(--cedar)]">●</span>}
                {it.text}
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
