import { useEffect, useState } from "react";
import ShortcutsOverlay from "./ShortcutsOverlay";
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
} from "lucide-react";

const STORAGE_KEY = "arz:nav-collapsed";

export type NavSection = "overview" | "chat" | "board" | "agents" | "memory" | "schedule" | "analytics" | "capabilities" | "autonomy" | "models" | "settings";

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

const ENTRIES: NavEntry[] = [
  { id: "overview", label: "Overview", icon: <LayoutDashboard size={16} /> },
  { id: "chat", label: "Chat", icon: <MessageSquare size={16} /> },
  { id: "board", label: "Board", icon: <Columns3 size={16} /> },
  { id: "agents", label: "Agents", icon: <Bot size={16} /> },
  { id: "memory", label: "Memory", icon: <Brain size={16} /> },
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
  { id: "analytics", label: "Analytics", icon: <BarChart3 size={16} /> },
  { id: "capabilities", label: "Capabilities", icon: <Puzzle size={16} /> },
  { id: "autonomy", label: "Autonomy", icon: <Activity size={16} /> },
  { id: "models", label: "Models", icon: <Cpu size={16} /> },
  { id: "settings", label: "Settings", icon: <SettingsIcon size={16} /> },
];

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
      <div className="flex items-center justify-between px-2 py-3 border-b border-[var(--border)]">
        {!collapsed && (
          <span className="text-[var(--accent)] font-semibold tracking-wide text-[13px] pl-1">
            🌲 Arz
          </span>
        )}
        <button
          onClick={() => setCollapsed((c) => !c)}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="w-7 h-7 flex items-center justify-center rounded text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface)] transition-colors mx-auto"
        >
          {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>
      </div>

      <div className="flex flex-col gap-0.5 p-1.5 flex-1">
        {ENTRIES.map((entry) => {
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

      <MemoryStatsRow collapsed={collapsed} />

      <div className="px-2 py-2 border-t border-[var(--border)] flex items-center justify-between gap-2">
        <button
          onClick={() => setShortcutsOpen(true)}
          title="Keyboard shortcuts (?)"
          className="w-7 h-7 flex items-center justify-center rounded text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface)] transition-colors"
        >
          <Keyboard size={14} />
        </button>
        {!collapsed && <span className="text-[10px] text-[var(--muted)]/60 ml-auto">arz v0.1.0</span>}
      </div>
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

function MemoryStatsRow({ collapsed }: { collapsed: boolean }) {
  const [stats, setStats] = useState<{ markdown: number; lessons: number; vectors: number } | null>(null);
  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      api.memoryStats()
        .then((s) => { if (!cancelled) setStats(s); })
        .catch(() => {});
    };
    tick();
    const id = window.setInterval(() => { if (!document.hidden) tick(); }, 30_000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, []);
  if (!stats) return null;
  const total = stats.markdown + stats.lessons + stats.vectors;
  const tip = `Memory · ${stats.markdown} markdown · ${stats.lessons} lessons · ${stats.vectors} vectors`;
  if (collapsed) {
    return (
      <div className="px-2 py-1 border-t border-[var(--border)]/50 flex justify-center" title={tip}>
        <span className="text-[10px] font-mono text-[var(--muted)]">{total}</span>
      </div>
    );
  }
  return (
    <div className="px-2.5 py-1.5 border-t border-[var(--border)]/50 text-[10px] font-mono text-[var(--muted)]" title={tip}>
      <div className="flex items-center justify-between">
        <span className="uppercase tracking-wider">Memory</span>
        <span>{total} items</span>
      </div>
      <div className="flex items-center gap-1.5 mt-0.5 text-[var(--muted)]/70">
        <span>md {stats.markdown}</span>
        <span>·</span>
        <span>lessons {stats.lessons}</span>
        <span>·</span>
        <span>vec {stats.vectors}</span>
      </div>
    </div>
  );
}
