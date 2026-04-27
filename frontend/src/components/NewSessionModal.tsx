import { useEffect, useState } from "react";
import { api } from "@/api/client";
import type { AgentConfig } from "@/api/client";

interface Props {
  defaultProvider: string;
  onConfirm: (provider: string, agentName?: string) => void;
  onCancel: () => void;
}

const PROVIDERS = [
  { id: "claude-code", label: "Claude Code", description: "Anthropic's Claude Code CLI" },
  { id: "kiro-cli", label: "Kiro-cli", description: "Amazon Kiro AI assistant" },
];

export default function NewSessionModal({ defaultProvider, onConfirm, onCancel }: Props) {
  const [agents, setAgents] = useState<AgentConfig[]>([]);
  const [useAgent, setUseAgent] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<string>("");
  const [selectedProvider, setSelectedProvider] = useState(defaultProvider);

  useEffect(() => {
    api.listAgents().then((list) => {
      setAgents(list);
      if (list.length > 0) {
        const def = list.find((a) => a.is_default) ?? list[0];
        setSelectedAgent(def.name);
        setUseAgent(true);
      }
    }).catch(() => {});
  }, []);

  const activeAgent = agents.find((a) => a.name === selectedAgent);

  const handleConfirm = () => {
    if (useAgent && activeAgent) {
      onConfirm(activeAgent.provider, activeAgent.name);
    } else {
      onConfirm(selectedProvider);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") onCancel();
    if (e.key === "Enter") handleConfirm();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onKeyDown={handleKeyDown}
      tabIndex={-1}
    >
      <div
        className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-2xl w-96 p-6 flex flex-col gap-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-[var(--text)] font-semibold text-[15px]">New session</h2>

        {agents.length > 0 && (
          <div className="flex flex-col gap-2">
            <label className="text-[var(--muted)] text-[12px] uppercase tracking-wider">Start from</label>
            <div className="flex gap-2">
              <ModeButton active={useAgent} onClick={() => setUseAgent(true)} label="Agent" />
              <ModeButton active={!useAgent} onClick={() => setUseAgent(false)} label="Custom" />
            </div>
          </div>
        )}

        {agents.length > 0 && useAgent ? (
          <div className="flex flex-col gap-2">
            <label className="text-[var(--muted)] text-[12px] uppercase tracking-wider">Agent</label>
            <div className="flex flex-col gap-2">
              {agents.map((a) => (
                <button
                  key={a.name}
                  onClick={() => setSelectedAgent(a.name)}
                  className={[
                    "flex items-start gap-3 p-3 rounded-xl border text-left transition-colors",
                    selectedAgent === a.name
                      ? "border-[var(--cedar)] bg-[var(--cedar)]/10"
                      : "border-[var(--border)] hover:border-[var(--cedar)]/50 hover:bg-[var(--border)]",
                  ].join(" ")}
                >
                  <span className={["mt-0.5 w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center", selectedAgent === a.name ? "border-[var(--cedar)]" : "border-[var(--muted)]"].join(" ")}>
                    {selectedAgent === a.name && <span className="w-2 h-2 rounded-full bg-[var(--cedar)]" />}
                  </span>
                  <span className="flex flex-col min-w-0">
                    <span className="flex items-center gap-2">
                      <span className="text-[var(--text)] text-[13px] font-medium">{a.name}</span>
                      <span className="text-[10px] font-mono text-[var(--cedar)] bg-[var(--cedar)]/10 px-1.5 py-0.5 rounded">{a.provider}</span>
                      {a.is_default && <span className="text-[10px] text-amber-400">default</span>}
                    </span>
                    {a.description && <span className="text-[var(--muted)] text-[11px]">{a.description}</span>}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <label className="text-[var(--muted)] text-[12px] uppercase tracking-wider">Provider</label>
            <div className="flex flex-col gap-2">
              {PROVIDERS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setSelectedProvider(p.id)}
                  className={[
                    "flex items-start gap-3 p-3 rounded-xl border text-left transition-colors",
                    selectedProvider === p.id
                      ? "border-[var(--cedar)] bg-[var(--cedar)]/10"
                      : "border-[var(--border)] hover:border-[var(--cedar)]/50 hover:bg-[var(--border)]",
                  ].join(" ")}
                >
                  <span className={["mt-0.5 w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center", selectedProvider === p.id ? "border-[var(--cedar)]" : "border-[var(--muted)]"].join(" ")}>
                    {selectedProvider === p.id && <span className="w-2 h-2 rounded-full bg-[var(--cedar)]" />}
                  </span>
                  <span className="flex flex-col">
                    <span className="text-[var(--text)] text-[13px] font-medium">{p.label}</span>
                    <span className="text-[var(--muted)] text-[11px]">{p.description}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <button
            onClick={onCancel}
            className="flex-1 py-2 rounded-xl border border-[var(--border)] text-[var(--muted)] text-[13px] hover:text-[var(--text)] hover:border-[var(--cedar)]/40 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            className="flex-1 py-2 rounded-xl bg-[var(--cedar)] text-white text-[13px] font-medium hover:bg-[var(--cedar-lt)] transition-colors"
          >
            Start
          </button>
        </div>
      </div>
    </div>
  );
}

function ModeButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={[
        "flex-1 py-1.5 rounded-lg text-[12px] font-medium border transition-colors",
        active
          ? "border-[var(--cedar)] bg-[var(--cedar)]/10 text-[var(--text)]"
          : "border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)]",
      ].join(" ")}
    >
      {label}
    </button>
  );
}
