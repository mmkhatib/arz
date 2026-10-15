// Cedar TopBar — matches design_handoff_arz_cedar/redesign/shell.jsx.
// Left: page eyebrow label.
// Center: ⌘K search button (opens command palette indexing pages,
//   sessions, history, memory, crons, agents, channels, prompts).
// Right: light/dark segmented toggle (cedar-glow accent on active),
//   notifications button, avatar.

import { useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { Bell, Palette, Search, Check, CircleAlert, MessageSquareDot, Loader2 } from "lucide-react";
import { useNavigate, useLocation } from "react-router-dom";
import { api, type SessionSummary } from "@/api/client";
import { useTheme } from "@/hooks/useTheme";
import { describe as describeCron } from "@/components/ScheduleBuilder";

const PAGE_LABEL: Record<string, string> = {
  "/":             "Chat",
  "/chat":         "Chat",
  "/board":        "Operations",
  "/projects":     "Projects",
  "/autopilot":    "Autopilot",
  "/channels":     "Channels",
  "/agents":       "Agents",
  "/memory":       "Memory",
  "/schedule":     "Schedule",
  "/analytics":    "Analytics",
  "/capabilities": "Capabilities",
  "/autonomy":     "Autonomy",
  "/models":       "Models",
  "/settings":     "Settings",
  "/overview":     "Overview",
};

const ALL_PAGES = [
  { path: "/overview",     label: "Overview",     zone: "Today" },
  { path: "/",             label: "Chat",         zone: "Today" },
  { path: "/memory",       label: "Memory",       zone: "Mind" },
  { path: "/agents",       label: "Agents",       zone: "Mind" },
  { path: "/projects",     label: "Projects",     zone: "Work" },
  { path: "/channels",     label: "Channels",     zone: "Work" },
  { path: "/board",        label: "Operations",   zone: "Work" },
  { path: "/schedule",     label: "Schedule",     zone: "Work" },
  { path: "/capabilities", label: "Capabilities", zone: "Reach" },
  { path: "/models",       label: "Models",       zone: "Reach" },
  { path: "/autopilot",    label: "Autopilot",    zone: "System" },
  { path: "/autonomy",     label: "Autonomy",     zone: "System" },
  { path: "/analytics",    label: "Analytics",    zone: "System" },
  { path: "/settings",     label: "Settings",     zone: "System" },
];

function pageLabel(pathname: string): string {
  if (pathname.startsWith("/chat/")) return "Chat";
  return PAGE_LABEL[pathname] ?? "Arz";
}

export default function TopBar() {
  const navigate = useNavigate();
  const location = useLocation();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);
  const { resolved, setMode, colorTheme, setColorTheme, themes } = useTheme();

  const onSelectMode = (v: "light" | "dark") => setMode(v);
  const isLight = resolved === "light";
  const isDark = resolved === "dark";

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
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        height: 48,
        flexShrink: 0,
        padding: "0 14px",
        borderBottom: "1px solid var(--border)",
        background: "var(--surface)",
      }}
    >
      <span
        style={{
          fontSize: 11,
          fontFamily: "var(--fm)",
          color: "var(--muted)",
          textTransform: "uppercase",
          letterSpacing: ".14em",
        }}
      >
        {pageLabel(location.pathname)}
      </span>
      <div style={{ flex: 1 }} />

      {/* Center search */}
      <button
        onClick={() => setPaletteOpen(true)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          height: 30,
          padding: "0 10px",
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: 7,
          color: "var(--text3)",
          fontSize: 12,
          minWidth: 240,
          maxWidth: 360,
          width: "100%",
          cursor: "pointer",
          transition: "border-color .12s, color .12s",
          fontFamily: "var(--fn)",
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--cedar-line)";
          (e.currentTarget as HTMLButtonElement).style.color = "var(--text2)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--border)";
          (e.currentTarget as HTMLButtonElement).style.color = "var(--text3)";
        }}
      >
        <Search size={13} />
        <span style={{ flex: 1, textAlign: "left" }}>Search pages, chats, history, memory…</span>
        <span
          style={{
            fontFamily: "var(--fm)",
            fontSize: 10,
            padding: "1px 5px",
            border: "1px solid var(--border)",
            borderRadius: 3,
            color: "var(--muted)",
          }}
        >
          ⌘K
        </span>
      </button>
      <div style={{ flex: 1 }} />

      {/* Light/dark segmented toggle — cedar-glow accent on active */}
      <div
        style={{
          display: "inline-flex",
          background: "var(--s2)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          padding: 2,
          height: 30,
        }}
      >
        <ModeBtn active={isLight} onClick={() => onSelectMode("light")} kind="light" />
        <ModeBtn active={isDark} onClick={() => onSelectMode("dark")} kind="dark" />
      </div>

      {/* Theme picker */}
      <div style={{ position: "relative" }}>
        <button
          title="Color theme"
          onClick={() => setThemeOpen((o) => !o)}
          style={{
            width: 30,
            height: 30,
            borderRadius: 7,
            border: "1px solid var(--border)",
            background: "var(--s2)",
            color: "var(--cedar-glow)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
          }}
        >
          <Palette size={13} />
        </button>
        {themeOpen && (
          <>
            <div onClick={() => setThemeOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 80 }} />
            <div
              style={{
                position: "absolute",
                top: "calc(100% + 6px)",
                right: 0,
                background: "var(--surface)",
                border: "1px solid var(--border2)",
                borderRadius: 10,
                boxShadow: "var(--shadow-2)",
                padding: 6,
                zIndex: 90,
                minWidth: 180,
              }}
            >
              <div
                style={{
                  fontSize: 9.5,
                  fontFamily: "var(--fm)",
                  textTransform: "uppercase",
                  letterSpacing: ".14em",
                  color: "var(--muted)",
                  padding: "6px 10px 4px",
                }}
              >
                Theme
              </div>
              {themes.map((t) => {
                const active = t.value === colorTheme;
                return (
                  <button
                    key={t.value}
                    onClick={() => { setColorTheme(t.value); setThemeOpen(false); }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      width: "100%",
                      padding: "6px 10px",
                      border: "none",
                      borderRadius: 6,
                      background: active ? "var(--cedar-dim)" : "transparent",
                      cursor: "pointer",
                      fontFamily: "var(--fn)",
                      fontSize: 12,
                      color: active ? "var(--cedar-glow)" : "var(--text)",
                      textAlign: "left",
                    }}
                  >
                    <span
                      style={{
                        width: 14,
                        height: 14,
                        borderRadius: "50%",
                        background: t.swatch,
                        border: "1px solid var(--border2)",
                      }}
                    />
                    <span style={{ flex: 1 }}>{t.label}</span>
                    {active && <Check size={11} />}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Notifications */}
      <NotificationsButton onOpenSession={(id) => navigate(`/?sid=${encodeURIComponent(id)}`)} />

      {/* Avatar */}
      <UserMark size={26} />

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

function ModeBtn({
  active,
  onClick,
  kind,
}: {
  active: boolean;
  onClick: () => void;
  kind: "light" | "dark";
}) {
  return (
    <button
      onClick={onClick}
      title={kind}
      style={{
        width: 30,
        height: 24,
        borderRadius: 6,
        border: "none",
        background: active ? "var(--surface)" : "transparent",
        color: active ? "var(--cedar-glow)" : "var(--text3)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        boxShadow: active ? "inset 0 0 0 1px var(--cedar-line)" : "none",
        transition: "all .12s",
      }}
    >
      {kind === "light" ? (
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.4" />
          <g stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
            <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.3 3.3l1.4 1.4M11.3 11.3l1.4 1.4M3.3 12.7l1.4-1.4M11.3 4.7l1.4-1.4" />
          </g>
        </svg>
      ) : (
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
          <path
            d="M12.5 9.5A5 5 0 0 1 6.5 3.5 5 5 0 1 0 12.5 9.5z"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </button>
  );
}

function UserMark({ size = 26 }: { size?: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: "linear-gradient(135deg, oklch(.6 .08 50), oklch(.45 .06 30))",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#fff",
        fontSize: size * 0.42,
        fontWeight: 600,
        fontFamily: "var(--fd)",
        flexShrink: 0,
        border: "1px solid oklch(.55 .06 40)",
      }}
    >
      M
    </div>
  );
}

// ── Command palette ─────────────────────────────────────────
type Item = {
  kind: "page" | "session" | "history" | "memory" | "cron" | "agent" | "channel" | "prompt" | "project";
  id: string;
  label: string;
  sub: string;
  path: string;
};

function CommandPalette({
  onClose,
  onNavigate,
}: {
  onClose: () => void;
  onNavigate: (path: string) => void;
}) {
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const [sessions, setSessions] = useState<Item[]>([]);
  const [history, setHistory] = useState<Item[]>([]);
  const [memory, setMemory] = useState<Item[]>([]);
  const [crons, setCrons] = useState<Item[]>([]);
  const [agents, setAgents] = useState<Item[]>([]);
  const [channels, setChannels] = useState<Item[]>([]);
  const [prompts, setPrompts] = useState<Item[]>([]);
  const [projects, setProjects] = useState<Item[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Load every searchable corpus in parallel on open.
  useEffect(() => {
    api
      .fetchSessions()
      .then((arr) =>
        setSessions(
          arr.map((s) => ({
            kind: "session" as const,
            id: s.id,
            label: s.title || "(untitled)",
            sub: `Session · ${s.message_count} msgs`,
            path: `/?sid=${encodeURIComponent(s.id)}`,
          })),
        ),
      )
      .catch(() => {});
    api
      .fetchHistory()
      .then((arr) =>
        setHistory(
          arr.map((s) => ({
            kind: "history" as const,
            id: s.id,
            label: s.title || "(untitled)",
            sub: `History · ${s.message_count} msgs`,
            path: `/?sid=${encodeURIComponent(s.id)}`,
          })),
        ),
      )
      .catch(() => {});
    api
      .listLessons()
      .then((arr) =>
        setMemory((prev) => [
          ...prev.filter((p) => !p.id.startsWith("lesson:")),
          ...arr.map((l) => ({
            kind: "memory" as const,
            id: `lesson:${l.id}`,
            label: l.text.split("\n")[0]?.slice(0, 80) || `Lesson #${l.id}`,
            sub: `Memory · ${l.category}${l.pinned ? " · pinned" : ""}`,
            path: "/memory",
          })),
        ]),
      )
      .catch(() => {});
    api
      .listMemoryFiles()
      .then((m) => {
        const items: Item[] = [];
        for (const k of ["preferences", "projects"] as const) {
          const v = m[k];
          if (v) {
            v.split("\n").filter((l) => l.trim().startsWith("-")).slice(0, 80).forEach((l, i) => {
              items.push({
                kind: "memory" as const,
                id: `${k}:${i}`,
                label: l.replace(/^[-*]\s*/, "").slice(0, 80),
                sub: `Memory · ${k}.md`,
                path: "/memory",
              });
            });
          }
        }
        setMemory((prev) => [
          ...prev.filter((p) => !p.id.startsWith("preferences:") && !p.id.startsWith("projects:")),
          ...items,
        ]);
      })
      .catch(() => {});
    api
      .listCrons()
      .then((arr) =>
        setCrons(
          arr.map((c) => ({
            kind: "cron" as const,
            id: String(c.id),
            label: c.name,
            sub: `Schedule · ${describeCron(c.schedule)}`,
            path: "/schedule",
          })),
        ),
      )
      .catch(() => {});
    api
      .listAgents()
      .then((arr) =>
        setAgents(
          arr.map((a) => ({
            kind: "agent" as const,
            id: a.name,
            label: a.name,
            sub: `Agent · ${a.provider}${a.is_default ? " · default" : ""}`,
            path: "/agents",
          })),
        ),
      )
      .catch(() => {});
    api
      .listChannelsApp()
      .then((arr) =>
        setChannels(
          arr.map((c) => ({
            kind: "channel" as const,
            id: c.id,
            label: c.name,
            sub: `Channel · ${c.status}`,
            path: "/channels",
          })),
        ),
      )
      .catch(() => {});
    api
      .listProjects()
      .then((arr) =>
        setProjects(
          arr.map((p) => ({
            kind: "project" as const,
            id: p.id,
            label: p.name,
            sub: `Project · ${p.open_tasks} open · ${p.status}`,
            path: `/projects/${encodeURIComponent(p.id)}`,
          })),
        ),
      )
      .catch(() => {});
    api
      .listPrompts()
      .then((arr) =>
        setPrompts(
          arr.map((p) => ({
            kind: "prompt" as const,
            id: p.slug,
            label: p.title,
            sub: `Prompt · ${(p.tags || []).join(", ") || "no tags"}`,
            path: "/capabilities",
          })),
        ),
      )
      .catch(() => {});
    // Focus the input after first paint.
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const items = useMemo<Item[]>(() => {
    const ql = q.toLowerCase().trim();
    const pages: Item[] = ALL_PAGES.map((p) => ({
      kind: "page",
      id: p.path,
      label: p.label,
      sub: `Page · ${p.zone}`,
      path: p.path,
    }));
    const all = [
      ...pages,
      ...projects,
      ...sessions,
      ...history,
      ...memory,
      ...crons,
      ...agents,
      ...channels,
      ...prompts,
    ];
    if (!ql) return [...pages, ...sessions.slice(0, 8)].slice(0, 16);
    // Rank: label prefix > word-start > label substring > sub match. Cap
    // each corpus so a big one (memory, history) can't bury the rest.
    const score = (i: Item): number => {
      const l = i.label.toLowerCase();
      if (l.startsWith(ql)) return 0;
      if (new RegExp(`\\b${ql.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(l)) return 1;
      if (l.includes(ql)) return 2;
      if (i.sub.toLowerCase().includes(ql)) return 3;
      return -1;
    };
    const perKind: Record<string, number> = {};
    return all
      .map((i, order) => ({ i, s: score(i), order }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => a.s - b.s || a.order - b.order)
      .filter(({ i }) => (perKind[i.kind] = (perKind[i.kind] ?? 0) + 1) <= (KIND_CAP[i.kind] ?? 6))
      .map((x) => x.i)
      .slice(0, 24);
  }, [q, sessions, history, memory, crons, agents, channels, prompts, projects]);

  useEffect(() => setIdx(0), [q]);

  // Keep the keyboard selection in view while arrowing through a long list.
  const listRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${idx}"]`)?.scrollIntoView({ block: "nearest" });
  }, [idx]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setIdx((i) => Math.min(items.length - 1, i + 1));
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setIdx((i) => Math.max(0, i - 1));
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const it = items[idx];
        if (it) onNavigate(it.path);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [items, idx, onNavigate, onClose]);

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.5)",
        backdropFilter: "blur(3px)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: "18vh",
        zIndex: 100,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 560,
          maxWidth: "90vw",
          background: "var(--surface)",
          border: "1px solid var(--border2)",
          borderRadius: 14,
          boxShadow: "var(--shadow-2)",
          overflow: "hidden",
          fontFamily: "var(--fn)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "14px 16px",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <Search size={15} color="var(--text3)" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search pages, chats, history, memory, crons, agents, channels…"
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              outline: "none",
              fontSize: 14,
              color: "var(--text)",
              fontFamily: "var(--fn)",
            }}
          />
          <span style={{ fontFamily: "var(--fm)", fontSize: 10.5, color: "var(--muted)" }}>esc</span>
        </div>
        <div ref={listRef} style={{ maxHeight: 380, overflowY: "auto", padding: 6 }}>
          {items.length === 0 && (
            <div style={{ padding: 24, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
              No results for “{q}”
            </div>
          )}
          {items.map((it, i) => (
            <button
              key={`${it.kind}:${it.id}`}
              data-idx={i}
              onClick={() => onNavigate(it.path)}
              onMouseEnter={() => setIdx(i)}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "9px 12px",
                background: i === idx ? "var(--cedar-dim)" : "transparent",
                border: "none",
                borderRadius: 8,
                cursor: "pointer",
                textAlign: "left",
                color: "var(--text)",
                fontFamily: "var(--fn)",
                marginBottom: 1,
              }}
            >
              <span
                style={{
                  fontFamily: "var(--fm)",
                  fontSize: 9.5,
                  color: i === idx ? "var(--cedar-glow)" : "var(--muted)",
                  textTransform: "uppercase",
                  letterSpacing: ".12em",
                  width: 56,
                  flexShrink: 0,
                }}
              >
                {it.kind}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 13,
                    color: "var(--text)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  <Highlight text={it.label} q={q} />
                </div>
                <div style={{ fontSize: 10.5, color: "var(--muted)", fontFamily: "var(--fm)", marginTop: 1 }}>
                  {it.sub}
                </div>
              </div>
              {i === idx && (
                <span style={{ fontSize: 10.5, color: "var(--muted)", fontFamily: "var(--fm)" }}>↵</span>
              )}
            </button>
          ))}
        </div>
        <div
          style={{
            display: "flex",
            gap: 14,
            padding: "8px 14px",
            borderTop: "1px solid var(--border)",
            fontFamily: "var(--fm)",
            fontSize: 10,
            color: "var(--muted)",
          }}
        >
          <span>↑↓ navigate</span>
          <span>↵ open</span>
          <span>esc close</span>
          <span style={{ marginLeft: "auto" }}>{items.length} result{items.length === 1 ? "" : "s"}</span>
        </div>
      </div>
    </div>
  );
}

const KIND_CAP: Record<string, number> = { page: 8, session: 6, history: 5, memory: 4, project: 4 };

function Highlight({ text, q }: { text: string; q: string }) {
  const ql = q.trim().toLowerCase();
  const at = ql ? text.toLowerCase().indexOf(ql) : -1;
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark style={{ background: "var(--cedar-dim)", color: "var(--cedar-glow)", borderRadius: 2, padding: 0 }}>
        {text.slice(at, at + ql.length)}
      </mark>
      {text.slice(at + ql.length)}
    </>
  );
}

// ── Notifications ───────────────────────────────────────────
// Sessions that want you: waiting on an approval, an unread reply, or
// still running. Polled lightly so the bell's dot stays honest.

function NotificationsButton({ onOpenSession }: { onOpenSession: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const location = useLocation();
  const activeSid = new URLSearchParams(location.search).get("sid");

  useEffect(() => {
    let alive = true;
    const load = () => api.fetchSessions().then((s) => { if (alive) setSessions(s); }).catch(() => {});
    load();
    const t = setInterval(load, open ? 5_000 : 20_000);
    return () => { alive = false; clearInterval(t); };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const needs = (sessions ?? []).filter((s) => s.needs_input);
  const unread = (sessions ?? []).filter((s) => s.unread && !s.needs_input && s.id !== activeSid);
  const running = (sessions ?? []).filter((s) => s.streaming && !s.needs_input);
  const alert = needs.length + unread.length;

  const groups: { key: string; title: string; icon: React.ReactNode; tone: string; rows: SessionSummary[] }[] = [
    { key: "needs", title: "Needs you", icon: <CircleAlert size={12} />, tone: "var(--dawn)", rows: needs },
    { key: "unread", title: "New replies", icon: <MessageSquareDot size={12} />, tone: "var(--cedar-glow)", rows: unread },
    { key: "running", title: "Running", icon: <Loader2 size={12} className="animate-spin" />, tone: "var(--text3)", rows: running },
  ];

  return (
    <div style={{ position: "relative" }}>
      <button
        title={alert ? `Notifications (${alert})` : "Notifications"}
        aria-label="Notifications"
        onClick={() => setOpen((o) => !o)}
        style={{
          position: "relative",
          width: 30,
          height: 30,
          borderRadius: 7,
          border: `1px solid ${open ? "var(--cedar-line)" : "var(--border)"}`,
          background: "var(--s2)",
          color: open ? "var(--cedar-glow)" : "var(--text2)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
        }}
      >
        <Bell size={13} />
        {alert > 0 && (
          <span
            style={{
              position: "absolute",
              top: -4,
              right: -4,
              minWidth: 15,
              height: 15,
              padding: "0 4px",
              borderRadius: 99,
              background: needs.length ? "var(--dawn)" : "var(--cedar-glow)",
              color: "var(--surface)",
              fontSize: 9,
              fontWeight: 600,
              fontFamily: "var(--fm)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              border: "1.5px solid var(--surface)",
            }}
          >
            {alert > 9 ? "9+" : alert}
          </span>
        )}
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 80 }} />
          <div
            style={{
              position: "absolute",
              top: "calc(100% + 6px)",
              right: 0,
              width: 320,
              maxHeight: 440,
              overflowY: "auto",
              background: "var(--surface)",
              border: "1px solid var(--border2)",
              borderRadius: 10,
              boxShadow: "var(--shadow-2)",
              zIndex: 90,
              fontFamily: "var(--fn)",
            }}
          >
            <div
              style={{
                padding: "10px 14px",
                borderBottom: "1px solid var(--border)",
                fontSize: 10,
                fontFamily: "var(--fm)",
                color: "var(--muted)",
                textTransform: "uppercase",
                letterSpacing: ".14em",
              }}
            >
              Notifications
            </div>
            {sessions === null ? (
              <div style={{ padding: 20, fontSize: 12, color: "var(--muted)", textAlign: "center" }}>Loading…</div>
            ) : groups.every((g) => g.rows.length === 0) ? (
              <div style={{ padding: "28px 20px", textAlign: "center" }}>
                <div style={{ fontFamily: "var(--fd)", fontSize: 17, color: "var(--text)" }}>All caught up.</div>
                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
                  Approvals and new replies show up here.
                </div>
              </div>
            ) : (
              groups
                .filter((g) => g.rows.length > 0)
                .map((g) => (
                  <div key={g.key} style={{ padding: "6px 6px 8px" }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        padding: "4px 8px",
                        fontSize: 10,
                        fontFamily: "var(--fm)",
                        textTransform: "uppercase",
                        letterSpacing: ".1em",
                        color: g.tone,
                      }}
                    >
                      {g.icon} {g.title} · {g.rows.length}
                    </div>
                    {g.rows.slice(0, 8).map((s) => (
                      <button
                        key={s.id}
                        onClick={() => { setOpen(false); onOpenSession(s.id); }}
                        style={{
                          width: "100%",
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          padding: "7px 8px",
                          border: "none",
                          borderRadius: 6,
                          background: "transparent",
                          cursor: "pointer",
                          textAlign: "left",
                          color: "var(--text)",
                          fontSize: 12.5,
                          fontFamily: "var(--fn)",
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = "var(--s2)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                      >
                        <span style={{ width: 6, height: 6, borderRadius: 99, background: g.tone, flexShrink: 0 }} />
                        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {s.title || "(untitled)"}
                        </span>
                        <span style={{ fontSize: 10, fontFamily: "var(--fm)", color: "var(--muted)" }}>
                          {s.message_count} msgs
                        </span>
                      </button>
                    ))}
                  </div>
                ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
