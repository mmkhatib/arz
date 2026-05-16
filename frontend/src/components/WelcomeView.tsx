import { useEffect, useRef, useState } from "react";
import { Check, Bot, Sparkles, RefreshCw } from "lucide-react";
import { api } from "@/api/client";
import Popover from "./Popover";
import { modelsForProvider, defaultModelForProvider, isModelValid, PROVIDER_LABELS } from "@/utils/models";
import { useOllamaInstalledModels } from "@/hooks/useOllamaInstalledModels";

interface AgentOpt { name: string; description?: string; provider?: string }

interface Props {
  model?: string;
  onModelChange?: (model: string) => void;
  provider?: string;
  workDir: string;
  onWorkDirChange: (path: string) => void;
  // Optional: agent (role) picker. Switching agent does NOT change the model.
  agent?: string | null;
  agents?: AgentOpt[];
  onAgentChange?: (agent: string | null) => void;
  /** Click a suggestion → seeds the composer with this text. */
  onPickSuggestion?: (text: string) => void;
}

export default function WelcomeView({ model, onModelChange, provider, workDir, onWorkDirChange, agent, agents = [], onAgentChange, onPickSuggestion }: Props) {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  useEffect(() => {
    let cancelled = false;
    api.listSuggestions().then((r) => { if (!cancelled) setSuggestions(r.suggestions); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);
  const refreshSuggestions = async () => {
    setRefreshing(true);
    try {
      const r = await api.refreshSuggestions();
      setSuggestions(r.suggestions);
    } catch { /* keep prior */ }
    setRefreshing(false);
  };
  const [modelOpen, setModelOpen] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);
  const [dirDraft, setDirDraft] = useState(workDir);
  const modelBtnRef = useRef<HTMLButtonElement>(null);

  // Hydrate the dynamic Ollama list (no-op if already cached).
  useOllamaInstalledModels();
  const providerModels = modelsForProvider(provider);
  const effectiveModel = isModelValid(provider, model) ? (model as string) : defaultModelForProvider(provider);
  const activeModel = providerModels.find((m) => m.id === effectiveModel);
  const activeAgent = agents.find((a) => a.name === agent);

  useEffect(() => {
    if (effectiveModel && effectiveModel !== model) {
      onModelChange?.(effectiveModel);
    }
  }, [effectiveModel, model, onModelChange]);

  const commitDir = () => {
    const trimmed = dirDraft.trim();
    if (trimmed !== workDir) onWorkDirChange(trimmed);
  };

  return (
    <div className="flex flex-col items-center justify-center h-full gap-6 px-6 pb-16">
      {/* Branding */}
      <div className="flex flex-col items-center gap-3">
        <div className="w-14 h-14 rounded-2xl bg-[var(--cedar)] flex items-center justify-center text-2xl">
          🌲
        </div>
        <div className="text-center">
          <h2 className="text-[16px] font-semibold text-[var(--text)] mb-1">New Session</h2>
          <p className="text-[12px] text-[var(--muted)]">Pick a model. Optionally pick an agent role.</p>
        </div>
      </div>

      {/* Options */}
      <div className="flex flex-col gap-3 w-full max-w-[360px]">
        {/* 1. Model — primary, focused first */}
        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-[var(--muted)] uppercase tracking-wider font-medium px-1">
            Model {provider ? `· ${PROVIDER_LABELS[provider] ?? provider}` : ""}
          </label>
          {onModelChange ? (
            <div className="relative">
              <button
                ref={modelBtnRef}
                onClick={() => { setModelOpen((v) => !v); setAgentOpen(false); }}
                className="w-full flex items-center gap-2 bg-[var(--surface)] border border-[var(--border)] rounded-lg px-3 py-2 text-[13px] font-mono hover:border-[var(--cedar)]/50 transition-colors focus:outline-none focus:border-[var(--cedar)]/50"
              >
                <span className="flex-1 text-left text-[var(--text)] font-medium truncate">
                  {activeModel?.label ?? effectiveModel ?? "Select model…"}
                </span>
                <span className="text-[var(--muted)] text-[11px] shrink-0">▾</span>
              </button>
              <Popover open={modelOpen} onClose={() => setModelOpen(false)}>
                <div className="min-w-[260px] max-w-[300px] flex flex-col">
                  <div className="px-2 py-1.5 text-[10px] text-[var(--muted)] uppercase tracking-wider font-medium border-b border-[var(--border)] sticky top-0 bg-[var(--surface)]">
                    Model
                  </div>
                  <div className="max-h-[260px] overflow-y-auto px-1 py-0.5">
                    {providerModels.length === 0 && provider === "ollama" ? (
                      <div className="px-2 py-3 text-[12px] text-[var(--muted)]">
                        No Ollama models installed locally.{" "}
                        <a
                          href="/models"
                          onClick={(e) => { e.preventDefault(); window.location.assign("/models"); }}
                          className="text-[var(--cedar)] hover:underline"
                        >
                          Pull one
                        </a>{" "}
                        first.
                      </div>
                    ) : (
                      providerModels.map((m) => (
                        <button
                          key={m.id}
                          onClick={() => { onModelChange?.(m.id); setModelOpen(false); }}
                          className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-[12px] hover:bg-[var(--bg)] transition-colors text-left"
                        >
                          <span className="w-3 shrink-0">
                            {m.id === effectiveModel && <Check size={11} className="text-[var(--cedar)]" />}
                          </span>
                          <span className={["truncate", m.id === effectiveModel ? "text-[var(--text)] font-medium" : "text-[var(--muted)]"].join(" ")}>
                            {m.label}
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              </Popover>
            </div>
          ) : (
            <div className="flex items-center gap-2 bg-[var(--surface)] border border-[var(--border)] rounded-lg px-3 py-2">
              <span className="text-[13px] font-medium text-[var(--cedar)]">
                {PROVIDER_LABELS[provider ?? ""] ?? provider}
              </span>
            </div>
          )}
        </div>

        {/* 2. Agent — optional, secondary */}
        {onAgentChange && agents.length > 0 && (
          <div className="flex flex-col gap-1">
            <label className="text-[10px] text-[var(--muted)] uppercase tracking-wider font-medium px-1">
              Agent <span className="opacity-60 normal-case tracking-normal">(optional · role only, doesn't change the LLM)</span>
            </label>
            <div className="relative">
              <button
                onClick={() => { setAgentOpen((v) => !v); setModelOpen(false); }}
                className="w-full flex items-center gap-2 bg-[var(--surface)] border border-[var(--border)] rounded-lg px-3 py-2 text-[13px] hover:border-[var(--cedar)]/50 transition-colors focus:outline-none focus:border-[var(--cedar)]/50"
              >
                <Bot size={13} className="text-[var(--muted)] shrink-0" />
                <span className={["flex-1 text-left truncate", agent ? "text-[var(--text)] font-medium" : "text-[var(--muted)] italic"].join(" ")}>
                  {activeAgent?.name ?? agent ?? "no agent"}
                </span>
                <span className="text-[var(--muted)] text-[11px] shrink-0">▾</span>
              </button>
              <Popover open={agentOpen} onClose={() => setAgentOpen(false)}>
                <div className="min-w-[260px] max-w-[300px] flex flex-col">
                  <div className="px-2 py-1.5 text-[10px] text-[var(--muted)] uppercase tracking-wider font-medium border-b border-[var(--border)] sticky top-0 bg-[var(--surface)]">
                    Agent role
                  </div>
                  <div className="max-h-[240px] overflow-y-auto px-1 py-0.5">
                    <button
                      onClick={() => { onAgentChange(null); setAgentOpen(false); }}
                      className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-[12px] hover:bg-[var(--bg)] transition-colors text-left"
                    >
                      <span className="w-3 shrink-0">{!agent && <Check size={11} className="text-[var(--cedar)]" />}</span>
                      <span className={!agent ? "text-[var(--text)] font-medium" : "text-[var(--muted)] italic"}>(none)</span>
                    </button>
                    {agents.map((a) => (
                      <button
                        key={a.name}
                        onClick={() => { onAgentChange(a.name); setAgentOpen(false); }}
                        title={a.description || a.name}
                        className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-[12px] hover:bg-[var(--bg)] transition-colors text-left"
                      >
                        <span className="w-3 shrink-0">{a.name === agent && <Check size={11} className="text-[var(--cedar)]" />}</span>
                        <span className={["truncate", a.name === agent ? "text-[var(--text)] font-medium" : "text-[var(--muted)]"].join(" ")}>
                          {a.name}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              </Popover>
            </div>
          </div>
        )}

        {/* 3. Working directory */}
        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-[var(--muted)] uppercase tracking-wider font-medium px-1">
            Working Directory
          </label>
          <input
            type="text"
            value={dirDraft}
            onChange={(e) => setDirDraft(e.target.value)}
            onBlur={commitDir}
            onKeyDown={(e) => { if (e.key === "Enter") { commitDir(); (e.target as HTMLInputElement).blur(); } }}
            placeholder="/path/to/project"
            spellCheck={false}
            className="w-full bg-[var(--surface)] border border-[var(--border)] rounded-lg px-3 py-2 text-[13px] font-mono text-[var(--text)] placeholder:text-[var(--muted)] hover:border-[var(--cedar)]/50 focus:border-[var(--cedar)]/50 focus:outline-none transition-colors"
          />
          <p className="text-[10px] text-[var(--muted)] px-1">
            Leave empty to use a default workspace folder.
          </p>
        </div>
      </div>

      {/* Suggestion pills — populated from background memory consolidator. */}
      {onPickSuggestion && suggestions.length > 0 && (
        <div className="flex flex-col items-center gap-2 w-full max-w-[640px] mt-2">
          <div className="flex items-center gap-2 text-[10px] text-[var(--muted)] uppercase tracking-wider">
            <Sparkles size={11} className="text-[var(--cedar)]" />
            <span>Suggestions</span>
            <button
              onClick={refreshSuggestions}
              disabled={refreshing}
              className="text-[var(--muted)] hover:text-[var(--cedar)] disabled:opacity-40 transition-colors"
              title="Regenerate suggestions"
            >
              <RefreshCw size={11} className={refreshing ? "animate-spin" : ""} />
            </button>
          </div>
          <div className="flex flex-wrap gap-2 justify-center">
            {suggestions.map((s, i) => (
              <button
                key={i}
                onClick={() => onPickSuggestion(s)}
                className="px-3 py-1.5 rounded-full border border-[var(--cedar-line)] bg-[var(--cedar-dim)] text-[var(--cedar-glow)] text-[12px] hover:bg-[var(--cedar)] hover:text-white transition-colors"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
