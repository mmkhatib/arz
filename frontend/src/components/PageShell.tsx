// Shared page chrome — every full-page route + modal in arz uses these.
//
// PageShell    — outer flex column, owns the header + scrollable body
// PageHeader   — icon + title + count + actions row (border-b)
// Card         — surface card with optional title + actions
// SectionLabel — small uppercase tracking-wider label
//
// All sizing/spacing constants live here so a single tweak propagates.

import type { ReactNode } from "react";

const HEADER_PAD = "px-5 pt-4 pb-3";

export function PageHeader({
  icon,
  title,
  count,
  subtitle,
  actions,
  onClose,
}: {
  icon?: ReactNode;
  title: string;
  count?: number | string;
  subtitle?: string;
  actions?: ReactNode;
  onClose?: () => void;
}) {
  return (
    <div className={`shrink-0 flex items-center justify-between gap-3 ${HEADER_PAD} border-b border-[var(--border)] bg-[var(--bg)]`}>
      <div className="flex items-center gap-2 min-w-0">
        {icon && <span className="text-[var(--cedar)] shrink-0">{icon}</span>}
        <h2 className="text-[15px] font-semibold text-[var(--text)] truncate">{title}</h2>
        {count !== undefined && count !== "" && (
          <span className="text-[12px] text-[var(--muted)] font-mono">{count}</span>
        )}
        {subtitle && <span className="text-[12px] text-[var(--muted)] truncate">· {subtitle}</span>}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {actions}
        {onClose && (
          <button
            onClick={onClose}
            className="text-[var(--muted)] hover:text-[var(--text)] text-xl leading-none px-1"
            aria-label="Close"
          >
            ×
          </button>
        )}
      </div>
    </div>
  );
}

export function PageShell({
  children,
  variant = "page",
  maxWidth = "max-w-4xl",
  onClose,
}: {
  children: ReactNode;
  variant?: "modal" | "page";
  maxWidth?: string;
  onClose?: () => void;
}) {
  if (variant === "page") {
    return (
      <div className="flex flex-col h-full bg-[var(--bg)] min-w-0 flex-1 overflow-hidden">
        {children}
      </div>
    );
  }
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
    >
      <div className={`bg-[var(--bg)] border border-[var(--border)] rounded-2xl shadow-2xl w-full ${maxWidth} mx-4 max-h-[88vh] flex flex-col`}>
        {children}
      </div>
    </div>
  );
}

export function PageBody({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`overflow-y-auto px-5 py-4 flex-1 flex flex-col gap-4 ${className}`}>
      {children}
    </div>
  );
}

export function Card({
  title,
  subtitle,
  count,
  actions,
  children,
  padding = "p-4",
  className = "",
}: {
  title?: string;
  subtitle?: string;
  count?: number | string;
  actions?: ReactNode;
  children: ReactNode;
  padding?: string;
  className?: string;
}) {
  return (
    <section className={`border border-[var(--border)] rounded-lg bg-[var(--surface)] flex flex-col ${className}`}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-2 px-4 py-2 border-b border-[var(--border)]">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              {title && <span className="text-[13px] font-semibold text-[var(--text)]">{title}</span>}
              {count !== undefined && count !== "" && (
                <span className="text-[10px] uppercase tracking-wider text-[var(--muted)]/70 font-mono">{count}</span>
              )}
            </div>
            {subtitle && <div className="text-[11px] text-[var(--muted)] mt-0.5">{subtitle}</div>}
          </div>
          {actions && <div className="flex items-center gap-1 shrink-0">{actions}</div>}
        </header>
      )}
      <div className={padding}>{children}</div>
    </section>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="text-[10px] uppercase tracking-wider text-[var(--muted)] font-medium">
      {children}
    </div>
  );
}
