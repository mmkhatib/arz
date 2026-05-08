// Theme + mode + density.
//
// data-theme   = "cedar" | alt palette name
// data-mode    = "dark" | "light"   (single source of truth, never "system" on the DOM)
// data-density = "compact" | "cozy" | "airy"
//
// Mode preference can be "system" — we resolve to dark/light on read +
// re-resolve when the OS preference changes. Theme is always concrete.
// Cedar is the brand default; alt themes recolor only the cedar
// variables (—cedar, —cedar-glow, —user-bg, —accent) so surfaces stay
// neutral across themes.

import { useState, useCallback, useEffect } from "react";

export type ModePreference = "dark" | "light" | "system";
export type ResolvedMode = "dark" | "light";
export type ColorTheme = string;
export type Density = "compact" | "cozy" | "airy";

export interface ThemeEntry {
  value: string;
  label: string;
  /** A representative seed colour for theme-picker swatches. */
  swatch: string;
}

export const THEMES: ThemeEntry[] = [
  { value: "cedar",     label: "Cedar",     swatch: "#4a8a6a" },
  { value: "saffron",   label: "Saffron",   swatch: "#9fbf2f" },
  { value: "twilight",  label: "Twilight",  swatch: "#a884e8" },
  { value: "glacier",   label: "Glacier",   swatch: "#6fa6bb" },
  { value: "driftwood", label: "Driftwood", swatch: "#34b0a4" },
  { value: "inkwell",   label: "Inkwell",   swatch: "#6a8df0" },
  { value: "ember",     label: "Ember",     swatch: "#ff8c2a" },
  { value: "lavender",  label: "Lavender",  swatch: "#b894ed" },
  { value: "petal",     label: "Petal",     swatch: "#e598a3" },
  { value: "glass",     label: "Glass",     swatch: "#1cc8e8" },
  { value: "obsidian",  label: "Obsidian",  swatch: "#1a8aff" },
];

export const DENSITIES: { value: Density; label: string }[] = [
  { value: "compact", label: "Compact" },
  { value: "cozy",    label: "Cozy"    },
  { value: "airy",    label: "Airy"    },
];

// Migrate old theme keys to current ones. Lets folks who picked
// "monokai" before the rename keep their selection.
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

function applyDom(theme: ColorTheme, mode: ResolvedMode, density: Density) {
  const html = document.documentElement;
  html.dataset.theme = theme;
  html.dataset.mode = mode;
  html.dataset.density = density;
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
  const [density, setDensityState] = useState<Density>(
    () => (localStorage.getItem("arz-density") as Density) || "cozy"
  );
  const [resolved, setResolved] = useState<ResolvedMode>(() =>
    resolveMode((localStorage.getItem("arz-mode") as ModePreference) || "system")
  );

  useEffect(() => {
    applyDom(colorTheme, resolved, density);
  }, [resolved, colorTheme, density]);

  // Track OS preference when in system mode.
  useEffect(() => {
    if (mode !== "system") return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => setResolved(getSystemMode());
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, [mode]);

  // Sync across multiple useTheme() instances on the same page.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      setMode(detail.mode);
      setResolved(resolveMode(detail.mode));
      setColorThemeState(detail.colorTheme);
      setDensityState(detail.density);
    };
    window.addEventListener(SYNC_EVENT, handler);
    return () => window.removeEventListener(SYNC_EVENT, handler);
  }, []);

  const broadcast = (next: { mode?: ModePreference; theme?: ColorTheme; density?: Density }) => {
    const m = next.mode ?? mode;
    const t = next.theme ?? colorTheme;
    const d = next.density ?? density;
    window.dispatchEvent(new CustomEvent(SYNC_EVENT, { detail: { mode: m, colorTheme: t, density: d } }));
  };

  const setColorTheme = useCallback((t: ColorTheme) => {
    localStorage.setItem("arz-color-theme", t);
    setColorThemeState(t);
    broadcast({ theme: t });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, density]);

  const setThemeMode = useCallback((pref: ModePreference) => {
    localStorage.setItem("arz-mode", pref);
    setMode(pref);
    setResolved(resolveMode(pref));
    broadcast({ mode: pref });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colorTheme, density]);

  const setDensity = useCallback((d: Density) => {
    localStorage.setItem("arz-density", d);
    setDensityState(d);
    broadcast({ density: d });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, colorTheme]);

  return {
    mode,
    resolved,
    colorTheme,
    density,
    setColorTheme,
    setMode: setThemeMode,
    setDensity,
    themes: THEMES,
    densities: DENSITIES,
  };
}
