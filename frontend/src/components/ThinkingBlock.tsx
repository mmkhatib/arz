import { useEffect, useRef, useState } from "react";
import { Brain, ChevronDown, ChevronRight } from "lucide-react";

/** Last non-empty line of the reasoning — the live one-line preview. */
function lastLine(text: string): string {
  const lines = text.trimEnd().split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i].trim();
    if (l) return l;
  }
  return "";
}

/** Collapsible model reasoning. While streaming the header previews the
 *  newest line and the open body follows new text; once saved it's a
 *  quiet "Thought for N words" row. */
export default function ThinkingBlock({ text, streaming = false }: { text: string; streaming?: boolean }) {
  const [open, setOpen] = useState(false);
  const bodyRef = useRef<HTMLPreElement | null>(null);
  const stickRef = useRef(true);

  useEffect(() => {
    const el = bodyRef.current;
    if (open && streaming && el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [text, open, streaming]);

  if (!text.trim()) return null;
  const words = text.trim().split(/\s+/).length;

  return (
    <div
      className="mb-2 rounded-lg text-[12px]"
      style={{ border: "1px dashed var(--border)", background: "var(--surface)" }}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left text-[var(--muted)] hover:text-[var(--text)]"
        style={{ fontFamily: "var(--fm)" }}
      >
        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        <Brain size={12} className={streaming ? "text-[var(--cedar-glow)] animate-pulse" : "text-[var(--cedar-2)]"} />
        <span className="shrink-0">{streaming ? "Thinking…" : `Thought · ${words} words`}</span>
        {streaming && !open && (
          <span className="truncate flex-1 italic opacity-70">{lastLine(text)}</span>
        )}
      </button>
      {open && (
        <pre
          ref={bodyRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
          }}
          className="px-3 pb-2.5 max-h-72 overflow-y-auto text-[12.5px] leading-relaxed italic text-[var(--text2)]"
          style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "var(--fn)", margin: 0 }}
        >
          {text}
        </pre>
      )}
    </div>
  );
}
