import ReactMarkdown from "react-markdown";
import type { MessageRecord } from "@/api/client";

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
              : "bg-[var(--asst-bg)] border border-[var(--border)] text-[var(--text)] rounded-bl-sm prose-arz",
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
                  return isBlock ? (
                    <code className="block bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-[13px] font-mono overflow-x-auto whitespace-pre my-2">
                      {children}
                    </code>
                  ) : (
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
