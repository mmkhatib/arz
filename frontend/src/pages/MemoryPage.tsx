// Memory — what Arzeh remembers.
// Three layouts per design: Rings (default) / List / Forest.

import { useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import {
  CedarPage,
  CedarPageHeader,
  CedarCard,
  CedarModal,
  CedarTextArea,
  CedarLabel,
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
  const ageDays = (Date.now() / 1000 - (l.created_at || 0)) / 86400;
  const strength = l.pinned ? 0.95 : Math.max(0.45, Math.min(0.92, 1 - ageDays / 60));
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

function relTime(epoch: number): string {
  if (!epoch) return "—";
  const d = Math.round((Date.now() / 1000 - epoch) / 86400);
  if (d < 1) return "today";
  if (d < 7) return `${d}d ago`;
  if (d < 60) return `${Math.round(d / 7)}w ago`;
  return `${Math.round(d / 30)}mo ago`;
}

export default function MemoryPage() {
  const [variant, setVariant] = useState<Variant>(
    () => (localStorage.getItem("arz:memory-variant") as Variant) || "rings",
  );
  useEffect(() => { localStorage.setItem("arz:memory-variant", variant); }, [variant]);

  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const refreshLessons = () => api.listLessons().then(setLessons).catch(() => {});
  useEffect(() => { refreshLessons(); }, []);
  const memories = useMemo(() => lessons.map(lessonToMemory), [lessons]);

  return (
    <CedarPage>
      <div style={{ position: "relative", overflow: "hidden" }}>
        <TopoLines height={120} opacity={0.5} />
        <CedarPageHeader
          eyebrow="rooted memory"
          title={
            <>
              <em style={{ fontStyle: "italic", color: "var(--cedar-glow)" }}>Rings</em> of what Arzeh remembers.
            </>
          }
          sub={`${memories.length} memories across lessons, facts, and preferences. Older rings are paler — durable lessons stay near the core.`}
          right={
            <>
              <SegSeg<Variant>
                value={variant}
                onChange={setVariant}
                options={[
                  { value: "rings", label: "Rings" },
                  { value: "list", label: "List" },
                  { value: "forest", label: "Forest" },
                ]}
              />
              <Btn kind="solid" icon={<Plus size={13} />} onClick={() => setShowAdd(true)}>
                Remember…
              </Btn>
            </>
          }
        />
      </div>
      <div style={{ padding: "24px 32px 32px" }}>
        {variant === "rings" && <RingsView memories={memories} />}
        {variant === "list" && <ListView memories={memories} />}
        {variant === "forest" && <ForestView memories={memories} />}
      </div>
      <RememberModal open={showAdd} onClose={() => setShowAdd(false)} onSaved={refreshLessons} />
    </CedarPage>
  );
}

function RememberModal({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [text, setText] = useState("");
  const [category, setCategory] = useState<"preference" | "tool" | "knowledge">("knowledge");
  const [pinned, setPinned] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setText("");
      setCategory("knowledge");
      setPinned(false);
      setError(null);
      setSubmitting(false);
    }
  }, [open]);

  const submit = async () => {
    const t = text.trim();
    if (!t) {
      setError("Memory text required.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await api.addLesson(category, t, pinned);
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <CedarModal
      open={open}
      onClose={onClose}
      eyebrow="remember"
      title={
        <>
          Plant a <em style={{ fontStyle: "italic", color: "var(--cedar-glow)" }}>memory</em>.
        </>
      }
      footer={
        <>
          <Btn kind="ghost" onClick={onClose} disabled={submitting}>Cancel</Btn>
          <Btn kind="solid" onClick={submit} disabled={submitting}>
            {submitting ? "Saving…" : "Remember"}
          </Btn>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <CedarLabel>Category</CedarLabel>
          <SegSeg
            value={category}
            onChange={(v) => setCategory(v as typeof category)}
            options={[
              { value: "knowledge", label: "Knowledge" },
              { value: "preference", label: "Preference" },
              { value: "tool", label: "Tool" },
            ]}
          />
        </div>
        <div>
          <CedarLabel>Memory text</CedarLabel>
          <CedarTextArea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={5}
            placeholder="What should arzeh remember?"
            autoFocus
          />
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--text)" }}>
          <input
            type="checkbox"
            checked={pinned}
            onChange={(e) => setPinned(e.target.checked)}
            style={{ accentColor: "var(--cedar)" }}
          />
          Pin this memory (won't be evicted by the consolidator)
        </label>
        {error && (
          <div
            style={{
              fontSize: 12,
              color: "var(--ember)",
              background: "var(--ember-dim)",
              border: "1px solid var(--ember)",
              borderRadius: 6,
              padding: "8px 10px",
            }}
          >
            {error}
          </div>
        )}
      </div>
    </CedarModal>
  );
}

// ── Rings ───────────────────────────────────────────────────
function RingsView({ memories }: { memories: Memory[] }) {
  const [hov, setHov] = useState<string | null>(null);

  const groups = [
    { gi: 0, label: "Core",   r: 100, items: memories.filter((m) => m.strength >= 0.85) },
    { gi: 1, label: "Strong", r: 140, items: memories.filter((m) => m.strength >= 0.7 && m.strength < 0.85) },
    { gi: 2, label: "Recent", r: 180, items: memories.filter((m) => m.strength < 0.7) },
  ];

  if (memories.length === 0) {
    return (
      <CedarCard padding={48}>
        <div style={{ textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
          The grove is bare. Have a conversation — Arzeh remembers what matters.
        </div>
      </CedarCard>
    );
  }

  const inspector = hov ? memories.find((m) => m.id === hov) : memories[0];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: 24 }}>
      {/* Rings viz */}
      <div style={{ position: "relative", aspectRatio: "1", maxWidth: 520, margin: "0 auto", width: "100%" }}>
        <svg viewBox="0 0 400 400" style={{ width: "100%", height: "100%" }}>
          {[180, 140, 100].map((r, i) => (
            <circle
              key={i}
              cx="200"
              cy="200"
              r={r}
              fill="none"
              stroke="var(--cedar-line)"
              strokeWidth={i === 2 ? 2 : 1}
              opacity={0.3 + i * 0.2}
              strokeDasharray={i === 0 ? "2 4" : undefined}
            />
          ))}
          <circle cx="200" cy="200" r="8" fill="var(--cedar-glow)" />
          {groups.flatMap((g) =>
            g.items.map((m, mi) => {
              const total = Math.max(1, g.items.length);
              const a = (mi / total) * Math.PI * 2 - Math.PI / 2 + g.gi * 0.3;
              const x = 200 + g.r * Math.cos(a);
              const y = 200 + g.r * Math.sin(a);
              const isH = hov === m.id;
              const c = KIND_COLOR[m.kind];
              return (
                <g
                  key={m.id}
                  onMouseEnter={() => setHov(m.id)}
                  onMouseLeave={() => setHov(null)}
                  style={{ cursor: "pointer" }}
                >
                  <circle cx={x} cy={y} r={isH ? 9 : 6} fill={c} opacity={0.5 + m.strength * 0.4} />
                  {isH && <circle cx={x} cy={y} r="14" fill="none" stroke={c} strokeWidth="1" opacity="0.5" />}
                </g>
              );
            }),
          )}
          <text x="200" y="50"  textAnchor="middle" fontFamily="var(--fm)" fontSize="10" fill="var(--muted)" letterSpacing=".1em">RECENT</text>
          <text x="200" y="100" textAnchor="middle" fontFamily="var(--fm)" fontSize="10" fill="var(--muted)" letterSpacing=".1em">STRONG</text>
          <text x="200" y="150" textAnchor="middle" fontFamily="var(--fm)" fontSize="10" fill="var(--muted)" letterSpacing=".1em">CORE</text>
        </svg>
      </div>

      {/* Inspector */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <CedarCard padding={16}>
          <div
            style={{
              fontSize: 10.5,
              fontFamily: "var(--fm)",
              color: "var(--muted)",
              letterSpacing: ".1em",
              textTransform: "uppercase",
            }}
          >
            Inspector
          </div>
          {inspector && (
            <>
              <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 8, marginBottom: 6 }}>
                <Tag color={KIND_TAG[inspector.kind]}>{inspector.kind}</Tag>
                <span style={{ fontSize: 10.5, color: "var(--muted)", fontFamily: "var(--fm)" }}>
                  {relTime(inspector.created)}
                </span>
                <span style={{ fontSize: 10.5, color: "var(--muted)", fontFamily: "var(--fm)" }}>
                  · strength {Math.round(inspector.strength * 100)}%
                </span>
              </div>
              <div
                style={{
                  fontFamily: "var(--fd)",
                  fontSize: 18,
                  color: "var(--text)",
                  lineHeight: 1.3,
                  marginBottom: 6,
                }}
              >
                {inspector.title}
              </div>
              {inspector.body && (
                <div style={{ fontSize: 13, color: "var(--text2)", lineHeight: 1.6 }}>{inspector.body}</div>
              )}
              {inspector.tags.length > 0 && (
                <div style={{ display: "flex", gap: 5, marginTop: 12, flexWrap: "wrap" }}>
                  {inspector.tags.map((t) => (
                    <Tag key={t} color="muted">#{t}</Tag>
                  ))}
                </div>
              )}
            </>
          )}
        </CedarCard>
        <CedarCard padding={16}>
          <div
            style={{
              fontSize: 10.5,
              fontFamily: "var(--fm)",
              color: "var(--muted)",
              letterSpacing: ".1em",
              textTransform: "uppercase",
              marginBottom: 10,
            }}
          >
            Legend
          </div>
          {[
            { c: "cedar-glow", l: "Lesson — durable patterns" },
            { c: "stone", l: "Fact — checkable knowledge" },
            { c: "dawn", l: "Preference — your taste" },
          ].map((x) => (
            <div
              key={x.l}
              style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", fontSize: 12, color: "var(--text2)" }}
            >
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: `var(--${x.c})` }} />
              {x.l}
            </div>
          ))}
        </CedarCard>
      </div>
    </div>
  );
}

// ── List ─────────────────────────────────────────────────────
function ListView({ memories }: { memories: Memory[] }) {
  const [filter, setFilter] = useState<"all" | "lesson" | "fact" | "preference">("all");
  const items = filter === "all" ? memories : memories.filter((m) => m.kind === filter);
  if (memories.length === 0) {
    return (
      <CedarCard padding={48}>
        <div style={{ textAlign: "center", color: "var(--muted)", fontSize: 13 }}>No memories yet.</div>
      </CedarCard>
    );
  }
  return (
    <>
      <div style={{ display: "flex", gap: 8, marginBottom: 14, alignItems: "center" }}>
        <SegSeg<typeof filter>
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "All" },
            { value: "lesson", label: "Lesson" },
            { value: "fact", label: "Fact" },
            { value: "preference", label: "Preference" },
          ]}
        />
      </div>
      <CedarCard padding={0}>
        {items.map((m) => (
          <div
            key={m.id}
            style={{
              display: "grid",
              gridTemplateColumns: "auto 1fr auto auto auto",
              gap: 14,
              alignItems: "center",
              padding: "14px 18px",
              borderBottom: "1px solid var(--hairline)",
              cursor: "pointer",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--s2)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            <Tag color={KIND_TAG[m.kind]}>{m.kind}</Tag>
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontSize: 13.5,
                  color: "var(--text)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {m.title}
              </div>
              {m.body && (
                <div
                  style={{
                    fontSize: 11.5,
                    color: "var(--text3)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    marginTop: 2,
                  }}
                >
                  {m.body}
                </div>
              )}
            </div>
            <div style={{ display: "flex", gap: 4 }}>
              {m.tags.slice(0, 2).map((t) => (
                <Tag key={t} color="muted">#{t}</Tag>
              ))}
            </div>
            <div style={{ width: 50, height: 4, background: "var(--s3)", borderRadius: 2, overflow: "hidden" }}>
              <div style={{ width: `${m.strength * 100}%`, height: "100%", background: "var(--cedar-glow)" }} />
            </div>
            <span
              style={{
                fontSize: 10.5,
                color: "var(--muted)",
                fontFamily: "var(--fm)",
                minWidth: 40,
                textAlign: "right",
              }}
            >
              {relTime(m.created)}
            </span>
          </div>
        ))}
      </CedarCard>
    </>
  );
}

// ── Forest — saplings per tag, height = strength ────────────
function ForestView({ memories }: { memories: Memory[] }) {
  const tags: Record<string, Memory[]> = {};
  for (const m of memories) {
    for (const t of m.tags) {
      (tags[t] ||= []).push(m);
    }
  }
  if (memories.length === 0) {
    return (
      <CedarCard padding={48}>
        <div style={{ textAlign: "center", color: "var(--muted)", fontSize: 13 }}>No memories yet.</div>
      </CedarCard>
    );
  }
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
        gap: 14,
      }}
    >
      {Object.entries(tags).map(([t, ms]) => (
        <CedarCard key={t} padding={0} hoverable>
          <div style={{ padding: "14px 16px 10px", borderBottom: "1px solid var(--hairline)" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <span style={{ fontFamily: "var(--fd)", fontSize: 20, color: "var(--text)" }}>#{t}</span>
              <span style={{ fontSize: 11, color: "var(--muted)", fontFamily: "var(--fm)" }}>
                {ms.length} {ms.length === 1 ? "memory" : "memories"}
              </span>
            </div>
            <svg
              viewBox={`0 0 ${ms.length * 16 + 8} 50`}
              style={{ width: "100%", marginTop: 8, display: "block", height: 50 }}
            >
              {ms.map((m, i) => (
                <g key={m.id}>
                  <line
                    x1={i * 16 + 8}
                    y1="48"
                    x2={i * 16 + 8}
                    y2={48 - m.strength * 32}
                    stroke="var(--cedar)"
                    strokeWidth="1.2"
                  />
                  <circle cx={i * 16 + 8} cy={48 - m.strength * 32} r="3.5" fill={KIND_COLOR[m.kind]} />
                </g>
              ))}
              <line x1="0" y1="48" x2="100%" y2="48" stroke="var(--border)" />
            </svg>
          </div>
          {ms.slice(0, 2).map((m) => (
            <div
              key={m.id}
              style={{
                padding: "8px 16px",
                fontSize: 12,
                color: "var(--text2)",
                borderTop: "1px solid var(--hairline)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              <span
                style={{
                  display: "inline-block",
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: KIND_COLOR[m.kind],
                  marginRight: 8,
                }}
              />
              {m.title}
            </div>
          ))}
        </CedarCard>
      ))}
    </div>
  );
}
