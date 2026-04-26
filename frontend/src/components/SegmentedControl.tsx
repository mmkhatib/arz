import type { ReactNode } from "react";

interface Segment<T extends string> {
  key: T;
  label: string;
  icon?: ReactNode;
  count?: number;
}

interface Props<T extends string> {
  segments: Segment<T>[];
  value: T;
  onChange: (v: T) => void;
}

export default function SegmentedControl<T extends string>({ segments, value, onChange }: Props<T>) {
  return (
    <div className="flex items-center gap-0.5 bg-[var(--bg)] rounded-lg p-0.5 border border-[var(--border)]">
      {segments.map((seg) => {
        const active = seg.key === value;
        return (
          <button
            key={seg.key}
            onClick={() => onChange(seg.key)}
            className={[
              "flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors whitespace-nowrap",
              active
                ? "bg-[var(--surface)] text-[var(--text)] shadow-sm"
                : "text-[var(--muted)] hover:text-[var(--text)]",
            ].join(" ")}
          >
            {seg.icon}
            {seg.label}
            {seg.count !== undefined && seg.count > 0 && (
              <span className={["rounded-full px-1 min-w-[16px] text-center text-[10px]", active ? "bg-[var(--cedar)]/20 text-[var(--cedar)]" : "bg-[var(--border)] text-[var(--muted)]"].join(" ")}>
                {seg.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
