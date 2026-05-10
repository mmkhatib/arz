// Channels (Apps) — persistent multi-agent workspaces.
//
// Layout: SecondaryNav lists existing channels + a "+ new" button.
// Selecting a channel shows the feed (chronological) and a footer
// composer. Posting fires the orchestrator+specialist loop server-
// side; the page polls /api/channels/{slug} every 2s while open and
// shows new messages live.

import { useEffect, useRef, useState } from "react";
import { Briefcase, Layers, Plus, Send, Wand2, X, Power, AlertTriangle } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, type ProjectSummary } from "@/api/client";
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
import SecondaryNav from "@/components/SecondaryNav";

type Channel = Awaited<ReturnType<typeof api.getChannelApp>>;
type Preset = Awaited<ReturnType<typeof api.channelPresetsApp>>[number];

function renderWithMentions(text: string): React.ReactNode {
  const parts = text.split(/(@\w[\w-]*)/g);
  return parts.map((p, i) =>
    p.startsWith("@") ? (
      <span
        key={i}
        style={{
          color: "var(--cedar-glow)",
          background: "var(--cedar-dim)",
          padding: "1px 6px",
          borderRadius: 4,
          fontWeight: 500,
        }}
      >
        {p}
      </span>
    ) : (
      <span key={i}>{p}</span>
    ),
  );
}

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

export default function ChannelsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  // Honor ?ch=<slug> in the URL: auto-select that channel on first
  // load. Cleared from the URL after we apply it so back-nav doesn't
  // fight the user's later picks.
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
  const [active, setActive] = useState<Channel | null>(null);
  const [composer, setComposer] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);

  useEffect(() => {
    api.listProjects().then(setProjects).catch(() => {});
    const t = setInterval(() => api.listProjects().then(setProjects).catch(() => {}), 30_000);
    return () => clearInterval(t);
  }, []);
  const feedRef = useRef<HTMLDivElement>(null);

  const refreshList = async () => {
    try {
      const data = await api.listChannelsApp();
      setChannels(data);
      if (!activeId && data.length > 0) setActiveId(data[0].id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  // Poll the active channel for live updates.
  useEffect(() => {
    if (!activeId) { setActive(null); return; }
    let cancelled = false;
    const tick = async () => {
      if (document.hidden) return;
      try {
        const ch = await api.getChannelApp(activeId);
        if (!cancelled) setActive(ch);
      } catch {
        // Channel may have been deleted; refresh list.
        void refreshList();
      }
    };
    tick();
    const id = window.setInterval(tick, 2000);
    return () => { cancelled = true; window.clearInterval(id); };
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

  const wake = async () => {
    if (!activeId) return;
    await api.wakeChannelApp(activeId).catch(() => {});
  };
  const dismiss = async () => {
    if (!activeId) return;
    if (!confirm("Dismiss this channel? Messages stay on disk; the channel will be marked inactive.")) return;
    await api.dismissChannelApp(activeId).catch(() => {});
    await refreshList();
  };

  const navItems = channels.map((c) => ({
    id: c.id,
    label: c.name,
    badge: c.messages.length > 0 ? String(c.messages.length) : undefined,
    hint: c.topic || c.id,
  }));

  return (
    <CedarPage>
      <div style={{ position: "relative", overflow: "hidden" }}>
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

      {showCreate && <CreateChannelDialog onClose={() => setShowCreate(false)} onCreated={(slug) => { setShowCreate(false); setActiveId(slug); refreshList(); }} />}

      <div className="flex flex-1 min-h-0">
        <SecondaryNav<string>
          title="Channels"
          icon={<Layers size={16} />}
          value={activeId ?? ""}
          onChange={(id) => setActiveId(id)}
          items={channels.length ? navItems : [{ id: "", label: "(no channels yet)", disabled: true }]}
        />

        <div className="flex-1 min-w-0 flex flex-col">
          {!active ? (
            <div className="flex-1 flex items-center justify-center text-[12px] text-[var(--muted)]">
              {channels.length === 0 ? "Create a channel to get started." : "Pick a channel."}
            </div>
          ) : (
            <>
              {/* Project banner — visible when channel has a linked project,
                  or a CTA to create one when not */}
              <ProjectBanner
                channelId={active.id}
                channelName={active.name}
                channelTopic={active.topic}
                projects={projects}
                onCreated={() => api.listProjects().then(setProjects).catch(() => {})}
                onOpen={(pid) => navigate(`/projects/${encodeURIComponent(pid)}`)}
              />
              {/* Channel header */}
              <div className="border-b border-[var(--border)] px-5 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[15px] font-semibold text-[var(--text)] truncate">{active.name}</span>
                    <Tag color={active.status === "active" ? "cedar" : active.status === "idle" ? "dawn" : "muted"}>
                      {active.status}
                    </Tag>
                    {active.preset && active.preset !== "custom" && (
                      <Tag color="stone">{active.preset.replace("_", " ")}</Tag>
                    )}
                  </div>
                  {active.topic && (
                    <div className="text-[12px] text-[var(--muted)] mt-0.5 truncate">{active.topic}</div>
                  )}
                  <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                    <span style={{ fontSize: 10, fontFamily: "var(--fm)", color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".1em", marginRight: 4 }}>
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
                        title={m.role}
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
                        <span style={{ fontSize: 10, color: "var(--muted)", fontFamily: "var(--fm)" }}>· {m.role}</span>
                      </span>
                    ))}
                    <span style={{ fontSize: 10.5, fontFamily: "var(--fm)", color: "var(--muted)", marginLeft: 6 }}>
                      · last {fmtAge(active.last_activity_ts)}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {active.status === "idle" && (
                    <button
                      onClick={wake}
                      className="text-[11px] px-2 py-1 rounded-md text-amber-400 hover:bg-amber-900/20 flex items-center gap-1"
                      title="Wake the channel"
                    >
                      <Power size={11} /> Wake
                    </button>
                  )}
                  {active.status !== "dismissed" && (
                    <button
                      onClick={dismiss}
                      className="text-[11px] px-2 py-1 rounded-md text-[var(--muted)] hover:text-red-400 hover:bg-red-400/10 flex items-center gap-1"
                      title="Dismiss"
                    >
                      <X size={11} /> Dismiss
                    </button>
                  )}
                </div>
              </div>

              {/* Feed */}
              <div ref={feedRef} className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-3">
                {active.messages.length === 0 ? (
                  <div className="text-center text-[var(--muted)]/60 text-[12px] py-8">
                    No messages yet. Post below to start the conversation.
                  </div>
                ) : (
                  active.messages.map((m) => {
                    const isUser = m.from === "user";
                    const isThreaded = !!m.thread_id;
                    return (
                      <div key={m.id} className={["flex flex-col gap-0.5", isThreaded ? "ml-6" : ""].join(" ")}>
                        <div className="flex items-center gap-2 text-[10px] font-mono">
                          <span className={isUser ? "text-[var(--text)]" : "text-[var(--cedar)]"}>
                            @{m.from}
                          </span>
                          <span className="text-[var(--muted)]/50">{fmtTime(m.ts)}</span>
                          {isThreaded && (
                            <span className="text-[var(--muted)]/60 italic">· thread on #{m.thread_id}</span>
                          )}
                        </div>
                        <div className={["text-[13px] whitespace-pre-wrap break-words rounded-lg px-3 py-2 max-w-[80%]",
                          isUser ? "bg-[var(--user-bg)] text-[var(--text)] self-start" :
                          isThreaded ? "bg-[var(--bg)] border border-[var(--border)]/60 text-[var(--text)] self-start" :
                          "bg-[var(--surface)] border border-[var(--border)] text-[var(--text)] self-start"].join(" ")}>
                          {renderWithMentions(m.text)}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Composer */}
              <div className="border-t border-[var(--border)] px-5 py-3 flex items-end gap-2 bg-[var(--surface)]">
                <textarea
                  value={composer}
                  onChange={(e) => setComposer(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); }
                  }}
                  placeholder="Post to the channel — orchestrator picks it up and delegates. ⌘Enter to send."
                  rows={2}
                  className="flex-1 bg-[var(--bg)] border border-[var(--border)] rounded-md px-3 py-2 text-[13px] text-[var(--text)] focus:outline-none focus:border-[var(--cedar)] resize-y"
                />
                <button
                  onClick={send}
                  disabled={!composer.trim()}
                  className="shrink-0 px-3 py-2 rounded-md bg-[var(--cedar)] text-white text-[12px] disabled:opacity-40 hover:bg-[var(--cedar-lt)] flex items-center gap-1"
                >
                  <Send size={11} /> Send
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {error && (
        <div className="absolute bottom-4 right-4 max-w-sm border border-red-500/40 bg-red-900/20 text-red-300 text-[11px] rounded px-3 py-2 flex items-start gap-2">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="text-[var(--muted)] hover:text-[var(--text)]"><X size={11} /></button>
        </div>
      )}
    </CedarPage>
  );
}

function CreateChannelDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (slug: string) => void }) {
  const [presets, setPresets] = useState<Preset[]>([]);
  const [presetId, setPresetId] = useState<string>("custom");
  const [name, setName] = useState("");
  const [topic, setTopic] = useState("");
  const [members, setMembers] = useState<string>("general");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { api.channelPresetsApp().then(setPresets).catch(() => {}); }, []);

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
            ? memberList.map((a, i) => ({ agent: a, role: i === 0 ? "orchestrator" : "specialist" }))
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-[var(--bg)] border border-[var(--border)] rounded-2xl shadow-2xl w-full max-w-lg mx-4 flex flex-col">
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-[var(--border)]">
          <div className="flex items-center gap-2">
            <Wand2 size={16} className="text-[var(--cedar)]" />
            <h2 className="text-[15px] font-semibold text-[var(--text)]">New channel</h2>
          </div>
          <button onClick={onClose} className="text-[var(--muted)] hover:text-[var(--text)] text-xl leading-none">×</button>
        </div>

        <div className="px-5 py-4 flex flex-col gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-[var(--muted)] mb-1">Preset</div>
            <div className="grid grid-cols-2 gap-1.5">
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
                  className={[
                    "text-left p-2 rounded-md border text-[12px]",
                    presetId === p.id ? "border-[var(--cedar)] bg-[var(--cedar)]/10 text-[var(--text)]" : "border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)]",
                  ].join(" ")}
                >
                  <div className="font-semibold text-[12px]">{p.name}</div>
                  <div className="text-[10px] text-[var(--muted)]/80 mt-0.5">{p.topic}</div>
                </button>
              ))}
            </div>
          </div>

          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Channel name"
            className="bg-[var(--bg)] border border-[var(--border)] rounded-md px-2 py-1.5 text-[13px] text-[var(--text)] focus:outline-none focus:border-[var(--cedar)]"
          />
          <textarea
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="Topic / objective"
            rows={2}
            className="bg-[var(--bg)] border border-[var(--border)] rounded-md px-2 py-1.5 text-[13px] text-[var(--text)] focus:outline-none focus:border-[var(--cedar)] resize-y"
          />

          {presetId === "custom" && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-[var(--muted)] mb-1">Members</div>
              <input
                value={members}
                onChange={(e) => setMembers(e.target.value)}
                placeholder="comma-separated agent names — first one is orchestrator"
                className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-md px-2 py-1.5 text-[12px] font-mono text-[var(--text)] focus:outline-none focus:border-[var(--cedar)]"
              />
            </div>
          )}

          {error && <div className="text-red-400 text-[11px] bg-red-900/20 rounded px-2 py-1">{error}</div>}

          <div className="flex justify-end gap-2 mt-2">
            <button onClick={onClose} className="px-3 py-1 rounded-md text-[12px] text-[var(--muted)] hover:text-[var(--text)]">
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={creating}
              className="px-3 py-1 rounded-md bg-[var(--cedar)] text-white text-[12px] disabled:opacity-40 hover:bg-[var(--cedar-lt)]"
            >
              {creating ? "Creating…" : "Create"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Banner that appears above a channel when it's been linked to a Project,
// or offers a one-click "create project from this channel" when not.
function ProjectBanner({
  channelId,
  channelName,
  channelTopic,
  projects,
  onCreated,
  onOpen,
}: {
  channelId: string;
  channelName: string;
  channelTopic: string;
  projects: ProjectSummary[];
  onCreated: () => void;
  onOpen: (projectId: string) => void;
}) {
  const linked = projects.find((p) => p.channel_id === channelId);
  const [showCreate, setShowCreate] = useState(false);

  if (linked) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 18px",
          borderBottom: "1px solid var(--border)",
          background: "var(--cedar-dim)",
        }}
      >
        <Briefcase size={14} className="text-[var(--cedar-glow)]" />
        <span style={{ fontSize: 12, fontFamily: "var(--fm)", color: "var(--cedar-2)", textTransform: "uppercase", letterSpacing: ".12em" }}>
          Project
        </span>
        <span style={{ fontSize: 13, color: "var(--text)", fontWeight: 500 }}>{linked.name}</span>
        <span style={{ fontSize: 11, color: "var(--muted)", fontFamily: "var(--fm)" }}>
          · {linked.open_tasks} open task{linked.open_tasks === 1 ? "" : "s"}
        </span>
        <div style={{ flex: 1 }} />
        <Btn size="sm" kind="outline" onClick={() => onOpen(linked.id)}>
          Open project →
        </Btn>
      </div>
    );
  }
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 18px",
        borderBottom: "1px solid var(--hairline)",
        background: "var(--surface)",
      }}
    >
      <Briefcase size={13} className="text-[var(--muted)]" />
      <span style={{ fontSize: 11.5, color: "var(--text3)" }}>
        Promote this channel to a tracked project — gives the orchestrator a brief, task list,
        and project memory.
      </span>
      <div style={{ flex: 1 }} />
      <Btn size="sm" kind="soft" icon={<Plus size={11} />} onClick={() => setShowCreate(true)}>
        Create project
      </Btn>
      <PromoteToProjectModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        defaultName={channelName}
        defaultBrief={channelTopic || ""}
        channelId={channelId}
        onCreated={(id) => { onCreated(); onOpen(id); }}
      />
    </div>
  );
}

function PromoteToProjectModal({
  open,
  onClose,
  defaultName,
  defaultBrief,
  channelId,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  defaultName: string;
  defaultBrief: string;
  channelId: string;
  onCreated: (id: string) => void;
}) {
  const [name, setName] = useState(defaultName);
  const [brief, setBrief] = useState(defaultBrief);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName(defaultName);
      setBrief(defaultBrief);
      setError(null);
      setSubmitting(false);
    }
  }, [open, defaultName, defaultBrief]);

  const submit = async () => {
    const n = name.trim();
    if (!n) { setError("Name required."); return; }
    setSubmitting(true);
    try {
      const p = await api.createProject({
        name: n,
        brief: brief.trim(),
        channel_id: channelId,
      });
      onCreated(p.id);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <CedarModal
      open={open}
      onClose={onClose}
      eyebrow="promote channel"
      title={
        <>
          Wrap this channel in a <em style={{ fontStyle: "italic", color: "var(--cedar-glow)" }}>project</em>.
        </>
      }
      footer={
        <>
          <Btn kind="ghost" onClick={onClose} disabled={submitting}>Cancel</Btn>
          <Btn kind="solid" onClick={submit} disabled={submitting}>
            {submitting ? "Creating…" : "Create project"}
          </Btn>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <CedarLabel>Name</CedarLabel>
          <CedarInput
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit(); }}
          />
        </div>
        <div>
          <CedarLabel>Brief</CedarLabel>
          <CedarTextArea
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            rows={6}
            placeholder="What is the orchestrator working on?"
          />
        </div>
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
