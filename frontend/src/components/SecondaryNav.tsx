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
  widthClass = "w-56",
}: Props<T>) {
  // Style mirrors SessionList (chat sidebar) so the visual model is the
  // same across the app: surface background, full-height column, item
  // hover = bg-border, active = bg-user-bg with cedar accent dot.
  return (
    <nav
      className={[
        "shrink-0 flex flex-col h-full bg-[var(--surface)] border-r border-[var(--border)]",
        widthClass,
        // On phones the secondary nav becomes a horizontal scroll strip
        // so it doesn't eat the chat area. Tablets+ get the vertical column.
        "max-md:!w-full max-md:!h-auto max-md:flex-row max-md:overflow-x-auto max-md:border-r-0 max-md:border-b",
      ].join(" ")}
    >
      {title && (
        <div className="flex items-center px-4 py-3 border-b border-[var(--border)] max-md:hidden">
          <span className="text-[var(--accent)] font-semibold tracking-wide text-[13px]">{title}</span>
        </div>
      )}
      <div className="flex-1 overflow-y-auto py-2 max-md:flex max-md:flex-row max-md:py-1 max-md:px-1">
        {items.map((it) => {
          const isActive = it.id === value;
          return (
            <button
              key={it.id}
              onClick={() => !it.disabled && onChange(it.id)}
              disabled={it.disabled}
              title={it.hint || it.label}
              className={[
                "group/sn w-full flex items-center gap-2 px-4 py-2 text-[13px] text-left transition-colors max-md:w-auto max-md:shrink-0 max-md:rounded-md",
                it.disabled
                  ? "text-[var(--muted)]/40 cursor-not-allowed"
                  : isActive
                  ? "bg-[var(--user-bg)] text-[var(--text)]"
                  : "text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--border)]",
              ].join(" ")}
            >
              <span className="w-2 flex items-center justify-center shrink-0">
                {isActive && <span className="text-[10px] text-[var(--accent)]">●</span>}
              </span>
              {it.icon && (
                <span
                  className={[
                    "w-4 h-4 flex items-center justify-center shrink-0",
                    isActive ? "text-[var(--cedar)]" : "",
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
          );
        })}
      </div>
      {footer && (
        <div className="border-t border-[var(--border)] p-2 max-md:hidden">{footer}</div>
      )}
    </nav>
  );
}
