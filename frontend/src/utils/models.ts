// Shared model catalog used by InputBar, WelcomeView, CompareModal,
// SettingsModal. Single source of truth — adding a new model here lights it
// up everywhere.

export interface ModelEntry {
  id: string;
  label: string;
}

// Static lists are FALLBACKS only — the server asks each CLI which models
// it serves today (GET /api/models, see arz/model_catalog.py) and
// setLiveModels() replaces these at boot. Prefer CLI aliases ("opus",
// "pro") here: they resolve to the newest model, so they never go stale.

export const CLAUDE_MODELS: ModelEntry[] = [
  { id: "opus",   label: "Opus (latest)" },
  { id: "fable",  label: "Fable (latest)" },
  { id: "sonnet", label: "Sonnet (latest)" },
  { id: "haiku",  label: "Haiku (latest)" },
];

export const CODEX_MODELS: ModelEntry[] = [
  { id: "", label: "Codex default" },
];

export const KIRO_MODELS: ModelEntry[] = [
  { id: "auto", label: "Auto" },
];

export const ANTHROPIC_MODELS: ModelEntry[] = [
  { id: "claude-opus-5-5",   label: "Claude Opus 5.5" },
  { id: "claude-fable-5-1",  label: "Claude Fable 5.1" },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5" },
  { id: "claude-haiku-5-5",  label: "Claude Haiku 5.5" },
];

export const GEMINI_MODELS: ModelEntry[] = [
  { id: "auto",       label: "Auto (Gemini picks)" },
  { id: "pro",        label: "Pro (latest)" },
  { id: "flash",      label: "Flash (latest)" },
  { id: "flash-lite", label: "Flash-Lite (latest)" },
];

// ── Live lists from the server ──────────────────────────────────────
interface LiveProvider { models: ModelEntry[]; defaultId: string | null }
const _live: Record<string, LiveProvider> = {};
const _liveSubs: Set<() => void> = new Set();

export function setLiveModels(
  providers: Record<string, { models: { id: string; label: string; default?: boolean }[] }>,
): void {
  for (const [name, p] of Object.entries(providers)) {
    if (name === "ollama" || !p.models?.length) continue; // ollama has its own hook
    _live[name] = {
      models: p.models.map((m) => ({ id: m.id, label: m.label })),
      defaultId: p.models.find((m) => m.default)?.id ?? p.models[0].id,
    };
  }
  _liveSubs.forEach((cb) => cb());
}

export function subscribeLiveModels(cb: () => void): () => void {
  _liveSubs.add(cb);
  return () => { _liveSubs.delete(cb); };
}

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

export const CLAUDE_DEFAULT = "opus";
export const ANTHROPIC_DEFAULT = "claude-opus-5-5";
export const CODEX_DEFAULT = "";
export const KIRO_DEFAULT = "auto";
export const GEMINI_DEFAULT = "auto";
export const OLLAMA_DEFAULT = "gemma3:4b";

export function modelsForProvider(provider: string | undefined): ModelEntry[] {
  const live = _live[provider || "claude-code"];
  if (live) return live.models;
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
  const live = _live[provider || "claude-code"];
  if (live?.defaultId != null) return live.defaultId;
  switch (provider) {
    case "codex": return CODEX_DEFAULT;
    case "kiro-cli": return KIRO_DEFAULT;
    case "anthropic": return ANTHROPIC_DEFAULT;
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
  // Until the live list lands, trust the saved model — judging it against
  // the static fallback would overwrite a valid pick (e.g. a Codex model
  // the fallback doesn't know) on every page load.
  if (provider !== "ollama" && !_live[provider || "claude-code"]) return true;
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
