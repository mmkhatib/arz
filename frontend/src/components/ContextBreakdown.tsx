// Side-panel "Context" tab: what each turn fed the model, by block.
//
// Backed by /api/sessions/{id}/context-trace — the chat route records the
// char size of every block it prepends (memory, recall, goal, subagent
// results, reminder) plus history and system prompt, and attaches the
// provider's context % on completion. Sizes are chars; we show a ~4
// chars/token estimate next to them since that's what people reason in.

import { useEffect, useMemo, useState } from "react";
import { Gauge } from "lucide-react";
import { api, type ContextTraceTurn } from "@/api/client";

export const CONTEXT_BLOCKS: { key: string; label: string; color: string }[] = [
  { key: "system", label: "System prompt", color: "var(--stone, #8a8f98)" },
  { key: "history", label: "History", color: "var(--cedar-2, #5f8f7a)" },
  { key: "memory", label: "Memory", color: "var(--pine)" },
  { key: "recall", label: "Recall", color: "var(--dawn)" },
  { key: "goal", label: "Goal", color: "var(--cedar-glow)" },
  { key: "subagents", label: "Subagent results", color: "#9b87c9" },
  { key: "reminder", label: "Turn reminder", color: "var(--muted)" },
  { key: "user", label: "Your message", color: "var(--ember)" },
];

const fmtTokens = (chars: number) => {
  const t = Math.round(chars / 4);
  return t >= 1000 ? `${(t / 1000).toFixed(1)}k` : String(t);
};

export function turnTotal(turn: ContextTraceTurn): number {
  return Object.values(turn.blocks).reduce((a, b) => a + b, 0);
}

export default function ContextBreakdown({ sessionId, refreshKey }: { sessionId: string; refreshKey?: number }) {
  const [turns, setTurns] = useState<ContextTraceTurn[] | null>(null);
  const [selected, setSelected] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      api
        .fetchContextTrace(sessionId)
        .then((r) => { if (!cancelled) setTurns(r.turns); })
        .catch(() => { if (!cancelled) setTurns([]); });
    load();
    const id = setInterval(() => { if (!document.hidden) load(); }, 8_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [sessionId, refreshKey]);

  const recent = useMemo(() => (turns ?? []).slice(-24), [turns]);
  const maxTotal = useMemo(() => Math.max(1, ...recent.map(turnTotal)), [recent]);

  if (turns === null) {
    return <div className="px-3 py-4 text-[11px] text-[var(--muted)]">Loading…</div>;
  }
  if (turns.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center text-[var(--muted)]/40 gap-2 py-10 px-6 text-center">
        <Gauge size={24} />
        <span className="text-[13px]">No turns recorded yet</span>
        <span className="text-[11px]">Send a message to see what fills the context window.</span>
      </div>
    );
  }

  const idx = selected !== null && selected < recent.length ? selected : recent.length - 1;
  const turn = recent[idx];
  const total = turnTotal(turn);
  const rows = CONTEXT_BLOCKS.map((b) => ({ ...b, value: turn.blocks[b.key] ?? 0 })).filter((r) => r.value > 0);
  const usage = turn.usage;

  return (
    <div className="flex flex-col">
      <div className="px-3 py-3 border-b border-[var(--hairline)]">
        <div className="flex items-baseline justify-between mb-2">
          <span className="text-[11px] font-mono uppercase tracking-[.08em] text-[var(--muted)]">
            {idx === recent.length - 1 ? "Latest turn" : `Turn ${turns.length - (recent.length - 1 - idx)}`}
          </span>
          <span className="text-[11px] font-mono text-[var(--text2)]">
            ~{fmtTokens(total)} tok sent
            {turn.context_pct != null && (
              <span className="text-[var(--muted)]"> · window {Math.round(turn.context_pct)}%</span>
            )}
          </span>
        </div>
        {turn.context_pct != null && (
          <div className="h-1.5 rounded bg-[var(--s2)] overflow-hidden mb-2.5" title="Provider-reported context usage">
            <div
              className="h-full"
              style={{
                width: `${Math.min(100, turn.context_pct)}%`,
                background: turn.context_pct >= 90 ? "var(--ember)" : turn.context_pct >= 75 ? "var(--dawn)" : "var(--pine)",
              }}
            />
          </div>
        )}
        <div className="flex h-3 rounded overflow-hidden mb-3" title="Share of characters sent this turn">
          {rows.map((r) => (
            <div key={r.key} style={{ width: `${(r.value / total) * 100}%`, background: r.color }} title={`${r.label}: ~${fmtTokens(r.value)} tok`} />
          ))}
        </div>
        <ul className="space-y-1">
          {rows.map((r) => (
            <li key={r.key} className="flex items-center gap-2 text-[11.5px]">
              <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: r.color }} />
              <span className="flex-1 text-[var(--text2)]">{r.label}</span>
              <span className="font-mono text-[10.5px] text-[var(--muted)]">{Math.round((r.value / total) * 100)}%</span>
              <span className="font-mono text-[10.5px] text-[var(--text2)] w-12 text-right">~{fmtTokens(r.value)}</span>
            </li>
          ))}
        </ul>
        {usage && (
          <div className="mt-3 pt-2 border-t border-[var(--hairline)] grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10.5px] font-mono text-[var(--muted)]">
            {usage.input_tokens != null && <span>input {usage.input_tokens.toLocaleString()}</span>}
            {usage.output_tokens != null && <span>output {usage.output_tokens.toLocaleString()}</span>}
            {!!usage.cache_read_input_tokens && <span>cache read {usage.cache_read_input_tokens.toLocaleString()}</span>}
            {!!usage.cache_creation_input_tokens && <span>cache write {usage.cache_creation_input_tokens.toLocaleString()}</span>}
          </div>
        )}
      </div>

      <div className="px-3 py-3">
        <div className="text-[9.5px] font-mono uppercase tracking-[.08em] text-[var(--muted)] mb-2">
          Recent turns · click to inspect
        </div>
        <div className="flex items-end gap-[3px] h-24">
          {recent.map((t, i) => {
            const tot = turnTotal(t);
            return (
              <button
                key={i}
                onClick={() => setSelected(i)}
                title={`~${fmtTokens(tot)} tok${t.context_pct != null ? ` · ${Math.round(t.context_pct)}%` : ""}`}
                className={[
                  "flex-1 min-w-[4px] flex flex-col-reverse rounded-sm overflow-hidden transition-opacity",
                  i === idx ? "ring-1 ring-[var(--cedar-glow)]" : "opacity-70 hover:opacity-100",
                ].join(" ")}
                style={{ height: `${Math.max(4, (tot / maxTotal) * 100)}%` }}
              >
                {CONTEXT_BLOCKS.map((b) => {
                  const v = t.blocks[b.key] ?? 0;
                  return v > 0 ? <div key={b.key} style={{ height: `${(v / tot) * 100}%`, background: b.color }} /> : null;
                })}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
