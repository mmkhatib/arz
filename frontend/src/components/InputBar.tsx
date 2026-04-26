import { useEffect, useRef, useState, useCallback } from "react";
import { ArrowUp, ArrowUpFromLine, Square, ShieldCheck, BookOpen, Handshake, Rocket } from "lucide-react";
import ContextRing from "./ContextRing";

export type ApprovalMode = "normal" | "trust_reads" | "trust" | "yolo";

const APPROVAL_DISPLAY: Record<ApprovalMode, { label: string; icon: React.ReactNode; color: string }> = {
  normal:      { label: "Normal", icon: <ShieldCheck size={13} />, color: "" },
  trust_reads: { label: "Reads",  icon: <BookOpen size={13} />,    color: "text-blue-400" },
  trust:       { label: "Trust",  icon: <Handshake size={13} />,   color: "text-green-400" },
  yolo:        { label: "YOLO",   icon: <Rocket size={13} />,      color: "text-red-400" },
};

const MODE_CYCLE: ApprovalMode[] = ["normal", "trust_reads", "trust", "yolo"];

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

  useEffect(() => {
    if (!disabled && !isRunning) textareaRef.current?.focus();
  }, [disabled, isRunning]);

  // Sync manual height to DOM
  useEffect(() => {
    if (!wrapperRef.current) return;
    if (manualHeight !== null) {
      wrapperRef.current.style.height = Math.max(manualHeight, INPUT_DRAG_MIN_H) + "px";
    } else {
      wrapperRef.current.style.height = "";
    }
  }, [manualHeight]);

  // Auto-resize textarea
  const applyHeight = useCallback(() => {
    if (!textareaRef.current || dragging.current) return;
    if (manualHeight !== null) return;
    const el = textareaRef.current;
    el.style.height = "auto";
    el.style.height = Math.max(INPUT_MIN_H, Math.min(el.scrollHeight, INPUT_MAX_H)) + "px";
  }, [manualHeight]);

  useEffect(() => { applyHeight(); }, [value, applyHeight]);

  // Reset height when cleared
  const prevValue = useRef(value);
  useEffect(() => {
    if (prevValue.current && !value) {
      setManualHeight(null);
      localStorage.removeItem(INPUT_HEIGHT_LS_KEY);
      if (wrapperRef.current) wrapperRef.current.style.height = "";
    }
    prevValue.current = value;
  }, [value]);

  // Drag resize global handlers
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
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
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

  const cycleMode = () => {
    const idx = MODE_CYCLE.indexOf(approvalMode);
    const next = MODE_CYCLE[(idx + 1) % MODE_CYCLE.length];
    onApprovalModeChange?.(next);
  };

  const modeDisplay = APPROVAL_DISPLAY[approvalMode];
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
          "rounded-2xl border border-[var(--border)] bg-[var(--bg)] overflow-hidden",
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
            manualHeight !== null ? "flex-1 h-full" : `min-h-[${INPUT_MIN_H}px] max-h-[${INPUT_MAX_H}px]`,
            disabled && !isRunning ? "opacity-40 pointer-events-none" : "",
          ].join(" ")}
        />

        {/* Bottom icon row */}
        <div className="flex items-center justify-between px-2.5 pb-2 pt-0.5 gap-2">
          {/* Left: model + approval mode + context ring */}
          <div className="flex items-center gap-0.5 min-w-0 overflow-hidden flex-1">
            {model && (
              <div className="flex items-center gap-1.5 h-7 px-2 rounded-lg text-[12px] font-mono text-[var(--muted)] shrink-0 whitespace-nowrap">
                <ContextRing pct={contextPct} />
                <span className="truncate max-w-[120px]">{model}</span>
              </div>
            )}
            {!model && <ContextRing pct={contextPct} />}
            {onApprovalModeChange && (
              <button
                onClick={cycleMode}
                title={`Approval mode: ${modeDisplay.label}`}
                className={[
                  "h-7 px-2 rounded-lg text-[12px] font-mono flex items-center gap-1 cursor-pointer transition-all hover:bg-[var(--surface)] shrink-0 whitespace-nowrap",
                  modeDisplay.color || "text-[var(--muted)] hover:text-[var(--text)]",
                ].join(" ")}
              >
                <span className="shrink-0">{modeDisplay.icon}</span>
                {modeDisplay.label}
              </button>
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
