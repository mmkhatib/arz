import { useEffect, useRef, useState, useCallback } from "react";
import { ArrowUp, ArrowUpFromLine, Square, ShieldCheck, BookOpen, Handshake, Rocket, Check, Paperclip, X, ChevronDown, Bot, Sparkles, Loader2 } from "lucide-react";

// Per-provider accent — matches the chat badges + analytics legend.
const PROVIDER_ACCENT: Record<string, string> = {
  "claude-code": "#e8884a",
  "kiro-cli":    "#5fa0d6",
  codex:         "#6abf7c",
  gemini:        "#7cb8c8",
  ollama:        "#c878d6",
  anthropic:     "#a884e8",
};
function providerAccent(p?: string | null): string {
  return (p && PROVIDER_ACCENT[p]) || "var(--cedar-glow)";
}
import type { UploadedFile } from "@/api/client";
import { api } from "@/api/client";
import ContextRing from "./ContextRing";
import Popover from "./Popover";
import { modelsForProvider, defaultModelForProvider, isModelValid, PROVIDER_LABELS } from "@/utils/models";
import { useOllamaInstalledModels } from "@/hooks/useOllamaInstalledModels";

export type ApprovalMode = "normal" | "trust_reads" | "trust" | "yolo";

const APPROVAL_OPTIONS: { mode: ApprovalMode; label: string; icon: React.ReactNode; hint: string; color: string }[] = [
  { mode: "normal",      label: "Normal", icon: <ShieldCheck size={13} />, hint: "Ask before every tool",          color: "text-[var(--muted)]" },
  { mode: "trust_reads", label: "Reads",  icon: <BookOpen size={13} />,    hint: "Auto-approve read-only tools",   color: "text-blue-400" },
  { mode: "trust",       label: "Trust",  icon: <Handshake size={13} />,   hint: "Auto-approve all tools",         color: "text-green-400" },
  { mode: "yolo",        label: "YOLO",   icon: <Rocket size={13} />,      hint: "No approval prompts at all",     color: "text-red-400" },
];


const INPUT_MIN_H = 44;
const INPUT_MAX_H = 140;
const INPUT_DRAG_MIN_H = 120;
const INPUT_HEIGHT_LS_KEY = "arz-input-height";

interface Props {
  onSend: (message: string, files?: UploadedFile[]) => void;
  onStop?: () => void;
  onUpload?: (files: File[]) => Promise<UploadedFile[]>;
  disabled: boolean;
  isRunning?: boolean;
  contextPct?: number;
  contextEstimated?: boolean;
  model?: string;
  provider?: string;
  approvalMode?: ApprovalMode;
  onApprovalModeChange?: (mode: ApprovalMode) => void;
  onModelChange?: (model: string) => void;
  agent?: string | null;
  agents?: { name: string; description?: string; provider?: string }[];
  onAgentChange?: (agent: string | null) => void;
  /** Increment to request focus on the textarea (e.g., re-clicking the active session). */
  focusSignal?: number;
  /** When set, the unsent draft is persisted to localStorage keyed by this id. */
  draftKey?: string;
  /** Preview of the next message that will fire once the current turn ends. */
  queuedPreview?: string | null;
  onCancelQueued?: () => void;
  /** Session id is needed so the "improve with AI" rewrite mirrors the
   *  active session's provider/model. */
  sessionId?: string | null;
}

export default function InputBar({
  onSend,
  onStop,
  onUpload,
  disabled,
  isRunning = false,
  contextPct = 0,
  contextEstimated = false,
  model,
  provider,
  approvalMode = "normal",
  onApprovalModeChange,
  onModelChange,
  agent,
  agents = [],
  onAgentChange,
  focusSignal,
  draftKey,
  queuedPreview = null,
  onCancelQueued,
  sessionId = null,
}: Props) {
  const [pendingFiles, setPendingFiles] = useState<UploadedFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUpload = useCallback(
    async (files: File[]) => {
      if (!onUpload || files.length === 0) return;
      setUploading(true);
      setUploadError(null);
      try {
        const saved = await onUpload(files);
        setPendingFiles((prev) => [...prev, ...saved]);
      } catch (e) {
        setUploadError(e instanceof Error ? e.message : String(e));
      } finally {
        setUploading(false);
      }
    },
    [onUpload],
  );

  const removePending = (path: string) => {
    setPendingFiles((prev) => prev.filter((f) => f.path !== path));
  };

  const _draftStorageKey = draftKey ? `arz:draft:${draftKey}` : null;
  const [value, setValue] = useState<string>(() => {
    if (!_draftStorageKey) return "";
    try { return localStorage.getItem(_draftStorageKey) ?? ""; } catch { return ""; }
  });

  // Re-hydrate when the active session changes (key swap).
  useEffect(() => {
    if (!_draftStorageKey) { setValue(""); return; }
    try { setValue(localStorage.getItem(_draftStorageKey) ?? ""); } catch { setValue(""); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey]);

  // Persist on every keystroke (light-write; localStorage handles fine).
  useEffect(() => {
    if (!_draftStorageKey) return;
    try {
      if (value) localStorage.setItem(_draftStorageKey, value);
      else localStorage.removeItem(_draftStorageKey);
    } catch {}
  }, [value, _draftStorageKey]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const dragStartY = useRef(0);
  const dragStartH = useRef(0);
  const [manualHeight, setManualHeight] = useState<number | null>(() => {
    const saved = localStorage.getItem(INPUT_HEIGHT_LS_KEY);
    const n = saved ? parseInt(saved, 10) : NaN;
    return !isNaN(n) && n >= INPUT_DRAG_MIN_H ? n : null;
  });
  const [approvalOpen, setApprovalOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);

  useEffect(() => {
    if (!disabled && !isRunning) textareaRef.current?.focus();
    // Re-read draft on focus bump too — lets parent components (e.g.
    // suggestion-pill click) seed the composer by writing to
    // localStorage and bumping focusSignal.
    if (_draftStorageKey) {
      try {
        const fresh = localStorage.getItem(_draftStorageKey) ?? "";
        if (fresh && fresh !== value) setValue(fresh);
      } catch { /* ignore */ }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled, isRunning, focusSignal]);

  useEffect(() => {
    if (!wrapperRef.current) return;
    if (manualHeight !== null) {
      wrapperRef.current.style.height = Math.max(manualHeight, INPUT_DRAG_MIN_H) + "px";
    } else {
      wrapperRef.current.style.height = "";
    }
  }, [manualHeight]);

  const applyHeight = useCallback(() => {
    if (!textareaRef.current || dragging.current || manualHeight !== null) return;
    const el = textareaRef.current;
    el.style.height = "auto";
    el.style.height = Math.max(INPUT_MIN_H, Math.min(el.scrollHeight, INPUT_MAX_H)) + "px";
  }, [manualHeight]);

  useEffect(() => { applyHeight(); }, [value, applyHeight]);

  const prevValue = useRef(value);
  useEffect(() => {
    if (prevValue.current && !value) {
      setManualHeight(null);
      localStorage.removeItem(INPUT_HEIGHT_LS_KEY);
      if (wrapperRef.current) wrapperRef.current.style.height = "";
    }
    prevValue.current = value;
  }, [value]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current || !wrapperRef.current) return;
      const maxH = window.innerHeight * 0.5;
      const delta = dragStartY.current - e.clientY;
      const h = Math.min(maxH, Math.max(INPUT_DRAG_MIN_H, dragStartH.current + delta));
      wrapperRef.current.style.height = h + "px";
    };
    const onUp = () => {
      if (!dragging.current || !wrapperRef.current) return;
      dragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      const finalH = wrapperRef.current.offsetHeight;
      setManualHeight(finalH);
      localStorage.setItem(INPUT_HEIGHT_LS_KEY, String(Math.round(finalH)));
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, []);

  const handleDragStart = (e: React.MouseEvent) => {
    e.preventDefault();
    if (!wrapperRef.current) return;
    dragging.current = true;
    dragStartY.current = e.clientY;
    dragStartH.current = wrapperRef.current.offsetHeight;
    setManualHeight(wrapperRef.current.offsetHeight);
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
  };

  const resetHeight = () => {
    setManualHeight(null);
    localStorage.removeItem(INPUT_HEIGHT_LS_KEY);
    if (wrapperRef.current) wrapperRef.current.style.height = "";
  };

  const [improving, setImproving] = useState(false);
  const [improveErr, setImproveErr] = useState<string | null>(null);

  const handleImprove = async () => {
    const draft = value.trim();
    if (!draft || improving || disabled) return;
    setImproving(true);
    setImproveErr(null);
    try {
      const { improved } = await api.improvePrompt(draft, sessionId || undefined);
      if (improved && improved !== draft) {
        setValue(improved);
        // Pop focus back into the textarea so the user can edit further.
        textareaRef.current?.focus();
      }
    } catch (e) {
      setImproveErr(e instanceof Error ? e.message : String(e));
      // Auto-clear so the inline error doesn't linger.
      window.setTimeout(() => setImproveErr(null), 4000);
    } finally {
      setImproving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Ctrl/Cmd + Enter = improve with AI instead of send. The improved
    // text replaces the draft so the user can still review before
    // sending.
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void handleImprove();
      return;
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  const submit = () => {
    const msg = value.trim();
    const files = pendingFiles;
    if ((!msg && files.length === 0) || disabled) return;
    setValue("");
    setPendingFiles([]);
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    onSend(msg, files.length > 0 ? files : undefined);
  };

  const activeApproval = APPROVAL_OPTIONS.find((o) => o.mode === approvalMode) ?? APPROVAL_OPTIONS[0];
  // Hydrate the dynamic Ollama list (no-op for non-ollama sessions; the
  // hook short-circuits on subsequent mounts).
  useOllamaInstalledModels();
  const providerModels = modelsForProvider(provider);
  const effectiveModel = isModelValid(provider, model) ? (model as string) : defaultModelForProvider(provider);
  const activeModel = providerModels.find((m) => m.id === effectiveModel);

  // Persist the resolved default up to the session so the picker, the badge,
  // and the provider all agree.
  useEffect(() => {
    if (effectiveModel && effectiveModel !== model) {
      onModelChange?.(effectiveModel);
    }
  }, [effectiveModel, model, onModelChange]);

  const hasInput = value.trim().length > 0;

  return (
    <div className="px-4 pb-3 pt-0 max-w-[900px] mx-auto w-full flex flex-col">
      {/* Drag handle */}
      <div
        className="flex items-center justify-center h-[6px] cursor-row-resize group/drag"
        onMouseDown={handleDragStart}
        onDoubleClick={resetHeight}
        title="Drag to resize"
      >
        <div className="w-10 h-[3px] rounded-full bg-[var(--border)] group-hover/drag:bg-[var(--cedar)] transition-colors duration-200" />
      </div>

      {/* Pending uploads */}
      {(pendingFiles.length > 0 || uploading || uploadError) && (
        <div className="flex flex-wrap gap-1.5 mb-1.5 px-1">
          {pendingFiles.map((f) => (
            <span
              key={f.path}
              className="inline-flex items-center gap-1 text-[11px] bg-[var(--surface)] border border-[var(--border)] rounded-lg px-2 py-1 text-[var(--muted)]"
              title={f.path}
            >
              <Paperclip size={11} />
              <span className="max-w-[160px] truncate">{f.name}</span>
              <button
                onClick={() => removePending(f.path)}
                className="text-[var(--muted)] hover:text-red-400"
                aria-label={`Remove ${f.name}`}
              >
                <X size={11} />
              </button>
            </span>
          ))}
          {uploading && <span className="text-[11px] text-[var(--muted)] animate-pulse">Uploading…</span>}
          {uploadError && (
            <span className="text-[11px] text-red-400 bg-red-900/20 rounded-lg px-2 py-1">
              Upload failed: {uploadError}
            </span>
          )}
        </div>
      )}

      {/* Unified input container */}
      <div
        ref={wrapperRef}
        onDragOver={(e) => {
          if (onUpload && e.dataTransfer.types.includes("Files")) {
            e.preventDefault();
            setDragOver(true);
          }
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          if (!onUpload) return;
          e.preventDefault();
          setDragOver(false);
          const files = Array.from(e.dataTransfer.files);
          if (files.length > 0) handleUpload(files);
        }}
        className={[
          "rounded-2xl border bg-[var(--bg)] overflow-visible transition-colors",
          dragOver ? "border-[var(--cedar)] ring-2 ring-[var(--cedar)]/40" : "border-[var(--border)]",
          "focus-within:border-[var(--cedar)]/50",
          manualHeight !== null ? "flex flex-col min-h-0" : "",
        ].join(" ")}
      >
        {queuedPreview && (
          <div className="px-3 pt-2.5 flex items-start gap-2">
            <span className="text-[9px] font-mono uppercase tracking-wider text-[var(--cedar-glow)] mt-0.5 shrink-0">
              Queued ↩
            </span>
            <span className="flex-1 text-[11.5px] text-[var(--text2)] line-clamp-2 break-words">
              {queuedPreview}
            </span>
            {onCancelQueued && (
              <button
                onClick={onCancelQueued}
                title="Drop queued message"
                className="text-[var(--muted)] hover:text-red-400 text-[11px] shrink-0"
              >
                ✕
              </button>
            )}
          </div>
        )}
        <textarea
          ref={textareaRef}
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onInput={applyHeight}
          disabled={(disabled && !isRunning) || !!queuedPreview}
          placeholder={
            queuedPreview
              ? "One queued — waiting for the current reply…"
              : isRunning
              ? "Arzeh is thinking… (you can queue one)"
              : "Message Arzeh…"
          }
          rows={1}
          aria-label="Message input"
          className={[
            "w-full bg-transparent border-none px-4 pt-3 pb-1 text-[var(--text)] text-[14px]",
            "outline-none resize-none leading-normal placeholder:text-[var(--muted)]",
            manualHeight !== null ? "flex-1" : "",
            disabled && !isRunning ? "opacity-40 pointer-events-none" : "",
          ].join(" ")}
          style={manualHeight !== null ? { height: "100%" } : undefined}
        />

        {/* Bottom icon row */}
        <div className="flex items-center justify-between px-2.5 pb-2 pt-0.5 gap-2">
          {/* Left: provider chip + model + agent + approval mode */}
          <div className="flex items-center gap-1.5 min-w-0 overflow-visible flex-1 flex-wrap">
            {/* Provider chip — locked. The CLI/provider stays in color and
                isn't switchable from here. To change CLI, fork a new session. */}
            <span
              title={`Provider: ${PROVIDER_LABELS[provider ?? ""] ?? provider}`}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                height: 26,
                padding: "0 9px",
                background: "var(--bg)",
                border: `1px solid ${providerAccent(provider)}`,
                borderRadius: 6,
                fontSize: 11.5,
                fontFamily: "var(--fn)",
              }}
            >
              <ContextRing pct={contextPct} estimated={contextEstimated} />
              <span
                style={{
                  fontFamily: "var(--fm)",
                  fontSize: 9.5,
                  color: "var(--muted)",
                  textTransform: "uppercase",
                  letterSpacing: ".08em",
                }}
              >
                cli
              </span>
              <span style={{ color: providerAccent(provider), fontWeight: 500 }}>
                {PROVIDER_LABELS[provider ?? ""] ?? provider}
              </span>
            </span>

            {/* Model picker — same composer chip shape as the others */}
            {onModelChange ? (
              <div className="relative shrink-0">
                <button
                  onClick={() => { setModelOpen((v) => !v); setApprovalOpen(false); setAgentOpen(false); }}
                  title="Switch model"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    height: 26,
                    padding: "0 8px",
                    background: "var(--bg)",
                    border: "1px solid var(--border)",
                    borderRadius: 6,
                    color: "var(--text2)",
                    fontSize: 11.5,
                    cursor: "pointer",
                    fontFamily: "var(--fn)",
                  }}
                >
                  <span
                    style={{
                      fontFamily: "var(--fm)",
                      fontSize: 9.5,
                      color: "var(--muted)",
                      textTransform: "uppercase",
                      letterSpacing: ".08em",
                    }}
                  >
                    model
                  </span>
                  <span style={{ color: "var(--text)", fontWeight: 500 }} className="truncate max-w-[180px]">
                    {activeModel?.label ?? effectiveModel ?? "Model"}
                  </span>
                  <ChevronDown size={9} className="text-[var(--muted)]" />
                </button>
                <Popover open={modelOpen} onClose={() => setModelOpen(false)}>
                  <div className="px-1 py-0.5 min-w-[220px]">
                    <div className="px-2 py-1 text-[10px] text-[var(--muted)] uppercase tracking-wider font-medium">{PROVIDER_LABELS[provider ?? ""] ?? "Model"}</div>
                    {providerModels.length === 0 && provider === "ollama" ? (
                      <div className="px-2 py-2 text-[12px] text-[var(--muted)]">
                        No Ollama models installed locally.{" "}
                        <a
                          href="/models"
                          onClick={(e) => { e.preventDefault(); window.location.assign("/models"); }}
                          className="text-[var(--cedar)] hover:underline"
                        >
                          Pull one
                        </a>{" "}
                        to use this provider.
                      </div>
                    ) : (
                      providerModels.map((m) => (
                        <button
                          key={m.id}
                          onClick={() => {
                            onModelChange?.(m.id);
                            setModelOpen(false);
                          }}
                          className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-[13px] hover:bg-[var(--bg)] transition-colors text-left"
                        >
                          <span className="w-3 shrink-0">
                            {m.id === effectiveModel && <Check size={12} className="text-[var(--cedar)]" />}
                          </span>
                          <span className={m.id === effectiveModel ? "text-[var(--text)] font-medium" : "text-[var(--muted)]"}>
                            {m.label}
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                </Popover>
              </div>
            ) : null}

            {/* Agent picker */}
            {onAgentChange && (
              <div className="relative shrink-0">
                <button
                  onClick={() => { setAgentOpen((v) => !v); setModelOpen(false); setApprovalOpen(false); }}
                  title="Switch agent"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    height: 26,
                    padding: "0 8px",
                    background: "var(--bg)",
                    border: "1px solid var(--border)",
                    borderRadius: 6,
                    color: "var(--text2)",
                    fontSize: 11.5,
                    cursor: "pointer",
                    fontFamily: "var(--fn)",
                  }}
                >
                  <Bot size={11} className="text-[var(--cedar-2)]" />
                  <span
                    style={{
                      fontFamily: "var(--fm)",
                      fontSize: 9.5,
                      color: "var(--muted)",
                      textTransform: "uppercase",
                      letterSpacing: ".08em",
                    }}
                  >
                    agent
                  </span>
                  <span style={{ color: "var(--text)", fontWeight: 500 }} className="truncate max-w-[120px]">
                    {agent ?? "none"}
                  </span>
                  <ChevronDown size={9} className="text-[var(--muted)]" />
                </button>
                <Popover open={agentOpen} onClose={() => setAgentOpen(false)}>
                  <div className="min-w-[220px] max-w-[280px]">
                    <div className="px-2 py-1 text-[10px] text-[var(--muted)] uppercase tracking-wider font-medium border-b border-[var(--border)]">Agent (preset)</div>
                    <div className="max-h-[260px] overflow-y-auto px-1 py-0.5">
                      <button
                        onClick={() => { onAgentChange(null); setAgentOpen(false); }}
                        className="w-full flex items-center gap-2 px-2 py-1 rounded-md text-[12px] hover:bg-[var(--bg)] transition-colors text-left"
                      >
                        <span className="w-3 shrink-0">{!agent && <Check size={11} className="text-[var(--cedar)]" />}</span>
                        <span className={!agent ? "text-[var(--text)] font-medium" : "text-[var(--muted)] italic"}>(none)</span>
                      </button>
                      {agents.map((a) => (
                        <button
                          key={a.name}
                          onClick={() => { onAgentChange(a.name); setAgentOpen(false); }}
                          title={a.description || a.name}
                          className="w-full flex items-center gap-2 px-2 py-1 rounded-md text-[12px] hover:bg-[var(--bg)] transition-colors text-left"
                        >
                          <span className="w-3 shrink-0">{a.name === agent && <Check size={11} className="text-[var(--cedar)]" />}</span>
                          <span className={["truncate", a.name === agent ? "text-[var(--text)] font-medium" : "text-[var(--muted)]"].join(" ")}>{a.name}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </Popover>
              </div>
            )}

            {/* Approval mode picker */}
            {onApprovalModeChange && (
              <div className="relative shrink-0">
                <button
                  onClick={() => { setApprovalOpen((v) => !v); setModelOpen(false); setAgentOpen(false); }}
                  title={`Approval mode: ${activeApproval.label}`}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    height: 26,
                    padding: "0 8px",
                    background: approvalMode === "yolo" ? "rgba(180, 70, 70, 0.15)" : "var(--bg)",
                    border: `1px solid ${approvalMode === "yolo" ? "var(--ember)" : "var(--border)"}`,
                    borderRadius: 6,
                    color: "var(--text2)",
                    fontSize: 11.5,
                    cursor: "pointer",
                    fontFamily: "var(--fn)",
                  }}
                >
                  <span className={["shrink-0", activeApproval.color].join(" ")}>{activeApproval.icon}</span>
                  <span
                    style={{
                      fontFamily: "var(--fm)",
                      fontSize: 9.5,
                      color: "var(--muted)",
                      textTransform: "uppercase",
                      letterSpacing: ".08em",
                    }}
                  >
                    approval
                  </span>
                  <span style={{ color: "var(--text)", fontWeight: 500 }}>{activeApproval.label}</span>
                  <ChevronDown size={9} className="text-[var(--muted)]" />
                </button>
                <Popover open={approvalOpen} onClose={() => setApprovalOpen(false)}>
                  <div className="px-1 py-0.5">
                    <div className="px-2 py-1 text-[10px] text-[var(--muted)] uppercase tracking-wider font-medium">Approval Mode</div>
                    {APPROVAL_OPTIONS.map((opt) => (
                      <button
                        key={opt.mode}
                        onClick={() => { onApprovalModeChange(opt.mode); setApprovalOpen(false); }}
                        className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-[13px] hover:bg-[var(--bg)] transition-colors text-left"
                      >
                        <span className="w-3 shrink-0">
                          {opt.mode === approvalMode && <Check size={12} className="text-[var(--cedar)]" />}
                        </span>
                        <span className={`shrink-0 ${opt.color}`}>{opt.icon}</span>
                        <div className="min-w-0">
                          <div className={opt.mode === approvalMode ? "text-[var(--text)] font-medium" : "text-[var(--muted)]"}>
                            {opt.label}
                          </div>
                          <div className="text-[10px] text-[var(--muted)]/60">{opt.hint}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                </Popover>
              </div>
            )}
          </div>

          {/* Right: attach + send / stop / queue */}
          <div className="shrink-0 flex items-center gap-1">
            {onUpload && (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    const files = Array.from(e.target.files ?? []);
                    if (files.length > 0) handleUpload(files);
                    e.target.value = "";
                  }}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-8 h-8 rounded-lg text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface)] flex items-center justify-center transition-all"
                  title="Attach files (or drop into the input)"
                  aria-label="Attach files"
                >
                  <Paperclip size={15} />
                </button>
              </>
            )}
            {/* Improve-with-AI: rewrites the draft via a cheap one-shot.
                Also triggered by Ctrl/Cmd+Enter. Hidden when there's
                nothing to improve. */}
            {hasInput && (
              <button
                type="button"
                onClick={handleImprove}
                disabled={improving || disabled}
                className="w-8 h-8 rounded-lg text-[var(--muted)] hover:text-[var(--cedar)] hover:bg-[var(--surface)] disabled:opacity-50 flex items-center justify-center transition-all"
                title={
                  improveErr
                    ? `Improve failed: ${improveErr}`
                    : "Improve prompt with AI (Ctrl/Cmd+Enter)"
                }
                aria-label="Improve prompt with AI"
              >
                {improving ? (
                  <Loader2 size={15} className="animate-spin" />
                ) : (
                  <Sparkles size={15} className={improveErr ? "text-red-400" : ""} />
                )}
              </button>
            )}
            {isRunning && onStop ? (
              hasInput ? (
                <button
                  className="w-8 h-8 rounded-full bg-amber-500 text-white flex items-center justify-center hover:bg-amber-400 transition-all"
                  onClick={submit}
                  title="Queue message"
                >
                  <ArrowUpFromLine size={16} />
                </button>
              ) : (
                <button
                  className="w-8 h-8 rounded-lg text-red-400 hover:bg-red-400/10 flex items-center justify-center transition-all animate-pulse"
                  onClick={onStop}
                  title="Stop generation (double-click to force-kill)"
                >
                  <Square size={16} fill="currentColor" />
                </button>
              )
            ) : (
              <button
                onClick={submit}
                disabled={(!hasInput && pendingFiles.length === 0) || disabled}
                className="w-8 h-8 rounded-full bg-[var(--cedar)] text-white flex items-center justify-center hover:bg-[var(--cedar-lt)] disabled:opacity-40 transition-all"
              >
                <ArrowUp size={16} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
