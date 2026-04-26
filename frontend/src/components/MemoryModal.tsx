import { useEffect, useState } from "react";
import { api } from "@/api/client";
import type { MemoryHit, MemoryLesson, ToolView } from "@/api/client";
import { Brain, FileText, BookOpen, Search as SearchIcon, Trash2, Plus, Save, Wrench, RefreshCw, AlertTriangle } from "lucide-react";

interface Props {
  onClose: () => void;
}

type Tab = "markdown" | "lessons" | "search" | "tools";

export default function MemoryModal({ onClose }: Props) {
  const [tab, setTab] = useState<Tab>("markdown");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-[var(--bg)] border border-[var(--border)] rounded-2xl shadow-2xl w-full max-w-3xl mx-4 max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-[var(--border)]">
          <div className="flex items-center gap-2">
            <Brain size={16} className="text-[var(--cedar)]" />
            <h2 className="text-[15px] font-semibold text-[var(--text)]">Memory</h2>
          </div>
          <button onClick={onClose} className="text-[var(--muted)] hover:text-[var(--text)] text-xl leading-none" aria-label="Close memory">
            ×
          </button>
        </div>
        <div className="flex border-b border-[var(--border)] px-3">
          <TabButton icon={<FileText size={13} />} label="Notes" active={tab === "markdown"} onClick={() => setTab("markdown")} />
          <TabButton icon={<BookOpen size={13} />} label="Lessons" active={tab === "lessons"} onClick={() => setTab("lessons")} />
          <TabButton icon={<SearchIcon size={13} />} label="Search" active={tab === "search"} onClick={() => setTab("search")} />
          <TabButton icon={<Wrench size={13} />} label="Tools" active={tab === "tools"} onClick={() => setTab("tools")} />
        </div>
        <div className="overflow-y-auto px-5 py-4 flex-1">
          {tab === "markdown" && <MarkdownTab />}
          {tab === "lessons" && <LessonsTab />}
          {tab === "search" && <SearchTab />}
          {tab === "tools" && <ToolsTab />}
        </div>
      </div>
    </div>
  );
}

function TabButton({ icon, label, active, onClick }: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={[
        "flex items-center gap-1.5 px-4 py-2 text-[12px] border-b-2 transition-colors",
        active ? "border-[var(--cedar)] text-[var(--text)]" : "border-transparent text-[var(--muted)] hover:text-[var(--text)]",
      ].join(" ")}
    >
      {icon}
      {label}
    </button>
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

// ── Lessons tab ───────────────────────────────────────────────────────────────

function LessonsTab() {
  const [lessons, setLessons] = useState<MemoryLesson[]>([]);
  const [draft, setDraft] = useState("");
  const [tags, setTags] = useState("");
  const [error, setError] = useState<string | null>(null);

  const refresh = () =>
    api.memoryListLessons().then(setLessons).catch((e) => setError(String(e)));
  useEffect(() => {
    refresh();
  }, []);

  const create = async () => {
    if (!draft.trim()) return;
    try {
      await api.memoryCreateLesson(
        draft.trim(),
        tags.split(",").map((t) => t.trim()).filter(Boolean),
      );
      setDraft("");
      setTags("");
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const del = async (id: number) => {
    if (!confirm("Delete this lesson?")) return;
    try {
      await api.memoryDeleteLesson(id);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="flex flex-col gap-3 h-[480px]">
      <div className="border border-[var(--border)] rounded-lg p-3 bg-[var(--surface)]">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add a new lesson — a correction or preference Arzeh should remember…"
          rows={3}
          className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-md px-2 py-1.5 text-[13px] text-[var(--text)] focus:outline-none focus:border-[var(--cedar)] resize-y"
        />
        <div className="flex items-center gap-2 mt-2">
          <input
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="tags, comma, separated"
            className="flex-1 bg-[var(--bg)] border border-[var(--border)] rounded-md px-2 py-1 text-[11px] text-[var(--text)] focus:outline-none focus:border-[var(--cedar)]"
          />
          <button
            onClick={create}
            disabled={!draft.trim()}
            className="flex items-center gap-1 px-3 py-1 rounded-md bg-[var(--cedar)] text-white text-[12px] disabled:opacity-40 hover:bg-[var(--cedar-lt)]"
          >
            <Plus size={11} /> Add
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto flex flex-col gap-2">
        {lessons.length === 0 && (
          <div className="text-center text-[var(--muted)]/60 text-[12px] py-6">No lessons yet</div>
        )}
        {lessons.map((l) => (
          <div
            key={l.id}
            className="group flex items-start gap-2 border border-[var(--border)] bg-[var(--surface)] rounded-lg p-3"
          >
            <div className="flex-1 min-w-0">
              <div className="text-[13px] text-[var(--text)] whitespace-pre-wrap break-words">{l.content}</div>
              {l.tags.length > 0 && (
                <div className="flex gap-1 mt-2">
                  {l.tags.map((t) => (
                    <span key={t} className="text-[10px] font-mono text-[var(--cedar)] bg-[var(--cedar)]/10 px-1.5 py-0.5 rounded">
                      {t}
                    </span>
                  ))}
                </div>
              )}
              <div className="text-[10px] text-[var(--muted)]/40 mt-1">
                {new Date(l.created_at * 1000).toLocaleString()}
              </div>
            </div>
            <button
              onClick={() => del(l.id)}
              className="opacity-0 group-hover:opacity-100 text-[var(--muted)] hover:text-red-400 shrink-0"
              title="Delete"
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </div>
      {error && <div className="text-red-400 text-[11px] bg-red-900/20 rounded px-2 py-1">{error}</div>}
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

// ── Tools tab ──────────────────────────────────────────────────────────────────

function ToolsTab() {
  const [tools, setTools] = useState<ToolView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [reloading, setReloading] = useState(false);

  const refresh = () =>
    api.listTools().then(setTools).catch((e) => setError(String(e)));

  useEffect(() => {
    refresh();
  }, []);

  const reload = async () => {
    setReloading(true);
    setError(null);
    try {
      await api.reloadTools();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setReloading(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 h-[480px]">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] text-[var(--muted)]">
          Drop Python files in <code className="text-[var(--cedar)]">~/.arz/tools/</code> — each declares <code>tool_spec</code> and <code>async run(input)</code>.
        </span>
        <button
          onClick={reload}
          disabled={reloading}
          className="flex items-center gap-1 px-3 py-1 rounded-md bg-[var(--cedar)] text-white text-[12px] disabled:opacity-40 hover:bg-[var(--cedar-lt)] shrink-0"
        >
          <RefreshCw size={11} className={reloading ? "animate-spin" : ""} /> Reload
        </button>
      </div>
      <div className="flex-1 overflow-y-auto flex flex-col gap-2">
        {tools.length === 0 && (
          <div className="text-center text-[var(--muted)]/60 text-[12px] py-8">No tools loaded.</div>
        )}
        {tools.map((t) => (
          <div
            key={t.source_path}
            className={[
              "border rounded-lg p-3 bg-[var(--surface)]",
              t.error ? "border-amber-400/40" : "border-[var(--border)]",
            ].join(" ")}
          >
            <div className="flex items-center gap-2 mb-1">
              <Wrench size={12} className="text-[var(--cedar)]" />
              <span className="text-[13px] font-mono text-[var(--text)]">{t.name}</span>
              {t.error && <AlertTriangle size={11} className="text-amber-400" />}
              <span className="text-[10px] font-mono text-[var(--muted)]/60 truncate ml-auto">{t.source_path}</span>
            </div>
            <div className="text-[12px] text-[var(--muted)]">{t.description}</div>
            {t.error && (
              <pre className="mt-2 text-[10px] text-red-400 bg-red-900/10 rounded p-2 whitespace-pre-wrap overflow-x-auto">
                {t.error}
              </pre>
            )}
          </div>
        ))}
      </div>
      {error && <div className="text-red-400 text-[11px] bg-red-900/20 rounded px-2 py-1">{error}</div>}
    </div>
  );
}
