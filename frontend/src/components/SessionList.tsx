import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Trash2, Palette } from "lucide-react";
import { api } from "@/api/client";
import type { SearchHit, SessionSummary } from "@/api/client";

const SESSION_COLORS = ["#2d6a4f", "#5b6a2d", "#6a2d5b", "#2d5b6a", "#6a4f2d", "#4f2d6a"];

interface ProviderBadge {
  label: string;
  className: string;
}

function providerBadge(provider: string | null | undefined, globalProvider: string): ProviderBadge {
  const p = provider || globalProvider;
  if (p === "kiro-cli") return { label: "Kiro", className: "bg-blue-900/30 text-blue-400" };
  if (p === "anthropic") return { label: "API", className: "bg-purple-900/30 text-purple-400" };
  if (p === "codex") return { label: "Codex", className: "bg-green-900/30 text-green-400" };
  return { label: "Claude", className: "bg-orange-900/40 text-orange-300" };
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
  const [colorPickerFor, setColorPickerFor] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SessionSummary[] | null>(null);
  const [searchHits, setSearchHits] = useState<SearchHit[] | null>(null);
  const [colorMap, setColorMap] = useState<Record<string, number | null>>({});
  const [history, setHistory] = useState<SessionSummary[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyHoveredId, setHistoryHoveredId] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Refetch history only when a session is removed from the active list
  // (the typical event that grows history). New sessions don't move into
  // history, and rerendering shouldn't refetch — coupling to the array
  // reference would refire on every state update for zero benefit.
  const activeSessionCount = sessions.length;
  useEffect(() => {
    api.fetchHistory().then(setHistory).catch(() => {});
  }, [activeSessionCount]);

  const handleSetColor = (id: string, color: number | null) => {
    setColorMap((prev) => ({ ...prev, [id]: color }));
    api.setSessionColor(id, color).catch(() => {});
  };

  const getColor = (session: SessionSummary): number | null => {
    if (session.id in colorMap) return colorMap[session.id];
    return session.color ?? null;
  };

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

  const displayed = results ?? [...sessions].sort((a, b) => {
    const ap = pinnedIds.has(a.id) ? 1 : 0;
    const bp = pinnedIds.has(b.id) ? 1 : 0;
    if (ap !== bp) return bp - ap;
    return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
  });

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
          "flex flex-col bg-[var(--surface)] border-r border-[var(--border)]",
          "md:static md:flex md:w-56 md:shrink-0",
          "fixed inset-y-0 left-0 z-40 w-64 transform transition-transform duration-200",
          mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0",
        ].join(" ")}
      >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
        <span className="text-[var(--accent)] font-semibold tracking-wide text-[13px]">
          🌲 Arzeh
        </span>
        <button
          onClick={onCreate}
          title="New session"
          className="text-[var(--muted)] hover:text-[var(--text)] text-lg leading-none"
        >
          +
        </button>
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
        {displayed.map((s) => {
          const isActive = s.id === activeId;
          const isPinned = pinnedIds.has(s.id);
          const isHovered = hoveredId === s.id;
          const colorIdx = getColor(s);
          const badge = providerBadge(s.provider, globalProvider);
          const hits = hitsBySession?.[s.id];
          return (
            <div
              key={s.id}
              className={[
                "group relative flex flex-col pr-1 transition-colors",
                isActive ? "bg-[var(--user-bg)]" : "hover:bg-[var(--border)]",
              ].join(" ")}
              style={colorIdx != null && !isActive ? { backgroundColor: SESSION_COLORS[colorIdx] + "22" } : undefined}
              onMouseEnter={() => setHoveredId(s.id)}
              onMouseLeave={() => setHoveredId(null)}
            >
              <div className="flex items-center">
                <button
                  onClick={() => onSelect(s.id)}
                  className={[
                    "flex-1 text-left px-4 py-2.5 text-[13px] truncate flex items-center gap-1.5",
                    isActive ? "text-[var(--text)]" : "text-[var(--muted)] group-hover:text-[var(--text)]",
                  ].join(" ")}
                >
                  {isPinned && (
                    <span className="text-[10px] text-[var(--accent)]">●</span>
                  )}
                  <span className="truncate flex-1">{s.title}</span>
                  {hits && hits.length > 1 && (
                    <span className="shrink-0 text-[9px] text-[var(--accent)] font-mono">
                      {hits.length}
                    </span>
                  )}
                  <span className={[
                    "shrink-0 text-[9px] px-1.5 py-0.5 rounded font-medium",
                    badge.className,
                  ].join(" ")}>
                    {badge.label}
                  </span>
                </button>

                {/* Action buttons — visible on hover */}
                {isHovered && (
                  <div className="flex items-center gap-0.5 shrink-0 pr-1">
                    <button
                      onClick={(e) => { e.stopPropagation(); onTogglePin(s.id); }}
                      title={isPinned ? "Unpin" : "Pin to top"}
                      className="w-6 h-6 flex items-center justify-center rounded text-[11px] text-[var(--muted)] hover:text-[var(--accent)] hover:bg-[var(--border)] transition-colors"
                    >
                      {isPinned ? "★" : "☆"}
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setColorPickerFor((prev) => (prev === s.id ? null : s.id));
                      }}
                      title="Color"
                      className="w-6 h-6 flex items-center justify-center rounded text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--border)] transition-colors"
                    >
                      <Palette size={11} />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); onDelete(s.id); }}
                      title="Close session"
                      className="w-6 h-6 flex items-center justify-center rounded text-[11px] text-[var(--muted)] hover:text-red-400 hover:bg-[var(--border)] transition-colors"
                    >
                      ×
                    </button>
                  </div>
                )}
              </div>

              {hits && hits[0] && (
                <div
                  onClick={() => onSelect(s.id)}
                  className="px-4 pb-1.5 -mt-1 text-[11px] text-[var(--muted)] truncate cursor-pointer"
                  title={`${hits[0].role}: ${hits[0].snippet.replace(/<\/?mark>/g, "")}`}
                >
                  {renderSnippet(hits[0].snippet)}
                </div>
              )}

              {colorPickerFor === s.id && (
                <div className="flex items-center gap-1 px-4 pb-1.5">
                  {[0, 1, 2, 3, 4, 5].map((idx) => (
                    <button
                      key={idx}
                      onClick={(e) => {
                        e.stopPropagation();
                        const newColor = colorIdx === idx ? null : idx;
                        handleSetColor(s.id, newColor);
                      }}
                      title={`Color ${idx + 1}`}
                      className={[
                        "w-3.5 h-3.5 rounded-full transition-opacity",
                        colorIdx === idx ? "opacity-100 ring-1 ring-[var(--text)]" : "opacity-70 hover:opacity-100",
                      ].join(" ")}
                      style={{ backgroundColor: SESSION_COLORS[idx] }}
                    />
                  ))}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleSetColor(s.id, null);
                      setColorPickerFor(null);
                    }}
                    title="Clear color"
                    className="w-3.5 h-3.5 flex items-center justify-center text-[10px] text-[var(--muted)] hover:text-[var(--text)] transition-colors"
                  >
                    ✕
                  </button>
                </div>
              )}
            </div>
          );
        })}

      </div>

      {/* History — anchored above footer, collapsible. Hidden while searching. */}
      {history.length > 0 && !query && (
        <div className={[
          "border-t border-[var(--border)] flex flex-col min-h-0",
          historyOpen ? "max-h-[40%]" : "",
        ].join(" ")}>
          <button
            onClick={() => setHistoryOpen((v) => !v)}
            className="w-full flex items-center justify-between px-4 py-2 text-[11px] text-[var(--muted)] hover:text-[var(--text)] transition-colors shrink-0"
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
                          onClick={() => {
                            if (confirm(`Permanently delete "${s.title}"? This cannot be undone.`)) {
                              api.permanentDeleteSession(s.id)
                                .then(() => setHistory((prev) => prev.filter((h) => h.id !== s.id)))
                                .catch((e) => alert(`Delete failed: ${e}`));
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
      </aside>
    </>
  );
}
