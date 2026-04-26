import { useState, useRef, useEffect, memo } from "react";
import { CheckCircle, Handshake, Ban, Wrench, AlertTriangle } from "lucide-react";
import { api } from "@/api/client";

export interface ToolGroupEntry {
  name: string;
  input: string;
}

interface Props {
  toolCalls: ToolGroupEntry[];
  requestId?: string;
  permissionTitle?: string;
  permissionInput?: string;
  isRunning: boolean;
}

const CollapsibleToolGroup = memo(function CollapsibleToolGroup({
  toolCalls,
  requestId,
  permissionTitle,
  permissionInput,
  isRunning,
}: Props) {
  const needsAttention = !!requestId;
  const [expanded, setExpanded] = useState(needsAttention);
  const [localResolved, setLocalResolved] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const userToggled = useRef(false);
  const wasRunning = useRef(isRunning);

  // Auto-expand when permission arrives
  useEffect(() => {
    if (needsAttention && !userToggled.current) setExpanded(true);
  }, [needsAttention]);

  // Auto-collapse 2s after running stops
  useEffect(() => {
    if (wasRunning.current && !isRunning && !needsAttention && !userToggled.current) {
      const t = setTimeout(() => setExpanded(false), 2000);
      return () => clearTimeout(t);
    }
    wasRunning.current = isRunning;
  }, [isRunning, needsAttention]);

  // Reset local resolved when new permission arrives
  useEffect(() => {
    setLocalResolved(null);
    setSubmitting(false);
  }, [requestId]);

  const count = toolCalls.length;
  const preview = permissionInput
    ? permissionInput.length > 150 ? permissionInput.slice(0, 150) + "…" : permissionInput
    : "";

  const doApprove = () => {
    if (!requestId || submitting) return;
    setSubmitting(true);
    setLocalResolved("approved");
    api.approveRequest(requestId).catch(() => {
      setLocalResolved(null);
      setSubmitting(false);
    });
  };

  const doReject = () => {
    if (!requestId || submitting) return;
    setSubmitting(true);
    setLocalResolved("rejected");
    api.rejectRequest(requestId).catch(() => {
      setLocalResolved(null);
      setSubmitting(false);
    });
  };

  const headerClass = [
    "flex items-center gap-2 px-3.5 py-2 rounded-md text-[13px] font-mono cursor-pointer transition-all w-full text-left border",
    needsAttention && !localResolved
      ? "border-amber-400/60 hover:border-amber-300 text-[var(--muted)] bg-[var(--surface)]"
      : localResolved
      ? "border-green-500/40 text-[var(--muted)] bg-[var(--surface)]"
      : "border-[var(--border)] hover:border-[var(--text)]/30 text-[var(--muted)] bg-[var(--surface)]",
    "hover:text-[var(--text)]",
  ].join(" ");

  return (
    <div className="my-1">
      <button
        className={headerClass}
        onClick={() => { userToggled.current = true; setExpanded((e) => !e); }}
        aria-expanded={expanded}
      >
        {needsAttention && !localResolved ? (
          <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse shrink-0" />
        ) : localResolved ? (
          <span className="w-2.5 h-2.5 rounded-full bg-green-500 shrink-0" />
        ) : isRunning ? (
          <span className="w-2.5 h-2.5 rounded-full bg-[var(--cedar)] animate-pulse shrink-0" />
        ) : (
          <span className={`text-[10px] transition-transform duration-150 ${expanded ? "rotate-90" : ""}`}>▶</span>
        )}
        <span>
          {localResolved === "approved" ? (
            <><CheckCircle size={13} className="inline mr-1" /> Approved</>
          ) : localResolved === "rejected" ? (
            <><Ban size={13} className="inline mr-1" /> Rejected</>
          ) : needsAttention ? (
            <><AlertTriangle size={13} className="inline mr-1" /> Approval needed</>
          ) : isRunning ? (
            <><Wrench size={13} className="inline mr-1" /> running tools</>
          ) : (
            <><Wrench size={13} className="inline mr-1" /> {count} tool call{count === 1 ? "" : "s"}</>
          )}
        </span>
        {permissionTitle && needsAttention && !localResolved && (
          <span className="text-[11px] text-[var(--muted)]/60 ml-auto truncate max-w-[120px]">{permissionTitle}</span>
        )}
      </button>

      {/* Inline approval preview + buttons */}
      {needsAttention && !localResolved && !expanded && (
        <>
          {preview && (
            <div className="mt-1 ml-4 border-l-[3px] border-l-amber-400 pl-3">
              <pre className="bg-[var(--bg)] rounded-md px-3 py-2 text-[13px] font-mono overflow-x-auto whitespace-pre-wrap break-all max-h-[4.5em] overflow-y-auto mb-1.5 text-[var(--muted)]">
                {preview}
              </pre>
            </div>
          )}
          <div className="mt-1 ml-4 pl-3 flex gap-1.5 flex-wrap">
            <button
              disabled={submitting}
              onClick={doApprove}
              className="px-2.5 py-1 rounded-md border border-[var(--border)] bg-transparent text-[var(--muted)] text-[13px] hover:text-[var(--text)] hover:border-[var(--text)]/30 hover:bg-[var(--surface)] transition-all disabled:opacity-50"
            >
              <CheckCircle size={13} className="inline mr-1" /> Approve
            </button>
            <button
              disabled={submitting}
              onClick={() => {
                if (!requestId || submitting) return;
                setSubmitting(true);
                setLocalResolved("trust");
                api.approveRequest(requestId).catch(() => { setLocalResolved(null); setSubmitting(false); });
              }}
              className="px-2.5 py-1 rounded-md border border-[var(--border)] bg-transparent text-[var(--muted)] text-[13px] hover:text-[var(--text)] hover:border-[var(--text)]/30 hover:bg-[var(--surface)] transition-all disabled:opacity-50"
            >
              <Handshake size={13} className="inline mr-1" /> Trust
            </button>
            <button
              disabled={submitting}
              onClick={doReject}
              className="px-2.5 py-1 rounded-md border border-[var(--border)] bg-transparent text-[var(--muted)] text-[13px] hover:text-red-400 hover:border-red-400 transition-all disabled:opacity-50"
            >
              <Ban size={13} className="inline mr-1" /> Reject
            </button>
          </div>
        </>
      )}

      {/* Expanded: show tool list */}
      {expanded && (
        <div className="mt-1 ml-4 border-l border-[var(--border)] pl-3 flex flex-col gap-1">
          {toolCalls.map((tc, i) => (
            <div key={i} className="text-[12px] font-mono text-[var(--muted)] flex items-center gap-1.5 py-0.5">
              <Wrench size={11} className="text-amber-400 shrink-0" />
              <span className="text-[var(--text)]">{tc.name}</span>
              {tc.input && (
                <span className="truncate max-w-[200px] text-[var(--muted)]/60">
                  {(() => {
                    try {
                      const obj = JSON.parse(tc.input);
                      const first = Object.values(obj).find((v) => typeof v === "string") as string | undefined;
                      return first ? (first.length > 60 ? first.slice(0, 57) + "…" : first) : "";
                    } catch { return ""; }
                  })()}
                </span>
              )}
            </div>
          ))}
          {needsAttention && !localResolved && (
            <div className="flex gap-1.5 flex-wrap mt-1">
              <button disabled={submitting} onClick={doApprove} className="px-2.5 py-1 rounded-md border border-[var(--border)] bg-transparent text-[var(--muted)] text-[12px] hover:text-[var(--text)] hover:bg-[var(--surface)] transition-all disabled:opacity-50">
                <CheckCircle size={12} className="inline mr-1" /> Approve
              </button>
              <button disabled={submitting} onClick={doReject} className="px-2.5 py-1 rounded-md border border-[var(--border)] bg-transparent text-[var(--muted)] text-[12px] hover:text-red-400 hover:border-red-400 transition-all disabled:opacity-50">
                <Ban size={12} className="inline mr-1" /> Reject
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
});

export default CollapsibleToolGroup;
