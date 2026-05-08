import { useEffect, useState } from "react";
import { Activity, Users, Heart, ListChecks, Save, Plus, Trash2, RefreshCw } from "lucide-react";
import { api, type AuditEntryPub } from "@/api/client";
import SecondaryNav from "@/components/SecondaryNav";
import { CedarPage, CedarPageHeader, CedarCard, Tag, TopoLines } from "@/components/CedarUI";

type Tab = "decisions" | "subagents" | "channels" | "heartbeat" | "tasks";

export default function AutonomyPage() {
  const [tab, setTab] = useState<Tab>("decisions");
  const [audits, setAudits] = useState<AuditEntryPub[]>([]);
  const [trust, setTrust] = useState<number>(() => {
    const raw = Number(localStorage.getItem("arz:trust-level"));
    return Number.isFinite(raw) && raw >= 0 && raw <= 100 ? raw : 70;
  });

  useEffect(() => {
    api.getOverview(50)
      .then((o) => setAudits(o.recent_activity || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    localStorage.setItem("arz:trust-level", String(trust));
  }, [trust]);

  const auto = audits.length;
  const asked = 0; // Could come from a different audit kind once we tag them

  return (
    <CedarPage>
      <div style={{ position: "relative", overflow: "hidden" }}>
        <TopoLines height={120} opacity={0.5} />
        <CedarPageHeader
          eyebrow="trust"
          title={
            <>
              What Arzeh did{" "}
              <em style={{ fontStyle: "italic", color: "var(--cedar-glow)" }}>without asking</em>.
            </>
          }
          sub={`${auto} auto-approved · ${asked} asked first. Adjust the trust dial to bring more decisions back to you.`}
        />
      </div>
      <div className="flex flex-1 min-h-0">
        <SecondaryNav<Tab>
          title="Autonomy"
          icon={<Activity size={16} />}
          value={tab}
          onChange={setTab}
          items={[
            { id: "decisions", label: "Decisions", icon: <Activity size={13} /> },
            { id: "subagents", label: "Subagents", icon: <Activity size={13} /> },
            { id: "channels",  label: "Channels",  icon: <Users size={13} /> },
            { id: "heartbeat", label: "Heartbeat", icon: <Heart size={13} /> },
            { id: "tasks",     label: "Tasks",     icon: <ListChecks size={13} /> },
          ]}
        />
        <div className="overflow-y-auto px-8 py-6 flex-1">
          {tab === "decisions" && <DecisionsTab audits={audits} trust={trust} setTrust={setTrust} />}
          {tab === "subagents" && <SubagentsTab />}
          {tab === "channels" && <ChannelsTab />}
          {tab === "heartbeat" && <HeartbeatTab />}
          {tab === "tasks" && <TasksTab />}
        </div>
      </div>
    </CedarPage>
  );
}

function DecisionsTab({
  audits,
  trust,
  setTrust,
}: {
  audits: AuditEntryPub[];
  trust: number;
  setTrust: (n: number) => void;
}) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 24 }}>
      <CedarCard padding={0}>
        <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center" }}>
          <span style={{ fontSize: 11, fontFamily: "var(--fm)", color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".1em" }}>
            Recent decisions · {audits.length}
          </span>
        </div>
        {audits.length === 0 && (
          <div style={{ padding: 32, textAlign: "center", fontSize: 12.5, color: "var(--muted)" }}>
            No actions logged yet.
          </div>
        )}
        {audits.map((e) => (
          <div
            key={e.id}
            style={{
              display: "grid",
              gridTemplateColumns: "100px 1fr auto",
              alignItems: "center",
              gap: 14,
              padding: "12px 18px",
              borderBottom: "1px solid var(--hairline)",
            }}
          >
            <Tag color="cedar">auto</Tag>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12.5, color: "var(--text)" }}>
                <span style={{ fontFamily: "var(--fm)", color: "var(--cedar-2)" }}>{e.kind}</span>
                {" "}· {e.summary}
              </div>
              {e.session_id && (
                <div style={{ fontSize: 10.5, color: "var(--muted)", fontFamily: "var(--fm)", marginTop: 2 }}>
                  session {e.session_id.slice(0, 8)}
                </div>
              )}
            </div>
            <span style={{ fontSize: 10.5, fontFamily: "var(--fm)", color: "var(--muted)" }}>
              {relTime(e.ts)}
            </span>
          </div>
        ))}
      </CedarCard>

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <CedarCard padding={20}>
          <div
            style={{
              fontSize: 10.5,
              color: "var(--muted)",
              fontFamily: "var(--fm)",
              textTransform: "uppercase",
              letterSpacing: ".12em",
              marginBottom: 12,
            }}
          >
            Trust dial
          </div>
          <div style={{ fontFamily: "var(--fd)", fontSize: 36, color: "var(--text)", lineHeight: 1, marginBottom: 4 }}>
            {trust}%
          </div>
          <div style={{ fontSize: 11.5, color: "var(--text3)", marginBottom: 14 }}>
            {trust < 30 ? "Cautious — ask for most things." : trust < 70 ? "Balanced — auto-approve safe ops." : "Trusting — auto-approve broadly."}
          </div>
          <input
            type="range"
            min={0}
            max={100}
            value={trust}
            onChange={(e) => setTrust(Number(e.target.value))}
            style={{ width: "100%", accentColor: "var(--cedar)" }}
          />
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 10, fontFamily: "var(--fm)", color: "var(--muted)" }}>
            <span>cautious</span>
            <span>trusting</span>
          </div>
        </CedarCard>
        <CedarCard padding={16}>
          <div style={{ fontSize: 11.5, color: "var(--text3)", lineHeight: 1.5 }}>
            Lower the dial to bring more decisions back to you for approval. Higher trust = fewer interruptions but more autonomy.
          </div>
        </CedarCard>
      </div>
    </div>
  );
}

function relTime(ts: number): string {
  if (!ts) return "—";
  const dt = Date.now() / 1000 - ts;
  if (dt < 60) return `${Math.floor(dt)}s ago`;
  if (dt < 3600) return `${Math.floor(dt / 60)}m ago`;
  if (dt < 86400) return `${Math.floor(dt / 3600)}h ago`;
  return `${Math.floor(dt / 86400)}d ago`;
}

// ── Subagents ────────────────────────────────────────────────────────────────

function SubagentsTab() {
  const [items, setItems] = useState<Awaited<ReturnType<typeof api.listSubagents>>>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => api.listSubagents().then(setItems).catch((e) => setError(String(e)));

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <div className="text-[12px] text-[var(--muted)]">
          Background subagent runs spawned via <code>spawn_run</code>. Result auto-injects into the parent session's next turn.
        </div>
        <button onClick={refresh} className="text-[var(--muted)] hover:text-[var(--text)]">
          <RefreshCw size={12} />
        </button>
      </div>
      {items.length === 0 && (
        <div className="text-center text-[var(--muted)]/60 text-[12px] py-12">No subagent runs yet.</div>
      )}
      {items.map((s) => (
        <div key={s.id} className="border border-[var(--border)] rounded-lg p-3 bg-[var(--surface)]">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[11px] font-mono text-[var(--cedar)] bg-[var(--cedar)]/10 px-1.5 py-0.5 rounded">{s.agent_name}</span>
            <span className={[
              "text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded",
              s.status === "completed" ? "text-emerald-400 bg-emerald-900/30" :
              s.status === "running" ? "text-blue-400 bg-blue-900/30" :
              s.status === "failed" || s.status === "timeout" ? "text-red-400 bg-red-900/30" :
              "text-[var(--muted)] bg-[var(--bg)]",
            ].join(" ")}>{s.status}</span>
            <span className="text-[10px] font-mono text-[var(--muted)]/60">{s.id.slice(0, 8)}</span>
            <span className="ml-auto text-[10px] text-[var(--muted)]/60">{relTime(s.started_at || s.finished_at)}</span>
          </div>
          <div className="text-[12px] text-[var(--text)] mb-1 line-clamp-2">{s.prompt}</div>
          {s.result && (
            <pre className="mt-1 text-[11px] font-mono text-[var(--muted)] bg-[var(--bg)] rounded p-2 whitespace-pre-wrap max-h-[200px] overflow-y-auto">{s.result}</pre>
          )}
        </div>
      ))}
      {error && <div className="text-red-400 text-[11px] bg-red-900/20 rounded px-2 py-1">{error}</div>}
    </div>
  );
}

// ── Channels ─────────────────────────────────────────────────────────────────

function ChannelsTab() {
  const [items, setItems] = useState<Awaited<ReturnType<typeof api.listChannels>>>([]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [members, setMembers] = useState("");
  const [active, setActive] = useState<string | null>(null);
  const [postFrom, setPostFrom] = useState("user");
  const [postText, setPostText] = useState("");

  const refresh = () => api.listChannels().then((d) => { setItems(d); if (active && !d.find((c) => c.id === active)) setActive(null); }).catch((e) => setError(String(e)));
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 8000);
    return () => clearInterval(t);
  }, []);

  const create = async () => {
    if (!name.trim()) return;
    try {
      const memberList = members.split(",").map((s) => s.trim()).filter(Boolean);
      await api.createChannel(name.trim(), memberList);
      setName(""); setMembers(""); setCreating(false);
      refresh();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  const del = async (slug: string) => {
    if (!confirm(`Delete channel ${slug}?`)) return;
    try { await api.deleteChannel(slug); refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  const post = async () => {
    if (!active || !postText.trim()) return;
    try {
      await api.postToChannel(active, postFrom || "user", postText.trim());
      setPostText("");
      refresh();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  const current = items.find((c) => c.id === active);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="text-[12px] text-[var(--muted)]">
          Multi-agent A2A spaces. Use <code>send_message(channel, text)</code> from inside a session to post; @mention agents to ping them.
        </div>
        {!creating && (
          <button onClick={() => setCreating(true)} className="flex items-center gap-1 px-3 py-1 rounded-md bg-[var(--cedar)] text-white text-[12px] hover:bg-[var(--cedar-lt)]">
            <Plus size={11} /> New channel
          </button>
        )}
      </div>

      {creating && (
        <div className="border border-[var(--border)] rounded-lg p-3 bg-[var(--surface)] flex flex-col gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="channel name" className="bg-[var(--bg)] border border-[var(--border)] rounded-md px-2 py-1.5 text-[13px] text-[var(--text)] focus:outline-none focus:border-[var(--cedar)]" />
          <input value={members} onChange={(e) => setMembers(e.target.value)} placeholder="members, comma, separated (agent names)" className="bg-[var(--bg)] border border-[var(--border)] rounded-md px-2 py-1.5 text-[12px] text-[var(--text)] focus:outline-none focus:border-[var(--cedar)]" />
          <div className="flex gap-2">
            <button onClick={create} disabled={!name.trim()} className="flex items-center gap-1 px-3 py-1 rounded-md bg-[var(--cedar)] text-white text-[12px] disabled:opacity-40">Create</button>
            <button onClick={() => setCreating(false)} className="text-[12px] text-[var(--muted)] hover:text-[var(--text)]">Cancel</button>
          </div>
        </div>
      )}

      <div className="flex gap-3 min-h-[300px]">
        <div className="w-48 shrink-0 flex flex-col gap-1">
          {items.length === 0 && <div className="text-[12px] text-[var(--muted)]/60 text-center py-4">No channels.</div>}
          {items.map((c) => (
            <button
              key={c.id}
              onClick={() => setActive(c.id)}
              className={[
                "text-left px-2 py-1.5 rounded-md text-[12px] flex items-center gap-2",
                active === c.id ? "bg-[var(--cedar)]/15 text-[var(--text)]" : "text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--text)]",
              ].join(" ")}
            >
              <span className="flex-1 truncate"># {c.id}</span>
              <span className="text-[9px] text-[var(--muted)]/60">{c.members.length}m</span>
            </button>
          ))}
        </div>

        <div className="flex-1 min-w-0 border border-[var(--border)] rounded-lg bg-[var(--surface)] flex flex-col">
          {!current && <div className="flex-1 flex items-center justify-center text-[12px] text-[var(--muted)]/60">Select a channel.</div>}
          {current && (
            <>
              <div className="px-3 py-2 border-b border-[var(--border)] flex items-center gap-2">
                <span className="text-[13px] font-semibold text-[var(--text)]"># {current.id}</span>
                <span className="text-[10px] text-[var(--muted)]/60">members: {current.members.map((m) => m.agent).join(", ") || "(none)"}</span>
                <button onClick={() => del(current.id)} className="ml-auto text-[var(--muted)] hover:text-red-400" title="Delete channel">
                  <Trash2 size={12} />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-1.5">
                {current.messages.length === 0 && <div className="text-[12px] text-[var(--muted)]/60 text-center py-8">No messages.</div>}
                {current.messages.map((m) => (
                  <div key={m.id} className="text-[12px]">
                    <span className="text-[var(--cedar)] font-mono mr-2">@{m.from}</span>
                    <span className="text-[var(--text)]">{m.text}</span>
                  </div>
                ))}
              </div>
              <div className="border-t border-[var(--border)] p-2 flex items-center gap-2">
                <input value={postFrom} onChange={(e) => setPostFrom(e.target.value)} placeholder="from" className="w-20 bg-[var(--bg)] border border-[var(--border)] rounded-md px-2 py-1 text-[11px] font-mono text-[var(--text)] focus:outline-none focus:border-[var(--cedar)]" />
                <input value={postText} onChange={(e) => setPostText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") post(); }} placeholder="message…" className="flex-1 bg-[var(--bg)] border border-[var(--border)] rounded-md px-2 py-1 text-[12px] text-[var(--text)] focus:outline-none focus:border-[var(--cedar)]" />
                <button onClick={post} disabled={!postText.trim()} className="px-3 py-1 rounded-md bg-[var(--cedar)] text-white text-[12px] disabled:opacity-40">Post</button>
              </div>
            </>
          )}
        </div>
      </div>

      {error && <div className="text-red-400 text-[11px] bg-red-900/20 rounded px-2 py-1">{error}</div>}
    </div>
  );
}

// ── Heartbeat ────────────────────────────────────────────────────────────────

function HeartbeatTab() {
  const [content, setContent] = useState<string>("");
  const [orig, setOrig] = useState<string>("");
  const [path, setPath] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [savedFlag, setSavedFlag] = useState(0);
  const [saving, setSaving] = useState(false);

  const refresh = () => api.getHeartbeat().then((d) => { setContent(d.content); setOrig(d.content); setPath(d.path); }).catch((e) => setError(String(e)));
  useEffect(() => { refresh(); }, []);

  const save = async () => {
    setSaving(true); setError(null);
    try { await api.putHeartbeat(content); setOrig(content); setSavedFlag(Date.now()); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setSaving(false); }
  };

  const justSaved = Date.now() - savedFlag < 1500;

  return (
    <div className="flex flex-col gap-3">
      <div className="border border-[var(--border)] rounded-lg p-4 bg-[var(--surface)] flex flex-col gap-3">
        <div className="text-[12px] text-[var(--muted)]">
          The heartbeat loop reads this checklist on a fixed interval (default 5 min). Each
          unchecked <code>- [ ]</code> item runs as one subagent turn; the line then flips to
          <code> - [x]</code>. Lines tagged <code>&lt;!-- KEEP --&gt;</code> reset back to
          unchecked after the next tick so they keep firing.
        </div>
        <div className="text-[10px] font-mono text-[var(--muted)]/60">{path}</div>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={20}
          className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-md px-2 py-1.5 text-[12px] font-mono text-[var(--text)] focus:outline-none focus:border-[var(--cedar)] resize-y"
        />
        <div className="flex items-center gap-3">
          <button onClick={save} disabled={saving || content === orig} className="flex items-center gap-1 px-4 py-1.5 rounded-md bg-[var(--cedar)] text-white text-[12px] disabled:opacity-40 hover:bg-[var(--cedar-lt)]">
            <Save size={11} /> Save
          </button>
          {justSaved && <span className="text-[10px] uppercase tracking-wider text-[var(--accent)] animate-pulse">saved</span>}
        </div>
      </div>
      {error && <div className="text-red-400 text-[11px] bg-red-900/20 rounded px-2 py-1">{error}</div>}
    </div>
  );
}

// ── Tasks ────────────────────────────────────────────────────────────────────

function TasksTab() {
  const [items, setItems] = useState<Awaited<ReturnType<typeof api.listTasks>>>([]);
  const [error, setError] = useState<string | null>(null);
  const [spec, setSpec] = useState<string>("");
  const [agent, setAgent] = useState<string>("general");
  const [submitting, setSubmitting] = useState(false);

  const refresh = () => api.listTasks().then(setItems).catch((e) => setError(String(e)));
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, []);

  const submit = async () => {
    if (!spec.trim()) return;
    setSubmitting(true); setError(null);
    try {
      await api.kickoffTask(spec.trim(), agent || "general");
      setSpec("");
      refresh();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setSubmitting(false); }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="text-[12px] text-[var(--muted)]">
        Submit a markdown spec; the runner decomposes it into ordered steps,
        executes each, and verifies acceptance against the spec.
      </div>

      <div className="border border-[var(--border)] rounded-lg p-3 bg-[var(--surface)] flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <label className="text-[11px] uppercase tracking-wider text-[var(--muted)]">Agent</label>
          <input value={agent} onChange={(e) => setAgent(e.target.value)} placeholder="general" className="w-32 bg-[var(--bg)] border border-[var(--border)] rounded-md px-2 py-1 text-[12px] font-mono text-[var(--text)] focus:outline-none focus:border-[var(--cedar)]" />
        </div>
        <textarea
          value={spec}
          onChange={(e) => setSpec(e.target.value)}
          placeholder={"# Goal\n- step 1: …\n- step 2: …\n\n## Acceptance\n- …"}
          rows={8}
          className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-md px-2 py-1.5 text-[12px] font-mono text-[var(--text)] focus:outline-none focus:border-[var(--cedar)] resize-y"
        />
        <button onClick={submit} disabled={submitting || !spec.trim()} className="self-end flex items-center gap-1 px-4 py-1.5 rounded-md bg-[var(--cedar)] text-white text-[12px] disabled:opacity-40 hover:bg-[var(--cedar-lt)]">
          <Plus size={11} /> Kick off
        </button>
      </div>

      {items.length === 0 && (
        <div className="text-center text-[var(--muted)]/60 text-[12px] py-8">No tasks yet.</div>
      )}
      {items.map((t) => (
        <div key={t.id} className="border border-[var(--border)] rounded-lg p-3 bg-[var(--surface)]">
          <div className="flex items-center gap-2 mb-1">
            <span className={[
              "text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded",
              t.status === "done" ? "text-emerald-400 bg-emerald-900/30" :
              t.status === "running" || t.status === "decomposing" || t.status === "verifying" ? "text-blue-400 bg-blue-900/30" :
              t.status === "failed" ? "text-red-400 bg-red-900/30" :
              "text-[var(--muted)] bg-[var(--bg)]",
            ].join(" ")}>{t.status}</span>
            <span className="text-[10px] font-mono text-[var(--muted)]/60">{t.id.slice(0, 8)}</span>
            <span className="text-[11px] text-[var(--cedar)]">@{t.agent}</span>
            <span className="ml-auto text-[10px] text-[var(--muted)]/60">{relTime(t.started_at)}</span>
          </div>
          <div className="text-[12px] text-[var(--muted)] mb-2 line-clamp-2">{t.spec}</div>
          {t.steps && t.steps.length > 0 && (
            <div className="flex flex-col gap-0.5 mb-2">
              {t.steps.map((s) => (
                <div key={s.n} className="text-[11px] flex items-start gap-2">
                  <span className={[
                    "shrink-0 w-4 text-center font-mono",
                    s.status === "done" ? "text-emerald-400" :
                    s.status === "running" ? "text-blue-400" :
                    s.status === "failed" ? "text-red-400" : "text-[var(--muted)]",
                  ].join(" ")}>
                    {s.status === "done" ? "✓" : s.status === "failed" ? "✗" : s.status === "running" ? "…" : "·"}
                  </span>
                  <span className="text-[var(--text)]">{s.text}</span>
                </div>
              ))}
            </div>
          )}
          {t.verdict && (
            <div className="text-[11px] text-[var(--muted)] italic border-l-2 border-[var(--cedar)] pl-2">{t.verdict}</div>
          )}
        </div>
      ))}
      {error && <div className="text-red-400 text-[11px] bg-red-900/20 rounded px-2 py-1">{error}</div>}
    </div>
  );
}
