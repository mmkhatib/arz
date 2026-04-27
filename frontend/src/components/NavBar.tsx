import { useEffect, useState } from "react";
import {
  MessageSquare,
  Brain,
  Clock,
  BarChart3,
  Settings as SettingsIcon,
  Keyboard,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

const STORAGE_KEY = "arz:nav-collapsed";

export type NavSection = "chat" | "memory" | "schedule" | "analytics" | "settings" | "shortcuts";

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
  { id: "chat", label: "Chat", icon: <MessageSquare size={16} /> },
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
  { id: "settings", label: "Settings", icon: <SettingsIcon size={16} /> },
  { id: "shortcuts", label: "Shortcuts", icon: <Keyboard size={16} /> },
];

export default function NavBar({ active, cronBadge, onSelect }: Props) {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(STORAGE_KEY) === "1");

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, collapsed ? "1" : "0");
  }, [collapsed]);

  return (
    <nav
      className={[
        "shrink-0 flex flex-col bg-[var(--bg)] border-r border-[var(--border)]",
        "transition-[width] duration-200",
        collapsed ? "w-12" : "w-44",
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

      <div className="px-3 py-2 text-[10px] text-[var(--muted)]/60 border-t border-[var(--border)]">
        {!collapsed && <span>arz v0.1.0</span>}
      </div>
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
