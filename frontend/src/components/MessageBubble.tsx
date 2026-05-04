import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import type { MessageRecord } from "@/api/client";
import MermaidBlock from "./MermaidBlock";
import { formatTokens } from "@/utils/tokens";

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

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // fallback for non-HTTPS
      const el = document.createElement("textarea");
      el.value = text;
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
      className="absolute top-2 right-2 opacity-0 group-hover/code:opacity-100 transition-opacity px-2 py-0.5 rounded text-[11px] bg-[var(--border)] text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface)]"
    >
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}

function CodeBlock({ children, className }: { children?: React.ReactNode; className?: string }) {
  const lang = className?.match(/language-(\w+)/)?.[1] ?? "";
  const code = String(children ?? "").replace(/\n$/, "");

  if (lang === "mermaid") {
    return <MermaidBlock code={code} />;
  }

  return (
    <div className="relative group/code my-2">
      {lang && (
        <div className="flex items-center justify-between bg-[var(--surface)] border border-[var(--border)] rounded-t-lg px-3 py-1 border-b-0">
          <span className="text-[11px] text-[var(--muted)] font-mono">{lang}</span>
        </div>
      )}
      <code
        className={[
          "block bg-[var(--bg)] border border-[var(--border)] px-3 py-2 text-[13px] font-mono overflow-x-auto whitespace-pre",
          lang ? "rounded-b-lg" : "rounded-lg",
        ].join(" ")}
      >
        {code}
      </code>
      <CopyButton text={code} />
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

      <div className="flex flex-col gap-0.5 max-w-[75%]">
        <div
          className={[
            "px-4 py-2.5 rounded-2xl text-[14px] break-words",
            isUser
              ? "bg-[var(--user-bg)] text-[var(--text)] rounded-br-sm whitespace-pre-wrap"
              : "bg-[var(--asst-bg)] border border-[var(--border)] text-[var(--text)] rounded-bl-sm",
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
            <ReactMarkdown
              remarkPlugins={[remarkMath]}
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
                a: ({ href, children }) => (
                  <a href={href} target="_blank" rel="noopener noreferrer" className="text-[var(--accent)] underline underline-offset-2 hover:text-[var(--cedar-lt)]">
                    {children}
                  </a>
                ),
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
              {message.text}
            </ReactMarkdown>
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
