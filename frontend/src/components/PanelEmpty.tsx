// Shared empty state for side-panel views: an icon tile, a title that
// says what this view is for, a line on what will make it fill up, and
// an optional action. Replaces the near-invisible "No X yet" glyphs.

import type { ComponentType, ReactNode } from "react";

export default function PanelEmpty({
  icon: Icon,
  title,
  hint,
  action,
}: {
  icon: ComponentType<{ size?: number; className?: string }>;
  title: string;
  hint?: ReactNode;
  action?: { label: string; onClick: () => void; icon?: ComponentType<{ size?: number }> };
}) {
  const ActionIcon = action?.icon;
  return (
    <div className="flex flex-col items-center justify-center text-center gap-2.5 px-8 py-12 h-full min-h-[220px]">
      <div className="w-11 h-11 rounded-xl flex items-center justify-center bg-[var(--cedar-dim)] border border-[var(--cedar-line)] text-[var(--cedar-glow)]">
        <Icon size={18} />
      </div>
      <div className="text-[13px] font-medium text-[var(--text2)]">{title}</div>
      {hint && <div className="text-[11.5px] leading-relaxed text-[var(--muted)] max-w-[280px]">{hint}</div>}
      {action && (
        <button
          onClick={action.onClick}
          className="mt-1.5 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-[var(--border)] text-[11.5px] text-[var(--text2)] hover:text-[var(--text)] hover:border-[var(--cedar-line)] hover:bg-[var(--s2)] transition-colors"
        >
          {ActionIcon && <ActionIcon size={12} />}
          {action.label}
        </button>
      )}
    </div>
  );
}

/** Quiet loading row for panel views — a pulsing dot and a label. */
export function PanelLoading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 px-3 py-4 text-[11.5px] text-[var(--muted)]">
      <span className="w-1.5 h-1.5 rounded-full bg-[var(--cedar-glow)] animate-pulse" />
      {label}
    </div>
  );
}
