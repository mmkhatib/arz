import { useEffect, useState } from "react";
import { api } from "@/api/client";
import type { Settings } from "@/api/client";

interface Props {
  onClose: () => void;
}

const PROVIDERS = [
  { value: "claude-code", label: "Claude Code CLI" },
  { value: "kiro-cli", label: "Kiro CLI (Amazon)" },
] as const;

export default function SettingsModal({ onClose }: Props) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [provider, setProvider] = useState<Settings["provider"]>("claude-code");
  const [model, setModel] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.getSettings().then((s) => {
      setSettings(s);
      setProvider(s.provider);
      setModel(s.model);
    }).catch((e: Error) => setError(e.message));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await api.saveSettings({ provider, model });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-[15px] font-semibold text-[var(--text)]">Settings</h2>
          <button
            onClick={onClose}
            className="text-[var(--muted)] hover:text-[var(--text)] text-xl leading-none"
          >
            ×
          </button>
        </div>

        {!settings && !error && (
          <div className="text-center text-[var(--muted)] py-6 text-sm animate-pulse">Loading…</div>
        )}

        {error && (
          <div className="text-red-400 text-sm bg-red-900/20 rounded-xl px-3 py-2 mb-4">{error}</div>
        )}

        {settings && (
          <div className="space-y-5">
            {/* Provider */}
            <div>
              <label className="block text-[12px] font-medium text-[var(--muted)] uppercase tracking-wider mb-2">
                Provider
              </label>
              <div className="space-y-2">
                {PROVIDERS.map((p) => (
                  <label
                    key={p.value}
                    className="flex items-center gap-3 cursor-pointer"
                  >
                    <input
                      type="radio"
                      name="provider"
                      value={p.value}
                      checked={provider === p.value}
                      onChange={() => setProvider(p.value)}
                      className="accent-[var(--cedar)]"
                    />
                    <span className="text-[14px] text-[var(--text)]">{p.label}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Model */}
            <div>
              <label className="block text-[12px] font-medium text-[var(--muted)] uppercase tracking-wider mb-2">
                Model
              </label>
              <input
                type="text"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="e.g. claude-opus-4-7"
                className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-xl px-3 py-2 text-[14px] text-[var(--text)] placeholder-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-[var(--cedar)]/40"
              />
            </div>

            {/* Save */}
            <button
              onClick={handleSave}
              disabled={saving}
              className="w-full py-2.5 rounded-xl bg-[var(--cedar)] text-white text-[14px] font-medium hover:bg-[var(--cedar-lt)] transition-colors disabled:opacity-50"
            >
              {saving ? "Saving…" : saved ? "Saved!" : "Save settings"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
