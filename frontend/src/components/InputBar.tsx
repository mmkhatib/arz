import { useEffect, useRef, useState, useCallback } from "react";
import { ArrowUp, ArrowUpFromLine, Square, ShieldCheck, BookOpen, Handshake, Rocket, Check } from "lucide-react";
import ContextRing from "./ContextRing";
import Popover from "./Popover";

export type ApprovalMode = "normal" | "trust_reads" | "trust" | "yolo";

const APPROVAL_OPTIONS: { mode: ApprovalMode; label: string; icon: React.ReactNode; hint: string; color: string }[] = [
  { mode: "normal",      label: "Normal", icon: <ShieldCheck size={13} />, hint: "Ask before every tool",          color: "text-[var(--muted)]" },
  { mode: "trust_reads", label: "Reads",  icon: <BookOpen size={13} />,    hint: "Auto-approve read-only tools",   color: "text-blue-400" },
  { mode: "trust",       label: "Trust",  icon: <Handshake size={13} />,   hint: "Auto-approve all tools",         color: "text-green-400" },
  { mode: "yolo",        label: "YOLO",   icon: <Rocket size={13} />,      hint: "No approval prompts at all",     color: "text-red-400" },
];

const KNOWN_MODELS = [
  { id: "claude-opus-4-7",           label: "Claude Opus 4.7" },
  { id: "claude-sonnet-4-6",         label: "Claude Sonnet 4.6" },
  { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
  { id: "claude-opus-4-5",           label: "Claude Opus 4.5" },
];

const INPUT_MIN_H = 44;
const INPUT_MAX_H = 140;
const INPUT_DRAG_MIN_H = 120;
const INPUT_HEIGHT_LS_KEY = "arz-input-height";

interface Props {
  onSend: (message: string) => void;
  onStop?: () => void;
  disabled: boolean;
  isRunning?: boolean;
  contextPct?: number;
  model?: string;
  approvalMode?: ApprovalMode;
  onApprovalModeChange?: (mode: ApprovalMode) => void;
  onModelChange?: (model: string) => void;
}

export default function InputBar({
  onSend,
  onStop,
  disabled,
  isRunning = false,
  contextPct = 0,
  model,
  approvalMode = "normal",
  onApprovalModeChange,
  onModelChange,
}: Props) {
  const [value, setValue] = useState("");
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

  useEffect(() => {
    if (!disabled && !isRunning) textareaRef.current?.focus();
  }, [disabled, isRunning]);

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

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  const submit = () => {
    const msg = value.trim();
    if (!msg || disabled) return;
    setValue("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    onSend(msg);
  };

  const activeApproval = APPROVAL_OPTIONS.find((o) => o.mode === approvalMode) ?? APPROVAL_OPTIONS[0];
  const activeModel = KNOWN_MODELS.find((m) => m.id === model);
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

      {/* Unified input container */}
      <div
        ref={wrapperRef}
        className={[
          "rounded-2xl border border-[var(--border)] bg-[var(--bg)] overflow-visible",
          "focus-within:border-[var(--cedar)]/50 transition-colors",
          manualHeight !== null ? "flex flex-col min-h-0" : "",
        ].join(" ")}
      >
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onInput={applyHeight}
          disabled={disabled && !isRunning}
          placeholder={isRunning ? "Arzeh is thinking…" : "Message Arzeh…"}
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
          {/* Left: model + approval mode + context ring */}
          <div className="flex items-center gap-0.5 min-w-0 overflow-visible flex-1">
            {/* Model picker */}
            <div className="relative shrink-0">
              <button
                onClick={() => { setModelOpen((v) => !v); setApprovalOpen(false); }}
                className="h-7 px-2 rounded-lg text-[12px] font-mono text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface)] flex items-center gap-1.5 transition-all whitespace-nowrap"
                title="Switch model"
              >
                <ContextRing pct={contextPct} />
                <span className="truncate max-w-[110px]">
                  {activeModel?.label ?? model ?? "Model"}
                </span>
              </button>
              <Popover open={modelOpen} onClose={() => setModelOpen(false)}>
                <div className="px-1 py-0.5">
                  <div className="px-2 py-1 text-[10px] text-[var(--muted)] uppercase tracking-wider font-medium">Model</div>
                  {KNOWN_MODELS.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => {
                        onModelChange?.(m.id);
                        setModelOpen(false);
                      }}
                      className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-[13px] hover:bg-[var(--bg)] transition-colors text-left"
                    >
                      <span className="w-3 shrink-0">
                        {m.id === model && <Check size={12} className="text-[var(--cedar)]" />}
                      </span>
                      <span className={m.id === model ? "text-[var(--text)] font-medium" : "text-[var(--muted)]"}>
                        {m.label}
                      </span>
                    </button>
                  ))}
                </div>
              </Popover>
            </div>

            {/* Approval mode picker */}
            {onApprovalModeChange && (
              <div className="relative shrink-0">
                <button
                  onClick={() => { setApprovalOpen((v) => !v); setModelOpen(false); }}
                  className={[
                    "h-7 px-2 rounded-lg text-[12px] font-mono flex items-center gap-1 transition-all hover:bg-[var(--surface)] whitespace-nowrap",
                    activeApproval.color,
                  ].join(" ")}
                  title={`Approval mode: ${activeApproval.label}`}
                >
                  <span className="shrink-0">{activeApproval.icon}</span>
                  {activeApproval.label}
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

          {/* Right: send / stop / queue */}
          <div className="shrink-0">
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
                  className="w-8 h-8 rounded-lg text-red-400 hover:bg-red-400/10 flex items-center justify-center transition-all"
                  onClick={onStop}
                  title="Stop generation"
                >
                  <Square size={16} fill="currentColor" />
                </button>
              )
            ) : (
              <button
                onClick={submit}
                disabled={!hasInput || disabled}
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
