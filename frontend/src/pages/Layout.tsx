import { useEffect, useRef, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { api } from "@/api/client";
import NavBar, { type NavSection } from "@/components/NavBar";
import { useTheme, THEMES } from "@/hooks/useTheme";

const PATH_TO_SECTION: Record<string, NavSection> = {
  "/": "chat",
  "/overview": "overview",
  "/agents": "agents",
  "/memory": "memory",
  "/schedule": "schedule",
  "/analytics": "analytics",
  "/capabilities": "capabilities",
  "/settings": "settings",
  "/shortcuts": "shortcuts",
};

const SECTION_TO_PATH: Record<NavSection, string> = {
  overview: "/overview",
  chat: "/",
  agents: "/agents",
  memory: "/memory",
  schedule: "/schedule",
  analytics: "/analytics",
  capabilities: "/capabilities",
  settings: "/settings",
  shortcuts: "/shortcuts",
};

function ThemeQuickPicker() {
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

  return (
    <div ref={ref} className="absolute top-3 right-3 z-40">
      <button
        onClick={() => setOpen((v) => !v)}
        title="Quick theme switcher"
        className={[
          "w-7 h-7 rounded-lg flex items-center justify-center text-[14px] transition-colors",
          open ? "bg-[var(--cedar)]/20 text-[var(--cedar)]" : "text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface)]",
        ].join(" ")}
      >
        🎨
      </button>
      {open && (
        <div className="absolute top-full right-0 mt-1 bg-[var(--surface)] border border-[var(--border)] rounded-xl shadow-xl py-1.5 min-w-[160px]">
          {/* Mode toggle */}
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
          {/* Theme list */}
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
              {colorTheme === t.value && <span className="text-[var(--cedar)] text-[10px]">●</span>}
              {colorTheme !== t.value && <span className="w-[14px]" />}
              {t.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Layout() {
  const navigate = useNavigate();
  const location = useLocation();
  const active = (PATH_TO_SECTION[location.pathname] ?? "chat") as NavSection;

  // Cron badge: same poll cadence and visibility logic as ChatPage had,
  // hoisted up so the badge is visible on every page (not just /).
  const [cronBadge, setCronBadge] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const computeBadge = async () => {
      if (document.hidden) return;
      try {
        const items = await api.listCrons();
        if (cancelled) return;
        let unseen = 0;
        for (const c of items) {
          if (c.last_run_at == null) continue;
          const seenRaw = localStorage.getItem(`arz:cron-seen:${c.id}`);
          const seen = seenRaw ? Number(seenRaw) : 0;
          if (c.last_run_at > seen) unseen++;
        }
        setCronBadge(unseen);
      } catch {}
    };
    computeBadge();
    const interval = setInterval(computeBadge, 60_000);
    const onVisible = () => { if (!document.hidden) computeBadge(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const markCronSeen = async () => {
    try {
      const items = await api.listCrons();
      for (const c of items) {
        if (c.last_run_at != null) {
          localStorage.setItem(`arz:cron-seen:${c.id}`, String(c.last_run_at));
        }
      }
      setCronBadge(0);
    } catch {}
  };

  return (
    <div className="flex w-full h-full overflow-hidden">
      <NavBar
        active={active}
        cronBadge={cronBadge}
        onSelect={(s) => {
          if (s === "schedule") void markCronSeen();
          navigate(SECTION_TO_PATH[s]);
        }}
      />
      <div className="relative flex flex-1 min-w-0 h-full overflow-hidden">
        <ThemeQuickPicker />
        <Outlet />
      </div>
    </div>
  );
}
