import { useEffect, useState } from "react";
import { api } from "@/api/client";
import type { AgentConfig } from "@/api/client";

interface Props {
  defaultProvider: string;
  onConfirm: (provider: string, agentName?: string) => void;
  onCancel: () => void;
}

const PROVIDERS = [
  { id: "claude-code", label: "Claude Code",  description: "Anthropic's Claude Code CLI" },
  { id: "kiro-cli",    label: "Kiro CLI",      description: "Amazon's Kiro AI assistant" },
  { id: "codex",       label: "OpenAI Codex",  description: "OpenAI Codex CLI" },
  { id: "gemini",      label: "Google Gemini", description: "Google Gemini CLI" },
  { id: "ollama",      label: "Ollama (local)", description: "Local model via Ollama (no API key needed)" },
  { id: "anthropic",   label: "Anthropic API", description: "Direct Anthropic SDK (no CLI needed)" },
];

type Tab = "custom" | "agent";

export default function NewSessionModal({ defaultProvider, onConfirm, onCancel }: Props) {
  const [agents, setAgents] = useState<AgentConfig[]>([]);
  const [tab, setTab] = useState<Tab>("custom");
  const [selectedAgent, setSelectedAgent] = useState<string>("");
  const [selectedProvider, setSelectedProvider] = useState(defaultProvider);

  useEffect(() => {
    api.listAgents().then((list) => {
      setAgents(list);
      if (list.length > 0) {
        const def = list.find((a) => a.is_default) ?? list[0];
        setSelectedAgent(def.name);
      }
    }).catch(() => {});
  }, []);

  const activeAgent = agents.find((a) => a.name === selectedAgent);

  const handleConfirm = () => {
    if (tab === "agent" && activeAgent) {
      // Agent's preferred provider applies on a fresh session.
      onConfirm(activeAgent.provider, activeAgent.name);
    } else {
      onConfirm(selectedProvider);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") onCancel();
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleConfirm();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onKeyDown={handleKeyDown}
      tabIndex={-1}
      onClick={onCancel}
    >
      <div
        className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-2xl w-full max-w-md max-h-[88vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header — fixed */}
        <div className="px-5 pt-4 pb-3 border-b border-[var(--border)] shrink-0">
          <h2 className="text-[var(--text)] font-semibold text-[15px] mb-3">New session</h2>
          <div className="flex gap-1 bg-[var(--bg)] rounded-lg p-1">
            <ModeButton active={tab === "custom"} onClick={() => setTab("custom")} label="Custom" />
            <ModeButton
              active={tab === "agent"}
              onClick={() => setTab("agent")}
              label={`Agent${agents.length ? ` (${agents.length})` : ""}`}
              disabled={agents.length === 0}
            />
          </div>
        </div>

        {/* Body — scrollable */}
        <div className="flex-1 overflow-y-auto px-5 py-4 min-h-0">
          {tab === "custom" ? (
            <div className="flex flex-col gap-2">
              {PROVIDERS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setSelectedProvider(p.id)}
                  className={[
                    "flex items-start gap-3 p-3 rounded-xl border text-left transition-colors",
                    selectedProvider === p.id
                      ? "border-[var(--cedar)] bg-[var(--cedar)]/10"
                      : "border-[var(--border)] hover:border-[var(--cedar)]/50 hover:bg-[var(--bg)]",
                  ].join(" ")}
                >
                  <span className={["mt-0.5 w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center", selectedProvider === p.id ? "border-[var(--cedar)]" : "border-[var(--muted)]"].join(" ")}>
                    {selectedProvider === p.id && <span className="w-2 h-2 rounded-full bg-[var(--cedar)]" />}
                  </span>
                  <span className="flex flex-col min-w-0">
                    <span className="text-[var(--text)] text-[13px] font-medium truncate">{p.label}</span>
                    <span className="text-[var(--muted)] text-[11px]">{p.description}</span>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {agents.length === 0 ? (
                <div className="text-center text-[var(--muted)] text-[12px] py-8">
                  No agents configured yet. Create one on the Agents page.
                </div>
              ) : (
                agents.map((a) => (
                  <button
                    key={a.name}
                    onClick={() => setSelectedAgent(a.name)}
                    className={[
                      "flex items-start gap-3 p-3 rounded-xl border text-left transition-colors",
                      selectedAgent === a.name
                        ? "border-[var(--cedar)] bg-[var(--cedar)]/10"
                        : "border-[var(--border)] hover:border-[var(--cedar)]/50 hover:bg-[var(--bg)]",
                    ].join(" ")}
                  >
                    <span className={["mt-0.5 w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center", selectedAgent === a.name ? "border-[var(--cedar)]" : "border-[var(--muted)]"].join(" ")}>
                      {selectedAgent === a.name && <span className="w-2 h-2 rounded-full bg-[var(--cedar)]" />}
                    </span>
                    <span className="flex flex-col min-w-0">
                      <span className="flex items-center gap-2 flex-wrap">
                        <span className="text-[var(--text)] text-[13px] font-medium">{a.name}</span>
                        <span className="text-[10px] font-mono text-[var(--cedar)] bg-[var(--cedar)]/10 px-1.5 py-0.5 rounded">{a.provider}</span>
                        {a.is_default && <span className="text-[10px] text-amber-400">default</span>}
                      </span>
                      {a.description && <span className="text-[var(--muted)] text-[11px]">{a.description}</span>}
                    </span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        {/* Footer CTAs — anchored, always visible */}
        <div className="px-5 py-3 border-t border-[var(--border)] shrink-0 flex gap-2">
          <button
            onClick={onCancel}
            className="flex-1 py-2 rounded-xl border border-[var(--border)] text-[var(--muted)] text-[13px] hover:text-[var(--text)] hover:border-[var(--cedar)]/40 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={tab === "agent" && agents.length === 0}
            className="flex-1 py-2 rounded-xl bg-[var(--cedar)] text-white text-[13px] font-medium hover:bg-[var(--cedar-lt)] disabled:opacity-40 transition-colors"
          >
            Start
          </button>
        </div>
      </div>
    </div>
  );
}

function ModeButton({ active, onClick, label, disabled }: { active: boolean; onClick: () => void; label: string; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={[
        "flex-1 py-1.5 rounded-md text-[12px] font-medium transition-colors",
        active
          ? "bg-[var(--surface)] text-[var(--text)] shadow-sm"
          : "text-[var(--muted)] hover:text-[var(--text)]",
        disabled ? "opacity-40 cursor-not-allowed" : "",
      ].join(" ")}
    >
      {label}
    </button>
  );
}
