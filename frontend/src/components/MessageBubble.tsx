import { useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { FileBody } from "./FileViewer";
import type { MessageRecord } from "@/api/client";
import MermaidBlock from "./MermaidBlock";
import { formatTokens } from "@/utils/tokens";
import Widget from "./Widget";

type MsgSegment =
  | { kind: "text"; value: string }
  | { kind: "widget"; title: string; html: string };

const _WIDGET_OPEN = /<(arzwidget|mcwidget)(\s+[^>]*)?>/i;

/* Path-shaped tokens we want to make click-to-open. Catches:
 *   /abs/posix/path.ext
 *   ./rel/path.ext  ../rel/path.ext  rel/path.ext  rel\\path.ext
 *   C:\\Users\\foo\\bar.ext   C:/Users/foo/bar.ext
 * Bare filenames must have a known-ish extension to qualify (≤8 chars,
 * alphanumeric) so we don't wrap "etc." or "fig.4".
 */
const _PATH_RE =
  /(?<![\w/\\-])((?:[A-Za-z]:[\\/][^\s"'`<>()\[\]{}|]+\.[A-Za-z0-9]{1,8})|(?:\.{1,2}[\\/][^\s"'`<>()\[\]{}|]+\.[A-Za-z0-9]{1,8})|(?:\/[\w.\-_~][\w.\-_~/]*\.[A-Za-z0-9]{1,8})|(?:[\w.\-_~]+[\\/][\w.\-_~][\w.\-_~\\/]*\.[A-Za-z0-9]{1,8}))(?![\w])/g;

/** remark plugin: split text nodes on path-shaped tokens and replace
 *  matches with synthetic link nodes carrying `#arz-file:<path>`. The
 *  ReactMarkdown `a` override below intercepts the scheme and renders a
 *  themed click-to-open pill. */
function remarkFilePaths() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return () => (tree: any) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const visit = (node: any) => {
      if (!node || !node.children) return;
      // Skip code blocks / inline code / our own synthetic links.
      if (node.type === "code" || node.type === "inlineCode") return;
      if (
        node.type === "link" &&
        typeof node.url === "string" &&
        node.url.startsWith("#arz-file:")
      ) {
        return;
      }
      const out: unknown[] = [];
      for (const child of node.children) {
        if (child.type !== "text" || typeof child.value !== "string") {
          out.push(child);
          continue;
        }
        const v: string = child.value;
        let last = 0;
        let m: RegExpExecArray | null;
        _PATH_RE.lastIndex = 0;
        let pushed = false;
        while ((m = _PATH_RE.exec(v)) !== null) {
          pushed = true;
          if (m.index > last) out.push({ type: "text", value: v.slice(last, m.index) });
          out.push({
            type: "link",
            url: `#arz-file:${m[1]}`,
            children: [{ type: "text", value: m[1] }],
          });
          last = m.index + m[0].length;
        }
        if (!pushed) out.push(child);
        else if (last < v.length) out.push({ type: "text", value: v.slice(last) });
      }
      node.children = out;
      for (const c of out as { type: string; children?: unknown }[]) {
        if (c.children) visit(c);
      }
    };
    visit(tree);
  };
}

// Split a chat message into text and widget chunks so the widget body
// (raw HTML + scripts) bypasses ReactMarkdown / sanitisation entirely.
function splitWidgets(text: string): MsgSegment[] {
  if (!text || (!text.includes("<arzwidget") && !text.includes("<mcwidget"))) {
    return [{ kind: "text", value: text }];
  }
  const out: MsgSegment[] = [];
  let rest = text;
  while (rest.length > 0) {
    const open = rest.match(_WIDGET_OPEN);
    if (!open || open.index === undefined) {
      out.push({ kind: "text", value: rest });
      break;
    }
    if (open.index > 0) {
      out.push({ kind: "text", value: rest.slice(0, open.index) });
    }
    const tag = open[1];
    const attrs = open[2] || "";
    const tagEnd = open.index + open[0].length;
    const closeRe = new RegExp(`</${tag}\\s*>`, "i");
    const closeMatch = rest.slice(tagEnd).match(closeRe);
    if (!closeMatch || closeMatch.index === undefined) {
      out.push({ kind: "text", value: rest });
      break;
    }
    const body = rest.slice(tagEnd, tagEnd + closeMatch.index);
    const titleMatch =
      attrs.match(/title\s*=\s*"([^"]*)"/i) || attrs.match(/title\s*=\s*'([^']*)'/i);
    out.push({
      kind: "widget",
      title: (titleMatch?.[1] || "Widget").slice(0, 120),
      html: body.trim(),
    });
    rest = rest.slice(tagEnd + closeMatch.index + closeMatch[0].length);
  }
  return out;
}

function shortModel(model: string): string {
  // Compress "claude-opus-4-7" → "Opus 4.7", "claude-haiku-4-5-20251001" → "Haiku 4.5"
  const m = model.match(/claude-(opus|sonnet|haiku)-(\d+)-(\d+)/i);
  if (m) return `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}.${m[3]}`;
  return model.length > 24 ? model.slice(0, 24) + "…" : model;
}

interface Props {
  message: MessageRecord;
  onFileOpen?: (path: string) => void;
  onCompare?: () => void;
  /** Last-user-message gets a pencil for in-place edit + resend. */
  isLastUser?: boolean;
  /** Last-assistant-message gets a ↻ for regenerate (re-runs prior user turn). */
  isLastAssistant?: boolean;
  onEditResend?: (text: string) => void;
  onRegenerate?: () => void;
  /** When this assistant message has multiple versions, ◀▶ buttons call this. */
  onCycleVersion?: (next: number) => void;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric" }) + " " +
    d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function fmtElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = (ms / 1000).toFixed(1);
  return `${s}s`;
}

/* Copy-to-clipboard helper.
 *
 * Two modes: `text` (we already have the raw string) or `targetRef`
 * (read textContent off the rendered DOM, used when the body is a tree
 * of rehype-highlight spans rather than a string).
 */
function CopyButton({
  text,
  targetRef,
}: {
  text?: string;
  targetRef?: React.RefObject<HTMLElement | null>;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    const payload = text ?? targetRef?.current?.textContent ?? "";
    if (!payload) return;
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
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={copy}
      title="Copy code"
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
      {copied ? "Copied ✓" : "Copy"}
    </button>
  );
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

function _stripPyRepr(raw: string): string {
  // Claude Code wraps tool input as `{'raw': '<json>'}`. Pull the inner.
  const m = raw.match(/^\s*\{\s*['"]raw['"]\s*:\s*['"]([\s\S]*)['"]\s*\}\s*$/);
  if (!m) return raw;
  return m[1].replace(/\\\\/g, "\\").replace(/\\"/g, '"').replace(/\\'/g, "'");
}

function _extractFileWrite(input: string): { path: string; content: string } | null {
  if (!input) return null;
  const candidate = _stripPyRepr(input);
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

function WrittenFilePreview({
  calls,
  onOpenFile,
}: {
  calls: { name: string; input: string }[];
  onOpenFile?: (path: string) => void;
}) {
  const previews = useMemo(() => {
    const out: { key: string; path: string; content: string; ext: string }[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < calls.length; i++) {
      const c = calls[i];
      if (!/^(Write|Edit|MultiEdit|create_file|write_file|write_to_file|str_replace)$/i.test(c.name)) continue;
      const got = _extractFileWrite(c.input);
      if (!got || !got.content) continue;
      const ext = (got.path.split(".").pop() || "").toLowerCase();
      if (ext === "html" || ext === "htm") continue;          // these become widgets
      if (!_CODE_EXTS.has(ext)) continue;                     // skip binary/unknown
      // Dedupe by path — same Write retried only renders once.
      if (seen.has(got.path)) continue;
      seen.add(got.path);
      out.push({ key: `${i}-${got.path}`, path: got.path, content: got.content, ext });
    }
    return out;
  }, [calls]);

  if (previews.length === 0) return null;
  return (
    <div className="mb-2 flex flex-col gap-2">
      {previews.map(({ key, path, content, ext }) => (
        <WrittenFilePreviewCard key={key} path={path} content={content} ext={ext} onOpenFile={onOpenFile} />
      ))}
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

function CodeBlock({ children, className }: { children?: React.ReactNode; className?: string }) {
  const lang = className?.match(/language-(\w+)/)?.[1] ?? "";
  const codeRef = useRef<HTMLElement | null>(null);

  if (lang === "mermaid") {
    // Mermaid renders to SVG; preserve old path.
    const code = typeof children === "string" ? children : "";
    return <MermaidBlock code={code} />;
  }

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
      {/* Header chrome — matches Widget / WrittenFilePreviewCard so
          inline ```fenced``` blocks read as part of the same family
          of renderer cards. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "6px 10px",
          background: "var(--cedar-dim)",
          borderBottom: "1px solid var(--cedar-line)",
          fontFamily: "var(--fm)",
          fontSize: 10,
          color: "var(--cedar-glow)",
          textTransform: "uppercase",
          letterSpacing: ".08em",
        }}
      >
        <span>{lang || "code"}</span>
        <span style={{ flex: 1 }} />
        <CopyButton targetRef={codeRef} />
      </div>
      <pre
        style={{
          margin: 0,
          padding: "10px 14px",
          background: "var(--bg)",
          color: "var(--text)",
          fontFamily: "var(--fm)",
          fontSize: 12.5,
          lineHeight: 1.55,
          overflowX: "auto",
          whiteSpace: "pre",
        }}
      >
        <code ref={codeRef} className={className}>{children}</code>
      </pre>
    </div>
  );
}

export default function MessageBubble({
  message,
  onFileOpen,
  onCompare,
  isLastUser,
  isLastAssistant,
  onEditResend,
  onRegenerate,
  onCycleVersion,
}: Props) {
  const isUser = message.role === "user";
  const segments = useMemo(() => splitWidgets(message.text), [message.text]);
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState(message.text);

  const versions = message.versions;
  const versionIndex = message.version_index ?? 0;
  const totalVersions = versions && versions.length > 0 ? versions.length : 1;

  return (
    <div className={`group flex ${isUser ? "justify-end" : "justify-start"} mb-4`}>
      {!isUser && (
        <div className="w-7 h-7 rounded-full bg-[var(--cedar)] flex items-center justify-center text-[12px] mr-2 mt-0.5 shrink-0">
          🌲
        </div>
      )}

      <div
        className="flex flex-col gap-0.5"
        style={{ maxWidth: isUser ? "72%" : "calc(100% - 36px)" }}
      >
        <div
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
              message.text
            )
          ) : (
            <>
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
                  <Widget key={segIdx} title={seg.title} html={seg.html} />
                ) : !seg.value.trim() ? null : (
              <ReactMarkdown
              key={segIdx}
              remarkPlugins={[remarkMath, remarkFilePaths()]}
              rehypePlugins={[rehypeKatex]}
              components={{
                p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                code: ({ children, className }) => {
                  const isBlock = className?.includes("language-");
                  if (isBlock) {
                    return <CodeBlock className={className}>{children}</CodeBlock>;
                  }
                  const text = String(children ?? "");
                  const isPath = onFileOpen && text.startsWith("/") && text.length > 3 && !text.includes("\n");
                  return (
                    <code
                      className={[
                        "bg-[var(--bg)] border border-[var(--border)] rounded px-1 py-0.5 text-[12px] font-mono",
                        isPath ? "cursor-pointer text-[var(--cedar)] hover:underline hover:border-[var(--cedar)]/50" : "",
                      ].join(" ")}
                      onClick={isPath ? () => onFileOpen!(text) : undefined}
                      title={isPath ? `Open ${text}` : undefined}
                    >
                      {children}
                    </code>
                  );
                },
                pre: ({ children }) => <>{children}</>,
                ul: ({ children }) => <ul className="list-disc pl-5 mb-2 space-y-0.5">{children}</ul>,
                ol: ({ children }) => <ol className="list-decimal pl-5 mb-2 space-y-0.5">{children}</ol>,
                li: ({ children }) => <li className="text-[14px]">{children}</li>,
                strong: ({ children }) => <strong className="font-semibold text-[var(--text)]">{children}</strong>,
                a: ({ href, children }) => {
                  // arz-file scheme: clickable themed pill that opens the
                  // referenced file in the Activity pane.
                  if (typeof href === "string" && href.startsWith("#arz-file:")) {
                    const path = href.slice("#arz-file:".length);
                    return (
                      <span
                        onClick={onFileOpen ? () => onFileOpen(path) : undefined}
                        title={onFileOpen ? `Open ${path}` : path}
                        className={[
                          "inline-flex items-center px-1 py-0.5 rounded border text-[12px] font-mono",
                          "border-[var(--cedar)]/40 bg-[var(--cedar)]/10 text-[var(--cedar)]",
                          onFileOpen ? "cursor-pointer hover:bg-[var(--cedar)]/20 hover:border-[var(--cedar)]" : "",
                        ].join(" ")}
                      >
                        {children}
                      </span>
                    );
                  }
                  return (
                    <a href={href} target="_blank" rel="noopener noreferrer" className="text-[var(--accent)] underline underline-offset-2 hover:text-[var(--cedar-lt)]">
                      {children}
                    </a>
                  );
                },
                h1: ({ children }) => <h1 className="text-[16px] font-semibold mb-1 mt-2">{children}</h1>,
                h2: ({ children }) => <h2 className="text-[15px] font-semibold mb-1 mt-2">{children}</h2>,
                h3: ({ children }) => <h3 className="text-[14px] font-semibold mb-1 mt-1">{children}</h3>,
                table: ({ children }) => (
                  <div className="overflow-x-auto my-2">
                    <table className="text-[13px] border-collapse w-full">{children}</table>
                  </div>
                ),
                th: ({ children }) => (
                  <th className="border border-[var(--border)] px-3 py-1.5 bg-[var(--surface)] text-left font-semibold text-[var(--text)]">
                    {children}
                  </th>
                ),
                td: ({ children }) => (
                  <td className="border border-[var(--border)] px-3 py-1.5 text-[var(--text)]">
                    {children}
                  </td>
                ),
                blockquote: ({ children }) => (
                  <blockquote className="border-l-2 border-[var(--cedar)] pl-3 text-[var(--muted)] italic my-2">
                    {children}
                  </blockquote>
                ),
                hr: () => <hr className="border-[var(--border)] my-3" />,
              }}
            >
              {seg.value}
            </ReactMarkdown>
                )
              )}
            </>
          )}
        </div>

        {/* Footer: timestamp + model + usage. Always visible — usage is
            information users want to see at a glance, not on hover. */}
        <div className={`flex items-center gap-2 px-1 text-[10px] text-[var(--muted)]/70 ${isUser ? "justify-end" : "justify-start"}`}>
          <span className="font-mono">{formatTime(message.created_at)}</span>
          {!isUser && message.elapsed_ms !== undefined && (
            <span className="font-mono">{fmtElapsed(message.elapsed_ms)}</span>
          )}
          {!isUser && message.tool_calls && message.tool_calls.length > 0 && (
            <span className="flex items-center gap-0.5">
              <span>🔧</span>
              <span>{message.tool_calls.length}</span>
            </span>
          )}
          {!isUser && message.model && (
            <span className="font-mono text-[var(--muted)]" title={message.model}>
              {shortModel(message.model)}
            </span>
          )}
          {!isUser && message.usage && (message.usage.input_tokens > 0 || message.usage.output_tokens > 0) && (
            <span
              className="font-mono"
              title={`in ${message.usage.input_tokens} • out ${message.usage.output_tokens} • cache+ ${message.usage.cache_creation_input_tokens} • cache↻ ${message.usage.cache_read_input_tokens}`}
            >
              {formatTokens(message.usage.input_tokens)}↑
              {" "}
              {formatTokens(message.usage.output_tokens)}↓
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
          {!isUser && onCompare && (
            <button
              onClick={onCompare}
              className="text-[var(--muted)] hover:text-[var(--cedar)] transition-colors"
              title="Compare with another model"
            >
              ↔ compare
            </button>
          )}
          {isUser && (
            <button
              onClick={async () => {
                try { await navigator.clipboard.writeText(message.text); } catch {}
              }}
              className="text-[var(--muted)] hover:text-[var(--cedar)] transition-colors opacity-0 group-hover:opacity-100"
              title="Copy"
            >
              ⧉ copy
            </button>
          )}
          {isUser && isLastUser && onEditResend && !editing && (
            <button
              onClick={() => { setEditDraft(message.text); setEditing(true); }}
              className="text-[var(--muted)] hover:text-[var(--cedar)] transition-colors"
              title="Edit & resend"
            >
              ✎ edit
            </button>
          )}
          {!isUser && isLastAssistant && onRegenerate && (
            <button
              onClick={onRegenerate}
              className="text-[var(--muted)] hover:text-[var(--cedar)] transition-colors"
              title="Regenerate this reply"
            >
              ↻ regenerate
            </button>
          )}
          {!isUser && totalVersions > 1 && onCycleVersion && (
            <span className="flex items-center gap-1 text-[var(--muted)]">
              <button
                onClick={() => onCycleVersion((versionIndex - 1 + totalVersions) % totalVersions)}
                className="hover:text-[var(--text)]"
                title="Previous version"
              >◀</button>
              <span className="font-mono">{versionIndex + 1}/{totalVersions}</span>
              <button
                onClick={() => onCycleVersion((versionIndex + 1) % totalVersions)}
                className="hover:text-[var(--text)]"
                title="Next version"
              >▶</button>
            </span>
          )}
        </div>
      </div>

      {isUser && (
        <div className="w-7 h-7 rounded-full bg-[var(--border)] flex items-center justify-center text-[12px] ml-2 mt-0.5 shrink-0">
          👤
        </div>
      )}
    </div>
  );
}

// ── Inline tool strip — shows tool calls in-bubble ────────────
// Single call: one row. 2-3 calls: flat list. 4+: collapsed-by-default
// "N tools" header with the first 3 shown, the rest behind a toggle.
// Click any row with a file_path / path / target_file argument and
// the FileViewer opens (when onOpenFile is wired).
function InlineToolStrip({
  calls,
  onOpenFile,
}: {
  calls: { name: string; input: string }[];
  onOpenFile?: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState(calls.length < 4);
  if (calls.length === 0) return null;
  const visible = expanded ? calls : calls.slice(0, 3);
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
            borderBottom: expanded ? "1px solid var(--hairline)" : "none",
          }}
        >
          <span style={{ fontSize: 11 }}>{expanded ? "▾" : "▸"}</span>
          <span style={{ textTransform: "uppercase", letterSpacing: ".08em" }}>
            {calls.length} tool{calls.length === 1 ? "" : "s"}
          </span>
          <span style={{ color: "var(--muted)", flex: 1 }}>
            {calls.slice(0, 4).map((c) => c.name).join(" · ")}
            {calls.length > 4 ? " · …" : ""}
          </span>
        </button>
      )}
      {expanded &&
        visible.map((c, i) => <InlineToolRow key={i} call={c} onOpenFile={onOpenFile} />)}
      {expanded && !expanded /* placeholder */}
      {expanded && calls.length > visible.length && (
        <div
          style={{
            padding: "5px 10px",
            fontSize: 10.5,
            fontFamily: "var(--fm)",
            color: "var(--muted)",
            borderTop: "1px solid var(--hairline)",
          }}
        >
          +{calls.length - visible.length} more
        </div>
      )}
    </div>
  );
}

function InlineToolRow({
  call,
  onOpenFile,
}: {
  call: { name: string; input: string };
  onOpenFile?: (path: string) => void;
}) {
  const { summary, filePath } = (() => {
    try {
      const obj = JSON.parse(call.input) as Record<string, unknown>;
      const fp = (obj.file_path || obj.path || obj.target_file || obj.filename) as
        | string
        | undefined;
      const cmd = (obj.command || obj.cmd) as string | undefined;
      const q = (obj.pattern || obj.query) as string | undefined;
      const first = Object.values(obj).find((v) => typeof v === "string") as
        | string
        | undefined;
      return {
        summary: cmd || q || fp || first || "",
        filePath: typeof fp === "string" ? fp : null,
      };
    } catch {
      return { summary: call.input.slice(0, 120), filePath: null };
    }
  })();
  const clickable = !!(filePath && onOpenFile);
  return (
    <div
      onClick={clickable ? () => onOpenFile!(filePath!) : undefined}
      title={clickable ? `Open ${filePath}` : call.input}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "5px 10px 5px 24px",
        fontSize: 11.5,
        fontFamily: "var(--fm)",
        color: "var(--text2)",
        cursor: clickable ? "pointer" : "default",
        borderTop: "1px solid var(--hairline)",
        transition: "background 100ms",
      }}
      onMouseEnter={(e) => {
        if (clickable) e.currentTarget.style.background = "var(--bg)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
      }}
    >
      <span
        style={{
          width: 5,
          height: 5,
          borderRadius: "50%",
          background: "var(--cedar-2)",
          flexShrink: 0,
        }}
      />
      <span style={{ color: "var(--cedar-glow)", flexShrink: 0 }}>{call.name}</span>
      <span
        style={{
          color: "var(--muted)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          flex: 1,
        }}
      >
        {summary}
      </span>
    </div>
  );
}
