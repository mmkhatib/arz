// Memory — what Arzeh remembers.
// Three layouts per design: Rings (default) / List / Forest.
//
// Strict definitions for memory kinds:
//   • Fact        — checkable knowledge ("Postgres prod is on db-1.internal:5432").
//   • Preference  — user's taste ("user prefers terse output, no emojis").
//   • Lesson      — durable pattern from corrections ("never push to main on Fridays").
// Strength: pinned → 0.95. Otherwise decays linearly from 1.0 toward 0.45 over 60 days.
// Rings band radial position within band is biased by strength (stronger = closer to core).

import { useEffect, useMemo, useState } from "react";
import { Plus, Search, Pencil, Copy as CopyIcon, Trash2, Check, X } from "lucide-react";
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
import { useDialog } from "@/components/Dialog";

type Variant = "rings" | "list" | "forest";
type Kind = "lesson" | "fact" | "preference";

type Lesson = { id: number; category: string; text: string; pinned: boolean; created_at: number };

type Memory = {
  id: string;
  rawId: number;
  kind: Kind;
  rawCategory: string;
  title: string;
  body: string;
  tags: string[];
  strength: number;
  pinned: boolean;
  created: number;
};

// Map storage category → display kind.
//   preference → preference, fact → fact, knowledge/lesson/anything else → lesson.
function categoryToKind(category: string): Kind {
  const c = (category || "").toLowerCase();
  if (c.startsWith("pref")) return "preference";
  if (c === "fact" || c.startsWith("fact")) return "fact";
  return "lesson";
}

// Reverse — kind → backend storage category. Backend only stores
// {preference, tool, knowledge}, so fact/lesson both map to knowledge with
// a leading tag so we can round-trip.
function kindToCategory(kind: Kind): string {
  if (kind === "preference") return "preference";
  if (kind === "fact") return "fact";
  return "knowledge";
}

function lessonToMemory(l: Lesson): Memory {
  const kind = categoryToKind(l.category);
  const lines = (l.text || "").split("\n");
  const title = lines[0]?.slice(0, 90) || "(untitled)";
  const body = lines.slice(1).join(" ").trim() || lines[0] || "";
  const ageDays = (Date.now() / 1000 - (l.created_at || 0)) / 86400;
  const strength = l.pinned ? 0.95 : Math.max(0.45, Math.min(0.92, 1 - ageDays / 60));
  return {
    id: String(l.id),
    rawId: l.id,
    kind,
    rawCategory: l.category,
    title,
    body,
    tags: [kind],
    strength,
    pinned: !!l.pinned,
    created: l.created_at,
  };
}

const KIND_COLOR: Record<Kind, string> = {
  lesson: "var(--cedar-glow)",
  fact: "var(--stone)",
  preference: "var(--dawn)",
};
const KIND_TAG: Record<Kind, "cedar" | "stone" | "dawn"> = {
  lesson: "cedar",
  fact: "stone",
  preference: "dawn",
};

const KIND_DEF: Record<Kind, { tagline: string; example: string }> = {
  fact: {
    tagline: "Checkable knowledge — names, addresses, versions, schemas.",
    example: "“Prod database is db-1.internal:5432 / Postgres 16.”",
  },
  preference: {
    tagline: "Your taste — how you want me to work, format, or respond.",
    example: "“Prefer terse fragment-style answers. Skip filler.”",
  },
  lesson: {
    tagline: "Durable pattern from a correction or hard-won mistake.",
    example: "“Never run a destructive migration without a manual backup first.”",
  },
};

function relTime(epoch: number): string {
  if (!epoch) return "—";
  const d = Math.round((Date.now() / 1000 - epoch) / 86400);
  if (d < 1) return "today";
  if (d < 7) return `${d}d ago`;
  if (d < 60) return `${Math.round(d / 7)}w ago`;
  return `${Math.round(d / 30)}mo ago`;
}

function copyText(s: string) {
  try {
    void navigator.clipboard.writeText(s);
  } catch {
    /* ignore */
  }
}

export default function MemoryPage() {
  const [variant, setVariant] = useState<Variant>(
    () => (localStorage.getItem("arz:memory-variant") as Variant) || "rings",
  );
  useEffect(() => { localStorage.setItem("arz:memory-variant", variant); }, [variant]);

  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<Memory | null>(null);
  const [query, setQuery] = useState("");
  const dialog = useDialog();

  const refreshLessons = () => api.listLessons().then(setLessons).catch(() => {});
  useEffect(() => { refreshLessons(); }, []);
  const memories = useMemo(() => lessons.map(lessonToMemory), [lessons]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return memories;
    return memories.filter(
      (m) =>
        m.title.toLowerCase().includes(q) ||
        m.body.toLowerCase().includes(q) ||
        m.tags.some((t) => t.toLowerCase().includes(q)),
    );
  }, [memories, query]);

  const onForget = async (m: Memory) => {
    const ok = await dialog.confirm({
      title: "Forget this memory?",
      body: m.title,
      okLabel: "Forget",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await api.deleteLesson(m.rawId);
      refreshLessons();
    } catch (e) {
      await dialog.notify({ title: "Couldn't forget", body: String(e instanceof Error ? e.message : e), tone: "danger" });
    }
  };

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
          sub={`${memories.length} memor${memories.length === 1 ? "y" : "ies"} across lessons, facts, and preferences. Stronger memories sit closer to the core; older rings fade.`}
          right={
            <>
              <SearchBox value={query} onChange={setQuery} />
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
        {variant === "rings" && (
          <RingsView
            memories={filtered}
            onEdit={(m) => setEditing(m)}
            onCopy={(m) => copyText(`${m.title}${m.body ? "\n" + m.body : ""}`)}
            onForget={onForget}
          />
        )}
        {variant === "list" && (
          <ListView
            memories={filtered}
            onEdit={(m) => setEditing(m)}
            onCopy={(m) => copyText(`${m.title}${m.body ? "\n" + m.body : ""}`)}
            onForget={onForget}
          />
        )}
        {variant === "forest" && <ForestView memories={filtered} onEdit={(m) => setEditing(m)} />}
      </div>
      <RememberModal
        open={showAdd}
        onClose={() => setShowAdd(false)}
        onSaved={refreshLessons}
      />
      <EditMemoryModal
        memory={editing}
        onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); refreshLessons(); }}
      />
    </CedarPage>
  );
}

function SearchBox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 7,
        padding: "5px 10px",
        background: "var(--s2)",
        border: "1px solid var(--border)",
        borderRadius: 7,
        width: 240,
      }}
    >
      <Search size={13} color="var(--muted)" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search memories…"
        style={{ border: "none", background: "transparent", outline: "none", flex: 1, color: "var(--text)", fontSize: 12 }}
      />
      {value && (
        <button
          onClick={() => onChange("")}
          style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--muted)", padding: 0, display: "flex" }}
          aria-label="Clear search"
        >
          <X size={12} />
        </button>
      )}
    </div>
  );
}

function KindGuide() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: "10px 12px",
        background: "var(--s2)",
        border: "1px solid var(--hairline)",
        borderRadius: 7,
      }}
    >
      <div style={{ fontSize: 10.5, fontFamily: "var(--fm)", color: "var(--muted)", letterSpacing: ".08em", textTransform: "uppercase" }}>
        Pick the right kind
      </div>
      {(["fact", "preference", "lesson"] as Kind[]).map((k) => (
        <div key={k} style={{ display: "grid", gridTemplateColumns: "76px 1fr", gap: 10, alignItems: "start" }}>
          <Tag color={KIND_TAG[k]}>{k}</Tag>
          <div>
            <div style={{ fontSize: 12, color: "var(--text)" }}>{KIND_DEF[k].tagline}</div>
            <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 2, fontStyle: "italic" }}>{KIND_DEF[k].example}</div>
          </div>
        </div>
      ))}
    </div>
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
  const [kind, setKind] = useState<Kind>("fact");
  const [pinned, setPinned] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setText("");
      setKind("fact");
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
      await api.addLesson(kindToCategory(kind), t, pinned);
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
          <CedarLabel>Kind</CedarLabel>
          <SegSeg<Kind>
            value={kind}
            onChange={setKind}
            options={[
              { value: "fact", label: "Fact" },
              { value: "preference", label: "Preference" },
              { value: "lesson", label: "Lesson" },
            ]}
          />
          <div style={{ marginTop: 8 }}>
            <KindGuide />
          </div>
        </div>
        <div>
          <CedarLabel>Memory text</CedarLabel>
          <CedarTextArea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={5}
            placeholder="What should Arzeh remember?"
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

function EditMemoryModal({
  memory,
  onClose,
  onSaved,
}: {
  memory: Memory | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [text, setText] = useState("");
  const [kind, setKind] = useState<Kind>("fact");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (memory) {
      setText(`${memory.title}${memory.body ? "\n" + memory.body : ""}`);
      setKind(memory.kind);
      setError(null);
      setSubmitting(false);
    }
  }, [memory]);

  if (!memory) return null;

  const submit = async () => {
    const t = text.trim();
    if (!t) {
      setError("Memory text required.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await api.updateLesson(memory.rawId, { category: kindToCategory(kind), text: t });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <CedarModal
      open={!!memory}
      onClose={onClose}
      eyebrow="edit"
      title="Edit memory"
      footer={
        <>
          <Btn kind="ghost" onClick={onClose} disabled={submitting}>Cancel</Btn>
          <Btn kind="solid" onClick={submit} disabled={submitting} icon={<Check size={13} />}>
            {submitting ? "Saving…" : "Save"}
          </Btn>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <CedarLabel>Kind</CedarLabel>
          <SegSeg<Kind>
            value={kind}
            onChange={setKind}
            options={[
              { value: "fact", label: "Fact" },
              { value: "preference", label: "Preference" },
              { value: "lesson", label: "Lesson" },
            ]}
          />
        </div>
        <div>
          <CedarLabel>Memory text</CedarLabel>
          <CedarTextArea value={text} onChange={(e) => setText(e.target.value)} rows={6} autoFocus />
        </div>
        {error && (
          <div style={{ fontSize: 12, color: "var(--ember)", background: "var(--ember-dim)", border: "1px solid var(--ember)", borderRadius: 6, padding: "8px 10px" }}>
            {error}
          </div>
        )}
      </div>
    </CedarModal>
  );
}

// ── Rings ───────────────────────────────────────────────────
//
// Layout: 3 concentric bands. Within each band, the bubble's radial position
// is biased by its strength — stronger memories sit closer to the inner edge
// of the band. Angular position is evenly distributed around the ring.
function RingsView({
  memories,
  onEdit,
  onCopy,
  onForget,
}: {
  memories: Memory[];
  onEdit: (m: Memory) => void;
  onCopy: (m: Memory) => void;
  onForget: (m: Memory) => void;
}) {
  const [hov, setHov] = useState<string | null>(null);

  const bands = [
    { gi: 0, label: "Core",   inner: 80,  outer: 120, lo: 0.85, hi: 1.001 },
    { gi: 1, label: "Strong", inner: 124, outer: 160, lo: 0.7,  hi: 0.85 },
    { gi: 2, label: "Recent", inner: 164, outer: 196, lo: 0.0,  hi: 0.7 },
  ];
  const groups = bands.map((b) => ({
    ...b,
    items: memories.filter((m) => m.strength >= b.lo && m.strength < b.hi),
  }));

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
              // Within the band, stronger memories sit closer to the inner edge.
              const strengthInBand = Math.max(0, Math.min(1, (m.strength - g.lo) / Math.max(0.0001, g.hi - g.lo)));
              const r = g.outer - strengthInBand * (g.outer - g.inner);
              const x = 200 + r * Math.cos(a);
              const y = 200 + r * Math.sin(a);
              const isH = hov === m.id;
              const c = KIND_COLOR[m.kind];
              return (
                <g
                  key={m.id}
                  onMouseEnter={() => setHov(m.id)}
                  onMouseLeave={() => setHov(null)}
                  onClick={() => onEdit(m)}
                  style={{ cursor: "pointer" }}
                >
                  <circle cx={x} cy={y} r={isH ? 9 : 5 + m.strength * 4} fill={c} opacity={0.5 + m.strength * 0.4} />
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
          <div style={{ fontSize: 10.5, fontFamily: "var(--fm)", color: "var(--muted)", letterSpacing: ".1em", textTransform: "uppercase" }}>
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
              <div style={{ fontFamily: "var(--fd)", fontSize: 18, color: "var(--text)", lineHeight: 1.3, marginBottom: 6 }}>
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
              <div style={{ display: "flex", gap: 6, marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
                <Btn size="sm" icon={<Pencil size={12} />} onClick={() => onEdit(inspector)}>Edit</Btn>
                <Btn size="sm" kind="ghost" icon={<CopyIcon size={11} />} onClick={() => onCopy(inspector)}>Copy</Btn>
                <Btn size="sm" kind="ghost" icon={<Trash2 size={12} />} onClick={() => onForget(inspector)}>Forget</Btn>
              </div>
            </>
          )}
        </CedarCard>
        <CedarCard padding={16}>
          <div style={{ fontSize: 10.5, fontFamily: "var(--fm)", color: "var(--muted)", letterSpacing: ".1em", textTransform: "uppercase", marginBottom: 10 }}>
            Legend
          </div>
          {([
            { kind: "lesson" as Kind, c: "cedar-glow", l: "Lesson — durable patterns" },
            { kind: "fact" as Kind, c: "stone", l: "Fact — checkable knowledge" },
            { kind: "preference" as Kind, c: "dawn", l: "Preference — your taste" },
          ]).map((x) => (
            <div key={x.kind} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", fontSize: 12, color: "var(--text2)" }}>
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
function ListView({
  memories,
  onEdit,
  onCopy,
  onForget,
}: {
  memories: Memory[];
  onEdit: (m: Memory) => void;
  onCopy: (m: Memory) => void;
  onForget: (m: Memory) => void;
}) {
  const [filter, setFilter] = useState<"all" | Kind>("all");
  const items = filter === "all" ? memories : memories.filter((m) => m.kind === filter);
  if (memories.length === 0) {
    return (
      <CedarCard padding={48}>
        <div style={{ textAlign: "center", color: "var(--muted)", fontSize: 13 }}>No memories match.</div>
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
        <span style={{ fontSize: 11, color: "var(--muted)", fontFamily: "var(--fm)" }}>
          {items.length} of {memories.length}
        </span>
      </div>
      <CedarCard padding={0}>
        {items.map((m) => (
          <ListRow key={m.id} m={m} onEdit={onEdit} onCopy={onCopy} onForget={onForget} />
        ))}
      </CedarCard>
    </>
  );
}

function ListRow({
  m,
  onEdit,
  onCopy,
  onForget,
}: {
  m: Memory;
  onEdit: (m: Memory) => void;
  onCopy: (m: Memory) => void;
  onForget: (m: Memory) => void;
}) {
  const [hover, setHover] = useState(false);
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "auto 1fr auto auto auto auto",
        gap: 14,
        alignItems: "center",
        padding: "12px 18px",
        borderBottom: "1px solid var(--hairline)",
        cursor: "pointer",
        background: hover ? "var(--s2)" : "transparent",
        transition: "background .1s",
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={() => onEdit(m)}
    >
      <Tag color={KIND_TAG[m.kind]}>{m.kind}</Tag>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13.5, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {m.title}
        </div>
        {m.body && (
          <div style={{ fontSize: 11.5, color: "var(--text3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 2 }}>
            {m.body}
          </div>
        )}
      </div>
      {/* Hover actions OR strength bar — never both at the same column */}
      <div style={{ display: "flex", gap: 4, alignItems: "center", opacity: hover ? 1 : 0, transition: "opacity .12s" }}>
        <IconButton title="Edit" onClick={(e) => { e.stopPropagation(); onEdit(m); }}><Pencil size={12} /></IconButton>
        <IconButton title="Copy" onClick={(e) => { e.stopPropagation(); onCopy(m); }}><CopyIcon size={12} /></IconButton>
        <IconButton title="Forget" onClick={(e) => { e.stopPropagation(); onForget(m); }} danger><Trash2 size={12} /></IconButton>
      </div>
      {/* Strength bar — denotes confidence */}
      <div
        title={`strength ${Math.round(m.strength * 100)}% ${m.pinned ? "(pinned)" : ""}`}
        style={{ width: 60, height: 4, background: "var(--s3)", borderRadius: 2, overflow: "hidden" }}
      >
        <div style={{ width: `${m.strength * 100}%`, height: "100%", background: m.pinned ? "var(--cedar-glow)" : "var(--cedar)" }} />
      </div>
      <span style={{ fontSize: 10.5, color: "var(--muted)", fontFamily: "var(--fm)", minWidth: 40, textAlign: "right" }}>
        {Math.round(m.strength * 100)}%
      </span>
      <span style={{ fontSize: 10.5, color: "var(--muted)", fontFamily: "var(--fm)", minWidth: 50, textAlign: "right" }}>
        {relTime(m.created)}
      </span>
    </div>
  );
}

function IconButton({
  children,
  onClick,
  title,
  danger,
}: {
  children: React.ReactNode;
  onClick: (e: React.MouseEvent) => void;
  title: string;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        background: "transparent",
        border: "1px solid var(--border)",
        borderRadius: 5,
        padding: "3px 6px",
        cursor: "pointer",
        color: danger ? "var(--ember)" : "var(--muted)",
        display: "flex",
        alignItems: "center",
      }}
    >
      {children}
    </button>
  );
}

// ── Forest — saplings per tag, height = strength ────────────
function ForestView({ memories, onEdit }: { memories: Memory[]; onEdit: (m: Memory) => void }) {
  const tags: Record<string, Memory[]> = {};
  for (const m of memories) {
    for (const t of m.tags) {
      (tags[t] ||= []).push(m);
    }
  }
  if (memories.length === 0) {
    return (
      <CedarCard padding={48}>
        <div style={{ textAlign: "center", color: "var(--muted)", fontSize: 13 }}>No memories match.</div>
      </CedarCard>
    );
  }
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 14 }}>
      {Object.entries(tags).map(([t, ms]) => (
        <CedarCard key={t} padding={0} hoverable>
          <div style={{ padding: "14px 16px 10px", borderBottom: "1px solid var(--hairline)" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <span style={{ fontFamily: "var(--fd)", fontSize: 20, color: "var(--text)" }}>#{t}</span>
              <span style={{ fontSize: 11, color: "var(--muted)", fontFamily: "var(--fm)" }}>
                {ms.length} {ms.length === 1 ? "memory" : "memories"}
              </span>
            </div>
            <svg viewBox={`0 0 ${ms.length * 16 + 8} 50`} style={{ width: "100%", marginTop: 8, display: "block", height: 50 }}>
              {ms.map((m, i) => (
                <g key={m.id} style={{ cursor: "pointer" }} onClick={() => onEdit(m)}>
                  <line x1={i * 16 + 8} y1="48" x2={i * 16 + 8} y2={48 - m.strength * 32} stroke="var(--cedar)" strokeWidth="1.2" />
                  <circle cx={i * 16 + 8} cy={48 - m.strength * 32} r="3.5" fill={KIND_COLOR[m.kind]} />
                </g>
              ))}
              <line x1="0" y1="48" x2="100%" y2="48" stroke="var(--border)" />
            </svg>
          </div>
          {ms.slice(0, 3).map((m) => (
            <div
              key={m.id}
              onClick={() => onEdit(m)}
              style={{
                padding: "8px 16px",
                fontSize: 12,
                color: "var(--text2)",
                borderTop: "1px solid var(--hairline)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                cursor: "pointer",
              }}
            >
              <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: KIND_COLOR[m.kind], marginRight: 8 }} />
              {m.title}
            </div>
          ))}
        </CedarCard>
      ))}
    </div>
  );
}
