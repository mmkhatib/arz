// Small segmented control used by Memory / Schedule / Analytics pages
// to toggle between alternate layout variants. Persists choice to
// localStorage under the given key.

import { useEffect, useState } from "react";

interface Variant<T extends string> {
  id: T;
  label: string;
  icon?: React.ReactNode;
}

interface Props<T extends string> {
  storageKey: string;
  variants: Variant<T>[];
  value: T;
  onChange: (v: T) => void;
}

export default function VariantSwitcher<T extends string>({ variants, value, onChange }: Props<T>) {
  return (
    <div className="inline-flex items-center gap-0.5 rounded-md bg-[var(--surface)] border border-[var(--border)] p-0.5">
      {variants.map((v) => (
        <button
          key={v.id}
          onClick={() => onChange(v.id)}
          className={[
            "flex items-center gap-1 px-2 py-1 rounded text-[11px] transition-colors",
            value === v.id
              ? "bg-[var(--cedar-dim)] text-[var(--text)]"
              : "text-[var(--muted)] hover:text-[var(--text)]",
          ].join(" ")}
        >
          {v.icon}
          <span>{v.label}</span>
        </button>
      ))}
    </div>
  );
}

export function useVariant<T extends string>(storageKey: string, defaultValue: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      return (raw as T) || defaultValue;
    } catch { return defaultValue; }
  });
  useEffect(() => {
    try { localStorage.setItem(storageKey, v); } catch {}
  }, [storageKey, v]);
  return [v, setV];
}
