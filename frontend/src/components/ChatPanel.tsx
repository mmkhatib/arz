import { useEffect, useRef, useState } from "react";
import { api } from "@/api/client";
import type { MessageRecord, SessionDetail } from "@/api/client";
import MessageBubble from "./MessageBubble";
import InputBar, { type ApprovalMode } from "./InputBar";
import CollapsibleToolGroup from "./CollapsibleToolGroup";

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

interface Props {
  sessionId: string;
  onToolCall?: (tc: { callId: string; name: string; input: string; time: string }) => void;
  onToolResult?: (callId: string, content: string) => void;
  activityOpen?: boolean;
  onToggleActivity?: () => void;
  onTitleChange?: (title: string) => void;
  onSseEvent?: (type: string, summary?: string) => void;
}

export default function ChatPanel({
  sessionId,
  onToolCall,
  onToolResult,
  activityOpen,
  onToggleActivity,
  onTitleChange,
  onSseEvent,
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
  const firstUserMsgRef = useRef<string>("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    setMessages([]);
    setStreamBuffer("");
    setError(null);
    setTitle("New session");
    api.getSession(sessionId)
      .then((s: SessionDetail) => {
        setMessages(s.messages);
        setTitle(s.title);
      })
      .catch((e: Error) => setError(e.message));
  }, [sessionId]);

  useEffect(() => {
    api.getSettings().then((s) => setSettings({ model: s.model })).catch(() => {});
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamBuffer]);

  const handleApprovalModeChange = (mode: ApprovalMode) => {
    setApprovalMode(mode);
    api.setApprovalMode(sessionId, mode).catch(() => {});
  };

  const handleStop = () => {
    abortRef.current?.();
  };

  const handleSend = async (message: string) => {
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
    abortRef.current = () => { aborted = true; setStreaming(false); setStreamBuffer(""); };

    try {
      const response = await api.sendMessage(sessionId, message);
      if (!response.ok) {
        throw new Error(`${response.status}: ${await response.text()}`);
      }

      let fullText = "";
      for await (const chunk of api.streamChat(response)) {
        if (aborted) break;

        if (chunk.type === "text_chunk" && chunk.text) {
          fullText += chunk.text;
          setStreamBuffer(fullText);
          onSseEvent?.("text_chunk");
        } else if (chunk.type === "tool_call" && chunk.tool_name) {
          const callId = chunk.request_id || chunk.tool_name! + Date.now();
          const tc = { callId, name: chunk.tool_name!, input: chunk.tool_input || "", time: new Date().toLocaleTimeString() };
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
      {/* Session header */}
      <div className="shrink-0 px-6 py-3 border-b border-[var(--border)] bg-[var(--surface)] flex items-center">
        <h2 className="text-[13px] font-medium text-[var(--text)] truncate">{title}</h2>
        <div className="ml-auto flex items-center gap-1">
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
          <div className="flex flex-col items-center justify-center h-full text-center">
            <span className="text-6xl mb-4">🌲</span>
            <h2 className="text-[var(--text)] text-xl font-medium mb-2">Hello! I'm Arzeh.</h2>
            <p className="text-[var(--muted)] text-[14px] max-w-xs">
              Your cedar — rooted, persistent, always here.
            </p>
          </div>
        )}

        {messages.map((msg, i) => (
          <MessageBubble key={i} message={msg} />
        ))}

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
        disabled={false}
        isRunning={streaming}
        contextPct={contextPct}
        model={settings?.model}
        approvalMode={approvalMode}
        onApprovalModeChange={handleApprovalModeChange}
      />
    </div>
  );
}
