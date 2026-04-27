import { useEffect, useRef, useState } from "react";
import { api } from "@/api/client";
import type { MessageRecord, SessionDetail } from "@/api/client";
import MessageBubble from "./MessageBubble";
import InputBar, { type ApprovalMode } from "./InputBar";
import CollapsibleToolGroup from "./CollapsibleToolGroup";
import WelcomeView from "./WelcomeView";
import CompareModal from "./CompareModal";
import { formatTokens } from "@/utils/tokens";

function ThinkingDots() {
  return (
    <span className="inline-flex items-center gap-1 py-0.5">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="w-1.5 h-1.5 rounded-full bg-[var(--cedar)] opacity-60"
          style={{ animation: `arz-bounce 1.2s ease-in-out ${i * 0.2}s infinite` }}
        />
      ))}
    </span>
  );
}

function SessionTitle({
  title,
  messageCount,
  onRename,
  onRegenerate,
}: {
  title: string;
  messageCount: number;
  onRename: (next: string) => void | Promise<void>;
  onRegenerate: () => void | Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const [regenerating, setRegenerating] = useState(false);

  useEffect(() => {
    if (!editing) setDraft(title);
  }, [title, editing]);

  const commit = async () => {
    const next = draft.trim();
    if (next && next !== title) await onRename(next);
    setEditing(false);
  };

  const regenerate = async () => {
    if (regenerating || messageCount < 2) return;
    setRegenerating(true);
    try {
      await onRegenerate();
    } finally {
      setRegenerating(false);
    }
  };

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          else if (e.key === "Escape") { setDraft(title); setEditing(false); }
        }}
        className="flex-1 min-w-0 bg-[var(--bg)] border border-[var(--cedar)]/40 rounded px-2 py-0.5 text-[13px] font-medium text-[var(--text)] focus:outline-none"
        maxLength={200}
      />
    );
  }

  return (
    <div className="group flex items-center gap-1.5 min-w-0">
      <h2
        className="text-[13px] font-medium text-[var(--text)] truncate cursor-text"
        title="Click to rename"
        onClick={() => setEditing(true)}
      >
        {title}
      </h2>
      <button
        onClick={regenerate}
        disabled={regenerating || messageCount < 2}
        title={messageCount < 2 ? "Send a message first" : "Regenerate with AI"}
        className="opacity-0 group-hover:opacity-100 transition-opacity text-[10px] text-[var(--muted)] hover:text-[var(--cedar)] disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
      >
        {regenerating ? "…" : "✨"}
      </button>
    </div>
  );
}

function ExportMenu({ sessionId }: { sessionId: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const close = () => setOpen(false);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest("[data-export-menu]")) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const copyLink = () => {
    const url = `${window.location.origin}${window.location.pathname}#session=${sessionId}`;
    void navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
    close();
  };

  return (
    <div className="relative" data-export-menu>
      <button
        onClick={() => setOpen((v) => !v)}
        title="Export / share"
        className={[
          "text-[12px] px-2 py-1 rounded-lg transition-colors",
          open
            ? "bg-[var(--cedar)]/20 text-[var(--cedar)]"
            : "text-[var(--muted)] hover:text-[var(--text)]",
        ].join(" ")}
      >
        ⤓ Export
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-30 min-w-[180px] rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-xl py-1">
          <a
            href={api.exportSessionUrl(sessionId, "markdown")}
            onClick={close}
            className="block px-3 py-1.5 text-[12px] text-[var(--text)] hover:bg-[var(--bg)]"
          >
            Download Markdown
          </a>
          <a
            href={api.exportSessionUrl(sessionId, "json")}
            onClick={close}
            className="block px-3 py-1.5 text-[12px] text-[var(--text)] hover:bg-[var(--bg)]"
          >
            Download JSON
          </a>
          <button
            onClick={copyLink}
            className="block w-full text-left px-3 py-1.5 text-[12px] text-[var(--text)] hover:bg-[var(--bg)]"
          >
            {copied ? "Link copied ✓" : "Copy session link"}
          </button>
        </div>
      )}
    </div>
  );
}

function SessionTotals({ messages }: { messages: MessageRecord[] }) {
  let inTok = 0,
    outTok = 0;
  for (const m of messages) {
    if (!m.usage) continue;
    inTok += m.usage.input_tokens;
    outTok += m.usage.output_tokens;
  }
  if (inTok === 0 && outTok === 0) return null;
  return (
    <span
      className="ml-3 text-[11px] font-mono text-[var(--muted)]"
      title={`Session totals: ${inTok} in, ${outTok} out`}
    >
      {formatTokens(inTok)}↑ {formatTokens(outTok)}↓
    </span>
  );
}

interface Props {
  sessionId: string;
  onToolCall?: (tc: { callId: string; name: string; input: string; time: string }) => void;
  onToolResult?: (callId: string, content: string) => void;
  activityOpen?: boolean;
  onToggleActivity?: () => void;
  onTitleChange?: (title: string) => void;
  onSseEvent?: (type: string, summary?: string) => void;
  onSeedFiles?: (paths: string[]) => void;
  onFileOpen?: (path: string) => void;
  onOpenSidebar?: () => void;
  /** Counter from parent — when it changes, the input bar refocuses. */
  focusSignal?: number;
}

export default function ChatPanel({
  sessionId,
  onToolCall,
  onToolResult,
  activityOpen,
  onToggleActivity,
  onTitleChange,
  onSseEvent,
  onSeedFiles,
  onFileOpen,
  onOpenSidebar,
  focusSignal,
}: Props) {
  const [messages, setMessages] = useState<MessageRecord[]>([]);
  const [title, setTitle] = useState<string>("New session");
  const [streaming, setStreaming] = useState(false);
  const [streamBuffer, setStreamBuffer] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [contextPct, setContextPct] = useState(0);
  const [toolCalls, setToolCalls] = useState<{ callId: string; name: string; input: string }[]>([]);
  const [pendingApproval, setPendingApproval] = useState<{ requestId: string; title: string; toolInput: string } | null>(null);
  const [approvalMode, setApprovalMode] = useState<ApprovalMode>("normal");
  const [settings, setSettings] = useState<{ model: string } | null>(null);
  const [workDir, setWorkDir] = useState("");
  const [compareTarget, setCompareTarget] = useState<{ prompt: string; baseline: string; baselineModel: string | null } | null>(null);
  const firstUserMsgRef = useRef<string>("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    setMessages([]);
    setStreamBuffer("");
    setError(null);
    setTitle("New session");
    setWorkDir("");
    api.getSession(sessionId)
      .then((s: SessionDetail) => {
        setMessages(s.messages);
        setTitle(s.title);
        setWorkDir(s.work_dir ?? "");
        if (s.approval_mode) setApprovalMode(s.approval_mode);
        // Seed file paths from message history so the Files tab is pre-populated
        if (onSeedFiles) {
          const FILE_TOOL_NAMES = new Set(["Read", "Write", "Edit", "MultiEdit", "Glob", "Grep"]);
          const paths: string[] = [];
          const seen = new Set<string>();
          for (const msg of s.messages) {
            for (const tc of msg.tool_calls ?? []) {
              if (!FILE_TOOL_NAMES.has(tc.name)) continue;
              try {
                const obj = JSON.parse(tc.input) as Record<string, unknown>;
                const p = (obj.file_path || obj.path || obj.pattern) as string | undefined;
                if (p && !seen.has(p)) { seen.add(p); paths.push(p); }
              } catch {}
            }
          }
          if (paths.length > 0) onSeedFiles(paths);
        }
      })
      .catch((e: Error) => setError(e.message));
  }, [sessionId]);

  useEffect(() => {
    api.getSettings().then((s) => setSettings({ model: s.model })).catch(() => {});
  }, []);

  // Auto-send a prompt stashed by "Open subagent task as new session"
  useEffect(() => {
    const stashed = sessionStorage.getItem(`arz:autosend:${sessionId}`);
    if (stashed) {
      sessionStorage.removeItem(`arz:autosend:${sessionId}`);
      // wait one tick so the session details have loaded
      const t = setTimeout(() => handleSend(stashed), 100);
      return () => clearTimeout(t);
    }
  }, [sessionId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamBuffer]);

  const handleApprovalModeChange = (mode: ApprovalMode) => {
    setApprovalMode(mode);
    api.setApprovalMode(sessionId, mode).catch(() => {});
  };

  const handleModelChange = (model: string) => {
    setSettings((prev) => prev ? { ...prev, model } : { model });
    api.saveSettings({ model })
      .then(() => api.evictSession(sessionId))
      .catch(() => {});
  };

  const handleWorkDirChange = (path: string) => {
    setWorkDir(path);
    api.setWorkDir(sessionId, path).catch(() => {});
  };

  const handleStop = () => {
    abortRef.current?.();
  };

  const handleSend = async (message: string, files?: import("@/api/client").UploadedFile[]) => {
    if (files && files.length > 0) {
      const refs = files
        .map((f) => {
          const isImage = ["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(f.ext);
          const url = `/api/files/read?path=${encodeURIComponent(f.path)}`;
          return isImage ? `![${f.name}](${url})` : `- \`${f.path}\``;
        })
        .join("\n");
      message = message ? `${message}\n\n${refs}` : refs;
    }
    return doSend(message);
  };

  const doSend = async (message: string) => {
    const userMsg: MessageRecord = {
      role: "user",
      text: message,
      created_at: new Date().toISOString(),
    };
    if (messages.length === 0) {
      setTitle(message.slice(0, 60));
      firstUserMsgRef.current = message;
    }
    setMessages((prev) => [...prev, userMsg]);
    setStreaming(true);
    setStreamBuffer("");
    setError(null);
    setToolCalls([]);
    setPendingApproval(null);

    let aborted = false;
    const sendStart = Date.now();
    abortRef.current = () => { aborted = true; setStreaming(false); setStreamBuffer(""); };

    try {
      const response = await api.sendMessage(sessionId, message);
      if (!response.ok) {
        throw new Error(`${response.status}: ${await response.text()}`);
      }

      let fullText = "";
      let turnUsage: import("@/api/client").UsageRecord | undefined;
      const turnToolCalls: { name: string; input: string }[] = [];
      for await (const chunk of api.streamChat(response)) {
        if (aborted) break;

        if (chunk.type === "text_chunk" && chunk.text) {
          fullText += chunk.text;
          setStreamBuffer(fullText);
          onSseEvent?.("text_chunk");
        } else if (chunk.type === "tool_call" && chunk.tool_name) {
          const callId = chunk.request_id || chunk.tool_name! + Date.now();
          const tc = { callId, name: chunk.tool_name!, input: chunk.tool_input || "", time: new Date().toLocaleTimeString() };
          turnToolCalls.push({ name: tc.name, input: tc.input });
          setToolCalls((prev) => [...prev, { callId: tc.callId, name: tc.name, input: tc.input }]);
          onToolCall?.(tc);
          onSseEvent?.("tool_call", chunk.tool_name);
        } else if (chunk.type === "tool_result" && chunk.tool_call_id) {
          onToolResult?.(chunk.tool_call_id, chunk.content || "");
          onSseEvent?.("tool_result", chunk.tool_call_id);
        } else if (chunk.type === "permission_request" && chunk.request_id) {
          setPendingApproval({
            requestId: chunk.request_id!,
            title: chunk.title || chunk.tool_name || "Permission",
            toolInput: chunk.tool_input || "",
          });
          onSseEvent?.("permission_request", chunk.title);
        } else if (chunk.type === "complete") {
          if (chunk.context_pct) setContextPct(chunk.context_pct);
          if (chunk.usage) turnUsage = chunk.usage;
          if (messages.length === 0 && fullText && firstUserMsgRef.current) {
            api.generateTitle(sessionId, firstUserMsgRef.current, fullText).then((t) => {
              if (t) { setTitle(t); onTitleChange?.(t); }
            }).catch(() => {});
          }
          onSseEvent?.("complete");
          break;
        } else if (chunk.type === "error") {
          setError(chunk.message ?? "Unknown error");
          onSseEvent?.("error", chunk.message);
          break;
        }
      }

      if (fullText && !aborted) {
        const assistantMsg: MessageRecord = {
          role: "assistant",
          text: fullText,
          created_at: new Date().toISOString(),
          tool_calls: turnToolCalls.length > 0 ? turnToolCalls : undefined,
          elapsed_ms: Date.now() - sendStart,
          usage: turnUsage,
        };
        setMessages((prev) => [...prev, assistantMsg]);
      }
    } catch (e) {
      if (!aborted) setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStreaming(false);
      setStreamBuffer("");
      setPendingApproval(null);
      abortRef.current = null;
    }
  };

  return (
    <div className="flex flex-col flex-1 min-w-0 h-full">
      {compareTarget && (
        <CompareModal
          prompt={compareTarget.prompt}
          baselineReply={compareTarget.baseline}
          baselineModel={compareTarget.baselineModel}
          provider="claude-code"
          onClose={() => setCompareTarget(null)}
        />
      )}
      {/* Session header */}
      <div className="shrink-0 px-4 md:px-6 py-3 border-b border-[var(--border)] bg-[var(--surface)] flex items-center gap-2">
        {onOpenSidebar && (
          <button
            onClick={onOpenSidebar}
            className="md:hidden text-[var(--muted)] hover:text-[var(--text)] -ml-1 p-1"
            aria-label="Open sidebar"
            title="Open sidebar"
          >
            ☰
          </button>
        )}
        <SessionTitle
          title={title}
          messageCount={messages.length}
          onRename={async (next) => {
            try {
              await api.renameSession(sessionId, next);
              setTitle(next);
              onTitleChange?.(next);
            } catch (e) {
              console.error("rename failed", e);
            }
          }}
          onRegenerate={async () => {
            const generated = await api.generateTitle(sessionId);
            if (generated) {
              setTitle(generated);
              onTitleChange?.(generated);
            }
          }}
        />
        <SessionTotals messages={messages} />
        <div className="ml-auto flex items-center gap-1">
          <ExportMenu sessionId={sessionId} />
          {onToggleActivity && (
            <button
              onClick={onToggleActivity}
              title="Toggle activity pane"
              className={[
                "text-[12px] px-2 py-1 rounded-lg transition-colors",
                activityOpen
                  ? "bg-[var(--cedar)]/20 text-[var(--cedar)]"
                  : "text-[var(--muted)] hover:text-[var(--text)]",
              ].join(" ")}
            >
              ⚡ Activity
            </button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        {messages.length === 0 && !streaming && (
          <WelcomeView
            model={settings?.model}
            onModelChange={handleModelChange}
            workDir={workDir}
            onWorkDirChange={handleWorkDirChange}
          />
        )}

        {messages.map((msg, i) => {
          const prevUser = msg.role === "assistant"
            ? [...messages.slice(0, i)].reverse().find((m) => m.role === "user")
            : null;
          return (
            <MessageBubble
              key={i}
              message={msg}
              onFileOpen={onFileOpen}
              onCompare={
                msg.role === "assistant" && prevUser
                  ? () => setCompareTarget({
                      prompt: prevUser.text,
                      baseline: msg.text,
                      baselineModel: msg.model ?? settings?.model ?? null,
                    })
                  : undefined
              }
            />
          );
        })}

        {/* Live streaming bubble */}
        {streaming && (
          <div className="flex justify-start mb-4">
            <div className="w-7 h-7 rounded-full bg-[var(--cedar)] flex items-center justify-center text-[12px] mr-2 mt-0.5 shrink-0">
              🌲
            </div>
            <div className="max-w-[75%] px-4 py-2.5 rounded-2xl rounded-bl-sm bg-[var(--asst-bg)] border border-[var(--border)] text-[14px] whitespace-pre-wrap">
              {(toolCalls.length > 0 || pendingApproval) && (
                <div className="mb-2">
                  <CollapsibleToolGroup
                    toolCalls={toolCalls}
                    requestId={pendingApproval?.requestId}
                    permissionTitle={pendingApproval?.title}
                    permissionInput={pendingApproval?.toolInput}
                    isRunning={streaming}
                  />
                </div>
              )}
              {streamBuffer || <ThinkingDots />}
            </div>
          </div>
        )}

        {error && (
          <div className="mx-auto max-w-sm text-center text-[13px] text-red-400 bg-red-900/20 rounded-xl px-4 py-2 mb-4">
            {error}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <InputBar
        onSend={handleSend}
        onStop={handleStop}
        onUpload={(files) => api.uploadFiles(sessionId, files)}
        disabled={false}
        isRunning={streaming}
        contextPct={contextPct}
        model={settings?.model}
        approvalMode={approvalMode}
        onApprovalModeChange={handleApprovalModeChange}
        onModelChange={handleModelChange}
        focusSignal={focusSignal}
      />
    </div>
  );
}
