import { useState } from "react";
import { AlertTriangle, Clock, KeyRound, PlugZap, RotateCcw, Gauge, Wifi } from "lucide-react";
import { classifyError, type ErrorKind } from "@/utils/errorKind";

const ICONS: Record<ErrorKind, React.ComponentType<{ size?: number }>> = {
  auth: KeyRound,
  usage_limit: Gauge,
  timeout: Clock,
  start_failed: PlugZap,
  network: Wifi,
  generic: AlertTriangle,
};

/** Turn-level failure, explained. Retry re-sends the last user message
 *  through the normal send path. */
export default function ErrorCard({
  message,
  onRetry,
  onDismiss,
}: {
  message: string;
  onRetry?: () => void;
  onDismiss?: () => void;
}) {
  const info = classifyError(message);
  const Icon = ICONS[info.kind];
  const [showRaw, setShowRaw] = useState(false);
  return (
    <div
      role="alert"
      className="mx-auto mb-4 max-w-[560px] rounded-xl border px-4 py-3 text-[13px]"
      style={{
        background: "var(--ember-dim)",
        borderColor: "color-mix(in srgb, var(--ember) 40%, var(--border))",
      }}
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 text-[var(--ember)]">
          <Icon size={16} />
        </span>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-[var(--text)]">{info.title}</div>
          <div className="text-[var(--text2)] mt-0.5">{info.hint}</div>
          <button
            onClick={() => setShowRaw((v) => !v)}
            className="mt-1 text-[10.5px] font-mono text-[var(--muted)] hover:text-[var(--text)]"
          >
            {showRaw ? "hide details" : "details"}
          </button>
          {showRaw && (
            <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words text-[11px] font-mono text-[var(--text2)] bg-[var(--bg)] border border-[var(--border)] rounded p-2">
              {message}
            </pre>
          )}
        </div>
        <div className="flex flex-col gap-1.5 shrink-0">
          {onRetry && (
            <button
              onClick={onRetry}
              className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-[var(--cedar)] text-white text-[12px] hover:bg-[var(--cedar-lt)]"
            >
              <RotateCcw size={12} /> Retry
            </button>
          )}
          {onDismiss && (
            <button
              onClick={onDismiss}
              className="px-2.5 py-1 rounded-md text-[12px] text-[var(--muted)] hover:text-[var(--text)]"
            >
              Dismiss
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
