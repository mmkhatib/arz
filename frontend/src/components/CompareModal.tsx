import { useEffect, useRef, useState } from "react";
import { api } from "@/api/client";
import { GitCompare, Square, Copy, Check } from "lucide-react";
import { modelsForProvider, defaultModelForProvider, PROVIDER_LABELS } from "@/utils/models";
import { useLiveModels } from "@/hooks/useLiveModels";

interface Props {
  prompt: string;
  baselineModel: string | null;
  baselineReply: string;
  provider: string;
  onClose: () => void;
}

interface ProviderOption {
  id: string;
  label: string;
}

const ALL_PROVIDERS: ProviderOption[] = [
  { id: "claude-code", label: PROVIDER_LABELS["claude-code"] },
  { id: "codex",       label: PROVIDER_LABELS["codex"] },
  { id: "kiro-cli",    label: PROVIDER_LABELS["kiro-cli"] },
  { id: "anthropic",   label: PROVIDER_LABELS["anthropic"] },
];

export default function CompareModal({ prompt, baselineModel, baselineReply, provider, onClose }: Props) {
  useLiveModels();
  const [altProvider, setAltProvider] = useState<string>(provider || "claude-code");
  const altModels = modelsForProvider(altProvider);
  const [altModel, setAltModel] = useState<string>(() => {
    // Default to a different model from the baseline within the same provider when possible
    if (provider === altProvider && baselineModel) {
      const other = altModels.find((m) => m.id !== baselineModel);
      if (other) return other.id;
    }
    return defaultModelForProvider(altProvider);
  });

  // If user switches provider, ensure altModel is valid for the new provider
  useEffect(() => {
    if (!altModels.some((m) => m.id === altModel)) {
      setAltModel(defaultModelForProvider(altProvider));
    }
  }, [altProvider, altModels, altModel]);
  const [streaming, setStreaming] = useState(false);
  const [altReply, setAltReply] = useState("");
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [copiedSide, setCopiedSide] = useState<"left" | "right" | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (streaming) abortRef.current?.abort();
        else onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [streaming, onClose]);

  const run = async () => {
    setStreaming(true);
    setAltReply("");
    setError(null);
    abortRef.current = new AbortController();
    try {
      const res = await api.compareStream(prompt, altProvider, altModel);
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      for await (const chunk of api.streamChat(res)) {
        if (chunk.type === "text_chunk" && chunk.text) {
          setAltReply((prev) => prev + chunk.text);
        } else if (chunk.type === "error") {
          throw new Error(chunk.message ?? "stream error");
        } else if (chunk.type === "complete") {
          break;
        }
      }
    } catch (e) {
      if ((e as { name?: string }).name !== "AbortError") {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  };

  const stop = () => abortRef.current?.abort();

  const copy = (which: "left" | "right", text: string) => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopiedSide(which);
      setTimeout(() => setCopiedSide(null), 1500);
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-[var(--bg)] border border-[var(--border)] rounded-2xl shadow-2xl w-full max-w-5xl mx-4 max-h-[88vh] flex flex-col">
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-[var(--border)]">
          <div className="flex items-center gap-2">
            <GitCompare size={16} className="text-[var(--cedar)]" />
            <h2 className="text-[15px] font-semibold text-[var(--text)]">Compare models</h2>
          </div>
          <button onClick={onClose} className="text-[var(--muted)] hover:text-[var(--text)] text-xl leading-none">×</button>
        </div>

        <div className="px-5 pt-3 pb-2 border-b border-[var(--border)]">
          <div className="text-[10px] uppercase tracking-wider text-[var(--muted)] mb-1">Prompt</div>
          <div className="text-[12px] text-[var(--text)] bg-[var(--surface)] rounded-md px-3 py-2 max-h-[80px] overflow-y-auto whitespace-pre-wrap">
            {prompt}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-0 flex-1 overflow-hidden">
          {/* Baseline (left) */}
          <div className="flex flex-col border-r border-[var(--border)] min-h-0">
            <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--border)] bg-[var(--surface)]">
              <span className="text-[12px] font-mono text-[var(--text)]">{baselineModel ?? "(unknown)"}</span>
              <button
                onClick={() => copy("left", baselineReply)}
                className="text-[var(--muted)] hover:text-[var(--text)] flex items-center gap-1 text-[11px]"
              >
                {copiedSide === "left" ? <Check size={11} /> : <Copy size={11} />}
                copy
              </button>
            </div>
            <pre className="flex-1 overflow-y-auto px-4 py-3 text-[13px] whitespace-pre-wrap text-[var(--text)]">
              {baselineReply || <span className="text-[var(--muted)]">(no baseline reply)</span>}
            </pre>
          </div>

          {/* Alt (right) */}
          <div className="flex flex-col min-h-0">
            <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--border)] bg-[var(--surface)] gap-2">
              <select
                value={altProvider}
                onChange={(e) => setAltProvider(e.target.value)}
                disabled={streaming}
                className="bg-[var(--bg)] border border-[var(--border)] rounded px-2 py-1 text-[11px] text-[var(--text)]"
                title="Provider"
              >
                {ALL_PROVIDERS.map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
              <select
                value={altModel}
                onChange={(e) => setAltModel(e.target.value)}
                disabled={streaming}
                className="bg-[var(--bg)] border border-[var(--border)] rounded px-2 py-1 text-[12px] text-[var(--text)]"
                title="Model"
              >
                {altModels.map((m) => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </select>
              {streaming ? (
                <button
                  onClick={stop}
                  className="flex items-center gap-1 px-2 py-1 rounded text-red-400 hover:bg-red-400/10 text-[11px]"
                >
                  <Square size={10} fill="currentColor" /> stop
                </button>
              ) : (
                <button
                  onClick={run}
                  className="px-2 py-1 rounded bg-[var(--cedar)] text-white text-[11px] hover:bg-[var(--cedar-lt)]"
                >
                  Run
                </button>
              )}
              <button
                onClick={() => copy("right", altReply)}
                disabled={!altReply}
                className="text-[var(--muted)] hover:text-[var(--text)] flex items-center gap-1 text-[11px] disabled:opacity-30"
              >
                {copiedSide === "right" ? <Check size={11} /> : <Copy size={11} />}
                copy
              </button>
            </div>
            <pre className="flex-1 overflow-y-auto px-4 py-3 text-[13px] whitespace-pre-wrap text-[var(--text)]">
              {altReply || (streaming ? <span className="text-[var(--muted)] animate-pulse">…</span> : <span className="text-[var(--muted)]">Click Run to generate.</span>)}
            </pre>
          </div>
        </div>

        {error && <div className="m-3 text-red-400 text-[11px] bg-red-900/20 rounded px-3 py-2">{error}</div>}
      </div>
    </div>
  );
}
