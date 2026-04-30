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

export const GEMINI_MODELS: ModelEntry[] = [
  { id: "gemini-2.5-pro",        label: "Gemini 2.5 Pro" },
  { id: "gemini-2.5-flash",      label: "Gemini 2.5 Flash" },
  { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash-Lite" },
];

// Ollama is *dynamic* — only models the user has actually pulled should
// appear in pickers. The cache is populated by useOllamaInstalledModels()
// (see hooks/useOllamaInstalledModels.ts) which queries /installer/status.
// `OLLAMA_MODELS` is intentionally empty by default — pickers show
// "no models pulled" until the hook fetches the real list.
export let OLLAMA_MODELS: ModelEntry[] = [];

let _ollamaInstalled: ModelEntry[] | null = null;
const _ollamaSubs: Set<() => void> = new Set();

export function setOllamaInstalledModels(models: ModelEntry[] | null): void {
  _ollamaInstalled = models;
  OLLAMA_MODELS = models ?? [];
  _ollamaSubs.forEach((cb) => cb());
}

export function getOllamaInstalledModels(): ModelEntry[] | null {
  return _ollamaInstalled;
}

export function subscribeOllamaInstalled(cb: () => void): () => void {
  _ollamaSubs.add(cb);
  return () => { _ollamaSubs.delete(cb); };
}

export const CLAUDE_DEFAULT = "claude-opus-4-7";
export const CODEX_DEFAULT = "gpt-5.4";
export const KIRO_DEFAULT = "auto";
export const GEMINI_DEFAULT = "gemini-2.5-pro";
export const OLLAMA_DEFAULT = "gemma3:4b";

export function modelsForProvider(provider: string | undefined): ModelEntry[] {
  switch (provider) {
    case "codex": return CODEX_MODELS;
    case "kiro-cli": return KIRO_MODELS;
    case "anthropic": return ANTHROPIC_MODELS;
    case "gemini": return GEMINI_MODELS;
    case "ollama": return _ollamaInstalled ?? OLLAMA_MODELS;
    default: return CLAUDE_MODELS; // claude-code or unknown
  }
}

export function defaultModelForProvider(provider: string | undefined): string {
  switch (provider) {
    case "codex": return CODEX_DEFAULT;
    case "kiro-cli": return KIRO_DEFAULT;
    case "anthropic": return CLAUDE_DEFAULT;
    case "gemini": return GEMINI_DEFAULT;
    case "ollama":
      // First installed model wins. If nothing is pulled yet, fall back
      // to the well-known default; user will see "Pull a model" prompts.
      return (_ollamaInstalled && _ollamaInstalled[0]?.id) || OLLAMA_DEFAULT;
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
  "gemini": "Gemini CLI",
  "ollama": "Ollama",
};
