// Vertical secondary navigation column used by pages that have multiple
// sub-sections (Memory, Capabilities, Autonomy, Settings, Analytics).
//
// Pairs with a flex row layout:
//
//   <div className="flex h-full">
//     <SecondaryNav items={...} value={tab} onChange={setTab} />
//     <div className="flex-1 overflow-hidden">{content}</div>
//   </div>
//
// Lives next to the primary NavBar (which is left-most in Layout.tsx).

import type { ReactNode } from "react";

export interface SecondaryNavItem<T extends string> {
  id: T;
  label: string;
  icon?: ReactNode;
  badge?: number | string;
  disabled?: boolean;
  hint?: string;
}

interface Props<T extends string> {
  title?: string;
  items: SecondaryNavItem<T>[];
  value: T;
  onChange: (id: T) => void;
  /** Optional footer slot for actions (refresh, settings shortcut, etc). */
  footer?: ReactNode;
  /** Width class — defaults to w-48; use "w-44" or similar for tighter pages. */
  widthClass?: string;
}

export default function SecondaryNav<T extends string>({
  title,
  items,
  value,
  onChange,
  footer,
  widthClass = "w-48",
}: Props<T>) {
  return (
    <nav
      className={[
        "shrink-0 flex flex-col bg-[var(--surface)]/40 border-r border-[var(--border)]",
        widthClass,
        // On phones the secondary nav becomes a horizontal scroll strip
        // so it doesn't eat the chat area. Tablets+ get the vertical column.
        "max-md:!w-full max-md:!h-auto max-md:flex-row max-md:overflow-x-auto max-md:border-r-0 max-md:border-b",
      ].join(" ")}
    >
      {title && (
        <div className="px-3 pt-3 pb-2 text-[10px] uppercase tracking-wider text-[var(--muted)] font-medium max-md:hidden">
          {title}
        </div>
      )}
      <div className="flex flex-col gap-0.5 p-1.5 flex-1 max-md:flex-row">
        {items.map((it) => (
          <button
            key={it.id}
            onClick={() => !it.disabled && onChange(it.id)}
            disabled={it.disabled}
            title={it.hint || it.label}
            className={[
              "group/sn flex items-center gap-2 rounded-md text-[13px] py-2 px-2.5 text-left transition-colors max-md:shrink-0",
              it.disabled
                ? "text-[var(--muted)]/40 cursor-not-allowed"
                : it.id === value
                ? "bg-[var(--cedar)]/15 text-[var(--text)]"
                : "text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--bg)]",
            ].join(" ")}
          >
            {it.icon && (
              <span
                className={[
                  "w-4 h-4 flex items-center justify-center shrink-0",
                  it.id === value ? "text-[var(--cedar)]" : "",
                ].join(" ")}
              >
                {it.icon}
              </span>
            )}
            <span className="flex-1 truncate">{it.label}</span>
            {it.badge !== undefined && it.badge !== "" && (
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[var(--bg)] text-[var(--muted)] shrink-0">
                {it.badge}
              </span>
            )}
          </button>
        ))}
      </div>
      {footer && (
        <div className="border-t border-[var(--border)] p-2 max-md:hidden">{footer}</div>
      )}
    </nav>
  );
}
