interface Props {
  onClose?: () => void;
  variant?: "modal" | "page";
}

const SHORTCUTS: { keys: string[]; label: string }[] = [
  { keys: ["⌘", "K"], label: "New session" },
  { keys: ["⌘", "F"], label: "Focus search" },
  { keys: ["⌘", "["], label: "Previous session" },
  { keys: ["⌘", "]"], label: "Next session" },
  { keys: ["⌘", "W"], label: "Close current session" },
  { keys: ["Esc"], label: "Close modal / file viewer" },
  { keys: ["?"], label: "Show this overlay" },
];

export default function ShortcutsOverlay({ onClose, variant = "modal" }: Props) {
  const handleClose = onClose ?? (() => {});

  const header = (
    <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-[var(--border)]">
      <h2 className="text-[15px] font-semibold text-[var(--text)]">Keyboard Shortcuts</h2>
      {variant === "modal" && (
        <button
          onClick={handleClose}
          className="text-[var(--muted)] hover:text-[var(--text)] text-xl leading-none"
          aria-label="Close shortcuts"
        >
          ×
        </button>
      )}
    </div>
  );

  const body = (
    <>
      <div className="p-5 flex flex-col gap-2">
        {SHORTCUTS.map((s) => (
          <div key={s.label} className="flex items-center justify-between">
            <span className="text-[13px] text-[var(--text)]">{s.label}</span>
            <div className="flex gap-1">
              {s.keys.map((k) => (
                <kbd
                  key={k}
                  className="px-2 py-0.5 rounded bg-[var(--surface)] border border-[var(--border)] text-[11px] font-mono text-[var(--muted)] min-w-[24px] text-center"
                >
                  {k}
                </kbd>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="px-5 pb-4 text-[11px] text-[var(--muted)]">
        On Linux/Windows, ⌘ = Ctrl. Some shortcuts (⌘W) may be intercepted by the browser.
      </div>
    </>
  );

  if (variant === "page") {
    return (
      <div className="flex flex-col h-full bg-[var(--bg)] min-w-0 overflow-hidden">
        {header}
        <div className="overflow-y-auto flex-1 max-w-md w-full mx-auto">
          {body}
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div className="bg-[var(--bg)] border border-[var(--border)] rounded-2xl shadow-2xl w-full max-w-md mx-4">
        {header}
        {body}
      </div>
    </div>
  );
}
