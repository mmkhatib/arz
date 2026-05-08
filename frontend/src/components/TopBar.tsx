// Global top header. Lives above the page area on every route.
// Hosts: breadcrumb, ⌘K command palette, theme/density dial.

import { useEffect, useState } from "react";
import { Search, Sun, Moon, Monitor, SlidersHorizontal, Check } from "lucide-react";
import { useNavigate, useLocation } from "react-router-dom";
import { api } from "@/api/client";
import Popover from "./Popover";
import { useTheme, type ColorTheme, type Density } from "@/hooks/useTheme";

const PATH_LABELS: Record<string, string> = {
  "/":            "Chat",
  "/chat":        "Chat",
  "/board":       "Operations",
  "/autopilot":   "Autopilot",
  "/channels":    "Channels",
  "/agents":      "Agents",
  "/memory":      "Memory",
  "/schedule":    "Schedule",
  "/analytics":   "Analytics",
  "/capabilities":"Capabilities",
  "/autonomy":    "Autonomy",
  "/models":      "Models",
  "/settings":    "Settings",
  "/overview":    "Overview",
};

function pageLabel(pathname: string): string {
  if (pathname.startsWith("/chat/")) return "Chat";
  return PATH_LABELS[pathname] ?? "Arz";
}

export default function TopBar() {
  const navigate = useNavigate();
  const location = useLocation();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [dialOpen, setDialOpen] = useState(false);
  const dialBtnRef = useState<HTMLButtonElement | null>(null);
  const [, setDialBtn] = dialBtnRef;

  // ⌘K / Ctrl+K opens palette
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <header
      className="shrink-0 flex items-center gap-3 px-4 py-2 border-b border-[var(--border)] bg-[var(--bg)]"
      style={{ minHeight: 44 }}
    >
      <div className="flex items-baseline gap-2 min-w-0">
        <span
          className="font-display text-[15px] text-[var(--text2)] tracking-wide"
          style={{ letterSpacing: ".02em" }}
        >
          arz
        </span>
        <span className="text-[var(--text3)]">/</span>
        <span className="text-[14px] font-medium text-[var(--text)] truncate">
          {pageLabel(location.pathname)}
        </span>
      </div>

      <div className="flex-1 flex justify-center">
        <button
          onClick={() => setPaletteOpen(true)}
          className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-[var(--surface)] border border-[var(--border)] text-[12px] text-[var(--muted)] hover:border-[var(--cedar-line)] hover:text-[var(--text)] min-w-[280px] max-w-[420px] w-full"
        >
          <Search size={13} />
          <span className="flex-1 text-left">Search pages, sessions, history…</span>
          <kbd className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg)] border border-[var(--border)] text-[var(--muted)]">
            ⌘K
          </kbd>
        </button>
      </div>

      <div className="flex items-center gap-1">
        <button
          ref={(el) => setDialBtn(el)}
          onClick={() => setDialOpen((v) => !v)}
          className="flex items-center gap-1 px-2 py-1.5 rounded-md text-[12px] text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface)]"
          title="Theme & density"
        >
          <SlidersHorizontal size={13} />
        </button>
        <ThemeDial open={dialOpen} onClose={() => setDialOpen(false)} />
      </div>

      {paletteOpen && (
        <CommandPalette
          onClose={() => setPaletteOpen(false)}
          onNavigate={(path) => {
            setPaletteOpen(false);
            navigate(path);
          }}
        />
      )}
    </header>
  );
}

// ── Theme + mode + density dial ─────────────────────────────────
function ThemeDial({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { mode, setMode, colorTheme, setColorTheme, density, setDensity, themes, densities } =
    useTheme();
  return (
    <Popover open={open} onClose={onClose} position="below">
      <div className="min-w-[280px] flex flex-col">
        <div className="px-3 py-2 eyebrow border-b border-[var(--border)]">Mode</div>
        <div className="px-2 py-2 grid grid-cols-3 gap-1">
          {[
            { id: "light", label: "Light", icon: <Sun size={13} /> },
            { id: "dark", label: "Dark", icon: <Moon size={13} /> },
            { id: "system", label: "System", icon: <Monitor size={13} /> },
          ].map((m) => (
            <button
              key={m.id}
              onClick={() => setMode(m.id as "light" | "dark" | "system")}
              className={[
                "flex flex-col items-center gap-1 p-2 rounded-md text-[11px]",
                mode === m.id
                  ? "bg-[var(--cedar-dim)] text-[var(--text)] border border-[var(--cedar-line)]"
                  : "text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--bg)] border border-transparent",
              ].join(" ")}
            >
              {m.icon}
              <span>{m.label}</span>
            </button>
          ))}
        </div>

        <div className="px-3 py-2 eyebrow border-t border-b border-[var(--border)]">Theme</div>
        <div className="max-h-[260px] overflow-y-auto px-1 py-1">
          {themes.map((t) => (
            <button
              key={t.value}
              onClick={() => setColorTheme(t.value as ColorTheme)}
              className={[
                "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left text-[12px]",
                colorTheme === t.value
                  ? "bg-[var(--cedar-dim)] text-[var(--text)]"
                  : "text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--bg)]",
              ].join(" ")}
            >
              <span
                className="w-3 h-3 rounded-full shrink-0 border border-[var(--border)]"
                style={{ background: t.swatch }}
              />
              <span className="flex-1">{t.label}</span>
              {colorTheme === t.value && <Check size={11} className="text-[var(--cedar)]" />}
            </button>
          ))}
        </div>

        <div className="px-3 py-2 eyebrow border-t border-b border-[var(--border)]">Density</div>
        <div className="px-2 py-2 grid grid-cols-3 gap-1">
          {densities.map((d) => (
            <button
              key={d.value}
              onClick={() => setDensity(d.value as Density)}
              className={[
                "p-2 rounded-md text-[11px]",
                density === d.value
                  ? "bg-[var(--cedar-dim)] text-[var(--text)] border border-[var(--cedar-line)]"
                  : "text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--bg)] border border-transparent",
              ].join(" ")}
            >
              {d.label}
            </button>
          ))}
        </div>
      </div>
    </Popover>
  );
}

// ── ⌘K palette ──────────────────────────────────────────────────
function CommandPalette({
  onClose,
  onNavigate,
}: {
  onClose: () => void;
  onNavigate: (path: string) => void;
}) {
  const [q, setQ] = useState("");
  const [sessions, setSessions] = useState<{ id: string; title: string }[]>([]);

  useEffect(() => {
    api.fetchSessions().then((s) => setSessions(s.map((x) => ({ id: x.id, title: x.title })))).catch(() => {});
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const ql = q.toLowerCase();
  const pageItems = Object.entries(PATH_LABELS)
    .filter(([_, label]) => label.toLowerCase().includes(ql))
    .map(([path, label]) => ({ kind: "page" as const, path, label }));
  const sessItems = sessions
    .filter((s) => !ql || s.title.toLowerCase().includes(ql))
    .slice(0, 8)
    .map((s) => ({ kind: "session" as const, path: `/?sid=${s.id}`, label: s.title || s.id.slice(0, 8) }));

  const items = [...pageItems, ...sessItems];

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center pt-[14vh] bg-black/40 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-[var(--bg)] border border-[var(--border)] rounded-2xl shadow-2xl w-full max-w-xl mx-4">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--border)]">
          <Search size={14} className="text-[var(--muted)]" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && items[0]) onNavigate(items[0].path);
            }}
            placeholder="Search pages, sessions…"
            className="flex-1 bg-transparent border-0 text-[14px] text-[var(--text)] focus:outline-none"
          />
          <kbd className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-[var(--surface)] border border-[var(--border)] text-[var(--muted)]">
            esc
          </kbd>
        </div>
        <div className="max-h-[50vh] overflow-y-auto p-2 flex flex-col gap-0.5">
          {items.length === 0 && (
            <div className="text-center text-[12px] text-[var(--muted)] py-8">No matches.</div>
          )}
          {items.map((it, i) => (
            <button
              key={`${it.kind}-${it.path}-${i}`}
              onClick={() => onNavigate(it.path)}
              className="flex items-center gap-3 px-3 py-2 rounded-md text-left text-[13px] text-[var(--text)] hover:bg-[var(--surface)]"
            >
              <span className="eyebrow text-[9px] w-12 shrink-0 text-[var(--muted)]">
                {it.kind === "page" ? "page" : "chat"}
              </span>
              <span className="flex-1 truncate">{it.label}</span>
              <span className="text-[10px] font-mono text-[var(--muted)]/70">{it.path}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
