import { useState } from "react";
import { api } from "@/api/client";

interface Props {
  requestId: string;
  title: string;
  toolInput: string;
  onResolved: (requestId: string) => void;
}

export default function ApprovalCard({ requestId, title, toolInput, onResolved }: Props) {
  const [pending, setPending] = useState<"approve" | "reject" | null>(null);

  const handle = async (action: "approve" | "reject") => {
    setPending(action);
    try {
      if (action === "approve") await api.approveRequest(requestId);
      else await api.rejectRequest(requestId);
      onResolved(requestId);
    } catch {
      setPending(null);
    }
  };

  const preview = toolInput.length > 120 ? toolInput.slice(0, 117) + "…" : toolInput;

  return (
    <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/5 px-3 py-2.5 mb-2">
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-[11px]">🔐</span>
        <span className="text-[12px] font-medium text-yellow-300/90">{title || "Tool permission"}</span>
      </div>
      {preview && (
        <div className="text-[11px] font-mono text-[var(--muted)] mb-2 leading-relaxed break-all">
          {preview}
        </div>
      )}
      <div className="flex gap-2">
        <button
          onClick={() => handle("approve")}
          disabled={pending !== null}
          className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium bg-green-500/15 text-green-400 hover:bg-green-500/25 disabled:opacity-50 transition-colors"
        >
          {pending === "approve" ? <span className="w-3 h-3 rounded-full border-2 border-green-400 border-t-transparent animate-spin inline-block" /> : "✓"}
          Approve
        </button>
        <button
          onClick={() => handle("reject")}
          disabled={pending !== null}
          className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium bg-red-500/15 text-red-400 hover:bg-red-500/25 disabled:opacity-50 transition-colors"
        >
          ✕ Reject
        </button>
      </div>
    </div>
  );
}
