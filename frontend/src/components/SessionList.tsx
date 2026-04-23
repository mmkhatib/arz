import type { SessionSummary } from "@/api/client";

interface Props {
  sessions: SessionSummary[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
}

export default function SessionList({ sessions, activeId, onSelect, onCreate }: Props) {
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

      {/* Session list */}
      <div className="flex-1 overflow-y-auto py-2">
        {sessions.length === 0 && (
          <p className="px-4 py-3 text-[var(--muted)] text-[13px]">No sessions yet.</p>
        )}
        {sessions.map((s) => (
          <button
            key={s.id}
            onClick={() => onSelect(s.id)}
            className={[
              "w-full text-left px-4 py-2.5 text-[13px] truncate transition-colors",
              s.id === activeId
                ? "bg-[var(--user-bg)] text-[var(--text)]"
                : "text-[var(--muted)] hover:bg-[var(--border)] hover:text-[var(--text)]",
            ].join(" ")}
          >
            {s.title}
          </button>
        ))}
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-[var(--border)] text-[11px] text-[var(--muted)]">
        arz v0.1.0
      </div>
    </aside>
  );
}
