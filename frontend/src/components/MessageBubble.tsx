import { useMemo, useRef, useState } from "react";
import { stripInlineTags } from "@/utils/stripInline";
import { FileBody } from "./FileViewer";
import type { MessageRecord, ToolCallRecord } from "@/api/client";
import { formatTokens } from "@/utils/tokens";
import Widget from "./Widget";
import CedarMark from "./CedarMark";
import { ArrowLeftRight, Check, Copy, Crosshair, GitBranch, Pencil, Quote, RotateCcw, Wrench } from "lucide-react";
import { parseServerTime } from "@/utils/serverTime";
import { GoalAutoCard, GoalMarkerChip } from "./GoalChips";
import SuggestedActions from "./SuggestedActions";
import ChatMarkdown from "./ChatMarkdown";
import ThinkingBlock from "./ThinkingBlock";
import { InlineToolStrip } from "./ToolDetails";
import { EditDiffBlock } from "./DiffBlock";
import { copyText } from "./CopyButton";
import { extractEditChanges, stripPyRepr } from "@/utils/toolInput";
import { extractOptions, segmentMessage, splitGoalTags } from "@/utils/segments";

function shortModel(model: string): string {
  // Compress "claude-opus-5-5" → "Opus 5.5", "claude-haiku-4-5-20251001" → "Haiku 4.5"
  const m = model.match(/claude-(opus|sonnet|haiku|fable)-(\d+)-(\d+)/i);
  if (m) return `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}.${m[3]}`;
  // CLI aliases ("opus", "flash-lite") — capitalise for the badge.
  if (/^[a-z][a-z-]*$/.test(model)) return model[0].toUpperCase() + model.slice(1);
  return model.length > 24 ? model.slice(0, 24) + "…" : model;
}

interface Props {
  message: MessageRecord;
  onFileOpen?: (path: string) => void;
  /** Send text as the user's next message — a widget button, or a choice
   *  the assistant offered with a trailing `[OPTIONS: A | B | C]`. */
  onSendText?: (text: string) => void;
  onCompare?: () => void;
  /** Last-user-message gets a pencil for in-place edit + resend. */
  isLastUser?: boolean;
  /** Last-assistant-message gets a ↻ for regenerate (re-runs prior user turn). */
  isLastAssistant?: boolean;
  onEditResend?: (text: string) => void;
  onRegenerate?: () => void;
  /** When this assistant message has multiple versions, ◀▶ buttons call this. */
  onCycleVersion?: (next: number) => void;
  /** Branch a new session containing the conversation up to this message. */
  onForkHere?: () => void;
  /** Drop this message into the composer as a `> quote`. */
  onQuote?: (text: string) => void;
}

function formatTime(iso: string): string {
  const d = parseServerTime(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric" }) + " " +
    d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function fmtElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = (ms / 1000).toFixed(1);
  return `${s}s`;
}

/* ── Written-file inline preview ───────────────────────────────────
 *
 * When a Write / Edit tool call produced a code file in this turn we
 * render the content inline as a syntax-highlighted code block. Saves
 * the user a click into the Activity pane just to see what landed.
 *
 * Skipped for `.html` (those should be inlined as <arzwidget>) and for
 * unknown / binary types.
 */
const _CODE_EXTS = new Set([
  "ts", "tsx", "js", "jsx", "mjs", "cjs",
  "py", "rb", "go", "rs", "java", "kt", "swift", "cs",
  "cpp", "cc", "c", "h", "hpp",
  "sh", "bash", "zsh", "fish",
  "css", "scss", "less", "vue", "svelte",
  "json", "yaml", "yml", "toml", "ini",
  "md", "mdx", "sql", "graphql", "gql", "proto",
  "lua", "pl", "scala", "clj", "ex", "exs", "elm", "erl", "dart",
]);

const _EXT_TO_LANG: Record<string, string> = {
  tsx: "tsx", ts: "typescript", jsx: "jsx", js: "javascript", mjs: "javascript", cjs: "javascript",
  py: "python", rb: "ruby", go: "go", rs: "rust", java: "java", kt: "kotlin", swift: "swift",
  cs: "csharp", cpp: "cpp", cc: "cpp", c: "c", h: "c", hpp: "cpp",
  sh: "bash", bash: "bash", zsh: "bash", fish: "bash",
  css: "css", scss: "scss", less: "less", vue: "html", svelte: "html",
  json: "json", yaml: "yaml", yml: "yaml", toml: "toml",
  md: "markdown", mdx: "markdown", sql: "sql",
};

function _extractFileWrite(input: string): { path: string; content: string } | null {
  if (!input) return null;
  const candidate = stripPyRepr(input);
  for (const text of [candidate, input]) {
    try {
      const obj = JSON.parse(text) as Record<string, unknown>;
      const fp = (obj.file_path || obj.path || obj.target_file) as string | undefined;
      const content = (obj.content || obj.new_string || obj.text) as string | undefined;
      if (typeof fp === "string" && typeof content === "string") {
        return { path: fp, content };
      }
    } catch { /* try next */ }
  }
  // Regex fallback: extract file_path and content even when surrounding JSON is malformed.
  const fpM = candidate.match(/['"]file_path['"]\s*:\s*['"]([^'"]+)['"]/);
  const contentM = candidate.match(/['"]content['"]\s*:\s*['"]([\s\S]*?)['"][,}]/);
  if (fpM && contentM) {
    let content = contentM[1].replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\"/g, '"');
    if (content.endsWith("\\")) content = content.slice(0, -1);
    return { path: fpM[1], content };
  }
  return null;
}

/** Edits show as diffs (old → new); MultiEdit fans out to one card per
 *  hunk. Keep a turn's diff stack readable by collapsing past this many. */
const MAX_OPEN_DIFFS = 3;

function WrittenFilePreview({
  calls,
  onOpenFile,
}: {
  calls: ToolCallRecord[];
  onOpenFile?: (path: string) => void;
}) {
  const previews = useMemo(() => {
    type Preview =
      | { kind: "file"; key: string; path: string; content: string; ext: string }
      | { kind: "diff"; key: string; path: string; oldText: string; newText: string };
    const out: Preview[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < calls.length; i++) {
      const c = calls[i];
      if (!/^(Write|Edit|MultiEdit|create_file|write_file|write_to_file|str_replace)$/i.test(c.name)) continue;
      const edits = extractEditChanges(c.name, c.input);
      if (edits.length > 0) {
        edits.forEach((e, j) => out.push({ kind: "diff", key: `${i}-${j}-${e.path}`, ...e }));
        continue;
      }
      const got = _extractFileWrite(c.input);
      if (!got || !got.content) continue;
      const ext = (got.path.split(".").pop() || "").toLowerCase();
      if (ext === "html" || ext === "htm") continue;          // these become widgets
      if (!_CODE_EXTS.has(ext)) continue;                     // skip binary/unknown
      // Dedupe by path — same Write retried only renders once.
      if (seen.has(got.path)) continue;
      seen.add(got.path);
      out.push({ kind: "file", key: `${i}-${got.path}`, path: got.path, content: got.content, ext });
    }
    return out;
  }, [calls]);

  if (previews.length === 0) return null;
  let diffs = 0;
  return (
    <div className="mb-2 flex flex-col gap-2">
      {previews.map((p) =>
        p.kind === "file" ? (
          <WrittenFilePreviewCard key={p.key} path={p.path} content={p.content} ext={p.ext} onOpenFile={onOpenFile} />
        ) : (
          <EditDiffBlock
            key={p.key}
            path={p.path}
            oldText={p.oldText}
            newText={p.newText}
            onOpenFile={onOpenFile}
            defaultOpen={diffs++ < MAX_OPEN_DIFFS}
          />
        ),
      )}
    </div>
  );
}

function WrittenFilePreviewCard({
  path,
  content,
  ext,
  onOpenFile,
}: {
  path: string;
  content: string;
  ext: string;
  onOpenFile?: (path: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const name = path.split(/[\\/]/).pop() || path;
  const lang = _EXT_TO_LANG[ext] || ext;
  const lineCount = content.split("\n").length;
  return (
    <div
      style={{
        border: "1px solid var(--cedar-line)",
        borderRadius: 10,
        overflow: "hidden",
        background: "var(--bg)",
      }}
    >
      {/* Header chrome — matches Widget.tsx exactly so cards align visually. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 10px",
          background: "var(--cedar-dim)",
          borderBottom: collapsed ? "none" : "1px solid var(--cedar-line)",
          fontFamily: "var(--fm)",
          fontSize: 11,
          color: "var(--cedar-glow)",
        }}
      >
        <button
          onClick={() => setCollapsed((v) => !v)}
          title={collapsed ? "Expand" : "Collapse"}
          style={{
            background: "transparent",
            border: "none",
            cursor: "pointer",
            color: "var(--cedar-glow)",
            display: "flex",
            alignItems: "center",
            padding: 0,
          }}
        >
          {collapsed ? "▸" : "▾"}
        </button>
        <span
          onClick={onOpenFile ? () => onOpenFile(path) : undefined}
          style={{
            color: "var(--cedar-glow)",
            cursor: onOpenFile ? "pointer" : "default",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            maxWidth: "60%",
          }}
          title={onOpenFile ? `Open ${path}` : path}
        >
          {name}
        </span>
        <span
          style={{
            fontSize: 9.5,
            color: "var(--muted)",
            textTransform: "uppercase",
            letterSpacing: ".08em",
          }}
        >
          {lang} · {lineCount} line{lineCount === 1 ? "" : "s"}
        </span>
      </div>
      {/* One renderer to rule them all — same component the Activity panel
          uses for its full-page viewer. Markdown gets prose mode, code
          gets hljs, HTML/CSV/JSON/Image each get their own view. */}
      {!collapsed && (
        <FileBody path={path} content={content} maxHeight={480} />
      )}
    </div>
  );
}

export default function MessageBubble({
  message,
  onFileOpen,
  onSendText,
  onCompare,
  isLastUser,
  isLastAssistant,
  onEditResend,
  onRegenerate,
  onCycleVersion,
  onForkHere,
  onQuote,
}: Props) {
  const isUser = message.role === "user";
  // Strip inline tags (recall/learn/semantic/etc) for assistant messages.
  // The server cleans before save, but old sessions may still hold raw
  // tags, and the same util is used by ChatPanel's live stream view —
  // keeping both paths consistent.
  const displayText = useMemo(
    () => (isUser ? message.text : stripInlineTags(message.text)),
    [message.text, isUser],
  );
  // A trailing `[OPTIONS: A | B | C]` becomes buttons, not literal text —
  // the choice the assistant offered is one click instead of a retype.
  const { cleanedText, choices } = useMemo(
    () => (isUser ? { cleanedText: displayText, choices: [] } : extractOptions(displayText)),
    [displayText, isUser],
  );
  const segments = useMemo(() => segmentMessage(cleanedText), [cleanedText]);
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState(message.text);

  const versions = message.versions;
  const versionIndex = message.version_index ?? 0;
  const totalVersions = versions && versions.length > 0 ? versions.length : 1;
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [copiedKind, setCopiedKind] = useState<"md" | "rich" | null>(null);

  // Markdown source for user + assistant alike; options marker stripped so
  // a pasted reply doesn't carry the button syntax with it.
  const copySource = isUser ? message.text : cleanedText;
  const flashCopied = (kind: "md" | "rich") => {
    setCopiedKind(kind);
    setTimeout(() => setCopiedKind(null), 1500);
  };
  const copyMarkdown = async () => {
    await copyText(copySource);
    flashCopied("md");
  };
  // Rich copy: rendered HTML + markdown fallback, so pasting into a doc
  // or email keeps headings / tables / code formatting.
  const copyRich = async () => {
    const html = bodyRef.current?.innerHTML ?? "";
    try {
      if (!html || typeof ClipboardItem === "undefined") throw new Error("no rich clipboard");
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([copySource], { type: "text/plain" }),
        }),
      ]);
    } catch {
      await copyText(copySource);
    }
    flashCopied("rich");
  };
  const actionCls =
    "text-[var(--muted)] hover:text-[var(--cedar-glow)] transition-colors flex items-center gap-1";

  return (
    <div className={`group flex ${isUser ? "justify-end" : "justify-start"} mb-4`}>
      {!isUser && (
        <div className="w-7 h-7 rounded-full bg-[var(--cedar-dim)] border border-[var(--cedar-line)] text-[var(--cedar-glow)] flex items-center justify-center mr-2.5 mt-0.5 shrink-0">
          <CedarMark size={16} />
        </div>
      )}

      {/* Assistant column fills the row so tables / code / diffs get the
          full width instead of shrinking to their intrinsic size. */}
      <div
        className={`flex flex-col gap-0.5 ${isUser ? "items-end" : "flex-1 min-w-0"}`}
        style={{ maxWidth: isUser ? "75%" : "calc(100% - 38px)" }}
      >
        {/* A steered turn never started a turn of its own — say so, or it
            reads as an ordinary message the agent silently ignored. */}
        {isUser && message.steer && (
          <span className="flex items-center gap-1 self-end px-1 text-[9.5px] font-mono uppercase tracking-wider text-[var(--cedar-glow)]">
            <Crosshair size={10} /> steered into the running turn
          </span>
        )}
        <div
          ref={bodyRef}
          className={[
            "text-[14px] break-words",
            isUser
              ? "px-3.5 py-2 rounded-[14px] rounded-br-[4px] bg-[var(--user-bg)] border border-[var(--user-bd)] text-[var(--text)] whitespace-pre-wrap"
              // Assistant: no bubble. Markdown sits flush with the cedar
              // mark — matches the design spec ("only the user has a
              // bubble, Arz speaks plainly").
              : "text-[var(--text)]",
          ].join(" ")}
        >
          {isUser ? (
            editing ? (
              <div className="flex flex-col gap-2 min-w-[260px]">
                <textarea
                  value={editDraft}
                  onChange={(e) => setEditDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                      e.preventDefault();
                      const t = editDraft.trim();
                      if (t && t !== message.text) {
                        onEditResend?.(t);
                      }
                      setEditing(false);
                    } else if (e.key === "Escape") {
                      setEditing(false);
                      setEditDraft(message.text);
                    }
                  }}
                  rows={Math.min(8, Math.max(2, editDraft.split("\n").length))}
                  className="bg-[var(--bg)] border border-[var(--border)] rounded-md p-2 text-[13px] text-[var(--text)] focus:outline-none focus:border-[var(--cedar)] resize-y w-full"
                  autoFocus
                />
                <div className="flex items-center justify-end gap-2 text-[11px]">
                  <span className="text-[var(--muted)]">⌘+Enter to resend · Esc to cancel</span>
                  <button
                    onClick={() => { setEditing(false); setEditDraft(message.text); }}
                    className="px-2 py-0.5 rounded text-[var(--muted)] hover:text-[var(--text)]"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      const t = editDraft.trim();
                      if (t && t !== message.text) onEditResend?.(t);
                      setEditing(false);
                    }}
                    className="px-2 py-0.5 rounded bg-[var(--cedar)] text-white"
                  >
                    Resend
                  </button>
                </div>
              </div>
            ) : (
              // User bubble. Most messages render as plain text, but
              // goal-auto follow-up prompts (kickoff + auto-iteration)
              // arrive wrapped in <goal-auto> tags so the agent loop
              // is visible to the user. Split + render the chip form
              // when present; otherwise just emit the raw text.
              (() => {
                const userSegs = splitGoalTags(message.text);
                if (userSegs.length === 1 && userSegs[0].kind === "text") {
                  return message.text;
                }
                return userSegs.map((seg, idx) =>
                  seg.kind === "goal-auto" ? (
                    <GoalAutoCard key={idx} attrs={seg.attrs} body={seg.body} />
                  ) : seg.kind === "goal-marker" ? (
                    <GoalMarkerChip key={idx} attrs={seg.attrs} />
                  ) : seg.kind === "text" ? (
                    seg.value.trim() ? (
                      <span key={idx} style={{ whiteSpace: "pre-wrap" }}>{seg.value}</span>
                    ) : null
                  ) : null,
                );
              })()
            )
          ) : (
            <>
              {message.thinking && <ThinkingBlock text={message.thinking} />}
              {message.tool_calls && message.tool_calls.length > 0 && (
                <>
                  <InlineToolStrip
                    calls={message.tool_calls}
                    onOpenFile={onFileOpen}
                  />
                  <WrittenFilePreview
                    calls={message.tool_calls}
                    onOpenFile={onFileOpen}
                  />
                </>
              )}
              {segments.map((seg, segIdx) =>
                seg.kind === "widget" ? (
                  <Widget key={segIdx} title={seg.title} html={seg.html} onAction={onSendText} />
                ) : seg.kind === "goal-marker" ? (
                  <GoalMarkerChip key={segIdx} attrs={seg.attrs} />
                ) : seg.kind === "goal-auto" ? (
                  <GoalAutoCard key={segIdx} attrs={seg.attrs} body={seg.body} />
                ) : !seg.value.trim() ? null : (
                  <ChatMarkdown key={segIdx} text={seg.value} onFileOpen={onFileOpen} />
                )
              )}
            </>
          )}
        </div>

        {/* Ranked next-actions, newest reply only — see SuggestedActions. */}
        {isLastAssistant && onSendText && (
          <SuggestedActions choices={choices} onPick={onSendText} />
        )}

        {/* Footer. Assistant: time · duration · tools · model · tokens stay
            visible (users scan usage at a glance); actions appear on hover.
            User: everything on hover — the bubble speaks for itself. */}
        <div
          className={`flex items-center gap-2.5 px-1 min-h-[16px] text-[10.5px] text-[var(--muted)] ${
            isUser ? "justify-end opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity" : "justify-start"
          }`}
        >
          <span className="font-mono" title={parseServerTime(message.created_at).toLocaleString()}>
            {formatTime(message.created_at)}
          </span>
          {!isUser && message.elapsed_ms !== undefined && (
            <span className="font-mono">{fmtElapsed(message.elapsed_ms)}</span>
          )}
          {!isUser && message.tool_calls && message.tool_calls.length > 0 && (
            <span
              className="flex items-center gap-0.5 font-mono"
              title={`${message.tool_calls.length} tool call${message.tool_calls.length === 1 ? "" : "s"}`}
            >
              <Wrench size={9.5} />
              {message.tool_calls.length}
            </span>
          )}
          {!isUser && message.model && (
            <span className="font-mono" title={message.model}>
              {shortModel(message.model)}
            </span>
          )}
          {!isUser && message.usage && (message.usage.input_tokens > 0 || message.usage.output_tokens > 0) && (
            <span
              className="font-mono"
              title={`in ${message.usage.input_tokens} • out ${message.usage.output_tokens} • cache+ ${message.usage.cache_creation_input_tokens} • cache↻ ${message.usage.cache_read_input_tokens}`}
            >
              {formatTokens(message.usage.input_tokens)}↑ {formatTokens(message.usage.output_tokens)}↓
            </span>
          )}
          {!isUser && message.usage && (message.usage.credits ?? 0) > 0 && (
            <span
              className="font-mono"
              title={`${message.usage.credits!.toFixed(4)} ${message.usage.credit_unit || "credits"}`}
            >
              {message.usage.credits!.toFixed(3)} ¢
            </span>
          )}
          {!isUser && totalVersions > 1 && onCycleVersion && (
            <span className="flex items-center gap-1">
              <button
                onClick={() => onCycleVersion((versionIndex - 1 + totalVersions) % totalVersions)}
                className="hover:text-[var(--text)]"
                title="Previous version"
              >‹</button>
              <span className="font-mono">{versionIndex + 1}/{totalVersions}</span>
              <button
                onClick={() => onCycleVersion((versionIndex + 1) % totalVersions)}
                className="hover:text-[var(--text)]"
                title="Next version"
              >›</button>
            </span>
          )}
          {!editing && (
            <span className="flex items-center gap-2.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
              {!isUser && <span className="w-px h-2.5 bg-[var(--border)]" />}
              <button onClick={copyMarkdown} className={actionCls} title={isUser ? "Copy" : "Copy as Markdown"}>
                {copiedKind === "md" ? <Check size={10} /> : <Copy size={10} />}
                {copiedKind === "md" ? "copied" : "copy"}
              </button>
              {!isUser && (
                <button onClick={copyRich} className={actionCls} title="Copy as rich text (keeps formatting when pasted)">
                  {copiedKind === "rich" ? <Check size={10} /> : <Copy size={10} />}
                  {copiedKind === "rich" ? "copied" : "rich"}
                </button>
              )}
              {onQuote && (
                <button onClick={() => onQuote(copySource)} className={actionCls} title="Quote into composer">
                  <Quote size={10} /> quote
                </button>
              )}
              {onForkHere && (
                <button onClick={onForkHere} className={actionCls} title="Fork a new session from this point">
                  <GitBranch size={10} /> fork
                </button>
              )}
              {!isUser && onCompare && (
                <button onClick={onCompare} className={actionCls} title="Compare with another model">
                  <ArrowLeftRight size={10} /> compare
                </button>
              )}
              {isUser && isLastUser && onEditResend && (
                <button
                  onClick={() => { setEditDraft(message.text); setEditing(true); }}
                  className={actionCls}
                  title="Edit & resend"
                >
                  <Pencil size={10} /> edit
                </button>
              )}
              {!isUser && isLastAssistant && onRegenerate && (
                <button onClick={onRegenerate} className={actionCls} title="Regenerate this reply">
                  <RotateCcw size={10} /> regenerate
                </button>
              )}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
