import { useEffect, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { api } from "@/api/client";
import NavBar, { type NavSection } from "@/components/NavBar";

const PATH_TO_SECTION: Record<string, NavSection> = {
  "/": "chat",
  "/overview": "overview",
  "/agents": "agents",
  "/memory": "memory",
  "/schedule": "schedule",
  "/analytics": "analytics",
  "/capabilities": "capabilities",
  "/autonomy": "autonomy",
  "/models": "models",
  "/settings": "settings",
};

const SECTION_TO_PATH: Record<NavSection, string> = {
  overview: "/overview",
  chat: "/",
  agents: "/agents",
  memory: "/memory",
  schedule: "/schedule",
  analytics: "/analytics",
  capabilities: "/capabilities",
  autonomy: "/autonomy",
  models: "/models",
  settings: "/settings",
};

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
        <Outlet />
      </div>
    </div>
  );
}
