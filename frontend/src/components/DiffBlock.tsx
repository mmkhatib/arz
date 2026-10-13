import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, FileDiff } from "lucide-react";
import CopyButton from "./CopyButton";
import {
  diffLines,
  diffStats,
  parseUnifiedDiff,
  unifiedDiffPath,
  withContext,
  type DiffLine,
} from "@/utils/lineDiff";

/** Hard cap on rendered rows — a 5k-line rewrite shouldn't lock the
 *  transcript. The full text is still one Copy away. */
const MAX_ROWS = 400;

const ROW_STYLE: Record<DiffLine["kind"], React.CSSProperties> = {
  add: { background: "color-mix(in srgb, var(--cedar) 16%, transparent)", color: "var(--text)" },
  del: { background: "color-mix(in srgb, var(--ember) 16%, transparent)", color: "var(--text)" },
  ctx: { color: "var(--text2)" },
  hunk: { color: "var(--stone)", background: "var(--stone-dim)" },
  meta: { color: "var(--muted)" },
};

const GUTTER: Record<DiffLine["kind"], string> = { add: "+", del: "−", ctx: " ", hunk: "", meta: "" };

export function DiffStatBadge({ added, removed }: { added: number; removed: number }) {
  return (
    <span style={{ fontFamily: "var(--fm)", fontSize: 10.5, display: "inline-flex", gap: 6 }}>
      <span style={{ color: "var(--cedar-glow)" }}>+{added}</span>
      <span style={{ color: "var(--ember)" }}>−{removed}</span>
    </span>
  );
}

function DiffRows({ lines }: { lines: DiffLine[] }) {
  const shown = lines.slice(0, MAX_ROWS);
  return (
    <div style={{ overflowX: "auto", maxHeight: 480, overflowY: "auto" }}>
      <pre
        style={{
          margin: 0,
          padding: "4px 0",
          fontFamily: "var(--fm)",
          fontSize: 12,
          lineHeight: 1.55,
          minWidth: "fit-content",
        }}
      >
        {shown.map((l, i) => (
          <div key={i} style={{ ...ROW_STYLE[l.kind], display: "flex", whiteSpace: "pre", paddingRight: 12 }}>
            <span
              aria-hidden
              style={{
                width: 22,
                flexShrink: 0,
                textAlign: "center",
                userSelect: "none",
                color: l.kind === "add" ? "var(--cedar-glow)" : l.kind === "del" ? "var(--ember)" : "var(--muted)",
              }}
            >
              {GUTTER[l.kind]}
            </span>
            <span>{l.text || " "}</span>
          </div>
        ))}
        {lines.length > MAX_ROWS && (
          <div style={{ padding: "4px 22px", color: "var(--muted)", fontStyle: "italic" }}>
            +{lines.length - MAX_ROWS} more lines
          </div>
        )}
      </pre>
    </div>
  );
}

/** Card chrome shared by fence diffs and Edit-tool diffs. */
function DiffCard({
  path,
  lines,
  copyText,
  defaultOpen,
  onOpenFile,
}: {
  path: string | null;
  lines: DiffLine[];
  copyText: string;
  defaultOpen: boolean;
  onOpenFile?: (path: string) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const stats = useMemo(() => diffStats(lines), [lines]);
  const name = path ? path.split(/[\\/]/).pop() || path : "diff";
  return (
    <div
      style={{
        margin: "8px 0",
        border: "1px solid var(--cedar-line)",
        borderRadius: 10,
        overflow: "hidden",
        background: "var(--bg)",
      }}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen((v) => !v);
          }
        }}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "6px 10px",
          background: "var(--cedar-dim)",
          borderBottom: open ? "1px solid var(--cedar-line)" : "none",
          fontFamily: "var(--fm)",
          fontSize: 11,
          color: "var(--cedar-glow)",
          cursor: "pointer",
          userSelect: "none",
        }}
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <FileDiff size={12} />
        <span
          onClick={
            path && onOpenFile
              ? (e) => {
                  e.stopPropagation();
                  onOpenFile(path);
                }
              : undefined
          }
          title={path ?? undefined}
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            maxWidth: "55%",
            textDecoration: path && onOpenFile ? "underline dotted" : undefined,
          }}
        >
          {name}
        </span>
        <DiffStatBadge {...stats} />
        <span style={{ flex: 1 }} />
        <CopyButton text={copyText} title="Copy diff" />
      </div>
      {open && <DiffRows lines={lines} />}
    </div>
  );
}

/** A ```diff fence in the reply. Starts collapsed to a file + stat chip
 *  when it's long; short patches open inline. */
export function FenceDiffBlock({ code, onOpenFile }: { code: string; onOpenFile?: (path: string) => void }) {
  const lines = useMemo(() => parseUnifiedDiff(code), [code]);
  const path = useMemo(() => unifiedDiffPath(code), [code]);
  return (
    <DiffCard
      path={path}
      lines={lines}
      copyText={code}
      defaultOpen={lines.length <= 40}
      onOpenFile={onOpenFile}
    />
  );
}

/** Edit / MultiEdit tool call rendered as a diff of old → new. */
export function EditDiffBlock({
  path,
  oldText,
  newText,
  onOpenFile,
  defaultOpen = true,
}: {
  path: string;
  oldText: string;
  newText: string;
  onOpenFile?: (path: string) => void;
  defaultOpen?: boolean;
}) {
  const lines = useMemo(() => withContext(diffLines(oldText, newText)), [oldText, newText]);
  const copy = useMemo(
    () =>
      lines
        .map((l) => (l.kind === "add" ? "+" : l.kind === "del" ? "-" : l.kind === "ctx" ? " " : "") + l.text)
        .join("\n"),
    [lines],
  );
  return (
    <DiffCard path={path} lines={lines} copyText={copy} defaultOpen={defaultOpen} onOpenFile={onOpenFile} />
  );
}
