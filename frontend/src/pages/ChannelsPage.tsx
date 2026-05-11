// Channels — multi-agent collaboration rooms.
//
// Layout (3 columns):
//   * Left rail (240px) — channel list, MeshClaw-style, with archived
//     channels rolled up into a "History" drawer at the bottom.
//   * Center — channel feed: sticky header, scrollable feed below it.
//     Each message renders as a Cedar bubble that can collapse/expand;
//     a single toggle in the feed header expands/collapses all at once.
//   * Right rail (290px, optional) — when the channel has a linked
//     project, shows brief + open task list with status dots, click any
//     task to open it on the project page.
//
// Markdown comes through CedarMarkdown so code blocks have syntax
// highlight, tables render, and `- [ ]` checklists work.

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Plus,
  Send,
  Wand2,
  X,
  Power,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  ChevronsDownUp,
  Users,
  Briefcase,
  Archive,
  Layers,
  UserPlus,
  FolderOpen,
  Pencil,
} from "lucide-react";
import { api, type ProjectSummary, type ProjectTask } from "@/api/client";
import { useDialog } from "@/components/Dialog";
import { TaskDetailModal } from "@/components/TaskDetailModal";
import {
  CedarPage,
  CedarPageHeader,
  CedarModal,
  CedarInput,
  CedarTextArea,
  CedarLabel,
  Btn,
  Tag,
  TopoLines,
} from "@/components/CedarUI";
import { CedarMarkdown } from "@/components/CedarMarkdown";

type Channel = Awaited<ReturnType<typeof api.getChannelApp>>;
type Preset = Awaited<ReturnType<typeof api.channelPresetsApp>>[number];

function fmtTime(ts: number): string {
  if (!ts) return "";
  const d = new Date(ts * 1000);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function fmtAge(ts: number): string {
  if (!ts) return "—";
  const dt = Date.now() / 1000 - ts;
  if (dt < 60) return `${Math.floor(dt)}s`;
  if (dt < 3600) return `${Math.floor(dt / 60)}m`;
  if (dt < 86400) return `${Math.floor(dt / 3600)}h`;
  return `${Math.floor(dt / 86400)}d`;
}

function summarizeText(s: string, max = 120): string {
  // First non-empty line, plain text, truncated.
  const stripped = s
    .replace(/```[\s\S]*?```/g, " [code] ")
    .replace(/[#*_`>]/g, "")
    .trim();
  const firstLine = stripped.split(/\r?\n/).find((l) => l.trim()) || stripped;
  return firstLine.length > max ? firstLine.slice(0, max - 1) + "…" : firstLine;
}

export default function ChannelsPage() {
  const navigate = useNavigate();
  const dialog = useDialog();
  const [searchParams, setSearchParams] = useSearchParams();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [active, setActive] = useState<Channel | null>(null);
  const [composer, setComposer] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [selectedTask, setSelectedTask] = useState<ProjectTask | null>(null);
  const [showFolderEdit, setShowFolderEdit] = useState(false);
  const feedRef = useRef<HTMLDivElement>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const prevArchivedCount = useRef(0);

  // Per-message expand state. Default: collapsed unless the message
  // is from the current user. expandAll toggles all bubbles open.
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [expandAll, setExpandAll] = useState(false);

  // Apply ?ch=<slug> on first load and clear it from the URL.
  useEffect(() => {
    const ch = searchParams.get("ch");
    if (ch) {
      setActiveId(ch);
      const next = new URLSearchParams(searchParams);
      next.delete("ch");
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Project list — used to render the right-rail when a channel is wired
  // to one, and to surface a "Promote to project" CTA when not.
  useEffect(() => {
    api.listProjects().then(setProjects).catch(() => {});
    const t = setInterval(() => api.listProjects().then(setProjects).catch(() => {}), 30_000);
    return () => clearInterval(t);
  }, []);

  const refreshList = async () => {
    try {
      const data = await api.listChannelsApp();
      setChannels(data);
      if (!activeId && data.length > 0) {
        // Prefer an active channel; fall back to the first one.
        const firstActive = data.find((c) => c.status === "active");
        setActiveId((firstActive ?? data[0]).id);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  // Poll the active channel for live updates.
  useEffect(() => {
    if (!activeId) {
      setActive(null);
      return;
    }
    let cancelled = false;
    const tick = async () => {
      if (document.hidden) return;
      try {
        const ch = await api.getChannelApp(activeId);
        if (!cancelled) setActive(ch);
      } catch {
        void refreshList();
      }
    };
    tick();
    const id = window.setInterval(tick, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  useEffect(() => {
    refreshList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-scroll feed to bottom on new messages.
  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight });
  }, [active?.messages.length]);

  const linkedProject = projects.find((p) => p.channel_id === activeId);

  const send = async () => {
    const t = composer.trim();
    if (!t || !activeId) return;
    setComposer("");
    try {
      await api.postToChannelApp(activeId, t);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setComposer(t);
    }
  };

  const close = async () => {
    if (!activeId) return;
    const ok = await dialog.confirm({
      title: "Close this channel?",
      body: "It moves to History. Re-posting reactivates it.",
      okLabel: "Close channel",
      tone: "warn",
      eyebrow: "close channel",
    });
    if (!ok) return;
    await api.dismissChannelApp(activeId).catch(() => {});
    await refreshList();
  };

  const wake = async () => {
    if (!activeId) return;
    await api.wakeChannelApp(activeId).catch(() => {});
    await refreshList();
  };

  const activeChannels = channels.filter((c) => c.status !== "dismissed");
  const archivedChannels = channels.filter((c) => c.status === "dismissed");

  // Auto-open the History drawer the first time the archive count grows
  // — keeps a freshly-closed channel discoverable without the user
  // hunting for the toggle.
  useEffect(() => {
    if (archivedChannels.length > prevArchivedCount.current) {
      setHistoryOpen(true);
    }
    prevArchivedCount.current = archivedChannels.length;
  }, [archivedChannels.length]);

  const allMsgIds = useMemo(() => active?.messages.map((m) => m.id) ?? [], [active]);
  const toggleExpand = (id: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleAll = () => {
    if (expandAll) {
      setExpandAll(false);
      setExpandedIds(new Set());
    } else {
      setExpandAll(true);
      setExpandedIds(new Set(allMsgIds));
    }
  };

  return (
    <CedarPage>
      <div style={{ position: "relative", overflow: "hidden", flexShrink: 0 }}>
        <TopoLines height={120} opacity={0.5} />
        <CedarPageHeader
          eyebrow="agent collaboration"
          title={
            <>
              The <em style={{ fontStyle: "italic", color: "var(--cedar-glow)" }}>channels</em>.
            </>
          }
          sub="Multi-agent workspaces. Drop a question, the orchestrator delegates."
          right={
            <Btn kind="solid" icon={<Plus size={13} />} onClick={() => setShowCreate(true)}>
              New channel
            </Btn>
          }
        />
      </div>

      {showCreate && (
        <CreateChannelDialog
          onClose={() => setShowCreate(false)}
          onCreated={(slug) => {
            setShowCreate(false);
            setActiveId(slug);
            refreshList();
          }}
        />
      )}
      {showInvite && active && (
        <InviteMemberDialog
          channelId={active.id}
          existingMembers={active.members.map((m) => m.agent)}
          onClose={() => setShowInvite(false)}
          onInvited={async () => {
            setShowInvite(false);
            try {
              const ch = await api.getChannelApp(active.id);
              setActive(ch);
            } catch {}
          }}
        />
      )}
      {selectedTask && linkedProject && (
        <TaskDetailModal
          task={selectedTask}
          onClose={() => setSelectedTask(null)}
          onOpenFile={async (p) => {
            // Try to reveal the file in the OS; fall back to clipboard.
            try {
              await api.revealPath(p);
            } catch {
              navigator.clipboard?.writeText(p).catch(() => {});
              await dialog.notify({
                title: "Path copied",
                body: `Couldn't reveal — path is on your clipboard:\n${p}`,
                tone: "warn",
              });
            }
          }}
          onGotoProject={() => {
            setSelectedTask(null);
            navigate(`/projects/${encodeURIComponent(linkedProject.id)}`);
          }}
        />
      )}
      {showFolderEdit && linkedProject && (
        <ChangeFolderModal
          project={linkedProject}
          onClose={() => setShowFolderEdit(false)}
          onSaved={async () => {
            setShowFolderEdit(false);
            try {
              const updated = await api.listProjects();
              setProjects(updated);
            } catch {}
          }}
        />
      )}

      {/* 3-column layout — fills the rest of the viewport, doesn't scroll
          the page itself. Each column is its own scroll container. */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: linkedProject
            ? "240px minmax(0, 1fr) 290px"
            : "240px minmax(0, 1fr)",
          flex: 1,
          minHeight: 0,
          overflow: "hidden",
        }}
      >
        {/* ── Left rail ─────────────────────────────────────────── */}
        <ChannelNav
          channels={activeChannels}
          archivedChannels={archivedChannels}
          activeId={activeId}
          onPick={setActiveId}
          onCreate={() => setShowCreate(true)}
          historyOpen={historyOpen}
          onToggleHistory={() => setHistoryOpen((v) => !v)}
        />

        {/* ── Center: feed ──────────────────────────────────────── */}
        <div style={{ display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 }}>
          {!active ? (
            <div
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--muted)",
                fontSize: 13,
              }}
            >
              {channels.length === 0 ? "Create a channel to get started." : "Pick a channel."}
            </div>
          ) : (
            <>
              {/* Sticky channel header — never scrolls */}
              <div
                style={{
                  flexShrink: 0,
                  borderBottom: "1px solid var(--border)",
                  padding: "12px 18px",
                  background: "var(--surface)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 16, fontWeight: 600, color: "var(--text)" }}>{active.name}</span>
                  <Tag
                    color={
                      active.status === "active"
                        ? "cedar"
                        : active.status === "idle"
                        ? "dawn"
                        : "muted"
                    }
                  >
                    {active.status === "dismissed" ? "archived" : active.status}
                  </Tag>
                  {active.preset && active.preset !== "custom" && (
                    <Tag color="stone">{active.preset.replace("_", " ")}</Tag>
                  )}
                  <div style={{ flex: 1 }} />
                  <Btn
                    size="sm"
                    kind="ghost"
                    icon={expandAll ? <ChevronsDownUp size={11} /> : <ChevronsUpDown size={11} />}
                    onClick={toggleAll}
                    title={expandAll ? "Collapse all" : "Expand all"}
                  >
                    {expandAll ? "Collapse all" : "Expand all"}
                  </Btn>
                  {linkedProject && (
                    <>
                      {linkedProject.repo_path && (
                        <Btn
                          size="sm"
                          kind="outline"
                          icon={<FolderOpen size={11} />}
                          onClick={async () => {
                            const path = linkedProject.repo_path;
                            navigator.clipboard?.writeText(path).catch(() => {});
                            try {
                              await api.revealPath(path);
                            } catch (e) {
                              await dialog.notify({
                                title: "Couldn't open folder",
                                body: `${e}\n\nPath copied to clipboard: ${path}`,
                                tone: "warn",
                              });
                            }
                          }}
                          title={`Open ${linkedProject.repo_path} in OS file manager (also copied to clipboard)`}
                        >
                          Folder
                        </Btn>
                      )}
                      <Btn
                        size="sm"
                        kind="ghost"
                        icon={<Pencil size={11} />}
                        onClick={() => setShowFolderEdit(true)}
                        title={
                          linkedProject.repo_path
                            ? `Change work folder (current: ${linkedProject.repo_path})`
                            : "Set work folder for this project"
                        }
                      >
                        {linkedProject.repo_path ? "Change folder" : "Set folder"}
                      </Btn>
                    </>
                  )}
                  <Btn
                    size="sm"
                    kind="outline"
                    icon={<UserPlus size={11} />}
                    onClick={() => setShowInvite(true)}
                  >
                    Invite
                  </Btn>
                  {active.status === "dismissed" ? (
                    <Btn size="sm" kind="soft" icon={<Power size={11} />} onClick={wake}>
                      Reactivate
                    </Btn>
                  ) : (
                    <Btn size="sm" kind="ghost" icon={<Archive size={11} />} onClick={close}>
                      Close
                    </Btn>
                  )}
                </div>
                {active.topic && (
                  <div style={{ marginTop: 4, fontSize: 12, color: "var(--muted)" }}>{active.topic}</div>
                )}
                {/* Member chips */}
                <div
                  style={{
                    marginTop: 8,
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    flexWrap: "wrap",
                  }}
                >
                  <span
                    style={{
                      fontSize: 10,
                      fontFamily: "var(--fm)",
                      color: "var(--muted)",
                      textTransform: "uppercase",
                      letterSpacing: ".1em",
                      marginRight: 4,
                    }}
                  >
                    Members
                  </span>
                  {active.members.map((m) => (
                    <span
                      key={m.agent}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        padding: "3px 9px 3px 6px",
                        background: "var(--s2)",
                        border: "1px solid var(--border)",
                        borderRadius: 14,
                        fontSize: 11.5,
                        color: "var(--text)",
                      }}
                    >
                      <span
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: "50%",
                          background: m.role === "orchestrator" ? "var(--cedar-glow)" : "var(--text3)",
                          boxShadow: m.role === "orchestrator" ? "0 0 4px var(--cedar-glow)" : undefined,
                        }}
                      />
                      @{m.agent}
                      <span style={{ fontSize: 10, color: "var(--muted)", fontFamily: "var(--fm)" }}>
                        · {m.role}
                      </span>
                    </span>
                  ))}
                  <span
                    style={{
                      fontSize: 10.5,
                      fontFamily: "var(--fm)",
                      color: "var(--muted)",
                      marginLeft: 6,
                    }}
                  >
                    · last {fmtAge(active.last_activity_ts)}
                  </span>
                </div>
              </div>

              {/* Scrollable feed */}
              <div
                ref={feedRef}
                style={{
                  flex: 1,
                  overflowY: "auto",
                  padding: "16px 18px 12px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                  minHeight: 0,
                }}
              >
                {active.messages.length === 0 && (
                  <div
                    style={{
                      textAlign: "center",
                      color: "var(--muted)",
                      fontSize: 13,
                      padding: "32px 0",
                    }}
                  >
                    No messages yet. Post below to start the conversation.
                  </div>
                )}
                {active.messages.map((m) => (
                  <ChannelBubble
                    key={m.id}
                    msg={m}
                    expanded={expandedIds.has(m.id) || expandAll}
                    onToggle={() => toggleExpand(m.id)}
                  />
                ))}
              </div>

              {/* Composer */}
              <div
                style={{
                  borderTop: "1px solid var(--border)",
                  padding: "12px 18px",
                  display: "flex",
                  gap: 8,
                  alignItems: "flex-end",
                  background: "var(--surface)",
                  flexShrink: 0,
                }}
              >
                <textarea
                  value={composer}
                  onChange={(e) => setComposer(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                      e.preventDefault();
                      send();
                    }
                  }}
                  placeholder={
                    active.status === "dismissed"
                      ? "Post anything to reactivate this channel…"
                      : "Post to the channel — orchestrator picks it up. ⌘Enter to send."
                  }
                  rows={2}
                  style={{
                    flex: 1,
                    background: "var(--bg)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    padding: "8px 10px",
                    fontSize: 13,
                    color: "var(--text)",
                    fontFamily: "var(--fn)",
                    resize: "vertical",
                    outline: "none",
                  }}
                />
                <Btn kind="solid" icon={<Send size={11} />} onClick={send} disabled={!composer.trim()}>
                  Send
                </Btn>
              </div>
            </>
          )}
        </div>

        {/* ── Right rail: project tasks (when linked) ─────────── */}
        {linkedProject && (
          <ProjectRail
            project={linkedProject}
            onSelectTask={setSelectedTask}
            onOpenProject={() => navigate(`/projects/${encodeURIComponent(linkedProject.id)}`)}
          />
        )}
      </div>

      {error && (
        <div
          style={{
            position: "fixed",
            bottom: 16,
            right: 16,
            maxWidth: 360,
            border: "1px solid var(--ember)",
            background: "var(--ember-dim)",
            color: "var(--ember)",
            fontSize: 11.5,
            borderRadius: 6,
            padding: "8px 10px",
            display: "flex",
            alignItems: "flex-start",
            gap: 6,
          }}
        >
          <AlertTriangle size={12} style={{ marginTop: 2 }} />
          <span style={{ flex: 1 }}>{error}</span>
          <button
            onClick={() => setError(null)}
            style={{ background: "transparent", border: "none", color: "var(--muted)", cursor: "pointer" }}
          >
            <X size={11} />
          </button>
        </div>
      )}
    </CedarPage>
  );
}

// ── Channel left rail (SessionList-style) ─────────────────────
function ChannelNav({
  channels,
  archivedChannels,
  activeId,
  onPick,
  onCreate,
  historyOpen,
  onToggleHistory,
}: {
  channels: Channel[];
  archivedChannels: Channel[];
  activeId: string | null;
  onPick: (id: string) => void;
  onCreate: () => void;
  historyOpen: boolean;
  onToggleHistory: () => void;
}) {
  return (
    <aside
      style={{
        display: "flex",
        flexDirection: "column",
        background: "var(--surface)",
        borderRight: "1px solid var(--border)",
        minHeight: 0,
      }}
    >
      <div
        style={{
          padding: "12px 14px",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexShrink: 0,
        }}
      >
        <Layers size={13} className="text-[var(--cedar-glow)]" />
        <span
          style={{
            fontSize: 11.5,
            fontWeight: 500,
            color: "var(--text2)",
            letterSpacing: ".04em",
            textTransform: "uppercase",
            fontFamily: "var(--fm)",
            flex: 1,
          }}
        >
          Channels
        </span>
        <button
          onClick={onCreate}
          title="New channel"
          style={{
            background: "transparent",
            border: "none",
            color: "var(--muted)",
            cursor: "pointer",
            fontSize: 16,
            lineHeight: 1,
          }}
        >
          +
        </button>
      </div>

      {/* Active channels — scrollable */}
      <div style={{ flex: 1, overflowY: "auto", padding: "6px 0" }}>
        {channels.length === 0 && (
          <div style={{ padding: "16px 14px", fontSize: 12, color: "var(--muted)" }}>
            No active channels.
          </div>
        )}
        {channels.map((c) => (
          <ChannelRow key={c.id} c={c} active={c.id === activeId} onPick={() => onPick(c.id)} />
        ))}
      </div>

      {/* History drawer — always visible at the bottom of the rail so
          closed channels are findable even when the count is currently
          zero. Header stays pinned; rows scroll inside when expanded. */}
      <div
        style={{
          borderTop: "1px solid var(--border)",
          display: "flex",
          flexDirection: "column",
          maxHeight: historyOpen && archivedChannels.length > 0 ? "40%" : undefined,
          minHeight: 0,
          flexShrink: 0,
        }}
      >
        <button
          onClick={onToggleHistory}
          disabled={archivedChannels.length === 0}
          style={{
            all: "unset",
            cursor: archivedChannels.length === 0 ? "default" : "pointer",
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "10px 14px",
            fontSize: 11,
            color: archivedChannels.length === 0 ? "var(--muted)" : "var(--text2)",
            textTransform: "uppercase",
            letterSpacing: ".1em",
            fontFamily: "var(--fm)",
            opacity: archivedChannels.length === 0 ? 0.6 : 1,
          }}
        >
          {historyOpen && archivedChannels.length > 0 ? (
            <ChevronDown size={11} />
          ) : (
            <ChevronRight size={11} />
          )}
          History ({archivedChannels.length})
        </button>
        {historyOpen && archivedChannels.length > 0 && (
          <div style={{ overflowY: "auto", flex: 1 }}>
            {archivedChannels.map((c) => (
              <ChannelRow
                key={c.id}
                c={c}
                active={c.id === activeId}
                onPick={() => onPick(c.id)}
                archived
              />
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}

function ChannelRow({
  c,
  active,
  onPick,
  archived,
}: {
  c: Channel;
  active: boolean;
  onPick: () => void;
  archived?: boolean;
}) {
  const lastMsg = c.messages[c.messages.length - 1];
  return (
    <button
      onClick={onPick}
      style={{
        display: "block",
        width: "100%",
        textAlign: "left",
        background: active ? "var(--cedar-dim)" : "transparent",
        borderLeft: `2px solid ${active ? "var(--cedar-glow)" : "transparent"}`,
        border: "none",
        borderRight: "none",
        borderTop: "none",
        borderBottom: "1px solid var(--hairline)",
        padding: "10px 14px",
        cursor: "pointer",
        opacity: archived ? 0.7 : 1,
        color: "var(--text)",
        fontFamily: "var(--fn)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span
          style={{
            fontSize: 12.5,
            color: active ? "var(--cedar-glow)" : "var(--text)",
            fontWeight: active ? 500 : 400,
            flex: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {c.name}
        </span>
        {c.status === "active" && !archived && (
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: "var(--cedar-glow)",
              boxShadow: "0 0 4px var(--cedar-glow)",
            }}
          />
        )}
      </div>
      {c.topic && (
        <div
          style={{
            fontSize: 11,
            color: "var(--text3)",
            marginTop: 3,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {c.topic}
        </div>
      )}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          marginTop: 4,
          fontSize: 10,
          fontFamily: "var(--fm)",
          color: "var(--muted)",
        }}
      >
        <span>{c.messages.length} msgs</span>
        <div style={{ flex: 1 }} />
        <span>{fmtAge(c.last_activity_ts || (lastMsg?.ts ?? 0))}</span>
      </div>
    </button>
  );
}

// ── Channel bubble (collapsible) ──────────────────────────────
function ChannelBubble({
  msg,
  expanded,
  onToggle,
}: {
  msg: Channel["messages"][number];
  expanded: boolean;
  onToggle: () => void;
}) {
  const isUser = msg.from === "user";
  const isThreaded = !!msg.thread_id;
  const summary = summarizeText(msg.text);
  const looksMultiline = msg.text.length > 160 || msg.text.includes("\n");

  return (
    <div
      style={{
        marginLeft: isThreaded ? 18 : 0,
        background: isUser ? "var(--user-bg)" : "var(--surface)",
        border: `1px solid ${isUser ? "var(--user-bd)" : "var(--border)"}`,
        borderRadius: 10,
        overflow: "hidden",
      }}
    >
      <button
        onClick={onToggle}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 12px",
          background: "transparent",
          border: "none",
          color: "var(--text)",
          textAlign: "left",
          cursor: looksMultiline ? "pointer" : "default",
          fontFamily: "var(--fn)",
        }}
      >
        <span
          style={{
            fontSize: 13,
            fontFamily: "var(--fm)",
            color: isUser ? "var(--text)" : "var(--cedar-glow)",
            fontWeight: 500,
          }}
        >
          @{msg.from}
        </span>
        <span style={{ fontSize: 11.5, color: "var(--muted)", fontFamily: "var(--fm)" }}>
          {fmtTime(msg.ts)}
        </span>
        {isThreaded && (
          <span style={{ fontSize: 10.5, color: "var(--muted)", fontFamily: "var(--fm)", fontStyle: "italic" }}>
            · thread on #{msg.thread_id}
          </span>
        )}
        {!expanded && looksMultiline && (
          <span
            style={{
              flex: 1,
              fontSize: 12.5,
              color: "var(--text2)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              marginLeft: 6,
            }}
          >
            {summary}
          </span>
        )}
        {looksMultiline && (
          <span style={{ marginLeft: "auto", color: "var(--muted)" }}>
            {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </span>
        )}
      </button>
      {(expanded || !looksMultiline) && (
        <div style={{ padding: "0 14px 12px" }}>
          <CedarMarkdown text={msg.text} />
        </div>
      )}
    </div>
  );
}

// ── Project rail ──────────────────────────────────────────────
function ProjectRail({
  project,
  onOpenProject,
  onSelectTask,
}: {
  project: ProjectSummary;
  onOpenProject: () => void;
  onSelectTask: (t: ProjectTask) => void;
}) {
  const grouped: Record<string, ProjectTask[]> = {
    in_progress: [],
    blocked: [],
    planned: [],
    done: [],
    failed: [],
  };
  for (const t of project.tasks) (grouped[t.status] || []).push(t);

  const order: { status: keyof typeof grouped; label: string; color: string }[] = [
    { status: "in_progress", label: "In progress", color: "var(--cedar-glow)" },
    { status: "blocked", label: "Blocked", color: "var(--dawn)" },
    { status: "planned", label: "Planned", color: "var(--text3)" },
    { status: "done", label: "Done", color: "var(--stone)" },
    { status: "failed", label: "Failed", color: "var(--ember)" },
  ];

  return (
    <aside
      style={{
        display: "flex",
        flexDirection: "column",
        borderLeft: "1px solid var(--border)",
        background: "var(--surface)",
        minHeight: 0,
      }}
    >
      <div
        style={{
          padding: "12px 14px",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          gap: 6,
          flexShrink: 0,
        }}
      >
        <Briefcase size={13} className="text-[var(--cedar-glow)]" />
        <span
          style={{
            fontSize: 11,
            fontFamily: "var(--fm)",
            color: "var(--muted)",
            textTransform: "uppercase",
            letterSpacing: ".1em",
            flex: 1,
          }}
        >
          Project
        </span>
        <span style={{ fontSize: 10.5, fontFamily: "var(--fm)", color: "var(--cedar-2)" }}>
          {project.open_tasks} open
        </span>
      </div>
      <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--hairline)" }}>
        <div style={{ fontSize: 13.5, fontWeight: 500, color: "var(--text)" }}>{project.name}</div>
        {project.brief && (
          <div
            style={{
              fontSize: 11.5,
              color: "var(--text3)",
              marginTop: 4,
              maxHeight: 60,
              overflow: "hidden",
            }}
          >
            {summarizeText(project.brief, 200)}
          </div>
        )}
        <div style={{ marginTop: 8 }}>
          <Btn size="sm" kind="outline" onClick={onOpenProject}>
            Open project →
          </Btn>
        </div>
      </div>
      <div style={{ flex: 1, overflowY: "auto" }}>
        {order.map(({ status, label, color }) => {
          const items = grouped[status];
          if (items.length === 0) return null;
          return (
            <div key={status}>
              <div
                style={{
                  padding: "10px 14px 6px",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 10,
                  fontFamily: "var(--fm)",
                  color: "var(--muted)",
                  textTransform: "uppercase",
                  letterSpacing: ".12em",
                }}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: color,
                  }}
                />
                {label} · {items.length}
              </div>
              {items.map((t) => (
                <button
                  key={t.id}
                  onClick={() => onSelectTask(t)}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    padding: "6px 14px 8px",
                    background: "transparent",
                    border: "none",
                    borderBottom: "1px solid var(--hairline)",
                    color: "var(--text)",
                    fontSize: 12.5,
                    fontFamily: "var(--fn)",
                    cursor: "pointer",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--s2)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  <div>{t.title}</div>
                  {t.assignee && (
                    <div
                      style={{
                        fontSize: 10.5,
                        fontFamily: "var(--fm)",
                        color: "var(--cedar-2)",
                        marginTop: 2,
                      }}
                    >
                      @{t.assignee}
                      {t.artifacts.length > 0 &&
                        ` · ${t.artifacts.length} file${t.artifacts.length === 1 ? "" : "s"}`}
                    </div>
                  )}
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </aside>
  );
}

// ── Invite modal ──────────────────────────────────────────────
function InviteMemberDialog({
  channelId,
  existingMembers,
  onClose,
  onInvited,
}: {
  channelId: string;
  existingMembers: string[];
  onClose: () => void;
  onInvited: () => void;
}) {
  const [agent, setAgent] = useState("");
  const [role, setRole] = useState<"orchestrator" | "specialist">("specialist");
  const [available, setAvailable] = useState<{ name: string; description: string }[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listAgents().then((arr) => setAvailable(arr.map((a) => ({ name: a.name, description: a.description })))).catch(() => {});
  }, []);

  const submit = async () => {
    const a = agent.trim().replace(/^@/, "");
    if (!a) {
      setError("Pick or type an agent name.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await api.addChannelMember(channelId, a, role);
      onInvited();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const filtered = available.filter((a) => !existingMembers.includes(a.name));

  return (
    <CedarModal
      open
      onClose={onClose}
      eyebrow="invite member"
      title={
        <>
          Add an <em style={{ fontStyle: "italic", color: "var(--cedar-glow)" }}>agent</em> to this channel.
        </>
      }
      footer={
        <>
          <Btn kind="ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </Btn>
          <Btn kind="solid" onClick={submit} disabled={submitting || !agent.trim()}>
            {submitting ? "Adding…" : "Invite"}
          </Btn>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <CedarLabel>Agent name</CedarLabel>
          <CedarInput
            value={agent}
            onChange={(e) => setAgent(e.target.value)}
            placeholder="e.g. designer, sre, doc-updater"
            autoFocus
          />
        </div>
        <div>
          <CedarLabel>Role</CedarLabel>
          <div style={{ display: "flex", gap: 6 }}>
            {(["specialist", "orchestrator"] as const).map((r) => (
              <button
                key={r}
                onClick={() => setRole(r)}
                style={{
                  padding: "5px 12px",
                  borderRadius: 7,
                  border: `1px solid ${role === r ? "var(--cedar-line)" : "var(--border)"}`,
                  background: role === r ? "var(--cedar-dim)" : "var(--bg)",
                  color: role === r ? "var(--cedar-glow)" : "var(--text2)",
                  fontFamily: "var(--fn)",
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                {r}
              </button>
            ))}
          </div>
        </div>
        {filtered.length > 0 && (
          <div>
            <CedarLabel>Pick from your agents ({filtered.length})</CedarLabel>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 4,
                maxHeight: 220,
                overflowY: "auto",
                border: "1px solid var(--border)",
                borderRadius: 7,
                padding: 6,
                background: "var(--bg)",
              }}
            >
              {filtered.map((a) => (
                <button
                  key={a.name}
                  onClick={() => setAgent(a.name)}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "flex-start",
                    padding: "6px 10px",
                    background: agent === a.name ? "var(--cedar-dim)" : "transparent",
                    border: "1px solid transparent",
                    borderRadius: 5,
                    cursor: "pointer",
                    color: "var(--text)",
                    fontFamily: "var(--fn)",
                    textAlign: "left",
                  }}
                >
                  <span style={{ fontSize: 12.5, fontWeight: 500 }}>@{a.name}</span>
                  {a.description && (
                    <span style={{ fontSize: 11, color: "var(--text3)", marginTop: 2 }}>
                      {a.description.slice(0, 120)}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}
        {error && (
          <div
            style={{
              fontSize: 12,
              color: "var(--ember)",
              background: "var(--ember-dim)",
              border: "1px solid var(--ember)",
              borderRadius: 6,
              padding: "8px 10px",
            }}
          >
            {error}
          </div>
        )}
      </div>
    </CedarModal>
  );
}

// ── Create channel modal (kept simple, Cedar-styled) ──────────
function CreateChannelDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (slug: string) => void;
}) {
  const [presets, setPresets] = useState<Preset[]>([]);
  const [presetId, setPresetId] = useState<string>("custom");
  const [name, setName] = useState("");
  const [topic, setTopic] = useState("");
  const [members, setMembers] = useState<string>("orchestrator,coder,reviewer");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.channelPresetsApp().then(setPresets).catch(() => {});
  }, []);

  const submit = async () => {
    setCreating(true);
    setError(null);
    try {
      const memberList = members.split(",").map((s) => s.trim()).filter(Boolean);
      const finalName = name.trim() || (presetId !== "custom" ? presetId.replace("_", "-") : "");
      if (!finalName) {
        setError("Channel name is required.");
        setCreating(false);
        return;
      }
      const r = await api.createChannelApp({
        name: finalName,
        topic: topic.trim() || undefined,
        preset: presetId,
        members:
          presetId === "custom"
            ? memberList.map((a, i) => ({
                agent: a,
                role: i === 0 ? "orchestrator" : "specialist",
              }))
            : undefined,
      });
      onCreated(r.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  };

  return (
    <CedarModal
      open
      onClose={onClose}
      eyebrow="new channel"
      title={
        <>
          Spin up a <em style={{ fontStyle: "italic", color: "var(--cedar-glow)" }}>collaboration</em>.
        </>
      }
      footer={
        <>
          <Btn kind="ghost" onClick={onClose} disabled={creating}>
            Cancel
          </Btn>
          <Btn kind="solid" icon={<Wand2 size={11} />} onClick={submit} disabled={creating}>
            {creating ? "Creating…" : "Create"}
          </Btn>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <CedarLabel>Preset</CedarLabel>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            {[{ id: "custom", name: "Custom", topic: "Define your own team" }, ...presets].map((p) => (
              <button
                key={p.id}
                onClick={() => {
                  setPresetId(p.id);
                  if (p.id !== "custom") {
                    setName(p.name);
                    setTopic(p.topic);
                  }
                }}
                style={{
                  padding: 10,
                  borderRadius: 8,
                  border: `1px solid ${presetId === p.id ? "var(--cedar-line)" : "var(--border)"}`,
                  background: presetId === p.id ? "var(--cedar-dim)" : "var(--bg)",
                  textAlign: "left",
                  fontFamily: "var(--fn)",
                  cursor: "pointer",
                  color: "var(--text)",
                }}
              >
                <div style={{ fontSize: 12.5, fontWeight: 500 }}>{p.name}</div>
                <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 2 }}>{p.topic}</div>
              </button>
            ))}
          </div>
        </div>
        <div>
          <CedarLabel>Name</CedarLabel>
          <CedarInput value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <CedarLabel>Topic / objective</CedarLabel>
          <CedarTextArea value={topic} onChange={(e) => setTopic(e.target.value)} rows={3} />
        </div>
        {presetId === "custom" && (
          <div>
            <CedarLabel>Members (comma-separated, first = orchestrator)</CedarLabel>
            <CedarInput
              value={members}
              onChange={(e) => setMembers(e.target.value)}
              style={{ fontFamily: "var(--fm)" }}
            />
          </div>
        )}
        {error && (
          <div
            style={{
              fontSize: 12,
              color: "var(--ember)",
              background: "var(--ember-dim)",
              border: "1px solid var(--ember)",
              borderRadius: 6,
              padding: "8px 10px",
            }}
          >
            {error}
          </div>
        )}
      </div>
    </CedarModal>
  );
}

// ── ProjectBanner removed in this rewrite ─────────────────────
// (It used to live above the channel header; the right rail now
// surfaces the project context instead, and the Create Project flow
// stays on the /projects page.)

// `Users` import retained — it's referenced by future invite-multiple flows.
const _UsersIcon = Users;
void _UsersIcon;

// ── Change folder modal ──────────────────────────────────────
function ChangeFolderModal({
  project,
  onClose,
  onSaved,
}: {
  project: ProjectSummary;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [path, setPath] = useState(project.repo_path || "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    const v = path.trim();
    setBusy(true);
    setErr(null);
    try {
      await api.patchProject(project.id, { repo_path: v });
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <CedarModal
      open
      onClose={onClose}
      width={560}
      eyebrow="work folder"
      title={
        <>
          Where should <em style={{ fontStyle: "italic", color: "var(--cedar-glow)" }}>{project.name}</em> work?
        </>
      }
      footer={
        <>
          <Btn kind="ghost" onClick={onClose} disabled={busy}>Cancel</Btn>
          <Btn kind="solid" onClick={submit} disabled={busy}>
            {busy ? "Saving…" : "Save folder"}
          </Btn>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div>
          <CedarLabel>Absolute path</CedarLabel>
          <CedarInput
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="/Users/you/code/my-project"
            autoFocus
            onKeyDown={(e) => { if (e.key === "Enter" && !busy) submit(); }}
            style={{ fontFamily: "var(--fm)" }}
          />
          <div style={{ fontSize: 10.5, color: "var(--muted)", fontFamily: "var(--fm)", marginTop: 4 }}>
            Agents run with this as their working directory. Path is saved as-is — no validation.
            Leave blank to clear.
          </div>
        </div>
        {project.repo_path && project.repo_path !== path.trim() && (
          <div style={{ fontSize: 11.5, color: "var(--text3)", fontFamily: "var(--fm)" }}>
            current: <code>{project.repo_path}</code>
          </div>
        )}
        {err && (
          <div
            style={{
              fontSize: 12,
              color: "var(--ember)",
              background: "var(--ember-dim)",
              border: "1px solid var(--ember)",
              borderRadius: 6,
              padding: "8px 10px",
            }}
          >
            {err}
          </div>
        )}
      </div>
    </CedarModal>
  );
}
