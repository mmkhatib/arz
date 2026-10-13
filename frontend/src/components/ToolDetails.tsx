import { useMemo, useState } from "react";
import { AlertTriangle, Ban, CheckCircle2, ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import type { ToolCallRecord } from "@/api/client";
import TerminalView, { isShellTool } from "./TerminalView";
import CopyButton from "./CopyButton";
import {
  inferToolStatus,
  parseToolInput,
  toolFilePath,
  toolSummary,
  truncateLines,
  type ToolStatus,
} from "@/utils/toolInput";

/** Lines shown before a payload folds behind "+N lines". */
const PAYLOAD_PREVIEW_LINES = 40;

export function ToolStatusIcon({ status }: { status: ToolStatus }) {
  if (status === "running") {
    return <Loader2 size={11} className="animate-spin" style={{ color: "var(--cedar-glow)", flexShrink: 0 }} />;
  }
  if (status === "error") return <AlertTriangle size={11} style={{ color: "var(--ember)", flexShrink: 0 }} />;
  if (status === "denied") return <Ban size={11} style={{ color: "var(--dawn)", flexShrink: 0 }} />;
  return <CheckCircle2 size={11} style={{ color: "var(--cedar-2)", flexShrink: 0 }} />;
}

/** Key/value view of a JSON object input. Nested values render as
 *  compact JSON; long strings fold like any payload. */
function JsonTable({ obj }: { obj: Record<string, unknown> }) {
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "var(--fm)", fontSize: 11.5 }}>
      <tbody>
        {Object.entries(obj).map(([k, v]) => (
          <tr key={k} style={{ borderTop: "1px solid var(--hairline)" }}>
            <td
              style={{
                padding: "4px 10px 4px 0",
                verticalAlign: "top",
                color: "var(--cedar-glow)",
                whiteSpace: "nowrap",
                width: 1,
              }}
            >
              {k}
            </td>
            <td style={{ padding: "4px 0", color: "var(--text2)" }}>
              <PayloadText text={typeof v === "string" ? v : JSON.stringify(v, null, 2)} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PayloadText({ text }: { text: string }) {
  const [full, setFull] = useState(false);
  const { shown, hidden } = useMemo(() => truncateLines(text, PAYLOAD_PREVIEW_LINES), [text]);
  return (
    <>
      <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "var(--fm)" }}>
        {full ? text : shown}
      </pre>
      {hidden > 0 && (
        <button
          onClick={() => setFull((v) => !v)}
          style={{
            marginTop: 2,
            background: "none",
            border: "none",
            padding: 0,
            cursor: "pointer",
            color: "var(--muted)",
            fontFamily: "var(--fm)",
            fontSize: 10.5,
          }}
        >
          {full ? "show less" : `+${hidden} more line${hidden === 1 ? "" : "s"}`}
        </button>
      )}
    </>
  );
}

type Tab = "input" | "output";

/** Expanded body of a tool row: Input / Output tabs. Edit diffs render
 *  once, below the strip (WrittenFilePreview), not again in here. */
export function ToolDetails({ call }: { call: ToolCallRecord }) {
  const hasOutput = !!call.output;
  const [tab, setTab] = useState<Tab>("input");
  const obj = useMemo(() => parseToolInput(call.input), [call.input]);
  const shell = isShellTool(call.name);

  const tabBtn = (t: Tab, label: string) => (
    <button
      onClick={() => setTab(t)}
      style={{
        background: tab === t ? "var(--cedar-dim)" : "transparent",
        border: "1px solid " + (tab === t ? "var(--cedar-line)" : "transparent"),
        borderRadius: 5,
        padding: "1px 8px",
        cursor: "pointer",
        color: tab === t ? "var(--cedar-glow)" : "var(--muted)",
        fontFamily: "var(--fm)",
        fontSize: 10,
        textTransform: "uppercase",
        letterSpacing: ".06em",
      }}
    >
      {label}
    </button>
  );

  return (
    <div style={{ padding: "6px 10px 8px 24px", borderTop: "1px solid var(--hairline)", background: "var(--bg)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 6 }}>
        {tabBtn("input", "Input")}
        {hasOutput && tabBtn("output", "Output")}
        <span style={{ flex: 1 }} />
        <CopyButton text={tab === "output" ? call.output ?? "" : call.input} />
      </div>
      {tab === "input" ? (
        obj ? (
          <JsonTable obj={obj} />
        ) : (
          <PayloadText text={call.input} />
        )
      ) : shell ? (
        <TerminalView text={call.output ?? ""} maxHeightPx={320} />
      ) : (
        <div style={{ fontSize: 11.5, color: "var(--text2)", maxHeight: 360, overflowY: "auto" }}>
          <PayloadText text={call.output ?? ""} />
        </div>
      )}
    </div>
  );
}

// ── Inline tool strip — shows tool calls in-bubble ────────────
// Single call: one row. 2-3 calls: flat list. 4+: collapsed-by-default
// "N tools" header. Click a row to expand its input / output; the
// file name (when present) opens the FileViewer.
export function InlineToolStrip({
  calls,
  onOpenFile,
}: {
  calls: ToolCallRecord[];
  onOpenFile?: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState(calls.length < 4);
  if (calls.length === 0) return null;
  const errors = calls.filter((c) => inferToolStatus(c.output) === "error").length;
  return (
    <div
      style={{
        marginBottom: 10,
        background: "var(--s2)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        overflow: "hidden",
      }}
    >
      {calls.length >= 2 && (
        <button
          onClick={() => setExpanded((v) => !v)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            width: "100%",
            padding: "6px 10px",
            background: "transparent",
            border: "none",
            cursor: "pointer",
            color: "var(--cedar-2)",
            fontSize: 11,
            fontFamily: "var(--fm)",
            textAlign: "left",
          }}
        >
          {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          <span style={{ textTransform: "uppercase", letterSpacing: ".08em" }}>
            {calls.length} tool{calls.length === 1 ? "" : "s"}
          </span>
          {errors > 0 && (
            <span style={{ color: "var(--ember)", display: "inline-flex", alignItems: "center", gap: 3 }}>
              <AlertTriangle size={10} /> {errors}
            </span>
          )}
          <span style={{ color: "var(--muted)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {calls.slice(0, 4).map((c) => c.name).join(" · ")}
            {calls.length > 4 ? " · …" : ""}
          </span>
        </button>
      )}
      {(expanded || calls.length === 1) &&
        calls.map((c, i) => <InlineToolRow key={i} call={c} onOpenFile={onOpenFile} first={i === 0 && calls.length === 1} />)}
    </div>
  );
}

function InlineToolRow({
  call,
  onOpenFile,
  first,
}: {
  call: ToolCallRecord;
  onOpenFile?: (path: string) => void;
  first?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const summary = useMemo(() => toolSummary(call.input), [call.input]);
  const filePath = useMemo(() => toolFilePath(parseToolInput(call.input)), [call.input]);
  const status = inferToolStatus(call.output);
  return (
    <div style={{ borderTop: first ? "none" : "1px solid var(--hairline)" }}>
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
        title={open ? "Hide details" : "Show input / output"}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "5px 10px 5px 10px",
          fontSize: 11.5,
          fontFamily: "var(--fm)",
          color: "var(--text2)",
          cursor: "pointer",
          transition: "background 100ms",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
      >
        <span style={{ color: "var(--muted)", display: "flex" }}>
          {open ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        </span>
        <ToolStatusIcon status={status} />
        <span style={{ color: "var(--cedar-glow)", flexShrink: 0 }}>{call.name}</span>
        <span
          onClick={
            filePath && onOpenFile
              ? (e) => {
                  e.stopPropagation();
                  onOpenFile(filePath);
                }
              : undefined
          }
          title={filePath && onOpenFile ? `Open ${filePath}` : summary}
          style={{
            color: "var(--muted)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flex: 1,
            textDecoration: filePath && onOpenFile ? "underline dotted" : undefined,
          }}
        >
          {summary}
        </span>
      </div>
      {open && <ToolDetails call={call} />}
    </div>
  );
}
