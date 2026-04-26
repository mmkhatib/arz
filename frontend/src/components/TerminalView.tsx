import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { parseAnsi, stripAnsi } from "@/utils/ansi";

const SHELL_TOOLS = new Set([
  "Bash",
  "bash",
  "shell",
  "Shell",
  "run_command",
  "execute_code",
  "Terminal",
]);

export function isShellTool(toolName: string): boolean {
  return SHELL_TOOLS.has(toolName);
}

interface Props {
  text: string;
  className?: string;
  maxHeightPx?: number;
}

/** Render shell/terminal output: ANSI colors → spans, with a copy button.
 *  Plain text without ANSI also routes through here so the copy button + dark
 *  terminal background still apply. */
export default function TerminalView({ text, className = "", maxHeightPx = 240 }: Props) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    void navigator.clipboard
      .writeText(stripAnsi(text))
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {});
  };

  const segments = parseAnsi(text);

  return (
    <div className={`relative group rounded-md border border-[var(--border)] bg-[#0b0d0c] ${className}`}>
      <button
        type="button"
        onClick={handleCopy}
        title="Copy output"
        aria-label="Copy terminal output"
        className="absolute top-1 right-1 z-10 px-1.5 py-1 rounded bg-black/40 text-[var(--muted)] hover:text-[var(--text)] opacity-0 group-hover:opacity-100 transition-opacity"
      >
        {copied ? <Check size={11} /> : <Copy size={11} />}
      </button>
      <pre
        className="px-2.5 py-2 text-[11px] font-mono whitespace-pre-wrap break-all overflow-y-auto leading-relaxed text-[#e5e5e5]"
        style={{ maxHeight: maxHeightPx }}
      >
        {segments.map((seg, i) => (
          <span
            key={i}
            style={{
              color: seg.fg,
              backgroundColor: seg.bg,
              fontWeight: seg.bold ? 600 : undefined,
              opacity: seg.dim ? 0.6 : undefined,
              fontStyle: seg.italic ? "italic" : undefined,
              textDecoration: seg.underline ? "underline" : undefined,
            }}
          >
            {seg.text}
          </span>
        ))}
      </pre>
    </div>
  );
}
