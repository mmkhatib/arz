import { useState } from "react";
import ReactMarkdown from "react-markdown";
import type { MessageRecord } from "@/api/client";
import MermaidBlock from "./MermaidBlock";

interface Props {
  message: MessageRecord;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
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

export default function MessageBubble({ message }: Props) {
  const isUser = message.role === "user";

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
            message.text
          ) : (
            <ReactMarkdown
              components={{
                p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                code: ({ children, className }) => {
                  const isBlock = className?.includes("language-");
                  if (isBlock) {
                    return <CodeBlock className={className}>{children}</CodeBlock>;
                  }
                  return (
                    <code className="bg-[var(--bg)] border border-[var(--border)] rounded px-1 py-0.5 text-[12px] font-mono">
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

        {/* Timestamp — visible on hover */}
        <span className="text-[10px] text-[var(--muted)] opacity-0 group-hover:opacity-100 transition-opacity px-1 self-end">
          {relativeTime(message.created_at)}
        </span>
      </div>

      {isUser && (
        <div className="w-7 h-7 rounded-full bg-[var(--border)] flex items-center justify-center text-[12px] ml-2 mt-0.5 shrink-0">
          👤
        </div>
      )}
    </div>
  );
}
