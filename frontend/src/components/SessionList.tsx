import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Trash2,
  Folder as FolderIcon,
  FolderPlus,
  Plus,
} from "lucide-react";
import * as LucideIcons from "lucide-react";
import { api } from "@/api/client";
import type { SearchHit, SessionSummary } from "@/api/client";
import { useDialog } from "@/components/Dialog";

export interface FolderItem {
  id: string;
  name: string;
  icon: string;
  session_ids: string[];
  created_at: number;
}

function renderFolderIcon(name: string, size = 13) {
  const Comp =
    (LucideIcons as unknown as Record<string, React.ComponentType<{ size?: number }>>)[name] ||
    FolderIcon;
  return <Comp size={size} />;
}

interface ProviderBadge {
  label: string;
  className: string;
}

// Single source of truth for per-provider badges. To add a new provider,
// add one row here — every consumer (SessionList, etc.) inherits it.
const PROVIDER_BADGES: Record<string, ProviderBadge> = {
  "claude-code": { label: "Claude", className: "bg-orange-900/40 text-orange-300" },
  "kiro-cli":    { label: "Kiro",   className: "bg-blue-900/30 text-blue-400" },
  "codex":       { label: "Codex",  className: "bg-green-900/30 text-green-400" },
  "gemini":      { label: "Gemini", className: "bg-cyan-900/30 text-cyan-300" },
  "ollama":      { label: "Ollama", className: "bg-fuchsia-900/30 text-fuchsia-300" },
  "anthropic":   { label: "API",    className: "bg-purple-900/30 text-purple-400" },
};

function providerBadge(provider: string | null | undefined, globalProvider: string): ProviderBadge {
  const p = provider || globalProvider || "";
  return PROVIDER_BADGES[p] ?? { label: p || "—", className: "bg-[var(--border)] text-[var(--muted)]" };
}

/** Render an FTS snippet as React nodes, with <mark> tokens highlighted.
 * Splits on the literal <mark>/</mark> markers we ask SQLite to emit; user
 * content between markers is rendered as plain text — never as HTML — to keep
 * the dashboard XSS-safe per STEERING.md. */
function renderSnippet(snippet: string): React.ReactNode[] {
  const parts = snippet.split(/<mark>|<\/mark>/);
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <mark key={i} className="bg-[var(--cedar)]/30 text-[var(--text)] rounded px-0.5">
        {part}
      </mark>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

interface Props {
  sessions: SessionSummary[];
  activeId: string | null;
  pinnedIds: Set<string>;
  globalProvider: string;
  searchInputRef?: React.Ref<HTMLInputElement>;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onDelete: (id: string) => void;
  onTogglePin: (id: string) => void;
  onArchive?: (id: string, archived: boolean) => void;
  /** Visible state on mobile (overlay drawer). On md+ the sidebar is always visible. */
  mobileOpen?: boolean;
  onMobileClose?: () => void;
  onResume: (session: SessionSummary) => void;
}

export default function SessionList({
  sessions,
  activeId,
  pinnedIds,
  globalProvider,
  searchInputRef,
  onSelect,
  onCreate,
  onDelete,
  onTogglePin,
  mobileOpen = false,
  onMobileClose,
  onResume,
}: Props) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SessionSummary[] | null>(null);
  const [searchHits, setSearchHits] = useState<SearchHit[] | null>(null);
  const [history, setHistory] = useState<SessionSummary[]>([]);
  const dialog = useDialog();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyHoveredId, setHistoryHoveredId] = useState<string | null>(null);
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [openFolders, setOpenFolders] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem("arz:folders-open");
      return raw ? new Set<string>(JSON.parse(raw)) : new Set<string>();
    } catch { return new Set<string>(); }
  });
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [dropTargetFolderId, setDropTargetFolderId] = useState<string | "unfiled" | null>(null);
  const pendingFolderRef = useRef<string | null>(null);
  const prevSessionIdsRef = useRef<Set<string>>(new Set());
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // When the user clicks "+" with a folder selected, pendingFolderRef
  // holds that folder. The next time a brand-new session shows up in
  // the sessions feed, drop it into the folder.
  useEffect(() => {
    if (!pendingFolderRef.current) return;
    const seen = prevSessionIdsRef.current;
    const fresh = sessions.find((s) => !seen.has(s.id));
    if (fresh) {
      const target = pendingFolderRef.current;
      pendingFolderRef.current = null;
      void api
        .moveSessionToFolder(fresh.id, target)
        .then(() => refreshFolders())
        .catch(() => {});
    }
    // Always refresh the snapshot so we don't repeatedly fire on
    // unrelated updates.
    prevSessionIdsRef.current = new Set(sessions.map((s) => s.id));
  }, [sessions]);

  const activeSessionCount = sessions.length;
  useEffect(() => {
    api.fetchHistory().then(setHistory).catch(() => {});
  }, [activeSessionCount]);

  const refreshFolders = () => api.listFolders().then(setFolders).catch(() => {});
  useEffect(() => { refreshFolders(); }, []);

  useEffect(() => {
    try { localStorage.setItem("arz:folders-open", JSON.stringify([...openFolders])); } catch {}
  }, [openFolders]);

  const toggleFolderOpen = (id: string) => {
    setOpenFolders((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const createFolder = async () => {
    const name = await dialog.prompt({
      title: "New folder",
      body: "Pick a name — the LLM auto-picks an icon to match.",
      placeholder: "e.g. clients, research, sandbox",
      okLabel: "Create",
      eyebrow: "new folder",
    });
    if (!name?.trim()) return;
    try {
      await api.createFolder(name.trim());
      await refreshFolders();
    } catch (e) {
      await dialog.notify({ title: "Folder create failed", body: String(e), tone: "danger" });
    }
  };

  const deleteFolder = async (id: string) => {
    const ok = await dialog.confirm({
      title: "Delete this folder?",
      body: "Sessions inside move back to the unfiled list.",
      tone: "danger",
    });
    if (!ok) return;
    try { await api.deleteFolder(id); await refreshFolders(); } catch {}
  };

  const moveToFolder = async (sessionId: string, folderId: string | null) => {
    try {
      await api.moveSessionToFolder(sessionId, folderId);
      await refreshFolders();
    } catch {}
  };

  // Fast lookup of which folder a session belongs to.
  const sessionFolderMap: Record<string, string> = {};
  for (const f of folders) {
    for (const sid of f.session_ids) sessionFolderMap[sid] = f.id;
  }

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!query.trim()) {
      setResults(null);
      setSearchHits(null);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      try {
        const hits = await api.searchMessages(query.trim(), { limit: 50 });
        setSearchHits(hits);
        // Reduce hits → unique sessions, preserving FTS rank order
        const seen = new Set<string>();
        const ordered: SessionSummary[] = [];
        for (const h of hits) {
          if (seen.has(h.session_id)) continue;
          seen.add(h.session_id);
          const fromActive = sessions.find((s) => s.id === h.session_id);
          const fromHistory = history.find((s) => s.id === h.session_id);
          if (fromActive || fromHistory) {
            ordered.push(fromActive ?? (fromHistory as SessionSummary));
          }
        }
        setResults(ordered);
      } catch {
        setSearchHits([]);
        setResults([]);
      }
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      setQuery("");
      setResults(null);
      setSearchHits(null);
    }
  };

  const hitsBySession = searchHits
    ? searchHits.reduce<Record<string, SearchHit[]>>((acc, h) => {
        (acc[h.session_id] ??= []).push(h);
        return acc;
      }, {})
    : null;

  const displayed = results ?? [...sessions]
    .filter((s) => !s.archived)
    .sort((a, b) => {
      const ap = pinnedIds.has(a.id) ? 1 : 0;
      const bp = pinnedIds.has(b.id) ? 1 : 0;
      if (ap !== bp) return bp - ap;
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    });

  // Resizable width — desktop only. Persists to localStorage.
  const MIN_WIDTH = 180;
  const MAX_WIDTH = 520;
  const DEFAULT_WIDTH = 224;
  const [width, setWidth] = useState<number>(() => {
    try {
      const raw = localStorage.getItem("arz:session-list-width");
      const n = raw ? Number(raw) : NaN;
      return Number.isFinite(n) && n >= MIN_WIDTH && n <= MAX_WIDTH ? n : DEFAULT_WIDTH;
    } catch { return DEFAULT_WIDTH; }
  });
  const draggingRef = useRef(false);
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!draggingRef.current) return;
      const next = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, e.clientX));
      setWidth(next);
    };
    const onUp = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      try { localStorage.setItem("arz:session-list-width", String(width)); } catch {}
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [width]);
  const startDrag = () => {
    draggingRef.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  return (
    <>
      {/* Backdrop on mobile when drawer is open */}
      {mobileOpen && onMobileClose && (
        <div
          onClick={onMobileClose}
          className="md:hidden fixed inset-0 z-30 bg-black/50 backdrop-blur-sm"
          aria-hidden="true"
        />
      )}
      <aside
        className={[
          "relative flex flex-col bg-[var(--surface)] border-r border-[var(--border)]",
          "md:static md:flex md:shrink-0",
          "fixed inset-y-0 left-0 z-40 w-64 transform transition-transform duration-200 md:transition-none",
          mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0",
        ].join(" ")}
        style={{ width: `${width}px` }}
      >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
        <span className="text-[var(--accent)] font-semibold tracking-wide text-[13px]">
          🌲 Arzeh
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={createFolder}
            title="New folder"
            className="w-6 h-6 flex items-center justify-center rounded text-[var(--muted)] hover:text-[var(--cedar-glow)] hover:bg-[var(--s2)]"
          >
            <FolderPlus size={13} />
          </button>
          <button
            onClick={() => {
              // Remember the destination folder so the new session lands there
              // once it appears in the sessions feed (see useEffect below).
              pendingFolderRef.current = selectedFolderId;
              prevSessionIdsRef.current = new Set(sessions.map((s) => s.id));
              onCreate();
            }}
            title={selectedFolderId ? "New session in selected folder" : "New session"}
            className="w-6 h-6 flex items-center justify-center rounded text-[var(--muted)] hover:text-[var(--cedar-glow)] hover:bg-[var(--s2)]"
          >
            <Plus size={14} />
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="px-3 py-2 border-b border-[var(--border)]">
        <input
          ref={searchInputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleSearchKeyDown}
          placeholder="Search… (⌘F)"
          className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-[12px] text-[var(--text)] placeholder-[var(--muted)] focus:outline-none focus:border-[var(--cedar)]"
        />
      </div>

      {/* Active session list */}
      <div className="flex-1 overflow-y-auto py-2">
        {displayed.length === 0 && (
          <p className="px-4 py-3 text-[var(--muted)] text-[13px]">
            {query ? "No results." : "No sessions yet."}
          </p>
        )}
        {/* Folders — click selects; chevron toggles open. Drop target. */}
        {!query && folders.map((f) => {
          const isOpen = openFolders.has(f.id);
          const isSelected = selectedFolderId === f.id;
          const isDropTarget = dropTargetFolderId === f.id;
          const folderSessions = displayed.filter((s) => sessionFolderMap[s.id] === f.id);
          return (
            <div
              key={f.id}
              className={[
                "border-b border-[var(--hairline)]",
                isDropTarget ? "bg-[var(--cedar-dim)]" : "",
              ].join(" ")}
              onDragOver={(e) => { e.preventDefault(); setDropTargetFolderId(f.id); }}
              onDragLeave={() => setDropTargetFolderId((cur) => (cur === f.id ? null : cur))}
              onDrop={(e) => {
                e.preventDefault();
                const sid = e.dataTransfer.getData("text/arz-session");
                setDropTargetFolderId(null);
                if (sid) void moveToFolder(sid, f.id);
              }}
            >
              <div
                role="button"
                tabIndex={0}
                onClick={() => {
                  setSelectedFolderId((cur) => (cur === f.id ? null : f.id));
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setSelectedFolderId((cur) => (cur === f.id ? null : f.id));
                  }
                }}
                className={[
                  "group flex items-center gap-1.5 px-3 py-1.5 cursor-pointer transition-colors",
                  isSelected
                    ? "bg-[var(--cedar-dim)] border-l-2 border-[var(--cedar-glow)]"
                    : "hover:bg-[var(--s2)] border-l-2 border-transparent",
                  "focus:outline-none focus-visible:bg-[var(--s2)]",
                ].join(" ")}
              >
                <button
                  onClick={(e) => { e.stopPropagation(); toggleFolderOpen(f.id); }}
                  className="w-4 h-4 flex items-center justify-center text-[var(--muted)] hover:text-[var(--text)]"
                  title={isOpen ? "Collapse" : "Expand"}
                >
                  {isOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                </button>
                <span className="text-[var(--cedar-glow)]">{renderFolderIcon(f.icon)}</span>
                <span className="text-[12.5px] text-[var(--text)] truncate flex-1">{f.name}</span>
                <span className="text-[10px] font-mono text-[var(--muted)]">{folderSessions.length}</span>
                <button
                  onClick={(e) => { e.stopPropagation(); deleteFolder(f.id); }}
                  title="Delete folder"
                  className="opacity-0 group-hover:opacity-100 w-5 h-5 flex items-center justify-center rounded text-[var(--muted)] hover:text-red-400"
                >
                  <Trash2 size={10} />
                </button>
              </div>
              {isOpen && folderSessions.map((s) => (
                <SessionRow
                  key={s.id}
                  s={s}
                  isActive={s.id === activeId}
                  isPinned={pinnedIds.has(s.id)}
                  isHovered={hoveredId === s.id}
                  badge={providerBadge(s.provider, globalProvider)}
                  hits={hitsBySession?.[s.id]}
                  onSelect={() => onSelect(s.id)}
                  onTogglePin={() => onTogglePin(s.id)}
                  onDelete={() => onDelete(s.id)}
                  onMouseEnter={() => setHoveredId(s.id)}
                  onMouseLeave={() => setHoveredId(null)}
                  indent
                />
              ))}
            </div>
          );
        })}

        {/* Sessions not in any folder — also a drop target */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDropTargetFolderId("unfiled"); }}
          onDragLeave={() => setDropTargetFolderId((cur) => (cur === "unfiled" ? null : cur))}
          onDrop={(e) => {
            e.preventDefault();
            const sid = e.dataTransfer.getData("text/arz-session");
            setDropTargetFolderId(null);
            if (sid) void moveToFolder(sid, null);
          }}
          className={dropTargetFolderId === "unfiled" ? "bg-[var(--cedar-dim)]/40" : ""}
        >
        {displayed.filter((s) => !sessionFolderMap[s.id]).map((s) => {
          const isActive = s.id === activeId;
          const isPinned = pinnedIds.has(s.id);
          const isHovered = hoveredId === s.id;
          const badge = providerBadge(s.provider, globalProvider);
          const hits = hitsBySession?.[s.id];
          return (
            <SessionRow
              key={s.id}
              s={s}
              isActive={isActive}
              isPinned={isPinned}
              isHovered={isHovered}
              badge={badge}
              hits={hits}
              onSelect={() => onSelect(s.id)}
              onTogglePin={() => onTogglePin(s.id)}
              onDelete={() => onDelete(s.id)}
              onMouseEnter={() => setHoveredId(s.id)}
              onMouseLeave={() => setHoveredId(null)}
            />
          );
        })}
        </div>

      </div>

      {/* History — anchored above footer, collapsible. Hidden while searching. */}
      {history.length > 0 && !query && (
        <div className={[
          "border-t border-[var(--border)] flex flex-col min-h-0",
          historyOpen ? "max-h-[40%]" : "",
        ].join(" ")}>
          <button
            onClick={() => setHistoryOpen((v) => !v)}
            className="w-full flex items-center justify-between px-4 text-[11px] text-[var(--muted)] hover:text-[var(--text)] transition-colors shrink-0"
            style={{ minHeight: "var(--shell-row-h)" }}
          >
            <span className="uppercase tracking-wider flex items-center gap-1.5">
              {historyOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              History ({history.length})
            </span>
          </button>

          {historyOpen && (
            <div className="overflow-y-auto flex-1">
              {history.map((s) => {
                const isHovered = historyHoveredId === s.id;
                const badge = providerBadge(s.provider, globalProvider);
                return (
                  <div
                    key={s.id}
                    className="flex items-center pr-1 hover:bg-[var(--border)] transition-colors"
                    onMouseEnter={() => setHistoryHoveredId(s.id)}
                    onMouseLeave={() => setHistoryHoveredId(null)}
                  >
                    <div className="flex-1 px-4 py-2 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-[12px] text-[var(--muted)] flex-1">{s.title}</span>
                        <span className={[
                          "shrink-0 text-[9px] px-1.5 py-0.5 rounded font-medium",
                          badge.className,
                        ].join(" ")}>
                          {badge.label}
                        </span>
                      </div>
                      <div className="text-[10px] text-[var(--muted)]/60 mt-0.5">
                        {s.message_count} msgs · {relativeTime(s.updated_at)}
                      </div>
                    </div>
                    {isHovered && (
                      <div className="shrink-0 flex items-center gap-1 mr-1.5">
                        <button
                          onClick={() => onResume(s)}
                          title="Resume session"
                          className="px-2 py-1 rounded-lg text-[10px] text-[var(--cedar)] border border-[var(--cedar)]/30 hover:bg-[var(--cedar)]/10 transition-colors"
                        >
                          Resume
                        </button>
                        <button
                          onClick={async () => {
                            const ok = await dialog.confirm({
                              title: `Permanently delete "${s.title}"?`,
                              body: "This cannot be undone.",
                              tone: "danger",
                            });
                            if (!ok) return;
                            try {
                              await api.permanentDeleteSession(s.id);
                              setHistory((prev) => prev.filter((h) => h.id !== s.id));
                            } catch (e) {
                              await dialog.notify({ title: "Delete failed", body: String(e), tone: "danger" });
                            }
                          }}
                          title="Permanently delete"
                          className="w-6 h-6 flex items-center justify-center rounded-lg text-[var(--muted)] hover:text-red-400 hover:bg-red-400/10 transition-colors"
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Footer kept intentionally minimal — Memory/Schedule/Analytics/Settings
          live in the global NavBar to the left. */}

      {/* Drag handle on the right edge — desktop only */}
      <div
        onMouseDown={(e) => { e.preventDefault(); startDrag(); }}
        onDoubleClick={() => { setWidth(DEFAULT_WIDTH); try { localStorage.setItem("arz:session-list-width", String(DEFAULT_WIDTH)); } catch {} }}
        title="Drag to resize · double-click to reset"
        className="hidden md:block absolute top-0 right-0 h-full w-1.5 -mr-0.5 cursor-col-resize z-10 hover:bg-[var(--cedar)]/30 active:bg-[var(--cedar)]/50 transition-colors"
      />
      </aside>
    </>
  );
}

// ── Single session row ────────────────────────────────────────
function SessionRow({
  s,
  isActive,
  isPinned,
  isHovered,
  badge,
  hits,
  indent,
  onSelect,
  onTogglePin,
  onDelete,
  onMouseEnter,
  onMouseLeave,
}: {
  s: SessionSummary;
  isActive: boolean;
  isPinned: boolean;
  isHovered: boolean;
  badge: ProviderBadge;
  hits?: SearchHit[];
  indent?: boolean;
  onSelect: () => void;
  onTogglePin: () => void;
  onDelete: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}) {
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/arz-session", s.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      className={[
        "group relative flex flex-col pr-1 transition-colors",
        isActive ? "bg-[var(--user-bg)]" : "hover:bg-[var(--s2)]",
        indent ? "pl-3" : "",
        "cursor-grab active:cursor-grabbing",
      ].join(" ")}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="flex items-center">
        <button
          onClick={onSelect}
          className={[
            "flex-1 text-left px-4 py-2.5 text-[13px] truncate flex items-center gap-1.5",
            isActive ? "text-[var(--text)]" : "text-[var(--muted)] group-hover:text-[var(--text)]",
          ].join(" ")}
        >
          {isPinned && <span className="text-[10px] text-[var(--cedar-glow)]">●</span>}
          {s.streaming && (
            <span
              title="Generating reply…"
              className="shrink-0 inline-block w-1.5 h-1.5 rounded-full bg-[var(--cedar)] animate-pulse"
            />
          )}
          <span className="truncate flex-1">{s.title}</span>
          {hits && hits.length > 1 && (
            <span className="shrink-0 text-[9px] text-[var(--cedar-glow)] font-mono">{hits.length}</span>
          )}
          <span
            className={[
              "shrink-0 text-[9px] px-1.5 py-0.5 rounded font-medium",
              badge.className,
            ].join(" ")}
          >
            {badge.label}
          </span>
        </button>

        {isHovered && (
          <div className="flex items-center gap-0.5 shrink-0 pr-1">
            <button
              onClick={(e) => { e.stopPropagation(); onTogglePin(); }}
              title={isPinned ? "Unpin" : "Pin to top"}
              className="w-6 h-6 flex items-center justify-center rounded text-[11px] text-[var(--muted)] hover:text-[var(--cedar-glow)] hover:bg-[var(--s2)] transition-colors"
            >
              {isPinned ? "★" : "☆"}
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(); }}
              title="Close session"
              className="w-6 h-6 flex items-center justify-center rounded text-[11px] text-[var(--muted)] hover:text-red-400 hover:bg-[var(--s2)] transition-colors"
            >
              ×
            </button>
          </div>
        )}
      </div>

      {hits && hits[0] && (
        <div
          onClick={onSelect}
          className="px-4 pb-1.5 -mt-1 text-[11px] text-[var(--muted)] truncate cursor-pointer"
          title={`${hits[0].role}: ${hits[0].snippet.replace(/<\/?mark>/g, "")}`}
        >
          {renderSnippet(hits[0].snippet)}
        </div>
      )}
    </div>
  );
}
