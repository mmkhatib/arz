import { useEffect, useState } from "react";
import { api } from "@/api/client";
import type { Settings } from "@/api/client";
import {
  SettingsToggle,
  SettingsSelect,
  SettingsInput,
  SettingsSection,
  SettingsCard,
} from "./settings/primitives";

interface Props {
  onClose?: () => void;
  variant?: "modal" | "page";
}

const PROVIDER_OPTIONS = ["claude-code", "kiro-cli", "anthropic"];
const PROVIDER_LABELS = ["Claude Code CLI", "Kiro CLI (Amazon)", "Anthropic API (direct)"];
const LOG_LEVELS = ["DEBUG", "INFO", "WARNING", "ERROR"];

export default function SettingsModal({ onClose, variant = "modal" }: Props) {
  const handleClose = onClose ?? (() => {});
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState(0);

  // Local-only buffers for fields with onBlur save semantics
  const [model, setModel] = useState("");
  const [botName, setBotName] = useState("");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");

  useEffect(() => {
    api
      .getSettings()
      .then((s) => {
        setSettings(s);
        setModel(s.model);
        setBotName(s.bot_name);
        setHost(s.host);
        setPort(String(s.port));
        setSystemPrompt(s.system_prompt);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  // Esc to close — only in modal variant; page variant has no close action
  useEffect(() => {
    if (variant !== "modal") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [variant, handleClose]);

  const patch = async (body: Partial<Settings>) => {
    setError(null);
    try {
      const next = await api.saveSettings(body);
      setSettings(next);
      setSavedAt(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (!settings && !error) {
    return (
      <Shell variant={variant} onClose={handleClose}>
        <div className="text-center text-[var(--muted)] py-12 text-sm animate-pulse">Loading…</div>
      </Shell>
    );
  }

  if (!settings) {
    return (
      <Shell variant={variant} onClose={handleClose}>
        <div className="text-red-400 text-sm bg-red-900/20 rounded-xl px-3 py-2">{error}</div>
      </Shell>
    );
  }

  const justSaved = Date.now() - savedAt < 1500;

  return (
    <Shell variant={variant} onClose={handleClose} savedFlag={justSaved} error={error}>
      <SettingsSection title="Provider">
        <SettingsCard>
          <SettingsSelect
            label="LLM Provider"
            description="Backend used for new sessions (existing sessions keep their own provider)"
            value={settings.provider}
            options={PROVIDER_OPTIONS}
            optionLabels={PROVIDER_LABELS}
            onChange={(v) => patch({ provider: v as Settings["provider"] })}
          />
          <SettingsInput
            label="Model"
            description="Provider-specific model identifier (e.g. claude-opus-4-7, claude-sonnet-4-6)"
            value={model}
            onChange={setModel}
            onBlur={() => model !== settings.model && patch({ model: model.trim() })}
            placeholder="claude-opus-4-7"
          />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="Dashboard">
        <SettingsCard>
          <SettingsInput
            label="Bot Name"
            description="Display name shown in the chat header"
            value={botName}
            onChange={setBotName}
            onBlur={() => botName !== settings.bot_name && patch({ bot_name: botName.trim() })}
            placeholder="Arzeh"
          />
          <SettingsInput
            label="Host"
            description="127.0.0.1 (loopback only) or 0.0.0.0 (all interfaces — requires token auth). Restart required."
            value={host}
            onChange={setHost}
            onBlur={() => host !== settings.host && patch({ host: host.trim() })}
            placeholder="127.0.0.1"
          />
          <SettingsInput
            label="Port"
            description="Dashboard listen port. Restart required."
            value={port}
            onChange={setPort}
            onBlur={() => {
              const n = Number(port);
              if (Number.isInteger(n) && n >= 1 && n <= 65535 && n !== settings.port) {
                patch({ port: n });
              } else if (port !== String(settings.port)) {
                setPort(String(settings.port));
              }
            }}
            type="number"
            placeholder="7777"
          />
          <SettingsToggle
            label="Token Auth"
            description="Require X-Arz-Token header on API requests. Mandatory when binding to non-loopback hosts."
            checked={settings.token_auth}
            onChange={(v) => patch({ token_auth: v })}
          />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="Memory">
        <SettingsCard>
          <SettingsToggle
            label="Auto-recall (RAG)"
            description="Prepend top-K relevant memory entries to every prompt. Off by default."
            checked={settings.auto_recall}
            onChange={(v) => patch({ auto_recall: v })}
          />
          <SettingsSelect
            label="Recall depth (K)"
            description="How many memory hits to include when auto-recall is enabled"
            value={String(settings.recall_k)}
            options={["1", "2", "3", "5", "8"]}
            onChange={(v) => patch({ recall_k: Number(v) })}
            disabled={!settings.auto_recall}
          />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="Advanced">
        <SettingsCard>
          <SettingsSelect
            label="Log Level"
            description="Server-side logging verbosity. Restart required."
            value={settings.log_level}
            options={LOG_LEVELS}
            onChange={(v) => patch({ log_level: v })}
          />
          <SettingsInput
            label="System Prompt"
            description="Default system prompt prepended to new sessions"
            value={systemPrompt}
            onChange={setSystemPrompt}
            onBlur={() =>
              systemPrompt !== settings.system_prompt && patch({ system_prompt: systemPrompt })
            }
            multiline
            rows={5}
          />
        </SettingsCard>
      </SettingsSection>
    </Shell>
  );
}

function Shell({
  onClose,
  children,
  savedFlag,
  error,
  variant = "modal",
}: {
  onClose: () => void;
  children: React.ReactNode;
  savedFlag?: boolean;
  error?: string | null;
  variant?: "modal" | "page";
}) {
  const header = (
    <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-[var(--border)]">
      <div className="flex items-center gap-3">
        <h2 className="text-[15px] font-semibold text-[var(--text)]">Settings</h2>
        {savedFlag && (
          <span className="text-[11px] text-[var(--accent)] uppercase tracking-wider animate-pulse">
            Saved
          </span>
        )}
      </div>
      {variant === "modal" && (
        <button
          onClick={onClose}
          className="text-[var(--muted)] hover:text-[var(--text)] text-xl leading-none"
          aria-label="Close settings"
        >
          ×
        </button>
      )}
    </div>
  );
  const errorBlock = error && (
    <div className="mx-5 mt-3 text-red-400 text-sm bg-red-900/20 rounded-xl px-3 py-2">
      {error}
    </div>
  );

  if (variant === "page") {
    return (
      <div className="flex flex-col h-full bg-[var(--bg)] min-w-0 flex-1 overflow-hidden">
        {header}
        {errorBlock}
        <div className="overflow-y-auto px-6 py-4 flex-1">{children}</div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-[var(--bg)] border border-[var(--border)] rounded-2xl shadow-2xl w-full max-w-2xl mx-4 max-h-[85vh] flex flex-col">
        {header}
        {errorBlock}
        <div className="overflow-y-auto px-5 py-4 flex-1">{children}</div>
      </div>
    </div>
  );
}
