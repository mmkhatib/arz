import { useEffect, useRef, useState } from "react";
import { api } from "@/api/client";
import type { SessionSummary } from "@/api/client";

interface Props {
  sessions: SessionSummary[];
  activeId: string | null;
  pinnedIds: Set<string>;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onDelete: (id: string) => void;
  onTogglePin: (id: string) => void;
  onSettings: () => void;
}

export default function SessionList({
  sessions,
  activeId,
  pinnedIds,
  onSelect,
  onCreate,
  onDelete,
  onTogglePin,
  onSettings,
}: Props) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SessionSummary[] | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!query.trim()) {
      setResults(null);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      try {
        const data = await api.searchSessions(query.trim());
        setResults(data);
      } catch {
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
    }
  };

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
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleSearchKeyDown}
          placeholder="Search…"
          className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-[12px] text-[var(--text)] placeholder-[var(--muted)] focus:outline-none focus:border-[var(--cedar)]"
        />
      </div>

      {/* Session list */}
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
          return (
            <div
              key={s.id}
              className={[
                "group relative flex items-center pr-1 transition-colors",
                isActive
                  ? "bg-[var(--user-bg)]"
                  : "hover:bg-[var(--border)]",
              ].join(" ")}
              onMouseEnter={() => setHoveredId(s.id)}
              onMouseLeave={() => setHoveredId(null)}
            >
              <button
                onClick={() => onSelect(s.id)}
                className={[
                  "flex-1 text-left px-4 py-2.5 text-[13px] truncate",
                  isActive ? "text-[var(--text)]" : "text-[var(--muted)] group-hover:text-[var(--text)]",
                ].join(" ")}
              >
                {isPinned && (
                  <span className="mr-1 text-[10px] text-[var(--accent)]">●</span>
                )}
                {s.title}
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
          );
        })}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--border)] text-[11px] text-[var(--muted)]">
        <span>arz v0.1.0</span>
        <button
          onClick={onSettings}
          title="Settings"
          className="w-6 h-6 flex items-center justify-center rounded hover:bg-[var(--border)] hover:text-[var(--text)] transition-colors"
        >
          ⚙
        </button>
      </div>
    </aside>
  );
}
