import { useState } from "react";

export async function copyText(payload: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(payload);
  } catch {
    // fallback for non-HTTPS
    const el = document.createElement("textarea");
    el.value = payload;
    document.body.appendChild(el);
    el.select();
    document.execCommand("copy");
    document.body.removeChild(el);
  }
}

/* Copy-to-clipboard pill used by code / table / tool cards.
 *
 * Two modes: `text` (we already have the raw string) or `getText`
 * (computed lazily — e.g. read off the rendered DOM, or serialise a
 * table only when clicked).
 */
export default function CopyButton({
  text,
  getText,
  label = "Copy",
  title = "Copy",
}: {
  text?: string;
  getText?: () => string;
  label?: string;
  title?: string;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const payload = text ?? getText?.() ?? "";
    if (!payload) return;
    await copyText(payload);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={copy}
      title={title}
      style={{
        background: "transparent",
        border: "1px solid var(--cedar-line)",
        borderRadius: 5,
        padding: "2px 8px",
        cursor: "pointer",
        color: copied ? "var(--cedar-glow)" : "var(--muted)",
        fontSize: 10,
        fontFamily: "var(--fm)",
        textTransform: "uppercase",
        letterSpacing: ".06em",
        transition: "color .12s",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.color = "var(--cedar-glow)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.color = copied ? "var(--cedar-glow)" : "var(--muted)"; }}
    >
      {copied ? "Copied ✓" : label}
    </button>
  );
}
