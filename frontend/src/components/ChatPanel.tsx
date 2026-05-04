import { useEffect, useRef, useState } from "react";
import { api } from "@/api/client";
import type { MessageRecord, SessionDetail } from "@/api/client";
import MessageBubble from "./MessageBubble";
import InputBar, { type ApprovalMode } from "./InputBar";
import CollapsibleToolGroup from "./CollapsibleToolGroup";
import WelcomeView from "./WelcomeView";
import CompareModal from "./CompareModal";
import ThemeDropdown from "./ThemeDropdown";
import { GitBranch, Zap } from "lucide-react";
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
        title={messageCount < 2 ? "Send a message first" : "Rename this chat using the current model"}
        className="text-[11px] text-[var(--muted)] hover:text-[var(--cedar)] disabled:opacity-30 disabled:cursor-not-allowed shrink-0 transition-colors"
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
    outTok = 0,
    credits = 0,
    creditUnit = "";
  for (const m of messages) {
    if (!m.usage) continue;
    inTok += m.usage.input_tokens;
    outTok += m.usage.output_tokens;
    if (m.usage.credits) {
      credits += m.usage.credits;
      if (!creditUnit && m.usage.credit_unit) creditUnit = m.usage.credit_unit;
    }
  }
  if (inTok === 0 && outTok === 0 && credits === 0) return null;
  const tokenStr = inTok > 0 || outTok > 0 ? `${formatTokens(inTok)}↑ ${formatTokens(outTok)}↓` : "";
  const creditStr = credits > 0 ? `${credits.toFixed(3)} ${creditUnit || "¢"}` : "";
  const title = [
    inTok > 0 || outTok > 0 ? `tokens: ${inTok} in, ${outTok} out` : null,
    credits > 0 ? `${credits.toFixed(4)} ${creditUnit || "credits"}` : null,
  ].filter(Boolean).join(" • ");
  return (
    <span className="ml-3 text-[11px] font-mono text-[var(--muted)] flex items-center gap-2" title={title}>
      {tokenStr && <span>{tokenStr}</span>}
      {creditStr && <span>{creditStr}</span>}
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
  /** Switch the parent to display the newly-forked session. */
  onSessionForked?: (newSessionId: string) => void;
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
  onSessionForked,
}: Props) {
  const [messages, setMessages] = useState<MessageRecord[]>([]);
  const [title, setTitle] = useState<string>("New session");
  const [streaming, setStreaming] = useState(false);
  const [streamBuffer, setStreamBuffer] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [contextPct, setContextPct] = useState(0);
  const [estimatedContext, setEstimatedContext] = useState(false);
  const [toolCalls, setToolCalls] = useState<{ callId: string; name: string; input: string; state?: "running" | "done" | "rejected" | "error" }[]>([]);
  const [pendingApproval, setPendingApproval] = useState<{ requestId: string; title: string; toolInput: string } | null>(null);
  const [approvalMode, setApprovalMode] = useState<ApprovalMode>("normal");
  const [settings, setSettings] = useState<{ model: string } | null>(null);
  const [sessionProvider, setSessionProvider] = useState<string | null>(null);
  const [sessionModel, setSessionModel] = useState<string | null>(null);
  const [sessionAgent, setSessionAgent] = useState<string | null>(null);
  const [agents, setAgents] = useState<{ name: string; description?: string; provider?: string }[]>([]);
  const [workDir, setWorkDir] = useState("");
  const [compareTarget, setCompareTarget] = useState<{ prompt: string; baseline: string; baselineModel: string | null } | null>(null);
  const [autonudgeGoal, setAutonudgeGoal] = useState<string | null>(null);
  const [autonudgeIdleS, setAutonudgeIdleS] = useState<number>(0);
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
        setSessionProvider(s.provider ?? null);
        setSessionModel(s.model ?? null);
        setSessionAgent(s.agent ?? null);
        if (s.approval_mode) setApprovalMode(s.approval_mode);
        setAutonudgeGoal(s.autonudge_goal ?? null);
        setAutonudgeIdleS(s.autonudge_idle_s ?? 0);
        // If a turn is currently running for this session (e.g. the user
        // navigated away and came back), attach to its detached stream and
        // start showing live updates again.
        if (s.streaming) {
          reattachStream().catch(() => {});
        }
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
    api.listAgents().then((as) =>
      setAgents(as.map((a) => ({ name: a.name, description: a.description, provider: a.provider })))
    ).catch(() => {});
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

  // While a turn is in flight (locally OR detached on the server), poll
  // the session every 3s to pull in messages saved by _run_turn's
  // background task. This is a defensive backstop to the SSE reattach —
  // if the SSE connection has any trouble, the user still sees the reply
  // get added once the server persists it.
  useEffect(() => {
    if (!streaming) return;
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      try {
        const s = await api.getSession(sessionId);
        if (cancelled) return;
        // Replace messages if the server has more than we do. Conservative:
        // only update if the server count is strictly greater, so we don't
        // wipe in-flight optimistic state.
        setMessages((prev) => (s.messages.length > prev.length ? s.messages : prev));
        if (!s.streaming) {
          // Server says the turn finished — let our local "streaming" flag
          // catch up so the UI clears the "..." indicator.
          setStreaming(false);
          setStreamBuffer("");
        }
      } catch {}
    };
    const id = setInterval(tick, 3000);
    return () => { cancelled = true; clearInterval(id); };
  }, [streaming, sessionId]);

  // Client-side context estimate when the provider doesn't report it.
  // Approximation: ~4 chars/token, default 200k token window.
  useEffect(() => {
    if (contextPct > 0 && !estimatedContext) return;
    const chars = messages.reduce((n, m) => n + (m.text?.length ?? 0), 0) + streamBuffer.length;
    const estTokens = chars / 4;
    const window = 200_000;
    const pct = Math.min(99, (estTokens / window) * 100);
    if (Math.abs(pct - contextPct) > 0.5) {
      setContextPct(pct);
      setEstimatedContext(true);
    }
  }, [messages, streamBuffer, contextPct, estimatedContext]);

  const handleApprovalModeChange = (mode: ApprovalMode) => {
    setApprovalMode(mode);
    api.setApprovalMode(sessionId, mode).catch(() => {});
  };

  const handleModelChange = (model: string) => {
    setSessionModel(model);
    api.setSessionModel(sessionId, model).catch(() => {});
  };

  const handleAgentChange = (agent: string | null) => {
    // Switching agent on an active session changes role only — system
    // prompt + approval mode + tool allowlist. The current LLM (provider +
    // model) stays put. Don't re-sync sessionProvider/sessionModel.
    setSessionAgent(agent);
    api.setSessionAgent(sessionId, agent)
      .then(() => api.getSession(sessionId))
      .then((s) => {
        if (s.approval_mode) setApprovalMode(s.approval_mode);
      })
      .catch(() => {});
  };

  const handleWorkDirChange = (path: string) => {
    setWorkDir(path);
    api.setWorkDir(sessionId, path).catch(() => {});
  };

  // Double-tap (within 1.5s) forces an immediate hard-kill instead of
  // waiting out the cooperative cancel budget.
  const lastStopAtRef = useRef<number>(0);
  const handleStop = async () => {
    const now = Date.now();
    const isDoubleTap = now - lastStopAtRef.current < 1500;
    lastStopAtRef.current = now;
    abortRef.current?.();
    try {
      await api.stopChat(sessionId);
      if (isDoubleTap) {
        // Already aborted client-side; backend got a second stop signal
        // which short-circuits the 10s budget.
        await api.stopChat(sessionId);
      }
    } catch {
      // Best-effort — if the server is gone the local abort is enough.
    }
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

  // Drain an SSE Response, updating UI state as events arrive. Used for
  // both fresh sends (POST /api/chat) and re-attaches (GET /api/chat/{id}/stream).
  const consumeStream = async (response: Response, sendStart: number, abortFlagRef: { aborted: boolean }) => {
    let fullText = "";
    let turnUsage: import("@/api/client").UsageRecord | undefined;
    const turnToolCalls: { name: string; input: string }[] = [];
    for await (const chunk of api.streamChat(response)) {
      if (abortFlagRef.aborted) break;
      if (chunk.type === "text_chunk" && chunk.text) {
        fullText += chunk.text;
        setStreamBuffer(fullText);
        onSseEvent?.("text_chunk");
      } else if (chunk.type === "tool_call" && chunk.tool_name) {
        const callId = chunk.request_id || chunk.tool_name! + Date.now();
        const tc = { callId, name: chunk.tool_name!, input: chunk.tool_input || "", time: new Date().toLocaleTimeString() };
        turnToolCalls.push({ name: tc.name, input: tc.input });
        setToolCalls((prev) => [...prev, { callId: tc.callId, name: tc.name, input: tc.input, state: "running" }]);
        onToolCall?.(tc);
        onSseEvent?.("tool_call", chunk.tool_name);
      } else if (chunk.type === "tool_result" && chunk.tool_call_id) {
        onToolResult?.(chunk.tool_call_id, chunk.content || "");
        setToolCalls((prev) => prev.map((t) =>
          t.callId === chunk.tool_call_id ? { ...t, state: "done" } : t,
        ));
        onSseEvent?.("tool_result", chunk.tool_call_id);
      } else if (chunk.type === "permission_request" && chunk.request_id) {
        setPendingApproval({
          requestId: chunk.request_id!,
          title: chunk.title || chunk.tool_name || "Permission",
          toolInput: chunk.tool_input || "",
        });
        onSseEvent?.("permission_request", chunk.title);
      } else if (chunk.type === "complete") {
        if (chunk.context_pct) { setContextPct(chunk.context_pct); setEstimatedContext(false); }
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
    if (fullText && !abortFlagRef.aborted) {
      const assistantMsg: MessageRecord = {
        role: "assistant",
        text: fullText,
        created_at: new Date().toISOString(),
        tool_calls: turnToolCalls.length > 0 ? turnToolCalls : undefined,
        elapsed_ms: Date.now() - sendStart,
        usage: turnUsage,
      };
      // De-dupe: if the server already saved this message (we'll see it on
      // next getSession), skip the optimistic add. Crude heuristic: if the
      // last message is already an assistant message with the same text,
      // don't double-add.
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.role === "assistant" && last.text === fullText) return prev;
        return [...prev, assistantMsg];
      });
    }
  };

  const doSend = async (message: string, opts: { replaceLastUser?: boolean; regenerate?: boolean } = {}) => {
    const userMsg: MessageRecord = {
      role: "user",
      text: message,
      created_at: new Date().toISOString(),
    };
    if (messages.length === 0) {
      setTitle(message.slice(0, 60));
      firstUserMsgRef.current = message;
    }
    if (opts.replaceLastUser || opts.regenerate) {
      // Optimistic: drop the trailing assistant + (for replace) edit user text.
      setMessages((prev) => {
        const next = [...prev];
        while (next.length && next[next.length - 1].role === "assistant") next.pop();
        if (opts.replaceLastUser && next.length && next[next.length - 1].role === "user") {
          next[next.length - 1] = { ...next[next.length - 1], text: message };
        } else if (!opts.regenerate) {
          next.push(userMsg);
        }
        return next;
      });
    } else {
      setMessages((prev) => [...prev, userMsg]);
    }
    setStreaming(true);
    setStreamBuffer("");
    setError(null);
    setToolCalls([]);
    setPendingApproval(null);

    const abortFlag = { aborted: false };
    const sendStart = Date.now();
    abortRef.current = () => { abortFlag.aborted = true; setStreaming(false); setStreamBuffer(""); };

    try {
      const response = await api.sendMessage(sessionId, message, {
        replaceLastUser: opts.replaceLastUser,
        regenerate: opts.regenerate,
      });
      if (!response.ok) {
        throw new Error(`${response.status}: ${await response.text()}`);
      }
      await consumeStream(response, sendStart, abortFlag);
    } catch (e) {
      if (!abortFlag.aborted) setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStreaming(false);
      setStreamBuffer("");
      setPendingApproval(null);
      abortRef.current = null;
    }
  };

  // Re-attach to an in-flight turn — the LLM is running detached on the
  // server, this just streams the buffered + live events into the UI.
  const reattachStream = async () => {
    setStreaming(true);
    setStreamBuffer("");
    setError(null);
    setToolCalls([]);
    setPendingApproval(null);
    const abortFlag = { aborted: false };
    abortRef.current = () => { abortFlag.aborted = true; setStreaming(false); setStreamBuffer(""); };
    try {
      const response = await api.reattachStream(sessionId);
      if (!response.ok) {
        throw new Error(`${response.status}: ${await response.text()}`);
      }
      await consumeStream(response, Date.now(), abortFlag);
    } catch (e) {
      if (!abortFlag.aborted) setError(e instanceof Error ? e.message : String(e));
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
          <ThemeDropdown />
          <button
            onClick={async () => {
              try {
                const fork = await api.forkSession(sessionId);
                onSessionForked?.(fork.id);
              } catch (e) {
                console.error("fork failed", e);
              }
            }}
            title="Fork this session — clones full history into a new tab"
            className="text-[12px] px-2 py-1 rounded-lg text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--bg)] flex items-center gap-1"
          >
            <GitBranch size={12} /> Fork
          </button>
          <button
            onClick={async () => {
              const isOn = !!(autonudgeGoal && autonudgeIdleS > 0);
              if (isOn) {
                await api.setAutoNudge(sessionId, { goal: null, idle_s: 0 });
                setAutonudgeGoal(null);
                setAutonudgeIdleS(0);
                return;
              }
              const goal = window.prompt("AutoNudge goal — what should this session keep working on?", autonudgeGoal ?? "");
              if (!goal) return;
              const idleStr = window.prompt("Nudge after how many seconds of idle?", String(autonudgeIdleS || 120));
              const idle_s = Math.max(30, parseInt(idleStr || "120", 10) || 120);
              await api.setAutoNudge(sessionId, { goal, idle_s, reset_iterations: true });
              setAutonudgeGoal(goal);
              setAutonudgeIdleS(idle_s);
            }}
            title={
              autonudgeGoal && autonudgeIdleS > 0
                ? `AutoNudge ON · every ${autonudgeIdleS}s · "${autonudgeGoal}" — click to disable`
                : "AutoNudge — keep this session working toward a goal when idle"
            }
            className={[
              "text-[12px] px-2 py-1 rounded-lg flex items-center gap-1",
              autonudgeGoal && autonudgeIdleS > 0
                ? "text-amber-400 bg-amber-400/10 hover:bg-amber-400/20"
                : "text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--bg)]",
            ].join(" ")}
          >
            <Zap size={12} />
            {autonudgeGoal && autonudgeIdleS > 0 ? "Auto ON" : "Auto"}
          </button>
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
            model={sessionModel ?? settings?.model}
            onModelChange={handleModelChange}
            provider={sessionProvider ?? undefined}
            workDir={workDir}
            onWorkDirChange={handleWorkDirChange}
            agent={sessionAgent}
            agents={agents}
            onAgentChange={handleAgentChange}
          />
        )}

        {messages.map((msg, i) => {
          const prevUser = msg.role === "assistant"
            ? [...messages.slice(0, i)].reverse().find((m) => m.role === "user")
            : null;
          // "Last user/assistant" = the trailing message of its role in the
          // visible list. Used to show edit & regenerate affordances.
          const lastUserIdx = messages.map((m, idx) => m.role === "user" ? idx : -1).filter((x) => x >= 0).pop() ?? -1;
          const lastAsstIdx = messages.map((m, idx) => m.role === "assistant" ? idx : -1).filter((x) => x >= 0).pop() ?? -1;
          const isLastUser = i === lastUserIdx && !streaming;
          const isLastAssistant = i === lastAsstIdx && !streaming;
          return (
            <MessageBubble
              key={i}
              message={msg}
              onFileOpen={onFileOpen}
              isLastUser={isLastUser}
              isLastAssistant={isLastAssistant}
              onEditResend={isLastUser ? (text) => doSend(text, { replaceLastUser: true }) : undefined}
              onRegenerate={
                isLastAssistant && prevUser
                  ? () => doSend(prevUser.text, { regenerate: true })
                  : undefined
              }
              onCycleVersion={
                msg.role === "assistant" && msg.versions && msg.versions.length > 1
                  ? async (next) => {
                      try {
                        await api.selectMessageVersion(sessionId, i, next);
                        setMessages((prev) => prev.map((m, idx) => idx === i
                          ? { ...m, text: m.versions![next], version_index: next }
                          : m));
                      } catch (e) {
                        console.error("version select failed", e);
                      }
                    }
                  : undefined
              }
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
        contextEstimated={estimatedContext}
        model={sessionModel ?? settings?.model}
        provider={sessionProvider ?? undefined}
        approvalMode={approvalMode}
        onApprovalModeChange={handleApprovalModeChange}
        onModelChange={handleModelChange}
        agent={sessionAgent}
        agents={agents}
        onAgentChange={handleAgentChange}
        focusSignal={focusSignal}
        draftKey={sessionId}
      />
    </div>
  );
}
