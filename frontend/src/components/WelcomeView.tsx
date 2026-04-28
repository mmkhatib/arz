import { useRef, useState } from "react";
import { Check } from "lucide-react";
import Popover from "./Popover";

const KNOWN_MODELS = [
  { id: "claude-opus-4-7",           label: "Claude Opus 4.7" },
  { id: "claude-sonnet-4-6",         label: "Claude Sonnet 4.6" },
  { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
  { id: "claude-opus-4-5",           label: "Claude Opus 4.5" },
];

const CODEX_MODELS = [
  { id: "gpt-5.4",       label: "GPT-5.4" },
  { id: "gpt-5.5",       label: "GPT-5.5" },
  { id: "gpt-5.4-mini",  label: "GPT-5.4 Mini" },
  { id: "gpt-5.3-codex", label: "GPT-5.3 Codex" },
  { id: "gpt-5.2",       label: "GPT-5.2" },
];

const CODEX_DEFAULT = "gpt-5.4";

interface Props {
  model?: string;
  onModelChange?: (model: string) => void;
  provider?: string;
  workDir: string;
  onWorkDirChange: (path: string) => void;
}

const PROVIDER_LABELS: Record<string, string> = {
  "kiro-cli": "Kiro CLI",
  "codex": "OpenAI Codex",
  "anthropic": "Anthropic API",
};

export default function WelcomeView({ model, onModelChange, provider, workDir, onWorkDirChange }: Props) {
  const [modelOpen, setModelOpen] = useState(false);
  const [dirDraft, setDirDraft] = useState(workDir);
  const modelBtnRef = useRef<HTMLButtonElement>(null);

  const isCodex = provider === "codex";
  const effectiveModel = isCodex
    ? (!model || model.startsWith("claude-") ? CODEX_DEFAULT : model)
    : model;
  const activeModel = isCodex
    ? CODEX_MODELS.find((m) => m.id === effectiveModel)
    : KNOWN_MODELS.find((m) => m.id === effectiveModel);

  const commitDir = () => {
    const trimmed = dirDraft.trim();
    if (trimmed !== workDir) onWorkDirChange(trimmed);
  };

  return (
    <div className="flex flex-col items-center justify-center h-full gap-8 px-6 pb-16">
      {/* Branding */}
      <div className="flex flex-col items-center gap-3">
        <div className="w-16 h-16 rounded-2xl bg-[var(--cedar)] flex items-center justify-center text-3xl">
          🌲
        </div>
        <div className="text-center">
          <h2 className="text-[17px] font-semibold text-[var(--text)] mb-1">New Session</h2>
          <p className="text-[13px] text-[var(--muted)]">Configure your session, then start chatting.</p>
        </div>
      </div>

      {/* Options */}
      <div className="flex flex-col gap-3 w-full max-w-[360px]">
        {/* Model picker — codex models, Claude models, or static provider badge */}
        {provider && provider !== "claude-code" && provider !== "codex" ? (
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] text-[var(--muted)] uppercase tracking-wider font-medium px-1">Provider</label>
            <div className="flex items-center gap-2 bg-[var(--surface)] border border-[var(--border)] rounded-xl px-3 py-2.5">
              <span className="text-[13px] font-medium text-[var(--cedar)]">
                {PROVIDER_LABELS[provider] ?? provider}
              </span>
            </div>
          </div>
        ) : (
        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] text-[var(--muted)] uppercase tracking-wider font-medium px-1">Model</label>
          <div className="relative">
            <button
              ref={modelBtnRef}
              onClick={() => setModelOpen((v) => !v)}
              className="w-full flex items-center gap-2 bg-[var(--surface)] border border-[var(--border)] rounded-xl px-3 py-2.5 text-[13px] font-mono hover:border-[var(--cedar)]/50 transition-colors focus:outline-none focus:border-[var(--cedar)]/50"
            >
              <span className="flex-1 text-left text-[var(--text)] font-medium truncate">
                {activeModel?.label ?? effectiveModel ?? "Select model…"}
              </span>
              <span className="text-[var(--muted)] text-[11px] shrink-0">▾</span>
            </button>
            <Popover open={modelOpen} onClose={() => setModelOpen(false)}>
              <div className="px-1 py-0.5 min-w-[200px]">
                <div className="px-2 py-1 text-[10px] text-[var(--muted)] uppercase tracking-wider font-medium">Model</div>
                {(isCodex ? CODEX_MODELS : KNOWN_MODELS).map((m) => (
                  <button
                    key={m.id}
                    onClick={() => { onModelChange?.(m.id); setModelOpen(false); }}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-[13px] hover:bg-[var(--bg)] transition-colors text-left"
                  >
                    <span className="w-3 shrink-0">
                      {m.id === effectiveModel && <Check size={12} className="text-[var(--cedar)]" />}
                    </span>
                    <span className={m.id === effectiveModel ? "text-[var(--text)] font-medium" : "text-[var(--muted)]"}>
                      {m.label}
                    </span>
                  </button>
                ))}
              </div>
            </Popover>
          </div>
        </div>
        )}

        {/* Working directory */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] text-[var(--muted)] uppercase tracking-wider font-medium px-1">
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
            className="w-full bg-[var(--surface)] border border-[var(--border)] rounded-xl px-3 py-2.5 text-[13px] font-mono text-[var(--text)] placeholder:text-[var(--muted)] hover:border-[var(--cedar)]/50 focus:border-[var(--cedar)]/50 focus:outline-none transition-colors"
          />
          <p className="text-[11px] text-[var(--muted)] px-1">
            Leave empty to use a default workspace folder.
          </p>
        </div>
      </div>
    </div>
  );
}
