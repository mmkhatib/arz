import { useEffect, useRef, useState } from "react";
import { api } from "@/api/client";
import type { SearchHit, SessionSummary } from "@/api/client";

const SESSION_COLORS = ["#2d6a4f", "#5b6a2d", "#6a2d5b", "#2d5b6a", "#6a4f2d", "#4f2d6a"];

function providerBadge(provider: string | null | undefined, globalProvider: string): string {
  const p = provider || globalProvider;
  if (p === "kiro-cli") return "Kiro";
  return "CC";
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
  onSettings: () => void;
  onMemory?: () => void;
  onSchedule?: () => void;
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
  onSettings,
  onMemory,
  onSchedule,
  onResume,
}: Props) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SessionSummary[] | null>(null);
  const [searchHits, setSearchHits] = useState<SearchHit[] | null>(null);
  const [colorMap, setColorMap] = useState<Record<string, number | null>>({});
  const [history, setHistory] = useState<SessionSummary[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyHoveredId, setHistoryHoveredId] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    api.fetchHistory().then(setHistory).catch(() => {});
  }, [sessions]); // refresh when active list changes (e.g. after delete)

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
    <aside className="flex flex-col w-56 shrink-0 border-r border-[var(--border)] bg-[var(--surface)]">
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
                    "shrink-0 text-[9px] px-1 py-0.5 rounded font-mono",
                    badge === "Kiro"
                      ? "bg-blue-900/30 text-blue-400"
                      : "bg-[var(--cedar)]/20 text-[var(--cedar)]",
                  ].join(" ")}>
                    {badge}
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

              {isHovered && (
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
                        "w-3 h-3 rounded-full transition-opacity",
                        colorIdx === idx ? "opacity-100 ring-1 ring-[var(--text)]" : "opacity-60 hover:opacity-100",
                      ].join(" ")}
                      style={{ backgroundColor: SESSION_COLORS[idx] }}
                    />
                  ))}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleSetColor(s.id, null);
                    }}
                    title="Clear color"
                    className="w-3 h-3 flex items-center justify-center text-[10px] text-[var(--muted)] hover:text-[var(--text)] transition-colors"
                  >
                    ✕
                  </button>
                </div>
              )}
            </div>
          );
        })}

        {/* History section */}
        {history.length > 0 && !query && (
          <div className="mt-2">
            <button
              onClick={() => setHistoryOpen((v) => !v)}
              className="w-full flex items-center justify-between px-4 py-1.5 text-[11px] text-[var(--muted)] hover:text-[var(--text)] transition-colors border-t border-[var(--border)]"
            >
              <span className="uppercase tracking-wider">History ({history.length})</span>
              <span>{historyOpen ? "▴" : "▾"}</span>
            </button>

            {historyOpen && history.map((s) => {
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
                        "shrink-0 text-[9px] px-1 py-0.5 rounded font-mono",
                        badge === "Kiro"
                          ? "bg-blue-900/30 text-blue-400"
                          : "bg-[var(--cedar)]/20 text-[var(--cedar)]",
                      ].join(" ")}>
                        {badge}
                      </span>
                    </div>
                    <div className="text-[10px] text-[var(--muted)]/60 mt-0.5">
                      {s.message_count} msgs · {relativeTime(s.updated_at)}
                    </div>
                  </div>
                  {isHovered && (
                    <button
                      onClick={() => onResume(s)}
                      title="Resume session"
                      className="shrink-0 mr-2 px-2 py-1 rounded-lg text-[10px] text-[var(--cedar)] border border-[var(--cedar)]/30 hover:bg-[var(--cedar)]/10 transition-colors"
                    >
                      Resume
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--border)] text-[11px] text-[var(--muted)]">
        <span>arz v0.1.0</span>
        <div className="flex items-center gap-1">
          {onMemory && (
            <button
              onClick={onMemory}
              title="Memory"
              className="w-6 h-6 flex items-center justify-center rounded hover:bg-[var(--border)] hover:text-[var(--text)] transition-colors"
            >
              🧠
            </button>
          )}
          {onSchedule && (
            <button
              onClick={onSchedule}
              title="Scheduled tasks"
              className="w-6 h-6 flex items-center justify-center rounded hover:bg-[var(--border)] hover:text-[var(--text)] transition-colors"
            >
              ⏱
            </button>
          )}
          <button
            onClick={onSettings}
            title="Settings"
            className="w-6 h-6 flex items-center justify-center rounded hover:bg-[var(--border)] hover:text-[var(--text)] transition-colors"
          >
            ⚙
          </button>
        </div>
      </div>
    </aside>
  );
}
