// Cedar primitives — Card, Btn, Tag, SegSeg, PageHeader, TopoLines.
// Used across every page to enforce the Cedar design language. Mirrors
// the prototype in design_handoff_arz_cedar/redesign/foundation.jsx.

import type { CSSProperties, ReactNode, MouseEventHandler } from "react";
import { useEffect, useState } from "react";

// ── TopoLines ───────────────────────────────────────────────
// Organic mountain contour decoration. Drops behind hero areas.
export function TopoLines({
  height = 120,
  opacity = 0.5,
  color,
}: {
  height?: number;
  opacity?: number;
  color?: string;
}) {
  const c = color || "var(--cedar-line)";
  const pathFor = (yOff: number, freq: number, amp: number) => {
    const pts: string[] = [];
    for (let x = 0; x <= 400; x += 10) {
      pts.push(
        `${x},${yOff + Math.sin((x * freq) / 100) * amp + Math.cos((x * freq * 1.7) / 100) * amp * 0.5}`,
      );
    }
    return "M" + pts.join(" L");
  };
  return (
    <svg
      viewBox={`0 0 400 ${height}`}
      preserveAspectRatio="none"
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        opacity,
        pointerEvents: "none",
      }}
    >
      {[0, 1, 2, 3, 4].map((i) => (
        <path
          key={i}
          d={pathFor(height * 0.2 + i * (height * 0.18), 1 + i * 0.3, 6 + i * 2)}
          fill="none"
          stroke={c}
          strokeWidth=".8"
          opacity={0.4 + i * 0.15}
        />
      ))}
    </svg>
  );
}

// ── Card ─────────────────────────────────────────────────────
export function CedarCard({
  children,
  padding = 16,
  style = {},
  hoverable = false,
  className = "",
  onClick,
}: {
  children: ReactNode;
  padding?: number;
  style?: CSSProperties;
  hoverable?: boolean;
  className?: string;
  onClick?: MouseEventHandler<HTMLDivElement>;
}) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => hoverable && setHover(true)}
      onMouseLeave={() => hoverable && setHover(false)}
      className={className}
      style={{
        background: hover ? "var(--s2)" : "var(--surface)",
        border: `1px solid ${hover ? "var(--cedar-line)" : "var(--border)"}`,
        borderRadius: 10,
        padding,
        transition: "all .15s",
        cursor: onClick ? "pointer" : "default",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

// ── Btn ──────────────────────────────────────────────────────
type BtnKind = "solid" | "outline" | "soft" | "ghost" | "danger";
type BtnSize = "sm" | "md";

export function Btn({
  children,
  kind = "outline",
  size = "md",
  icon,
  onClick,
  disabled,
  type = "button",
  style = {},
  title,
}: {
  children?: ReactNode;
  kind?: BtnKind;
  size?: BtnSize;
  icon?: ReactNode;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  disabled?: boolean;
  type?: "button" | "submit";
  style?: CSSProperties;
  title?: string;
}) {
  const sizes: Record<BtnSize, CSSProperties> = {
    sm: { padding: icon && !children ? 5 : "5px 9px", fontSize: 11.5, gap: 5, height: 24 },
    md: { padding: icon && !children ? 7 : "7px 12px", fontSize: 12.5, gap: 6, height: 30 },
  };
  const kinds: Record<BtnKind, { bg: string; bd: string; fg: string; hoverBg?: string }> = {
    solid:   { bg: "var(--cedar)",       bd: "var(--cedar)",      fg: "#fff",                hoverBg: "var(--cedar-2)" },
    outline: { bg: "var(--bg)",          bd: "var(--border)",     fg: "var(--text)" },
    soft:    { bg: "var(--cedar-dim)",   bd: "var(--cedar-line)", fg: "var(--cedar-glow)" },
    ghost:   { bg: "transparent",        bd: "transparent",       fg: "var(--text2)",        hoverBg: "var(--s2)" },
    danger:  { bg: "var(--ember-dim)",   bd: "var(--ember)",      fg: "var(--ember)" },
  };
  const s = sizes[size];
  const k = kinds[kind];
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        background: k.bg,
        border: `1px solid ${k.bd}`,
        color: k.fg,
        borderRadius: 7,
        cursor: disabled ? "default" : "pointer",
        fontFamily: "var(--fn)",
        fontWeight: 500,
        whiteSpace: "nowrap",
        opacity: disabled ? 0.5 : 1,
        transition: "all .12s",
        ...s,
        ...style,
      }}
      onMouseEnter={(e) => {
        if (disabled || !k.hoverBg) return;
        (e.currentTarget as HTMLButtonElement).style.background = k.hoverBg;
      }}
      onMouseLeave={(e) => {
        if (disabled) return;
        (e.currentTarget as HTMLButtonElement).style.background = k.bg;
      }}
    >
      {icon}
      {children}
    </button>
  );
}

// ── Tag ──────────────────────────────────────────────────────
type TagColor = "muted" | "cedar" | "pine" | "stone" | "dawn" | "ember";

export function Tag({ children, color = "muted" }: { children: ReactNode; color?: TagColor }) {
  const map: Record<TagColor, { bg: string; bd: string; fg: string }> = {
    muted: { bg: "var(--s2)",        bd: "var(--border)",     fg: "var(--text3)" },
    cedar: { bg: "var(--cedar-dim)", bd: "var(--cedar-line)", fg: "var(--cedar-glow)" },
    pine:  { bg: "var(--pine-dim)",  bd: "var(--pine)",       fg: "var(--pine)" },
    stone: { bg: "var(--stone-dim)", bd: "var(--border2)",    fg: "var(--stone)" },
    dawn:  { bg: "var(--dawn-dim)",  bd: "var(--dawn)",       fg: "var(--dawn)" },
    ember: { bg: "var(--ember-dim)", bd: "var(--ember)",      fg: "var(--ember)" },
  };
  const k = map[color];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "1px 7px",
        fontSize: 10,
        fontFamily: "var(--fm)",
        background: k.bg,
        border: `1px solid ${k.bd}`,
        color: k.fg,
        borderRadius: 99,
        lineHeight: 1.5,
        letterSpacing: ".02em",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

// ── SegSeg (segmented control) ───────────────────────────────
export function SegSeg<T extends string>({
  value,
  options,
  onChange,
  size = "md",
}: {
  value: T;
  options: ({ value: T; label: string } | T)[];
  onChange: (v: T) => void;
  size?: "sm" | "md";
}) {
  const opts = options.map((o) =>
    typeof o === "string"
      ? { value: o, label: o.charAt(0).toUpperCase() + o.slice(1) }
      : o,
  );
  return (
    <div
      style={{
        display: "inline-flex",
        background: "var(--s2)",
        border: "1px solid var(--border)",
        borderRadius: 7,
        padding: 2,
      }}
    >
      {opts.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          style={{
            padding: size === "sm" ? "4px 10px" : "5px 12px",
            fontSize: size === "sm" ? 11 : 12,
            background: o.value === value ? "var(--surface)" : "transparent",
            border: "none",
            borderRadius: 5,
            color: o.value === value ? "var(--text)" : "var(--text3)",
            cursor: "pointer",
            fontFamily: "var(--fn)",
            fontWeight: o.value === value ? 500 : 400,
            boxShadow: o.value === value ? "0 1px 2px rgba(0,0,0,.3)" : "none",
            transition: "all .12s",
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ── CedarPageHeader ─────────────────────────────────────────
// Display-serif title, optional eyebrow with cedar-glow line, optional
// subtitle and right-rail action slot. Drop into the top of every page.
export function CedarPageHeader({
  eyebrow,
  title,
  sub,
  right,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <header
      style={{
        padding: "28px 32px 22px",
        borderBottom: "1px solid var(--hairline)",
        position: "relative",
        zIndex: 1,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: 24,
        }}
      >
        <div style={{ minWidth: 0 }}>
          {eyebrow && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <span style={{ width: 18, height: 1, background: "var(--cedar-glow)" }} />
              <span
                style={{
                  fontSize: 10.5,
                  fontFamily: "var(--fm)",
                  textTransform: "uppercase",
                  letterSpacing: ".18em",
                  color: "var(--cedar-2)",
                }}
              >
                {eyebrow}
              </span>
            </div>
          )}
          <h1
            style={{
              fontFamily: "var(--fd)",
              fontSize: 32,
              fontWeight: 400,
              color: "var(--text)",
              lineHeight: 1.1,
              margin: 0,
              letterSpacing: "-.01em",
            }}
          >
            {title}
          </h1>
          {sub && (
            <p
              style={{
                marginTop: 8,
                fontSize: 13.5,
                color: "var(--text3)",
                lineHeight: 1.6,
                maxWidth: 680,
              }}
            >
              {sub}
            </p>
          )}
        </div>
        {right && <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>{right}</div>}
      </div>
    </header>
  );
}

// ── Toggle (iOS-style) ───────────────────────────────────────
export function Toggle({
  on,
  onClick,
  title,
}: {
  on: boolean;
  onClick?: () => void;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        width: 34,
        height: 18,
        borderRadius: 9,
        border: "none",
        cursor: "pointer",
        background: on ? "var(--cedar)" : "var(--s3)",
        position: "relative",
        flexShrink: 0,
        transition: "background .15s",
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 2,
          left: on ? 18 : 2,
          width: 14,
          height: 14,
          background: "#fff",
          borderRadius: "50%",
          transition: "left .15s",
          boxShadow: "0 1px 2px rgba(0,0,0,.4)",
        }}
      />
    </button>
  );
}

// ── Modal — scrim + Cedar-styled dialog ─────────────────────
export function CedarModal({
  open,
  onClose,
  title,
  eyebrow,
  children,
  footer,
  width = 520,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  eyebrow?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  // ESC dismisses; click-outside does not — modal only closes via the
  // explicit close button in the header or the Cancel button consumers
  // place in the footer. Stops the user losing wizard state by missing
  // the modal edge.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.55)",
        backdropFilter: "blur(3px)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "5vh 4vw",
        zIndex: 100,
        overflow: "hidden",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width,
          maxWidth: "92vw",
          maxHeight: "90vh",
          display: "flex",
          flexDirection: "column",
          background: "var(--surface)",
          border: "1px solid var(--border2)",
          borderRadius: 14,
          boxShadow: "var(--shadow-2)",
          overflow: "hidden",
          fontFamily: "var(--fn)",
          position: "relative",
        }}
      >
        {/* Header — fixed at top, never scrolls */}
        <div
          style={{
            position: "relative",
            padding: "18px 22px 14px",
            borderBottom: "1px solid var(--border)",
            overflow: "hidden",
            flexShrink: 0,
            paddingRight: 48,
          }}
        >
          <TopoLines height={80} opacity={0.4} />
          {eyebrow && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, position: "relative" }}>
              <span style={{ width: 16, height: 1, background: "var(--cedar-glow)" }} />
              <span
                style={{
                  fontSize: 10,
                  fontFamily: "var(--fm)",
                  textTransform: "uppercase",
                  letterSpacing: ".16em",
                  color: "var(--cedar-2)",
                }}
              >
                {eyebrow}
              </span>
            </div>
          )}
          <h2
            style={{
              fontFamily: "var(--fd)",
              fontSize: 22,
              fontWeight: 400,
              color: "var(--text)",
              lineHeight: 1.15,
              margin: 0,
              letterSpacing: "-.01em",
              position: "relative",
            }}
          >
            {title}
          </h2>
          <button
            onClick={onClose}
            title="Close (Esc)"
            aria-label="Close"
            style={{
              position: "absolute",
              top: 12,
              right: 12,
              width: 28,
              height: 28,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 6,
              border: "1px solid transparent",
              background: "transparent",
              color: "var(--muted)",
              cursor: "pointer",
              fontSize: 18,
              lineHeight: 1,
              zIndex: 2,
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = "var(--s2)";
              (e.currentTarget as HTMLButtonElement).style.color = "var(--text)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = "transparent";
              (e.currentTarget as HTMLButtonElement).style.color = "var(--muted)";
            }}
          >
            ×
          </button>
        </div>
        {/* Body — scrolls when content exceeds viewport */}
        <div
          style={{
            padding: "18px 22px",
            overflowY: "auto",
            flex: 1,
            minHeight: 0,
          }}
        >
          {children}
        </div>
        {footer && (
          <div
            style={{
              padding: "12px 22px",
              borderTop: "1px solid var(--border)",
              display: "flex",
              alignItems: "center",
              justifyContent: "flex-end",
              gap: 8,
              background: "var(--bg)",
              flexShrink: 0,
            }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

// ── CedarTextField + CedarTextArea — themed inputs for use inside modals
export function CedarLabel({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        fontSize: 10.5,
        fontFamily: "var(--fm)",
        textTransform: "uppercase",
        letterSpacing: ".14em",
        color: "var(--muted)",
        marginBottom: 5,
      }}
    >
      {children}
    </div>
  );
}

const _inpStyle: CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  background: "var(--bg)",
  border: "1px solid var(--border)",
  borderRadius: 7,
  color: "var(--text)",
  fontSize: 13,
  fontFamily: "var(--fn)",
  outline: "none",
};

export function CedarInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      style={{
        ..._inpStyle,
        ...(props.style || {}),
      }}
      onFocus={(e) => {
        e.currentTarget.style.borderColor = "var(--cedar-line)";
        props.onFocus?.(e);
      }}
      onBlur={(e) => {
        e.currentTarget.style.borderColor = "var(--border)";
        props.onBlur?.(e);
      }}
    />
  );
}

export function CedarTextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      style={{
        ..._inpStyle,
        fontFamily: "var(--fn)",
        lineHeight: 1.55,
        resize: "vertical",
        ...(props.style || {}),
      }}
      onFocus={(e) => {
        e.currentTarget.style.borderColor = "var(--cedar-line)";
        props.onFocus?.(e);
      }}
      onBlur={(e) => {
        e.currentTarget.style.borderColor = "var(--border)";
        props.onBlur?.(e);
      }}
    />
  );
}

// ── Eyebrow label ────────────────────────────────────────────
export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <span
      style={{
        fontSize: 10.5,
        fontFamily: "var(--fm)",
        textTransform: "uppercase",
        letterSpacing: ".16em",
        color: "var(--muted)",
      }}
    >
      {children}
    </span>
  );
}

// ── CedarPage wrapper — full-page scrollable area ────────────
export function CedarPage({
  children,
  topo = false,
  scroll = true,
}: {
  children: ReactNode;
  topo?: boolean;
  /**
   * When false, the page becomes a flex column that fills its
   * available height without scrolling itself. Children opt into
   * their own scroll containers — used by chat/channels/board layouts
   * that pin a header + composer and only scroll the middle pane.
   */
  scroll?: boolean;
}) {
  return (
    <div
      className={topo ? "topo-bg" : ""}
      style={{
        flex: 1,
        overflowY: scroll ? "auto" : "hidden",
        display: scroll ? undefined : "flex",
        flexDirection: scroll ? undefined : "column",
        position: "relative",
        background: "var(--bg)",
        minWidth: 0,
        minHeight: 0,
      }}
    >
      {children}
    </div>
  );
}
