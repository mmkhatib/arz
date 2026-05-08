import { useState, useCallback, useEffect } from "react";

export type ModePreference = "dark" | "light" | "system";
export type ResolvedMode = "dark" | "light";
export type ColorTheme = string;

export interface ThemeEntry {
  value: string;
  label: string;
}

// Arz-original theme names. Most are riffs on classic palettes but with
// our own colour shifts so they read as Arz themes, not direct ports.
export const THEMES: ThemeEntry[] = [
  { value: "cedar", label: "Cedar" },          // signature green/forest
  { value: "saffron", label: "Saffron" },      // warm citrine + olive
  { value: "twilight", label: "Twilight" },    // dusty violet
  { value: "glacier", label: "Glacier" },      // pale arctic blue
  { value: "driftwood", label: "Driftwood" },  // muted teal on cream
  { value: "inkwell", label: "Inkwell" },      // deep navy + indigo
  { value: "ember", label: "Ember" },          // burnt orange + ochre
  { value: "lavender", label: "Lavender" },    // soft mauve
  { value: "petal", label: "Petal" },          // rose + dusk
  { value: "glass", label: "Glass" },          // crisp cyan
  { value: "obsidian", label: "Obsidian" },    // pure-black AMOLED
];

// One-shot remap: anyone with the old theme keys in localStorage from
// a prior version gets transparently switched to the renamed equivalent.
const THEME_MIGRATION: Record<string, string> = {
  monokai: "saffron",
  dracula: "twilight",
  nord: "glacier",
  solarized: "driftwood",
  tokyonight: "inkwell",
  gruvbox: "ember",
  catppuccin: "lavender",
  rosepine: "petal",
  ice: "glass",
  amoled: "obsidian",
};

function migrateTheme(name: string): string {
  return THEME_MIGRATION[name] ?? name;
}

function getSystemMode(): ResolvedMode {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function resolveMode(pref: ModePreference): ResolvedMode {
  return pref === "system" ? getSystemMode() : pref;
}

function applyTheme(colorTheme: ColorTheme, mode: ResolvedMode) {
  document.documentElement.dataset.theme = `${colorTheme}-${mode}`;
  document.documentElement.dataset.mode = mode;
}

const SYNC_EVENT = "arz-theme-sync";

export function useTheme() {
  const [mode, setMode] = useState<ModePreference>(
    () => (localStorage.getItem("arz-mode") as ModePreference) || "system"
  );
  const [colorTheme, setColorThemeState] = useState<ColorTheme>(() => {
    const raw = (localStorage.getItem("arz-color-theme") as ColorTheme) || "cedar";
    const migrated = migrateTheme(raw);
    if (migrated !== raw) localStorage.setItem("arz-color-theme", migrated);
    return migrated;
  });
  const [resolved, setResolved] = useState<ResolvedMode>(() =>
    resolveMode((localStorage.getItem("arz-mode") as ModePreference) || "system")
  );

  useEffect(() => {
    applyTheme(colorTheme, resolved);
  }, [resolved, colorTheme]);

  useEffect(() => {
    if (mode !== "system") return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => setResolved(getSystemMode());
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, [mode]);

  // Sync across multiple useTheme() instances on the same page
  useEffect(() => {
    const handler = (e: Event) => {
      const { mode: m, colorTheme: ct } = (e as CustomEvent).detail;
      setMode(m);
      setResolved(resolveMode(m));
      setColorThemeState(ct);
    };
    window.addEventListener(SYNC_EVENT, handler);
    return () => window.removeEventListener(SYNC_EVENT, handler);
  }, []);

  const setColorTheme = useCallback((t: ColorTheme) => {
    localStorage.setItem("arz-color-theme", t);
    setColorThemeState(t);
    const m = (localStorage.getItem("arz-mode") as ModePreference) || "system";
    window.dispatchEvent(new CustomEvent(SYNC_EVENT, { detail: { mode: m, colorTheme: t } }));
  }, []);

  const setThemeMode = useCallback((pref: ModePreference) => {
    localStorage.setItem("arz-mode", pref);
    setMode(pref);
    const newResolved = resolveMode(pref);
    setResolved(newResolved);
    const ct = (localStorage.getItem("arz-color-theme") as ColorTheme) || "cedar";
    window.dispatchEvent(new CustomEvent(SYNC_EVENT, { detail: { mode: pref, colorTheme: ct } }));
  }, []);

  return {
    mode,
    resolved,
    colorTheme,
    setColorTheme,
    setMode: setThemeMode,
    themes: THEMES,
  };
}
