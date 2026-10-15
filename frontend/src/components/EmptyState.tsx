import type { ReactNode } from "react";

/** Centered empty state used by list/board pages: icon in a soft
 *  cedar disc, serif title, one-line hint, optional action. */
export default function EmptyState({
  icon,
  title,
  hint,
  action,
  compact = false,
}: {
  icon: ReactNode;
  title: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        gap: compact ? 8 : 10,
        padding: compact ? "28px 16px" : "48px 24px",
        color: "var(--muted)",
      }}
    >
      <div
        style={{
          width: compact ? 40 : 52,
          height: compact ? 40 : 52,
          borderRadius: "50%",
          display: "grid",
          placeItems: "center",
          background: "var(--cedar-dim)",
          border: "1px solid var(--cedar-line)",
          color: "var(--cedar-glow)",
          marginBottom: compact ? 2 : 4,
        }}
      >
        {icon}
      </div>
      <div style={{ fontFamily: "var(--fd)", fontSize: compact ? 17 : 22, color: "var(--text)", lineHeight: 1.2 }}>
        {title}
      </div>
      {hint && (
        <div style={{ fontSize: compact ? 12 : 13, maxWidth: 440, lineHeight: 1.55 }}>{hint}</div>
      )}
      {action && <div style={{ marginTop: compact ? 4 : 8 }}>{action}</div>}
    </div>
  );
}
