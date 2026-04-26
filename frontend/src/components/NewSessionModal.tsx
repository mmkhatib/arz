import { useState } from "react";

interface Props {
  defaultProvider: string;
  onConfirm: (provider: string) => void;
  onCancel: () => void;
}

const PROVIDERS = [
  { id: "claude-code", label: "Claude Code", description: "Anthropic's Claude Code CLI" },
  { id: "kiro-cli", label: "Kiro-cli", description: "Amazon Kiro AI assistant" },
];

export default function NewSessionModal({ defaultProvider, onConfirm, onCancel }: Props) {
  const [selected, setSelected] = useState(defaultProvider);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") onCancel();
    if (e.key === "Enter") onConfirm(selected);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onKeyDown={handleKeyDown}
      tabIndex={-1}
    >
      <div
        className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-2xl w-80 p-6 flex flex-col gap-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-[var(--text)] font-semibold text-[15px]">New session</h2>

        <div className="flex flex-col gap-2">
          <label className="text-[var(--muted)] text-[12px] uppercase tracking-wider">Provider</label>
          <div className="flex flex-col gap-2">
            {PROVIDERS.map((p) => (
              <button
                key={p.id}
                onClick={() => setSelected(p.id)}
                className={[
                  "flex items-start gap-3 p-3 rounded-xl border text-left transition-colors",
                  selected === p.id
                    ? "border-[var(--cedar)] bg-[var(--cedar)]/10"
                    : "border-[var(--border)] hover:border-[var(--cedar)]/50 hover:bg-[var(--border)]",
                ].join(" ")}
              >
                <span
                  className={[
                    "mt-0.5 w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center",
                    selected === p.id ? "border-[var(--cedar)]" : "border-[var(--muted)]",
                  ].join(" ")}
                >
                  {selected === p.id && (
                    <span className="w-2 h-2 rounded-full bg-[var(--cedar)]" />
                  )}
                </span>
                <span className="flex flex-col">
                  <span className="text-[var(--text)] text-[13px] font-medium">{p.label}</span>
                  <span className="text-[var(--muted)] text-[11px]">{p.description}</span>
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="flex gap-2 pt-1">
          <button
            onClick={onCancel}
            className="flex-1 py-2 rounded-xl border border-[var(--border)] text-[var(--muted)] text-[13px] hover:text-[var(--text)] hover:border-[var(--cedar)]/40 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(selected)}
            className="flex-1 py-2 rounded-xl bg-[var(--cedar)] text-white text-[13px] font-medium hover:bg-[var(--cedar-lt)] transition-colors"
          >
            Start
          </button>
        </div>
      </div>
    </div>
  );
}
