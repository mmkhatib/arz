// Shared model catalog used by InputBar, WelcomeView, CompareModal,
// SettingsModal. Single source of truth — adding a new model here lights it
// up everywhere.

export interface ModelEntry {
  id: string;
  label: string;
}

export const CLAUDE_MODELS: ModelEntry[] = [
  { id: "claude-opus-4-7",           label: "Claude Opus 4.7" },
  { id: "claude-sonnet-4-6",         label: "Claude Sonnet 4.6" },
  { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
  { id: "claude-opus-4-5",           label: "Claude Opus 4.5" },
];

export const CODEX_MODELS: ModelEntry[] = [
  { id: "gpt-5.4",       label: "GPT-5.4" },
  { id: "gpt-5.5",       label: "GPT-5.5" },
  { id: "gpt-5.4-mini",  label: "GPT-5.4 Mini" },
  { id: "gpt-5.3-codex", label: "GPT-5.3 Codex" },
  { id: "gpt-5.2",       label: "GPT-5.2" },
];

export const KIRO_MODELS: ModelEntry[] = [
  { id: "auto",              label: "Auto" },
  { id: "claude-sonnet-4.5", label: "Claude Sonnet 4.5" },
  { id: "claude-sonnet-4",   label: "Claude Sonnet 4" },
  { id: "claude-haiku-4.5",  label: "Claude Haiku 4.5" },
  { id: "deepseek-3.2",      label: "DeepSeek 3.2" },
  { id: "minimax-m2.5",      label: "MiniMax M2.5" },
  { id: "minimax-m2.1",      label: "MiniMax M2.1" },
  { id: "glm-5",             label: "GLM-5" },
  { id: "qwen3-coder-next",  label: "Qwen3 Coder Next" },
];

export const ANTHROPIC_MODELS: ModelEntry[] = [
  { id: "claude-opus-4-7",           label: "Claude Opus 4.7" },
  { id: "claude-sonnet-4-6",         label: "Claude Sonnet 4.6" },
  { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
];

export const CLAUDE_DEFAULT = "claude-opus-4-7";
export const CODEX_DEFAULT = "gpt-5.4";
export const KIRO_DEFAULT = "auto";

export function modelsForProvider(provider: string | undefined): ModelEntry[] {
  switch (provider) {
    case "codex": return CODEX_MODELS;
    case "kiro-cli": return KIRO_MODELS;
    case "anthropic": return ANTHROPIC_MODELS;
    default: return CLAUDE_MODELS; // claude-code or unknown
  }
}

export function defaultModelForProvider(provider: string | undefined): string {
  switch (provider) {
    case "codex": return CODEX_DEFAULT;
    case "kiro-cli": return KIRO_DEFAULT;
    case "anthropic": return CLAUDE_DEFAULT;
    default: return CLAUDE_DEFAULT;
  }
}

export function isModelValid(provider: string | undefined, modelId: string | undefined): boolean {
  if (!modelId) return false;
  return modelsForProvider(provider).some((m) => m.id === modelId);
}

/** Display labels for the static provider chip when no model picker shows. */
export const PROVIDER_LABELS: Record<string, string> = {
  "claude-code": "Claude Code",
  "kiro-cli": "Kiro CLI",
  "codex": "OpenAI Codex",
  "anthropic": "Anthropic API",
  "ollama": "Ollama",
};
