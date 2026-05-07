import { useEffect, useState } from "react";
import { api } from "@/api/client";
import type { MemoryHit } from "@/api/client";
import { Brain, FileText, Search as SearchIcon, Trash2, Plus, Save, Sparkles, FileEdit, Pin, PinOff, Lightbulb } from "lucide-react";
import SecondaryNav from "@/components/SecondaryNav";
import Popover from "@/components/Popover";
import { PageShell, PageHeader } from "@/components/PageShell";

interface Props {
  onClose?: () => void;
  variant?: "modal" | "page";
}

type Tab = "markdown" | "search" | "auto_lessons" | "files";

export default function MemoryModal({ onClose, variant = "modal" }: Props) {
  const [tab, setTab] = useState<Tab>("markdown");
  const handleClose = onClose ?? (() => {});

  useEffect(() => {
    if (variant !== "modal") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [variant]);

  const navItems = [
    { id: "auto_lessons" as const, label: "Lessons",      icon: <Sparkles size={13} /> },
    { id: "files" as const,        label: "Memory Files", icon: <FileEdit size={13} /> },
    { id: "markdown" as const,     label: "Notes",        icon: <FileText size={13} /> },
    { id: "search" as const,       label: "Search",       icon: <SearchIcon size={13} /> },
  ];

  const tabBody = () => (
    <>
      {tab === "auto_lessons" && <AutoLessonsTab />}
      {tab === "files" && <MemoryFilesTab />}
      {tab === "markdown" && <MarkdownTab />}
      {tab === "search" && <SearchTab />}
    </>
  );

  // Page variant: SecondaryNav itself carries the page identity (icon +
  // "Memory" title), so we drop the redundant PageHeader. Modal variant
  // keeps the PageHeader because the modal frame has no other anchor.
  return (
    <PageShell variant={variant} maxWidth="max-w-4xl" onClose={handleClose}>
      {variant === "modal" && (
        <PageHeader icon={<Brain size={16} />} title="Memory" onClose={handleClose} />
      )}
      <div className="flex flex-1 min-h-0">
        <SecondaryNav<Tab>
          title={variant === "page" ? "Memory" : undefined}
          icon={variant === "page" ? <Brain size={16} /> : undefined}
          value={tab}
          onChange={setTab}
          items={navItems}
          widthClass={variant === "modal" ? "w-44" : "w-56"}
        />
        <div className="overflow-y-auto px-5 py-4 flex-1">{tabBody()}</div>
      </div>
    </PageShell>
  );
}

// ── Auto-inject Lessons tab (new /api/lessons store) ────────────────────────

function AutoLessonsTab() {
  const [items, setItems] = useState<{ id: number; category: string; text: string; pinned: boolean; created_at: number }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [category, setCategory] = useState<"preference" | "tool" | "knowledge">("preference");
  const [pinned, setPinned] = useState(false);

  const refresh = () => api.listLessons().then(setItems).catch((e) => setError(String(e)));
  useEffect(() => { refresh(); }, []);

  const add = async () => {
    if (!text.trim()) return;
    setError(null);
    try {
      await api.addLesson(category, text.trim(), pinned);
      setText("");
      setPinned(false);
      refresh();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  const togglePin = async (l: { id: number; pinned: boolean }) => {
    try { await api.pinLesson(l.id, !l.pinned); refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  const del = async (id: number) => {
    if (!confirm("Delete this lesson?")) return;
    try { await api.deleteLesson(id); refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  const grouped: Record<string, typeof items> = { preference: [], tool: [], knowledge: [] };
  items.forEach((l) => { (grouped[l.category] ?? grouped.knowledge).push(l); });

  return (
    <div className="flex flex-col gap-3">
      <div className="text-[12px] text-[var(--muted)]">
        Lessons here auto-inject into every chat turn. Pinned + preference
        always include; others match by keyword overlap. Cap: 200 entries.
      </div>

      <div className="border border-[var(--border)] rounded-lg p-3 bg-[var(--surface)] flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <select value={category} onChange={(e) => setCategory(e.target.value as "preference" | "tool" | "knowledge")} className="bg-[var(--bg)] border border-[var(--border)] rounded-md px-2 py-1 text-[12px] text-[var(--text)] focus:outline-none focus:border-[var(--cedar)]">
            <option value="preference">preference</option>
            <option value="tool">tool</option>
            <option value="knowledge">knowledge</option>
          </select>
          <label className="flex items-center gap-1.5 text-[11px] text-[var(--muted)] cursor-pointer">
            <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} className="accent-[var(--cedar)]" />
            pin
          </label>
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="One- or two-sentence lesson the agent should remember…"
          rows={2}
          className="bg-[var(--bg)] border border-[var(--border)] rounded-md px-2 py-1.5 text-[13px] text-[var(--text)] focus:outline-none focus:border-[var(--cedar)] resize-y"
        />
        <button
          onClick={add}
          disabled={!text.trim()}
          className="self-end flex items-center gap-1 px-3 py-1 rounded-md bg-[var(--cedar)] text-white text-[12px] disabled:opacity-40 hover:bg-[var(--cedar-lt)]"
        >
          <Plus size={11} /> Add
        </button>
      </div>

      {(["preference", "tool", "knowledge"] as const).map((cat) => (
        grouped[cat].length === 0 ? null : (
          <div key={cat}>
            <div className="text-[10px] uppercase tracking-wider text-[var(--muted)] mb-1">{cat}</div>
            <div className="flex flex-col gap-1">
              {grouped[cat].map((l) => (
                <div key={l.id} className="group flex items-start gap-2 border border-[var(--border)] rounded-lg p-2 bg-[var(--surface)]">
                  <span className="text-[10px] font-mono text-[var(--muted)]/60 shrink-0 mt-0.5">#{l.id}</span>
                  <span className="text-[13px] text-[var(--text)] flex-1 min-w-0">{l.text}</span>
                  <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100">
                    <button onClick={() => togglePin(l)} title={l.pinned ? "Unpin" : "Pin"} className="p-1 rounded text-[var(--muted)] hover:text-amber-400 hover:bg-[var(--bg)]">
                      {l.pinned ? <Pin size={12} fill="currentColor" /> : <PinOff size={12} />}
                    </button>
                    <button onClick={() => del(l.id)} title="Delete" className="p-1 rounded text-[var(--muted)] hover:text-red-400 hover:bg-[var(--bg)]">
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      ))}

      {items.length === 0 && (
        <div className="text-center text-[var(--muted)]/60 text-[12px] py-8">
          No lessons yet. Add one above, or let the agent call <code>learn_add</code>.
        </div>
      )}
      {error && <div className="text-red-400 text-[11px] bg-red-900/20 rounded px-2 py-1">{error}</div>}
    </div>
  );
}

// ── Memory Files tab (preferences.md / projects.md) ─────────────────────────

function MemoryFilesTab() {
  const [pref, setPref] = useState<string>("");
  const [proj, setProj] = useState<string>("");
  const [origPref, setOrigPref] = useState<string>("");
  const [origProj, setOrigProj] = useState<string>("");
  const [history, setHistory] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedFlag, setSavedFlag] = useState(0);

  const refresh = () =>
    api.listMemoryFiles().then((d) => {
      setPref(d.preferences); setOrigPref(d.preferences);
      setProj(d.projects); setOrigProj(d.projects);
      setHistory(d.history ?? []);
    }).catch((e) => setError(String(e)));

  useEffect(() => { refresh(); }, []);

  const save = async (which: "preferences.md" | "projects.md") => {
    setError(null);
    setSaving(true);
    try {
      const content = which === "preferences.md" ? pref : proj;
      await api.writeMemoryFile(which, content);
      if (which === "preferences.md") setOrigPref(content);
      else setOrigProj(content);
      setSavedFlag(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const justSaved = Date.now() - savedFlag < 1500;
  const [consolidating, setConsolidating] = useState(false);
  const [consolidateMsg, setConsolidateMsg] = useState<string | null>(null);

  const consolidate = async (force: boolean) => {
    setConsolidating(true);
    setConsolidateMsg(null);
    try {
      const r = await api.consolidateNow(force);
      setConsolidateMsg(
        `consolidated ${r.candidates} session(s): +${r.preferences_added} prefs, +${r.projects_added} projects, +${r.lessons_added} lessons`
      );
      refresh();
    } catch (e) {
      setConsolidateMsg(`error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setConsolidating(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="text-[12px] text-[var(--muted)]">
        Memory builds itself as you chat — the model emits tags or the
        nightly consolidator extracts items. You usually don't need to
        edit anything here. Below is what's currently being injected
        into every turn.
      </div>

      <div className="border border-[var(--border)] rounded-lg p-3 bg-[var(--surface)] flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-[12px] font-semibold text-[var(--text)]">Consolidation</div>
          <div className="text-[11px] text-[var(--muted)]">
            Nightly LLM rollup of recent sessions into preferences, projects,
            and lessons. Runs at 03:00; click below to force one now.
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => consolidate(false)}
            disabled={consolidating}
            className="px-3 py-1 rounded-md bg-[var(--cedar)] text-white text-[12px] disabled:opacity-40 hover:bg-[var(--cedar-lt)]"
          >
            {consolidating ? "running…" : "Run now"}
          </button>
          <button
            onClick={() => consolidate(true)}
            disabled={consolidating}
            title="Force a pass even on sessions older than 24h"
            className="px-3 py-1 rounded-md bg-[var(--bg)] border border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)] text-[12px] disabled:opacity-40"
          >
            Force
          </button>
        </div>
      </div>
      {consolidateMsg && (
        <div className="text-[11px] text-[var(--muted)] bg-[var(--surface)] border border-[var(--border)] rounded px-2 py-1">{consolidateMsg}</div>
      )}

      <BulletSection
        title="Preferences"
        subtitle="Always-on rules — style, tone, dont-do-X. Cap 1k chars."
        content={pref}
        onChange={setPref}
        onSave={() => save("preferences.md")}
        dirty={pref !== origPref}
        saving={saving}
        savedFlag={justSaved}
        examples={PREF_EXAMPLES}
        examplesTitle="Preferences — examples"
      />

      <BulletSection
        title="Projects"
        subtitle="What's currently in flight — for context the model can lean on. Cap 2k chars."
        content={proj}
        onChange={setProj}
        onSave={() => save("projects.md")}
        dirty={proj !== origProj}
        saving={saving}
        savedFlag={justSaved}
        examples={PROJ_EXAMPLES}
        examplesTitle="Projects — examples"
      />

      {history.length > 0 && (
        <div className="border border-[var(--border)] rounded-lg p-3 bg-[var(--surface)]">
          <div className="text-[12px] font-semibold text-[var(--text)] mb-1">Daily history</div>
          <div className="text-[11px] text-[var(--muted)] mb-2">
            Auto-summaries the consolidator wrote per day. Searchable from the Search tab.
          </div>
          <div className="text-[11px] font-mono text-[var(--muted)] flex flex-wrap gap-1.5">
            {history.map((h) => (
              <span key={h} className="px-2 py-0.5 rounded bg-[var(--bg)] border border-[var(--border)]">{h}</span>
            ))}
          </div>
        </div>
      )}

      {error && <div className="text-red-400 text-[11px] bg-red-900/20 rounded px-2 py-1">{error}</div>}
    </div>
  );
}

// ── BulletSection — list-first view of a memory file ────────────────────────
//
// Parses each non-empty line of the file content. Lines starting with
// "- " or "* " render as bullets; anything else is shown as a header
// row. Read-first: each bullet has a delete button. Add via the inline
// "+" form. "Edit raw" toggles the raw textarea for power users.

function BulletSection({
  title,
  subtitle,
  content,
  onChange,
  onSave,
  dirty,
  saving,
  savedFlag,
  examples,
  examplesTitle,
}: {
  title: string;
  subtitle: string;
  content: string;
  onChange: (next: string) => void;
  onSave: () => void;
  dirty: boolean;
  saving: boolean;
  savedFlag: boolean;
  examples: string[];
  examplesTitle: string;
}) {
  const [showRaw, setShowRaw] = useState(false);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");

  const lines = content.split(/\r?\n/);
  const bullets: { idx: number; text: string }[] = [];
  const others: { idx: number; text: string }[] = [];
  lines.forEach((raw, i) => {
    const line = raw.replace(/\s+$/g, "");
    if (!line.trim()) return;
    if (/^\s*[-*]\s+/.test(line)) {
      bullets.push({ idx: i, text: line.replace(/^\s*[-*]\s+/, "") });
    } else if (/^#/.test(line.trim())) {
      // Skip markdown headers — they're chrome, not content.
    } else {
      others.push({ idx: i, text: line });
    }
  });

  const removeBullet = (idx: number) => {
    const next = lines.filter((_, i) => i !== idx).join("\n");
    onChange(next);
  };

  const addBullet = () => {
    const t = draft.trim();
    if (!t) return;
    const trimmed = content.replace(/\s+$/, "");
    const sep = trimmed ? "\n" : "";
    onChange(trimmed + sep + `- ${t}\n`);
    setDraft("");
    setAdding(false);
  };

  return (
    <div className="border border-[var(--border)] rounded-lg p-3 bg-[var(--surface)] flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-semibold text-[var(--text)]">{title}</span>
            <span className="text-[10px] uppercase tracking-wider text-[var(--muted)]/70 font-mono">
              {bullets.length} {bullets.length === 1 ? "item" : "items"}
            </span>
          </div>
          <div className="text-[11px] text-[var(--muted)] mt-0.5">{subtitle}</div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => setAdding((v) => !v)}
            className="text-[11px] flex items-center gap-1 px-2 py-1 rounded-md text-[var(--cedar)] hover:bg-[var(--bg)]"
            title="Add a bullet"
          >
            <Plus size={11} /> Add
          </button>
          <ExamplesButton
            title={examplesTitle}
            examples={examples}
            onInsert={(snippet) => {
              const trimmed = content.replace(/\s+$/, "");
              const sep = trimmed ? "\n" : "";
              const line = snippet.startsWith("- ") ? snippet : `- ${snippet}`;
              onChange(trimmed + sep + line + "\n");
            }}
          />
          <button
            onClick={() => setShowRaw((v) => !v)}
            className="text-[11px] px-2 py-1 rounded-md text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--bg)]"
            title="Edit raw markdown"
          >
            {showRaw ? "Hide raw" : "Edit raw"}
          </button>
        </div>
      </div>

      {adding && (
        <div className="flex gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addBullet();
              else if (e.key === "Escape") { setAdding(false); setDraft(""); }
            }}
            placeholder="One bullet — Enter to add"
            autoFocus
            className="flex-1 bg-[var(--bg)] border border-[var(--border)] rounded-md px-2 py-1 text-[12px] text-[var(--text)] focus:outline-none focus:border-[var(--cedar)]"
          />
          <button
            onClick={addBullet}
            disabled={!draft.trim()}
            className="text-[11px] px-2 py-1 rounded-md bg-[var(--cedar)] text-white disabled:opacity-40"
          >
            Add
          </button>
        </div>
      )}

      {bullets.length === 0 && others.length === 0 ? (
        <div className="text-[11px] text-[var(--muted)]/70 italic py-2">
          Empty. The model fills this in as you teach it — or click Add / Examples to seed manually.
        </div>
      ) : (
        <div className="flex flex-col">
          {bullets.map(({ idx, text }) => (
            <div
              key={idx}
              className="group flex items-start gap-2 py-1.5 border-b border-[var(--border)]/40 last:border-b-0"
            >
              <span className="text-[var(--muted)]/50 text-[12px] mt-0.5 shrink-0">·</span>
              <span className="flex-1 text-[12px] text-[var(--text)] break-words">{text}</span>
              <button
                onClick={() => removeBullet(idx)}
                className="opacity-0 group-hover:opacity-100 text-[var(--muted)] hover:text-red-400 transition-opacity shrink-0"
                title="Remove"
              >
                <Trash2 size={11} />
              </button>
            </div>
          ))}
          {others.map(({ idx, text }) => (
            <div key={idx} className="text-[11px] text-[var(--muted)]/70 italic py-1 break-words">
              {text}
            </div>
          ))}
        </div>
      )}

      {showRaw && (
        <textarea
          value={content}
          onChange={(e) => onChange(e.target.value)}
          rows={8}
          placeholder="Raw markdown. One bullet per line."
          className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-md px-2 py-1.5 text-[12px] font-mono text-[var(--text)] focus:outline-none focus:border-[var(--cedar)] resize-y mt-2"
        />
      )}

      {(dirty || savedFlag) && (
        <div className="flex items-center gap-2 justify-end mt-1">
          {savedFlag && <span className="text-[10px] uppercase tracking-wider text-[var(--accent)] animate-pulse">saved</span>}
          <button
            onClick={onSave}
            disabled={saving || !dirty}
            className="text-[12px] flex items-center gap-1 px-3 py-1 rounded-md bg-[var(--cedar)] text-white disabled:opacity-40 hover:bg-[var(--cedar-lt)]"
          >
            <Save size={11} /> Save
          </button>
        </div>
      )}
    </div>
  );
}

// ── Markdown notes tab ────────────────────────────────────────────────────────

function MarkdownTab() {
  const [keys, setKeys] = useState<string[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [newKey, setNewKey] = useState("");

  const refresh = () =>
    api.memoryListMarkdown().then(setKeys).catch((e) => setError(String(e)));

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    if (!active) return;
    api.memoryReadMarkdown(active)
      .then((m) => {
        setContent(m.content);
        setDirty(false);
      })
      .catch((e) => setError(String(e)));
  }, [active]);

  const save = async () => {
    if (!active) return;
    setError(null);
    try {
      await api.memoryWriteMarkdown(active, content);
      setDirty(false);
      setSavedAt(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const del = async (key: string) => {
    if (!confirm(`Delete "${key}"?`)) return;
    try {
      await api.memoryDeleteMarkdown(key);
      if (active === key) {
        setActive(null);
        setContent("");
      }
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const create = async () => {
    const key = newKey.trim();
    if (!/^[a-zA-Z0-9_\-]{1,128}$/.test(key)) {
      setError("Key must be alphanumeric, _ or -, up to 128 chars");
      return;
    }
    setError(null);
    try {
      await api.memoryWriteMarkdown(key, "");
      setNewKey("");
      setActive(key);
      setContent("");
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const justSaved = Date.now() - savedAt < 1500;

  return (
    <div className="grid grid-cols-[200px_1fr] gap-3 h-[480px]">
      <div className="flex flex-col gap-2 border border-[var(--border)] rounded-lg bg-[var(--surface)] p-2 overflow-hidden">
        <div className="flex gap-1">
          <input
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            placeholder="new-note-key"
            className="flex-1 bg-[var(--bg)] border border-[var(--border)] rounded-md px-2 py-1 text-[11px] text-[var(--text)] focus:outline-none focus:border-[var(--cedar)]"
          />
          <button
            onClick={create}
            title="Create new note"
            className="px-2 rounded-md text-[var(--muted)] hover:text-[var(--cedar)] hover:bg-[var(--bg)]"
          >
            <Plus size={12} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto flex flex-col gap-0.5">
          {keys.length === 0 && (
            <div className="text-[11px] text-[var(--muted)]/60 text-center py-4">No notes yet</div>
          )}
          {keys.map((k) => (
            <div
              key={k}
              className={[
                "group flex items-center justify-between px-2 py-1 rounded text-[12px] cursor-pointer",
                active === k
                  ? "bg-[var(--cedar)]/15 text-[var(--text)]"
                  : "text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--bg)]",
              ].join(" ")}
              onClick={() => setActive(k)}
            >
              <span className="truncate">{k}</span>
              <button
                onClick={(e) => { e.stopPropagation(); del(k); }}
                className="opacity-0 group-hover:opacity-100 text-[var(--muted)] hover:text-red-400"
                title="Delete"
              >
                <Trash2 size={11} />
              </button>
            </div>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-2 min-w-0">
        {active ? (
          <>
            <div className="flex items-center gap-2">
              <span className="text-[12px] font-mono text-[var(--text)] truncate flex-1">{active}</span>
              {justSaved && <span className="text-[10px] uppercase text-[var(--accent)]">Saved</span>}
              <button
                onClick={save}
                disabled={!dirty}
                className="flex items-center gap-1 px-3 py-1 rounded-md bg-[var(--cedar)] text-white text-[12px] disabled:opacity-40 hover:bg-[var(--cedar-lt)]"
              >
                <Save size={11} /> Save
              </button>
            </div>
            <textarea
              value={content}
              onChange={(e) => { setContent(e.target.value); setDirty(true); }}
              onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); save(); } }}
              className="flex-1 bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-[13px] font-mono text-[var(--text)] focus:outline-none focus:border-[var(--cedar)] resize-none"
              placeholder="Markdown content…"
            />
          </>
        ) : (
          <div className="flex items-center justify-center h-full text-[var(--muted)] text-[13px]">
            Select a note or create a new one
          </div>
        )}
        {error && <div className="text-red-400 text-[11px] bg-red-900/20 rounded px-2 py-1">{error}</div>}
      </div>
    </div>
  );
}

// ── Search tab ────────────────────────────────────────────────────────────────

function SearchTab() {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<MemoryHit[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (!q.trim()) return;
    setLoading(true);
    setError(null);
    try {
      setHits(await api.memorySearch(q.trim(), 20));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 h-[480px]">
      <div className="flex gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") run(); }}
          placeholder="Search across memory…"
          className="flex-1 bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-[13px] text-[var(--text)] focus:outline-none focus:border-[var(--cedar)]"
        />
        <button
          onClick={run}
          disabled={loading || !q.trim()}
          className="px-4 rounded-lg bg-[var(--cedar)] text-white text-[12px] disabled:opacity-40 hover:bg-[var(--cedar-lt)]"
        >
          {loading ? "…" : "Search"}
        </button>
      </div>
      <div className="flex-1 overflow-y-auto flex flex-col gap-2">
        {hits === null && <div className="text-center text-[var(--muted)]/60 text-[12px] py-6">Type to search across lessons, memory files, notes, and history.</div>}
        {hits?.length === 0 && <div className="text-center text-[var(--muted)]/60 text-[12px] py-6">No results</div>}
        {hits?.map((h) => (
          <div key={`${h.source}-${h.key}`} className="border border-[var(--border)] bg-[var(--surface)] rounded-lg p-3">
            <div className="flex items-center gap-2 mb-2">
              <SourceBadge source={h.source} />
              <span className="text-[11px] font-mono text-[var(--muted)] truncate" title={h.key}>
                {keyDisplay(h.key, h.source)}
              </span>
              {h.score > 0 && (
                <span className="ml-auto text-[10px] font-mono text-[var(--muted)]/50" title={`bm25 / vector relevance score`}>
                  {h.score.toFixed(2)}
                </span>
              )}
            </div>
            <div
              className="text-[12px] text-[var(--text)] whitespace-pre-wrap break-words max-h-[140px] overflow-y-auto leading-snug [&_mark]:bg-[var(--cedar)]/30 [&_mark]:text-[var(--text)] [&_mark]:rounded [&_mark]:px-0.5"
              dangerouslySetInnerHTML={{ __html: sanitiseSnippet(h.content) }}
            />
          </div>
        ))}
      </div>
      {error && <div className="text-red-400 text-[11px] bg-red-900/20 rounded px-2 py-1">{error}</div>}
    </div>
  );
}

// ── Search-result helpers ────────────────────────────────────────────────────

const SOURCE_STYLES: Record<string, { label: string; cls: string }> = {
  lessons:    { label: "Lesson",   cls: "bg-amber-900/40 text-amber-300" },
  preferences:{ label: "Pref",     cls: "bg-emerald-900/40 text-emerald-300" },
  projects:   { label: "Project",  cls: "bg-blue-900/40 text-blue-300" },
  memory:     { label: "Memory",   cls: "bg-fuchsia-900/40 text-fuchsia-300" },
  history:    { label: "History",  cls: "bg-purple-900/40 text-purple-300" },
  markdown:   { label: "Note",     cls: "bg-cyan-900/40 text-cyan-300" },
  vector:     { label: "Vector",   cls: "bg-pink-900/40 text-pink-300" },
};

function SourceBadge({ source }: { source: string }) {
  const s = SOURCE_STYLES[source] ?? { label: source, cls: "bg-[var(--border)] text-[var(--muted)]" };
  return (
    <span className={`shrink-0 text-[10px] uppercase tracking-wider font-mono px-1.5 py-0.5 rounded ${s.cls}`}>
      {s.label}
    </span>
  );
}

function keyDisplay(key: string, source: string): string {
  // Backend keys come as "<source>:<id>" — strip the redundant prefix
  // since the source badge already conveys it.
  if (key.startsWith(source + ":")) return key.slice(source.length + 1);
  return key;
}

// FTS5 snippet uses literal <mark> tags. We accept those and strip every
// other tag so the dangerouslySetInnerHTML stays safe.
function sanitiseSnippet(s: string): string {
  if (!s) return "";
  return s.replace(/<(?!\/?mark\b)[^>]*>/gi, "");
}

// ── Examples popover ─────────────────────────────────────────────────────────

const PREF_EXAMPLES: string[] = [
  "- I prefer terse responses with no trailing summaries",
  "- when refactoring, prefer one bundled PR over many small ones",
  "- never start a sentence with the word \"So\"",
  "- always show absolute file paths, never relative",
  "- I work in PT timezone — schedule things in PT unless I say otherwise",
];

const PROJ_EXAMPLES: string[] = [
  "- arz — multi-provider LLM agent runtime; main repo at ~/workspace/arz",
  "- side project: rebuilding home-network monitoring on Tailscale + Grafana",
  "- on-call rotation: every other Tuesday for the data platform team",
];

function ExamplesButton({
  title,
  examples,
  onInsert,
}: {
  title: string;
  examples: string[];
  onInsert: (snippet: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        title="Show example bullets"
        className="flex items-center gap-1 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded text-[var(--muted)] hover:text-[var(--cedar)] hover:bg-[var(--bg)]"
      >
        <Lightbulb size={11} /> Examples
      </button>
      <Popover open={open} onClose={() => setOpen(false)} position="below">
        <div className="min-w-[320px] max-w-[460px] flex flex-col">
          <div className="px-3 py-2 text-[11px] uppercase tracking-wider font-medium text-[var(--muted)] border-b border-[var(--border)]">
            {title}
          </div>
          <div className="px-2 py-2 flex flex-col gap-1 max-h-[280px] overflow-y-auto">
            {examples.map((ex, i) => (
              <div
                key={i}
                className="group flex items-start gap-2 px-2 py-1.5 rounded-md hover:bg-[var(--bg)] text-[12px] font-mono text-[var(--text)]"
              >
                <span className="flex-1 break-words">{ex}</span>
                <button
                  onClick={() => { onInsert(ex); setOpen(false); }}
                  className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded text-[var(--muted)] hover:text-[var(--cedar)] hover:bg-[var(--surface)]"
                  title="Insert into editor"
                >
                  insert
                </button>
              </div>
            ))}
          </div>
          <div className="px-3 py-2 border-t border-[var(--border)] text-[10px] text-[var(--muted)]/70">
            These are examples only — they're never injected into prompts unless you click insert + save.
          </div>
        </div>
      </Popover>
    </div>
  );
}

