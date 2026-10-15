import { useEffect, useRef, useState } from "react";
import { serverTimeMs } from "@/utils/serverTime";
import CedarMark from "./CedarMark";
import {
  Archive,
  ArchiveRestore,
  Check,
  ChevronDown,
  ChevronRight,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Sparkles,
  Trash2,
  Folder as FolderIcon,
  FolderInput,
  FolderPlus,
  Plus,
  X,
} from "lucide-react";
import * as LucideIcons from "lucide-react";
import { api } from "@/api/client";
import type { SearchHit, SessionSummary } from "@/api/client";
import { useDialog } from "@/components/Dialog";
import {
  DEFAULT_STALE_COLLAPSE_MS,
  SESSION_FILTERS,
  STALE_COLLAPSE_PRESETS_MS,
  isUnread,
  matchesFilter,
  shouldDrainFilter,
  splitStale,
  staleLabel,
  type SessionFilter,
} from "@/utils/sessionOrg";

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
  // Quiet by design: a row's provider is reference info, not a call to
  // action. A tinted dot carries identity; the label stays muted.
  "claude-code": { label: "claude", className: "bg-[#d08a5c]" },
  "kiro-cli":    { label: "kiro",   className: "bg-[#6f8fd8]" },
  "codex":       { label: "codex",  className: "bg-[#5fa080]" },
  "gemini":      { label: "gemini", className: "bg-[#5ab4c8]" },
  "ollama":      { label: "ollama", className: "bg-[#b07cc6]" },
  "anthropic":   { label: "api",    className: "bg-[#9a7ad0]" },
};

function providerBadge(provider: string | null | undefined, globalProvider: string): ProviderBadge {
  const p = provider || globalProvider || "";
  return PROVIDER_BADGES[p] ?? { label: p || "—", className: "bg-[var(--muted)]" };
}

/** "3m", "4h", "2d" — compact age for a sidebar row. */
function shortAge(iso: string): string {
  const mins = Math.floor((Date.now() - serverTimeMs(iso)) / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  return days < 60 ? `${days}d` : `${Math.floor(days / 30)}mo`;
}

function ProviderTag({ badge }: { badge: ProviderBadge }) {
  return (
    <span className="shrink-0 inline-flex items-center gap-1 font-mono text-[9.5px] text-[var(--muted)]" title={badge.label}>
      <span className={`inline-block w-1.5 h-1.5 rounded-full opacity-80 ${badge.className}`} />
      {badge.label}
    </span>
  );
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
  const diff = Date.now() - serverTimeMs(iso);
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
  onArchive,
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
  const [filter, setFilter] = useState<SessionFilter>("all");
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [staleOpen, setStaleOpen] = useState(false);
  const [staleMs, setStaleMs] = useState<number>(() => {
    try {
      const raw = localStorage.getItem("arz:stale-collapse-ms");
      const n = raw === null ? NaN : Number(raw);
      return Number.isFinite(n) && n >= 0 ? n : DEFAULT_STALE_COLLAPSE_MS;
    } catch { return DEFAULT_STALE_COLLAPSE_MS; }
  });
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [listMenuOpen, setListMenuOpen] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  // Optimistic titles until the parent's next poll catches up.
  const [titleOverrides, setTitleOverrides] = useState<Record<string, string>>({});
  const lastMarkedRef = useRef<string>("");
  const [archiveOverrides, setArchiveOverrides] = useState<Record<string, boolean>>({});

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

  // Mark the active session read whenever it gains messages while open.
  const active = sessions.find((s) => s.id === activeId);
  useEffect(() => {
    if (!active?.unread) return;
    const key = `${active.id}:${active.message_count}`;
    if (lastMarkedRef.current === key) return;
    lastMarkedRef.current = key;
    void api.markSessionRead(active.id).catch(() => {});
  }, [active?.id, active?.message_count, active?.unread]);

  // Drop optimistic titles once the server copy agrees.
  useEffect(() => {
    setTitleOverrides((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const s of sessions) {
        if (next[s.id] !== undefined && next[s.id] === s.title) { delete next[s.id]; changed = true; }
      }
      return changed ? next : prev;
    });
  }, [sessions]);

  useEffect(() => {
    try { localStorage.setItem("arz:stale-collapse-ms", String(staleMs)); } catch {}
  }, [staleMs]);

  // Drop optimistic archive flags once the server copy agrees.
  useEffect(() => {
    setArchiveOverrides((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const s of sessions) {
        if (next[s.id] !== undefined && next[s.id] === !!s.archived) { delete next[s.id]; changed = true; }
      }
      return changed ? next : prev;
    });
  }, [sessions]);

  const isArchived = (s: SessionSummary) => archiveOverrides[s.id] ?? !!s.archived;

  const setArchived = (id: string, archived: boolean) => {
    setArchiveOverrides((p) => ({ ...p, [id]: archived }));
    if (onArchive) onArchive(id, archived);
    else void api.setSessionArchive(id, archived).catch(() => {});
  };

  const titled = (s: SessionSummary): SessionSummary =>
    titleOverrides[s.id] !== undefined ? { ...s, title: titleOverrides[s.id] } : s;

  const commitRename = async (id: string, title: string) => {
    setRenamingId(null);
    const t = title.trim();
    const cur = sessions.find((s) => s.id === id);
    if (!t || !cur || t === (titleOverrides[id] ?? cur.title)) return;
    setTitleOverrides((p) => ({ ...p, [id]: t }));
    try { await api.renameSession(id, t); } catch (e) {
      setTitleOverrides((p) => { const n = { ...p }; delete n[id]; return n; });
      await dialog.notify({ title: "Rename failed", body: String(e), tone: "danger" });
    }
  };

  const regenerateTitle = async (id: string) => {
    try {
      const t = await api.generateTitle(id);
      if (t) setTitleOverrides((p) => ({ ...p, [id]: t }));
    } catch (e) {
      await dialog.notify({ title: "Couldn't generate a title", body: String(e), tone: "danger" });
    }
  };

  const renameFolder = async (f: FolderItem) => {
    const name = await dialog.prompt({ title: "Rename folder", defaultValue: f.name, okLabel: "Rename" });
    if (!name?.trim() || name.trim() === f.name) return;
    try { await api.updateFolder(f.id, { name: name.trim() }); await refreshFolders(); } catch (e) {
      await dialog.notify({ title: "Rename failed", body: String(e), tone: "danger" });
    }
  };

  const cleanupOld = async () => {
    setListMenuOpen(false);
    const days = Math.max(1, Math.round((staleMs || DEFAULT_STALE_COLLAPSE_MS) / 86_400_000));
    try {
      const preview = await api.cleanupSessions(days, true);
      if (preview.count === 0) {
        await dialog.notify({ title: "Nothing to clean up", body: `No unpinned sessions idle for more than ${days} days.` });
        return;
      }
      const names = preview.sessions.slice(0, 8).map((s) => `• ${s.title}`).join("\n");
      const more = preview.count > 8 ? `\n…and ${preview.count - 8} more` : "";
      const ok = await dialog.confirm({
        title: `Archive ${preview.count} idle session${preview.count === 1 ? "" : "s"}?`,
        body: <span className="whitespace-pre-line">{`Idle more than ${days} days. Pinned and running sessions are kept. You can restore them from Archived.\n\n${names}${more}`}</span>,
        okLabel: "Archive",
      });
      if (!ok) return;
      const done = await api.cleanupSessions(days, false);
      setArchiveOverrides((p) => {
        const n = { ...p };
        for (const x of done.sessions) n[x.id] = true;
        return n;
      });
    } catch (e) {
      await dialog.notify({ title: "Cleanup failed", body: String(e), tone: "danger" });
    }
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

  const live = sessions.filter((s) => !isArchived(s)).map(titled);
  const archivedSessions = sessions.filter(isArchived).map(titled);
  const byRecency = (a: SessionSummary, b: SessionSummary) =>
    serverTimeMs(b.updated_at) - serverTimeMs(a.updated_at);

  const filterCounts: Record<SessionFilter, number> = {
    all: live.length,
    unread: live.filter((s) => matchesFilter(s, "unread", activeId, pinnedIds)).length,
    running: live.filter((s) => matchesFilter(s, "running", activeId, pinnedIds)).length,
    attention: live.filter((s) => matchesFilter(s, "attention", activeId, pinnedIds)).length,
    pinned: live.filter((s) => matchesFilter(s, "pinned", activeId, pinnedIds)).length,
  };
  useEffect(() => {
    if (shouldDrainFilter(filter, filterCounts[filter])) setFilter("all");
  }, [filter, filterCounts[filter]]);

  const displayed = results
    ? results.map(titled)
    : live.filter((s) => matchesFilter(s, filter, activeId, pinnedIds)).sort(byRecency);
  // Grouped view (folders, pinned, stale fold) only when unfiltered.
  const grouped = !query && filter === "all";
  const pinnedRows = grouped ? displayed.filter((s) => pinnedIds.has(s.id)) : [];
  const unpinned = grouped ? displayed.filter((s) => !pinnedIds.has(s.id)) : displayed;
  const { fresh: unfiledFresh, stale: unfiledStale } = splitStale(
    unpinned.filter((s) => !sessionFolderMap[s.id]),
    grouped ? staleMs : 0,
    Date.now(),
    (s) => serverTimeMs(s.updated_at),
    (s) => s.id === activeId || !!s.streaming || !!s.needs_input || isUnread(s, activeId),
  );

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

  const renderRow = (s: SessionSummary, indent?: boolean) => (
    <SessionRow
      key={s.id}
      s={s}
      isActive={s.id === activeId}
      isPinned={pinnedIds.has(s.id)}
      isUnread={isUnread(s, activeId)}
      isHovered={hoveredId === s.id}
      isRenaming={renamingId === s.id}
      badge={providerBadge(s.provider, globalProvider)}
      hits={hitsBySession?.[s.id]}
      onSelect={() => onSelect(s.id)}
      onTogglePin={() => onTogglePin(s.id)}
      onDelete={() => onDelete(s.id)}
      onStartRename={() => setRenamingId(s.id)}
      onCommitRename={(t) => void commitRename(s.id, t)}
      onCancelRename={() => setRenamingId(null)}
      onOpenMenu={(x, y) => setMenu({ id: s.id, x, y })}
      onMouseEnter={() => setHoveredId(s.id)}
      onMouseLeave={() => setHoveredId(null)}
      indent={indent}
    />
  );

  const menuSession = menu ? sessions.find((s) => s.id === menu.id) : undefined;

  return (
    <>
      {menu && menuSession && (
        <SessionMenu
          x={menu.x}
          y={menu.y}
          isPinned={pinnedIds.has(menuSession.id)}
          isArchived={isArchived(menuSession)}
          folders={folders}
          currentFolderId={sessionFolderMap[menuSession.id] ?? null}
          onClose={() => setMenu(null)}
          onRename={() => setRenamingId(menuSession.id)}
          onTogglePin={() => onTogglePin(menuSession.id)}
          onRegenerateTitle={() => void regenerateTitle(menuSession.id)}
          onMove={(fid) => void moveToFolder(menuSession.id, fid)}
          onArchive={() => setArchived(menuSession.id, !isArchived(menuSession))}
          onDelete={() => onDelete(menuSession.id)}
        />
      )}
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
        <span className="flex items-center gap-1.5 text-[var(--text)] font-semibold tracking-wide text-[13px]">
          <CedarMark size={15} /> Arzeh
        </span>
        <div className="relative flex items-center gap-1">
          <button
            onClick={() => setListMenuOpen((v) => !v)}
            title="List options"
            className="w-6 h-6 flex items-center justify-center rounded text-[var(--muted)] hover:text-[var(--cedar-glow)] hover:bg-[var(--s2)]"
          >
            <MoreHorizontal size={13} />
          </button>
          {listMenuOpen && (
            <MenuShell onClose={() => setListMenuOpen(false)} className="absolute right-0 top-full mt-1">
              <div className="px-3 pt-1.5 pb-1 text-[10px] uppercase tracking-wider text-[var(--muted)]">
                Fold idle sessions after
              </div>
              {STALE_COLLAPSE_PRESETS_MS.map((ms) => (
                <MenuItem key={ms} onClick={() => { setStaleMs(ms); setListMenuOpen(false); }}>
                  <span className="w-3">{staleMs === ms && <Check size={11} />}</span>
                  {staleLabel(ms)}
                </MenuItem>
              ))}
              <div className="my-1 border-t border-[var(--hairline)]" />
              <MenuItem onClick={() => void cleanupOld()}>
                <Archive size={11} /> Archive idle sessions…
              </MenuItem>
            </MenuShell>
          )}
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
      <div className="px-3 pt-2 pb-1.5 border-b border-[var(--border)]">
        <input
          ref={searchInputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleSearchKeyDown}
          placeholder="Search… (⌘F)"
          className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-[12px] text-[var(--text)] placeholder-[var(--muted)] focus:outline-none focus:border-[var(--cedar)]"
        />
        {!query && (filter !== "all" || SESSION_FILTERS.some((f) => f.id !== "all" && filterCounts[f.id] > 0)) && (
          <div className="flex flex-wrap gap-1 mt-1.5" role="tablist" aria-label="Filter sessions">
            {SESSION_FILTERS.filter((f) => f.id === "all" || f.id === filter || filterCounts[f.id] > 0).map((f) => (
              <button
                key={f.id}
                role="tab"
                aria-selected={filter === f.id}
                onClick={() => setFilter(f.id)}
                className={[
                  "px-2 py-0.5 rounded-full text-[10.5px] border transition-colors",
                  filter === f.id
                    ? "border-[var(--cedar)] bg-[var(--cedar-dim)] text-[var(--text)]"
                    : "border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)]",
                  f.id === "attention" && filterCounts.attention > 0 && filter !== f.id ? "!text-[var(--dawn)] !border-[var(--dawn)]/50" : "",
                ].join(" ")}
              >
                {f.label}
                {f.id !== "all" && <span className="ml-1 font-mono opacity-70">{filterCounts[f.id]}</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Active session list */}
      <div className="flex-1 overflow-y-auto py-2">
        {displayed.length === 0 && (
          <p className="px-4 py-3 text-[var(--muted)] text-[13px]">
            {query ? "No results." : filter !== "all" ? "Nothing here." : "No sessions yet."}
          </p>
        )}

        {/* Pinned — always on top, outside folders */}
        {pinnedRows.length > 0 && (
          <div className="pb-1 mb-1 border-b border-[var(--hairline)]">
            <div className="px-4 pt-1 pb-0.5 text-[10px] uppercase tracking-wider text-[var(--muted)] flex items-center gap-1">
              <Pin size={9} /> Pinned
            </div>
            {pinnedRows.map((s) => renderRow(s))}
          </div>
        )}

        {/* Folders — click selects; chevron toggles open; double-click renames. Drop target. */}
        {grouped && folders.map((f) => {
          const isOpen = openFolders.has(f.id);
          const isSelected = selectedFolderId === f.id;
          const isDropTarget = dropTargetFolderId === f.id;
          const folderSessions = unpinned.filter((s) => sessionFolderMap[s.id] === f.id);
          const folderUnread = folderSessions.some((s) => isUnread(s, activeId));
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
                onDoubleClick={() => void renameFolder(f)}
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
                <span className="text-[12.5px] text-[var(--text)] truncate flex-1" title="Double-click to rename">{f.name}</span>
                {!isOpen && folderUnread && (
                  <span title="Unread inside" className="w-1.5 h-1.5 rounded-full bg-[var(--cedar-glow)]" />
                )}
                <span className="text-[10px] font-mono text-[var(--muted)]">{folderSessions.length}</span>
                <button
                  onClick={(e) => { e.stopPropagation(); void renameFolder(f); }}
                  title="Rename folder"
                  className="opacity-0 group-hover:opacity-100 w-5 h-5 flex items-center justify-center rounded text-[var(--muted)] hover:text-[var(--text)]"
                >
                  <Pencil size={10} />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); deleteFolder(f.id); }}
                  title="Delete folder"
                  className="opacity-0 group-hover:opacity-100 w-5 h-5 flex items-center justify-center rounded text-[var(--muted)] hover:text-red-400"
                >
                  <Trash2 size={10} />
                </button>
              </div>
              {isOpen && folderSessions.map((s) => renderRow(s, true))}
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
          {(grouped ? unfiledFresh : displayed).map((s) => renderRow(s))}
          {grouped && unfiledStale.length > 0 && (
            <>
              <button
                onClick={() => setStaleOpen((v) => !v)}
                className="w-full flex items-center gap-1.5 px-4 py-1.5 text-[11px] text-[var(--muted)] hover:text-[var(--text)]"
                title={`Idle more than ${staleLabel(staleMs)}`}
              >
                {staleOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                {unfiledStale.length} older
              </button>
              {staleOpen && unfiledStale.map((s) => renderRow(s))}
            </>
          )}
        </div>

      </div>

      {/* Archived — restore or delete. Hidden while searching. */}
      {archivedSessions.length > 0 && !query && (
        <div className={[
          "border-t border-[var(--border)] flex flex-col min-h-0",
          archivedOpen ? "max-h-[35%]" : "",
        ].join(" ")}>
          <button
            onClick={() => setArchivedOpen((v) => !v)}
            className="w-full flex items-center justify-between px-4 text-[11px] text-[var(--muted)] hover:text-[var(--text)] transition-colors shrink-0"
            style={{ height: "var(--shell-row-h)" }}
          >
            <span className="uppercase tracking-wider flex items-center gap-1.5">
              {archivedOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              Archived ({archivedSessions.length})
            </span>
          </button>
          {archivedOpen && (
            <div className="overflow-y-auto flex-1">
              {archivedSessions.sort(byRecency).map((s) => (
                <div key={s.id} className="group flex items-center pr-1.5 hover:bg-[var(--s2)] transition-colors">
                  <button
                    onClick={() => onSelect(s.id)}
                    className="flex-1 min-w-0 text-left px-4 py-2"
                  >
                    <div className="truncate text-[12px] text-[var(--muted)]">{s.title}</div>
                    <div className="text-[10px] text-[var(--muted)]/60 mt-0.5">
                      {s.message_count} msgs · {relativeTime(s.updated_at)}
                    </div>
                  </button>
                  <button
                    onClick={() => setArchived(s.id, false)}
                    title="Restore"
                    className="opacity-0 group-hover:opacity-100 w-6 h-6 flex items-center justify-center rounded text-[var(--muted)] hover:text-[var(--cedar-glow)]"
                  >
                    <ArchiveRestore size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* History — anchored above footer, collapsible. Hidden while searching. */}
      {history.length > 0 && !query && (
        <div className={[
          "border-t border-[var(--border)] flex flex-col min-h-0",
          historyOpen ? "max-h-[40%]" : "",
        ].join(" ")}>
          <button
            onClick={() => setHistoryOpen((v) => !v)}
            className="w-full flex items-center justify-between px-4 text-[11px] text-[var(--muted)] hover:text-[var(--text)] transition-colors shrink-0"
            style={{ height: "var(--shell-row-h)" }}
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
                        <ProviderTag badge={badge} />
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

// ── Menus ─────────────────────────────────────────────────────
function MenuShell({
  children,
  onClose,
  className = "",
  style,
}: {
  children: React.ReactNode;
  onClose: () => void;
  className?: string;
  style?: React.CSSProperties;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);
  return (
    <div
      ref={ref}
      role="menu"
      style={style}
      className={[
        "z-50 min-w-[190px] rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-xl py-1",
        className,
      ].join(" ")}
    >
      {children}
    </div>
  );
}

function MenuItem({
  children,
  onClick,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className={[
        "w-full flex items-center gap-2 px-3 py-1.5 text-left text-[12px] transition-colors",
        danger ? "text-red-400 hover:bg-red-400/10" : "text-[var(--text)] hover:bg-[var(--s2)]",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

function SessionMenu({
  x,
  y,
  isPinned,
  isArchived,
  folders,
  currentFolderId,
  onClose,
  onRename,
  onTogglePin,
  onRegenerateTitle,
  onMove,
  onArchive,
  onDelete,
}: {
  x: number;
  y: number;
  isPinned: boolean;
  isArchived: boolean;
  folders: FolderItem[];
  currentFolderId: string | null;
  onClose: () => void;
  onRename: () => void;
  onTogglePin: () => void;
  onRegenerateTitle: () => void;
  onMove: (folderId: string | null) => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const [moveOpen, setMoveOpen] = useState(false);
  const act = (fn: () => void) => () => { onClose(); fn(); };
  // Keep the menu on-screen near the bottom/right edges.
  const left = Math.min(x, window.innerWidth - 210);
  const top = Math.min(y, window.innerHeight - (moveOpen ? 320 : 230));
  return (
    <MenuShell onClose={onClose} className="fixed" style={{ left, top }}>
      <MenuItem onClick={act(onRename)}><Pencil size={11} /> Rename</MenuItem>
      <MenuItem onClick={act(onRegenerateTitle)}><Sparkles size={11} /> Regenerate title</MenuItem>
      <MenuItem onClick={act(onTogglePin)}>
        {isPinned ? <PinOff size={11} /> : <Pin size={11} />} {isPinned ? "Unpin" : "Pin to top"}
      </MenuItem>
      {folders.length > 0 && (
        <>
          <MenuItem onClick={() => setMoveOpen((v) => !v)}>
            <FolderInput size={11} /> Move to folder
            <ChevronRight size={11} className={["ml-auto transition-transform", moveOpen ? "rotate-90" : ""].join(" ")} />
          </MenuItem>
          {moveOpen && (
            <div className="pl-4">
              {currentFolderId && (
                <MenuItem onClick={act(() => onMove(null))}><X size={11} /> No folder</MenuItem>
              )}
              {folders.filter((f) => f.id !== currentFolderId).map((f) => (
                <MenuItem key={f.id} onClick={act(() => onMove(f.id))}>
                  {renderFolderIcon(f.icon, 11)} <span className="truncate">{f.name}</span>
                </MenuItem>
              ))}
            </div>
          )}
        </>
      )}
      <div className="my-1 border-t border-[var(--hairline)]" />
      <MenuItem onClick={act(onArchive)}>
        {isArchived ? <ArchiveRestore size={11} /> : <Archive size={11} />} {isArchived ? "Restore" : "Archive"}
      </MenuItem>
      <MenuItem danger onClick={act(onDelete)}><X size={11} /> Close session</MenuItem>
    </MenuShell>
  );
}

// ── Single session row ────────────────────────────────────────
function SessionRow({
  s,
  isActive,
  isPinned,
  isUnread,
  isHovered,
  isRenaming,
  badge,
  hits,
  indent,
  onSelect,
  onTogglePin,
  onDelete,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onOpenMenu,
  onMouseEnter,
  onMouseLeave,
}: {
  s: SessionSummary;
  isActive: boolean;
  isPinned: boolean;
  isUnread: boolean;
  isHovered: boolean;
  isRenaming: boolean;
  badge: ProviderBadge;
  hits?: SearchHit[];
  indent?: boolean;
  onSelect: () => void;
  onTogglePin: () => void;
  onDelete: () => void;
  onStartRename: () => void;
  onCommitRename: (title: string) => void;
  onCancelRename: () => void;
  onOpenMenu: (x: number, y: number) => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}) {
  const [draft, setDraft] = useState(s.title);
  useEffect(() => { if (isRenaming) setDraft(s.title); }, [isRenaming]);
  return (
    <div
      draggable={!isRenaming}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/arz-session", s.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      onContextMenu={(e) => { e.preventDefault(); onOpenMenu(e.clientX, e.clientY); }}
      className={[
        "group relative flex flex-col pr-1 transition-colors",
        isActive ? "bg-[var(--user-bg)]" : "hover:bg-[var(--s2)]",
        indent ? "pl-3" : "",
        isRenaming ? "" : "cursor-grab active:cursor-grabbing",
      ].join(" ")}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {isActive && <span aria-hidden className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-r bg-[var(--cedar)]" />}
      <div className="flex items-center">
        {isRenaming ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            onBlur={() => onCommitRename(draft)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); onCommitRename(draft); }
              if (e.key === "Escape") { e.preventDefault(); onCancelRename(); }
            }}
            aria-label="Session title"
            className="flex-1 mx-2 my-1.5 bg-[var(--bg)] border border-[var(--cedar)] rounded px-2 py-1 text-[13px] text-[var(--text)] focus:outline-none"
          />
        ) : (
        <button
          onClick={onSelect}
          onDoubleClick={(e) => { e.preventDefault(); onStartRename(); }}
          title={s.needs_input ? "Waiting for your approval" : undefined}
          className={[
            "flex-1 text-left px-4 py-2.5 text-[13px] truncate flex items-center gap-1.5",
            isActive || isUnread ? "text-[var(--text)]" : "text-[var(--muted)] group-hover:text-[var(--text)]",
          ].join(" ")}
        >
          {isPinned && !isUnread && !s.streaming && !s.needs_input && (
            <Pin size={10} className="shrink-0 text-[var(--cedar-glow)] -rotate-45" aria-label="Pinned" />
          )}
          {s.needs_input ? (
            <span className="shrink-0 inline-block w-1.5 h-1.5 rounded-full bg-[var(--dawn)]" aria-label="Needs you" />
          ) : s.streaming ? (
            <span
              title="Generating reply…"
              className="shrink-0 inline-block w-1.5 h-1.5 rounded-full bg-[var(--cedar)] animate-pulse"
            />
          ) : isUnread ? (
            <span className="shrink-0 inline-block w-1.5 h-1.5 rounded-full bg-[var(--cedar-glow)]" aria-label="Unread" />
          ) : null}
          <span className={["truncate flex-1", isUnread ? "font-semibold" : ""].join(" ")}>{s.title}</span>
          {hits && hits.length > 1 && (
            <span className="shrink-0 text-[9px] text-[var(--cedar-glow)] font-mono">{hits.length}</span>
          )}
          {!isHovered && (
            <span className="shrink-0 flex items-center gap-1.5">
              <ProviderTag badge={badge} />
              <span className="font-mono text-[9.5px] text-[var(--muted)]/80 w-6 text-right">{shortAge(s.updated_at)}</span>
            </span>
          )}
        </button>
        )}

        {isHovered && !isRenaming && (
          <div className="flex items-center gap-0.5 shrink-0 pr-1">
            <button
              onClick={(e) => { e.stopPropagation(); onTogglePin(); }}
              title={isPinned ? "Unpin" : "Pin to top"}
              className="w-6 h-6 flex items-center justify-center rounded text-[11px] text-[var(--muted)] hover:text-[var(--cedar-glow)] hover:bg-[var(--s2)] transition-colors"
            >
              {isPinned ? <PinOff size={12} /> : <Pin size={12} />}
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                const r = e.currentTarget.getBoundingClientRect();
                onOpenMenu(r.left, r.bottom + 4);
              }}
              title="More actions"
              className="w-6 h-6 flex items-center justify-center rounded text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--s2)] transition-colors"
            >
              <MoreHorizontal size={12} />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(); }}
              title="Close session"
              className="w-6 h-6 flex items-center justify-center rounded text-[var(--muted)] hover:text-[var(--ember)] hover:bg-[var(--s2)] transition-colors"
            >
              <X size={12} />
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
