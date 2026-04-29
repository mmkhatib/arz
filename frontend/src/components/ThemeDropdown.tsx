import { useEffect, useRef, useState } from "react";
import { useTheme, THEMES } from "@/hooks/useTheme";

export default function ThemeDropdown() {
  const { colorTheme, mode, setColorTheme, setMode } = useTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const activeLabel = THEMES.find((t) => t.value === colorTheme)?.label ?? "Theme";

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        title="Theme"
        className={[
          "text-[12px] px-2 py-1 rounded-lg transition-colors flex items-center gap-1",
          open
            ? "bg-[var(--cedar)]/20 text-[var(--cedar)]"
            : "text-[var(--muted)] hover:text-[var(--text)]",
        ].join(" ")}
      >
        <span>{activeLabel}</span>
        <span className="text-[10px] opacity-70">▾</span>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-30 bg-[var(--surface)] border border-[var(--border)] rounded-xl shadow-xl py-1.5 min-w-[180px]">
          <div className="px-3 pb-1.5 mb-1 border-b border-[var(--border)] flex gap-1">
            {(["dark", "light", "system"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={[
                  "flex-1 text-[11px] rounded-md py-1 capitalize transition-colors",
                  mode === m
                    ? "bg-[var(--cedar)]/20 text-[var(--cedar)] font-medium"
                    : "text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--bg)]",
                ].join(" ")}
              >
                {m}
              </button>
            ))}
          </div>
          {THEMES.map((t) => (
            <button
              key={t.value}
              onClick={() => { setColorTheme(t.value); setOpen(false); }}
              className={[
                "w-full text-left px-3 py-1.5 text-[13px] flex items-center gap-2 transition-colors",
                colorTheme === t.value
                  ? "text-[var(--text)] font-medium"
                  : "text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--bg)]",
              ].join(" ")}
            >
              {colorTheme === t.value
                ? <span className="text-[var(--cedar)] text-[10px]">●</span>
                : <span className="w-[14px]" />}
              {t.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
