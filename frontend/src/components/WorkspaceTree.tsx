// Lazy workspace file tree for the side panel's Files tab.
//
// Each directory is fetched on first expand (one level per call), entries
// carry git status badges, and a search box switches the view to grep
// results across the workspace. Hidden/vendor dirs (dotfiles,
// node_modules, …) are tucked away behind a toggle.

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Eye, EyeOff, Folder, FolderOpen, RefreshCw, Search } from "lucide-react";
import { api, type GrepHit, type WorkspaceEntry } from "@/api/client";
import { GitBadge } from "./ChangesView";

interface Props {
  sessionId: string;
  onOpen: (path: string) => void;
  fileIcon: (path: string) => React.ComponentType<{ size?: number; className?: string }>;
}

export default function WorkspaceTree({ sessionId, onOpen, fileIcon }: Props) {
  const [dirs, setDirs] = useState<Record<string, WorkspaceEntry[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [root, setRoot] = useState<string>("");
  const [showHidden, setShowHidden] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<GrepHit[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [searching, setSearching] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadDir = useCallback(
    (rel: string) =>
      api
        .fetchWorkspaceTree(sessionId, rel)
        .then((t) => {
          setDirs((prev) => ({ ...prev, [rel]: t.entries }));
          if (rel === "") setRoot(t.root);
        })
        .catch(() => setDirs((prev) => ({ ...prev, [rel]: [] }))),
    [sessionId],
  );

  useEffect(() => {
    setDirs({});
    setExpanded(new Set());
    void loadDir("");
  }, [sessionId, loadDir]);

  const refresh = () => {
    void loadDir("");
    for (const rel of expanded) void loadDir(rel);
  };

  const toggle = (rel: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(rel)) next.delete(rel);
      else {
        next.add(rel);
        if (!dirs[rel]) void loadDir(rel);
      }
      return next;
    });
  };

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    const q = query.trim();
    if (!q) { setHits(null); setSearching(false); return; }
    setSearching(true);
    debounce.current = setTimeout(() => {
      api
        .grepWorkspace(sessionId, q)
        .then((r) => { setHits(r.hits); setTruncated(r.truncated); })
        .catch(() => { setHits([]); setTruncated(false); })
        .finally(() => setSearching(false));
    }, 300);
    return () => { if (debounce.current) clearTimeout(debounce.current); };
  }, [query, sessionId]);

  const renderLevel = (rel: string, depth: number): React.ReactNode => {
    const entries = dirs[rel];
    if (!entries) {
      return <div className="text-[11px] text-[var(--muted)] py-1" style={{ paddingLeft: 12 + depth * 12 }}>Loading…</div>;
    }
    const visible = showHidden ? entries : entries.filter((e) => !e.hidden);
    if (visible.length === 0 && depth === 0) {
      return <div className="px-3 py-3 text-[11px] text-[var(--muted)]">Empty workspace.</div>;
    }
    return visible.map((e) => {
      const isOpen = expanded.has(e.rel_path);
      const Icon = e.is_dir ? (isOpen ? FolderOpen : Folder) : fileIcon(e.path);
      return (
        <div key={e.rel_path}>
          <button
            onClick={() => (e.is_dir ? toggle(e.rel_path) : onOpen(e.path))}
            title={e.path}
            className={[
              "w-full flex items-center gap-1.5 pr-2 py-[3px] text-left hover:bg-[var(--s2)] transition-colors",
              e.hidden ? "opacity-60" : "",
            ].join(" ")}
            style={{ paddingLeft: 8 + depth * 12 }}
          >
            <span className="w-3 shrink-0 text-[var(--muted)]">
              {e.is_dir ? (isOpen ? <ChevronDown size={10} /> : <ChevronRight size={10} />) : null}
            </span>
            <Icon size={12} className={e.is_dir ? "text-[var(--cedar-glow)] shrink-0" : "text-[var(--muted)] shrink-0"} />
            <span
              className="text-[11.5px] font-mono truncate flex-1"
              style={{ color: e.status ? "var(--text)" : "var(--text2)" }}
            >
              {e.name}
            </span>
            <GitBadge status={e.status} />
          </button>
          {e.is_dir && isOpen && renderLevel(e.rel_path, depth + 1)}
        </div>
      );
    });
  };

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 border-b border-[var(--hairline)]">
        <div className="flex-1 flex items-center gap-1.5 bg-[var(--bg)] border border-[var(--border)] rounded px-2 py-1 focus-within:border-[var(--cedar-line)]">
          <Search size={11} className="text-[var(--muted)] shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") setQuery(""); }}
            placeholder="Search workspace…"
            className="flex-1 min-w-0 bg-transparent text-[11px] text-[var(--text)] focus:outline-none"
          />
        </div>
        <button
          onClick={() => setShowHidden((v) => !v)}
          title={showHidden ? "Hide dotfiles & vendor dirs" : "Show dotfiles & vendor dirs"}
          className="w-6 h-6 flex items-center justify-center rounded text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--s2)]"
        >
          {showHidden ? <EyeOff size={11} /> : <Eye size={11} />}
        </button>
        <button
          onClick={refresh}
          title="Refresh tree"
          className="w-6 h-6 flex items-center justify-center rounded text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--s2)]"
        >
          <RefreshCw size={11} />
        </button>
      </div>
      {root && !hits && (
        <div className="px-3 pt-1.5 pb-0.5 text-[9.5px] font-mono text-[var(--muted)] truncate" title={root}>
          {root}
        </div>
      )}
      <div className="py-1">
        {hits ? (
          <GrepResults hits={hits} truncated={truncated} searching={searching} onOpen={onOpen} />
        ) : (
          renderLevel("", 0)
        )}
      </div>
    </div>
  );
}

function GrepResults({
  hits,
  truncated,
  searching,
  onOpen,
}: {
  hits: GrepHit[];
  truncated: boolean;
  searching: boolean;
  onOpen: (path: string) => void;
}) {
  if (searching && hits.length === 0) {
    return <div className="px-3 py-3 text-[11px] text-[var(--muted)]">Searching…</div>;
  }
  if (hits.length === 0) {
    return <div className="px-3 py-3 text-[11px] text-[var(--muted)]">No matches.</div>;
  }
  // Group consecutive hits by file — results arrive file-ordered.
  const groups: { rel: string; path: string; hits: GrepHit[] }[] = [];
  for (const h of hits) {
    const last = groups[groups.length - 1];
    if (last && last.path === h.path) last.hits.push(h);
    else groups.push({ rel: h.rel_path, path: h.path, hits: [h] });
  }
  return (
    <div>
      {groups.map((g) => (
        <div key={g.path} className="mb-1">
          <button
            onClick={() => onOpen(g.path)}
            className="w-full text-left px-3 py-1 text-[11px] font-mono text-[var(--cedar-glow)] truncate hover:bg-[var(--s2)]"
            title={g.path}
          >
            {g.rel} <span className="text-[var(--muted)]">({g.hits.length})</span>
          </button>
          {g.hits.map((h) => (
            <button
              key={h.line}
              onClick={() => onOpen(h.path)}
              className="w-full text-left flex gap-2 pl-5 pr-2 py-[2px] hover:bg-[var(--s2)]"
            >
              <span className="shrink-0 w-8 text-right text-[10px] font-mono text-[var(--muted)]">{h.line}</span>
              <span className="text-[10.5px] font-mono text-[var(--text2)] truncate">{h.text.trim()}</span>
            </button>
          ))}
        </div>
      ))}
      {truncated && (
        <div className="px-3 py-2 text-[10px] text-[var(--muted)]">Results truncated — refine the search.</div>
      )}
    </div>
  );
}
