import { useEffect, useState } from "react";
import { api } from "@/api/client";
import type { MemoryHit } from "@/api/client";
import { Brain, FileText, Search as SearchIcon, Trash2, Plus, Save, Sparkles, FileEdit, Pin, PinOff, Lightbulb } from "lucide-react";
import SecondaryNav from "@/components/SecondaryNav";
import Popover from "@/components/Popover";

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

  const header = (
    <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-[var(--border)]">
      <div className="flex items-center gap-2">
        <Brain size={16} className="text-[var(--cedar)]" />
        <h2 className="text-[15px] font-semibold text-[var(--text)]">Memory</h2>
      </div>
      {variant === "modal" && (
        <button onClick={handleClose} className="text-[var(--muted)] hover:text-[var(--text)] text-xl leading-none" aria-label="Close memory">
          ×
        </button>
      )}
    </div>
  );
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

  if (variant === "page") {
    return (
      <div className="flex flex-col h-full bg-[var(--bg)] min-w-0 flex-1 overflow-hidden">
        {header}
        <div className="flex flex-1 min-h-0">
          <SecondaryNav<Tab> title="Memory" value={tab} onChange={setTab} items={navItems} />
          <div className="overflow-y-auto px-5 py-4 flex-1">{tabBody()}</div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div className="bg-[var(--bg)] border border-[var(--border)] rounded-2xl shadow-2xl w-full max-w-4xl mx-4 max-h-[85vh] flex flex-col">
        {header}
        <div className="flex flex-1 min-h-0">
          <SecondaryNav<Tab> value={tab} onChange={setTab} items={navItems} widthClass="w-44" />
          <div className="overflow-y-auto px-5 py-4 flex-1">{tabBody()}</div>
        </div>
      </div>
    </div>
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
        These files auto-inject into every chat turn:
        <code className="text-[var(--cedar)] ml-1">preferences.md</code> (cap 1k chars) +
        <code className="text-[var(--cedar)] ml-1">projects.md</code> (cap 2k chars).
      </div>

      <div className="border border-[var(--border)] rounded-lg p-3 bg-[var(--surface)] flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-[12px] font-semibold text-[var(--text)]">Memory consolidation</div>
          <div className="text-[11px] text-[var(--muted)]">
            Runs nightly at 03:00 (cron <code>memory-consolidator</code>). Walks recent
            sessions and asks the LLM to extract durable preferences, project context, and
            lessons — appends to the files below + writes a daily summary to <code>history/</code>.
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

      <div>
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <span className="text-[12px] font-semibold text-[var(--text)]">preferences.md</span>
            <ExamplesButton
              title="Preferences — examples"
              examples={PREF_EXAMPLES}
              onInsert={(snippet) => setPref((cur) => (cur ? cur.trimEnd() + "\n" + snippet : snippet))}
            />
          </div>
          <div className="flex items-center gap-2">
            {justSaved && <span className="text-[10px] uppercase tracking-wider text-[var(--accent)] animate-pulse">saved</span>}
            <button onClick={() => save("preferences.md")} disabled={saving || pref === origPref} className="text-[12px] flex items-center gap-1 px-3 py-1 rounded-md bg-[var(--cedar)] text-white disabled:opacity-40 hover:bg-[var(--cedar-lt)]">
              <Save size={11} /> Save
            </button>
          </div>
        </div>
        <textarea
          value={pref}
          onChange={(e) => setPref(e.target.value)}
          rows={8}
          placeholder="Empty. Click the lightbulb above for example bullets, or write your own — one per line."
          className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-md px-2 py-1.5 text-[12px] font-mono text-[var(--text)] focus:outline-none focus:border-[var(--cedar)] resize-y"
        />
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <span className="text-[12px] font-semibold text-[var(--text)]">projects.md</span>
            <ExamplesButton
              title="Projects — examples"
              examples={PROJ_EXAMPLES}
              onInsert={(snippet) => setProj((cur) => (cur ? cur.trimEnd() + "\n" + snippet : snippet))}
            />
          </div>
          <button onClick={() => save("projects.md")} disabled={saving || proj === origProj} className="text-[12px] flex items-center gap-1 px-3 py-1 rounded-md bg-[var(--cedar)] text-white disabled:opacity-40 hover:bg-[var(--cedar-lt)]">
            <Save size={11} /> Save
          </button>
        </div>
        <textarea
          value={proj}
          onChange={(e) => setProj(e.target.value)}
          rows={10}
          placeholder="Empty. Click the lightbulb above for example bullets, or write your own — one per line."
          className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-md px-2 py-1.5 text-[12px] font-mono text-[var(--text)] focus:outline-none focus:border-[var(--cedar)] resize-y"
        />
      </div>

      {history.length > 0 && (
        <div>
          <div className="text-[12px] font-semibold text-[var(--text)] mb-1">history/</div>
          <div className="text-[11px] font-mono text-[var(--muted)] flex flex-wrap gap-2">
            {history.map((h) => <span key={h} className="px-2 py-0.5 rounded bg-[var(--surface)] border border-[var(--border)]">{h}</span>)}
          </div>
        </div>
      )}

      {error && <div className="text-red-400 text-[11px] bg-red-900/20 rounded px-2 py-1">{error}</div>}
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
        {hits === null && <div className="text-center text-[var(--muted)]/60 text-[12px] py-6">Type to search</div>}
        {hits?.length === 0 && <div className="text-center text-[var(--muted)]/60 text-[12px] py-6">No results</div>}
        {hits?.map((h) => (
          <div key={`${h.source}-${h.key}`} className="border border-[var(--border)] bg-[var(--surface)] rounded-lg p-3">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[11px] font-mono text-[var(--text)] truncate">{h.key}</span>
              <span className="text-[9px] uppercase tracking-wider text-[var(--muted)]/60 font-mono">{h.source}</span>
              {h.score > 0 && (
                <span className="text-[10px] font-mono text-[var(--muted)]/50 ml-auto">score {h.score.toFixed(1)}</span>
              )}
            </div>
            <pre className="text-[12px] text-[var(--muted)] whitespace-pre-wrap break-words max-h-[140px] overflow-y-auto">
              {h.content}
            </pre>
          </div>
        ))}
      </div>
      {error && <div className="text-red-400 text-[11px] bg-red-900/20 rounded px-2 py-1">{error}</div>}
    </div>
  );
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

