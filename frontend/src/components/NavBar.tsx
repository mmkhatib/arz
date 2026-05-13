import { useEffect, useState } from "react";
import ShortcutsOverlay from "./ShortcutsOverlay";
import CedarMark from "./CedarMark";
import { api } from "@/api/client";
import {
  MessageSquare,
  Brain,
  Clock,
  BarChart3,
  Settings as SettingsIcon,
  Keyboard,
  ChevronLeft,
  ChevronRight,
  LayoutDashboard,
  Bot,
  Puzzle,
  Cpu,
  Activity,
  Columns3,
  Wand2,
  Layers,
  Briefcase,
} from "lucide-react";

const STORAGE_KEY = "arz:nav-collapsed";

export type NavSection = "overview" | "chat" | "board" | "projects" | "autopilot" | "channels" | "agents" | "memory" | "schedule" | "analytics" | "capabilities" | "autonomy" | "models" | "settings";

interface Props {
  active: NavSection;
  cronBadge?: number;
  onSelect: (section: NavSection) => void;
}

interface NavEntry {
  id: NavSection;
  label: string;
  icon: React.ReactNode;
  badge?: (badge?: number) => React.ReactNode | null;
}

// Information architecture — 5 zones, flat within each. Mirrors the
// Cedar redesign spec.
const NAV_ZONES: { zone: string; items: NavEntry[] }[] = [
  {
    zone: "Today",
    items: [
      { id: "overview", label: "Overview", icon: <LayoutDashboard size={16} /> },
      { id: "chat",     label: "Chat",     icon: <MessageSquare size={16} /> },
    ],
  },
  {
    zone: "Mind",
    items: [
      { id: "memory", label: "Memory", icon: <Brain size={16} /> },
      { id: "agents", label: "Agents", icon: <Bot size={16} /> },
    ],
  },
  {
    zone: "Work",
    items: [
      { id: "projects", label: "Projects",  icon: <Briefcase size={16} /> },
      { id: "channels", label: "Channels",  icon: <Layers size={16} /> },
      { id: "board",    label: "Operations", icon: <Columns3 size={16} /> },
      {
        id: "schedule",
        label: "Schedule",
        icon: <Clock size={16} />,
        badge: (b) =>
          b && b > 0 ? (
            <span className="absolute top-0.5 right-0.5 min-w-[14px] h-[14px] rounded-full bg-[var(--cedar)] text-white text-[9px] font-mono flex items-center justify-center px-1 leading-none">
              {b > 9 ? "9+" : b}
            </span>
          ) : null,
      },
    ],
  },
  {
    zone: "Reach",
    items: [
      { id: "capabilities", label: "Capabilities", icon: <Puzzle size={16} /> },
      { id: "models",       label: "Models",       icon: <Cpu size={16} /> },
    ],
  },
  {
    zone: "System",
    items: [
      { id: "autopilot", label: "Autopilot", icon: <Wand2 size={16} /> },
      { id: "autonomy",  label: "Autonomy",  icon: <Activity size={16} /> },
      { id: "analytics", label: "Analytics", icon: <BarChart3 size={16} /> },
      { id: "settings",  label: "Settings",  icon: <SettingsIcon size={16} /> },
    ],
  },
];

// (kept to avoid an empty file region; flat list reachable via NAV_ZONES.)

export default function NavBar({ active, cronBadge, onSelect }: Props) {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(STORAGE_KEY) === "1");
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, collapsed ? "1" : "0");
  }, [collapsed]);

  // Global ? hotkey opens shortcuts modal
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "?" && !e.ctrlKey && !e.metaKey) {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA") return;
        e.preventDefault();
        setShortcutsOpen(true);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <nav
      className={[
        "shrink-0 flex flex-col bg-[var(--bg)] border-r border-[var(--border)]",
        "transition-[width] duration-200",
        // On phones we collapse to icon-only regardless of preference; the
        // chat hamburger handles drilling into the session list.
        collapsed ? "w-12" : "w-44",
        "max-md:!w-12",
      ].join(" ")}
    >
      {/* Brand + collapse toggle */}
      <div
        className="flex items-center justify-between px-3 border-b border-[var(--border)] overflow-hidden"
        style={{ height: "var(--shell-row-h)" }}
      >
        {!collapsed && (
          <div className="flex items-center gap-2">
            <CedarMark size={22} />
            <span
              className="font-display tracking-wide text-[18px] text-[var(--text)]"
              style={{ fontStyle: "italic", letterSpacing: ".01em" }}
            >
              arz
            </span>
          </div>
        )}
        <button
          onClick={() => setCollapsed((c) => !c)}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="w-7 h-7 flex items-center justify-center rounded text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface)] transition-colors"
        >
          {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>
      </div>

      <div className="flex flex-col p-1.5 flex-1 overflow-y-auto">
        {NAV_ZONES.map((zone, zi) => (
          <div key={zone.zone} className={zi > 0 ? "mt-3" : ""}>
            {!collapsed && (
              <div className="px-2.5 pt-1 pb-1 eyebrow text-[var(--muted)]">{zone.zone}</div>
            )}
            <div className="flex flex-col gap-0.5">
              {zone.items.map((entry) => {
                const isActive = entry.id === active;
                const badge = entry.id === "schedule" ? entry.badge?.(cronBadge) : null;
                return (
                  <NavItem
                    key={entry.id}
                    label={entry.label}
                    icon={entry.icon}
                    active={isActive}
                    collapsed={collapsed}
                    badge={badge}
                    onClick={() => onSelect(entry.id)}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <MemoryStatsRow
        collapsed={collapsed}
        onShortcuts={() => setShortcutsOpen(true)}
      />
      {shortcutsOpen && <ShortcutsOverlay onClose={() => setShortcutsOpen(false)} />}
    </nav>
  );
}

function NavItem({
  label,
  icon,
  active,
  collapsed,
  badge,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  collapsed: boolean;
  badge?: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={[
        "group/nav relative flex items-center gap-2.5 rounded-md text-[13px] font-medium",
        "py-2 px-2.5 transition-colors duration-150",
        active
          ? "bg-[var(--cedar)]/15 text-[var(--text)]"
          : "text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface)]",
      ].join(" ")}
      title={collapsed ? label : undefined}
    >
      <span
        className={[
          "relative w-4 h-4 flex items-center justify-center shrink-0",
          active ? "text-[var(--cedar)]" : "",
        ].join(" ")}
      >
        {icon}
        {badge}
      </span>
      {!collapsed && <span className="truncate">{label}</span>}
      {/* Tooltip when collapsed */}
      {collapsed && (
        <span className="pointer-events-none absolute left-full ml-2 px-2 py-1 rounded-md bg-[var(--surface)] border border-[var(--border)] text-[12px] text-[var(--text)] opacity-0 group-hover/nav:opacity-100 transition-opacity whitespace-nowrap z-50 shadow-md">
          {label}
        </span>
      )}
    </button>
  );
}

function MemoryStatsRow({
  collapsed,
  onShortcuts,
}: {
  collapsed: boolean;
  onShortcuts: () => void;
}) {
  const [stats, setStats] = useState<{ markdown: number; lessons: number; vectors: number } | null>(null);
  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      api.memoryStats()
        .then((s) => { if (!cancelled) setStats(s); })
        .catch(() => {});
    };
    tick();
    // 5 min cadence — memory items barely change between polls and the
    // gateway access log gets noisy fast. Tab-visibility gate keeps idle
    // tabs from firing at all.
    const id = window.setInterval(() => { if (!document.hidden) tick(); }, 300_000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, []);
  const total = stats ? stats.markdown + stats.lessons + stats.vectors : 0;
  const tip = stats
    ? `Memory · ${stats.markdown} markdown · ${stats.lessons} lessons · ${stats.vectors} vectors`
    : "";
  if (collapsed) {
    return (
      <div
        className="px-2 border-t border-[var(--border)] flex items-center justify-between gap-1 overflow-hidden"
        style={{ height: "var(--shell-row-h)" }}
        title={tip}
      >
        <button
          onClick={onShortcuts}
          title="Keyboard shortcuts (?)"
          className="w-6 h-6 flex items-center justify-center rounded text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface)] transition-colors"
        >
          <Keyboard size={12} />
        </button>
        {stats && <span className="text-[10px] font-mono text-[var(--muted)]">{total}</span>}
      </div>
    );
  }
  return (
    <div
      className="px-2 border-t border-[var(--border)] text-[10px] font-mono text-[var(--muted)] flex items-center gap-2 overflow-hidden whitespace-nowrap"
      style={{ height: "var(--shell-row-h)" }}
      title={tip}
    >
      <button
        onClick={onShortcuts}
        title="Keyboard shortcuts (?)"
        className="w-6 h-6 flex items-center justify-center rounded text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface)] transition-colors shrink-0"
      >
        <Keyboard size={12} />
      </button>
      <span className="flex-1 min-w-0 truncate">
        {stats ? `${total} mem` : "mem…"}
      </span>
      <span className="text-[var(--muted)]/60 shrink-0">v0.7.53</span>
    </div>
  );
}
