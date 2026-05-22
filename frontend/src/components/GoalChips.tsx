import { useState } from "react";
import type { GoalAttrs } from "@/utils/segments";

export function GoalMarkerChip({ attrs }: { attrs: GoalAttrs }) {
  const variant = attrs.variant || "evaluator";
  const judge = attrs.judge || "";
  const verdict = attrs.verdict || "";
  const reason = attrs.reason || "";
  const iter = attrs.iter || "";
  const cap = attrs.cap || "";

  let icon = "⟳";
  let color = "var(--cedar)";
  let label = "evaluator";
  let animated = false;
  if (variant === "pending") {
    icon = "⏳";
    color = "var(--cedar-glow, var(--cedar))";
    label = "evaluator · running";
    animated = true;
  } else if (variant === "reset") {
    const streak = attrs.streak || "3";
    icon = "⚠";
    color = "#fbbf24";
    label = `frustration · hard reset (${streak}× same complaint)`;
  } else if (variant === "done") {
    icon = "◎";
    color = "#34d399";
    label = "goal · done";
  } else if (variant === "cap") {
    icon = "⨯";
    color = "#f87171";
    label = `goal · cap ${iter}/${cap}`;
  } else if (verdict === "met") {
    icon = "✓";
    color = "#34d399";
    label = "evaluator · met";
  } else {
    icon = "⟳";
    color = "#fbbf24";
    label = "evaluator · not met";
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 8,
        margin: "8px 0",
        padding: "8px 10px",
        background: "var(--surface)",
        border: `1px solid ${color}33`,
        borderLeft: `3px solid ${color}`,
        borderRadius: 6,
        fontSize: 11.5,
        fontFamily: "var(--fm, ui-monospace, monospace)",
      }}
    >
      <span
        style={{
          color,
          fontSize: 13,
          fontWeight: 600,
          lineHeight: 1.4,
          display: "inline-block",
          animation: animated ? "arz-pulse 1.4s ease-in-out infinite" : undefined,
        }}
      >
        {icon}
      </span>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span
            style={{
              color: "var(--muted)",
              textTransform: "uppercase",
              letterSpacing: ".08em",
              fontSize: 9.5,
            }}
          >
            {label}
          </span>
          {judge ? (
            <span style={{ color: "var(--cedar-2, var(--cedar))", fontSize: 10.5 }}>{judge}</span>
          ) : null}
        </div>
        {reason ? (
          <span
            style={{
              color: "var(--text2, var(--text))",
              fontSize: 11.5,
              lineHeight: 1.45,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {reason}
          </span>
        ) : null}
      </div>
    </div>
  );
}

export function GoalAutoCard({ attrs, body }: { attrs: GoalAttrs; body: string }) {
  const iter = attrs.iter || "0";
  const cap = attrs.cap || "";
  const reason = attrs.reason || "";
  const goalAttr = attrs.goal || "";
  const isKickoff = reason === "kickoff";
  const [open, setOpen] = useState(false);

  const accent = isKickoff ? "#34d399" : "var(--cedar-glow, var(--cedar))";
  const icon = isKickoff ? "🎯" : "⟲";
  const label = isKickoff ? "goal · kickoff" : `goal-auto · ${iter}/${cap}`;

  const cleanedBody = (() => {
    let b = body;
    b = b.replace(/^\s*\[goal-(?:start|auto[^\]]*)\][^\n]*\n*/i, "");
    b = b.replace(/^Goal:\s*\n/i, "");
    return b.trim();
  })();

  const goalText = (goalAttr || cleanedBody.split("\n")[0] || "").trim();

  return (
    <div
      style={{
        margin: "10px 0",
        background:
          "linear-gradient(135deg, color-mix(in srgb, var(--surface) 92%, transparent), var(--surface))",
        border: `1px solid color-mix(in srgb, ${accent} 35%, var(--border))`,
        borderLeft: `3px solid ${accent}`,
        borderRadius: 10,
        overflow: "hidden",
        boxShadow: "0 1px 0 rgba(0,0,0,0.05) inset",
      }}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 12px",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
          fontFamily: "var(--fm, ui-monospace, monospace)",
        }}
      >
        <span style={{ fontSize: 18, lineHeight: 1 }}>{icon}</span>
        <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              style={{
                color: accent,
                textTransform: "uppercase",
                letterSpacing: ".08em",
                fontSize: 10,
                fontWeight: 600,
              }}
            >
              {label}
            </span>
            {!isKickoff && reason ? (
              <span
                style={{
                  color: "var(--muted)",
                  fontSize: 10.5,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={`evaluator: ${reason}`}
              >
                · evaluator: {reason}
              </span>
            ) : null}
          </div>
          {goalText ? (
            <div
              style={{
                color: "var(--text)",
                fontSize: 13.5,
                fontWeight: 500,
                fontFamily: "var(--ft, system-ui, sans-serif)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={goalText}
            >
              {goalText}
            </div>
          ) : null}
        </div>
        <span
          style={{
            fontSize: 11,
            color: "var(--muted)",
            transform: open ? "rotate(90deg)" : "none",
            transition: "transform 120ms ease",
          }}
        >
          ▸
        </span>
      </button>
      {open ? (
        <div
          style={{
            padding: "10px 12px",
            borderTop: "1px solid color-mix(in srgb, var(--border) 60%, transparent)",
            fontSize: 12,
            color: "var(--text2, var(--text))",
            whiteSpace: "pre-wrap",
            fontFamily: "var(--fm, ui-monospace, monospace)",
            background: "color-mix(in srgb, var(--bg) 50%, transparent)",
          }}
        >
          {cleanedBody || body}
        </div>
      ) : null}
    </div>
  );
}
