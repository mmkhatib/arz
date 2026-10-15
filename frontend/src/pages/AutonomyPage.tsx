import { useEffect, useState } from "react";
import type React from "react";
import { Save, Plus, Trash2, RefreshCw, Bot, MessagesSquare, ListChecks } from "lucide-react";
import { api, type AuditEntryPub } from "@/api/client";
import { CedarPage, CedarPageHeader, CedarCard, Tag, SegSeg, TopoLines, Btn, CedarInput, CedarTextArea } from "@/components/CedarUI";
import { useDialog } from "@/components/Dialog";
import EmptyState from "@/components/EmptyState";
import { ageSecs, fmtAge, plainExcerpt } from "@/utils/format";

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
          right={
            <SegSeg<Tab>
              value={tab}
              onChange={setTab}
              options={[
                { value: "decisions", label: "Decisions" },
                { value: "subagents", label: "Subagents" },
                { value: "channels", label: "Channels" },
                { value: "heartbeat", label: "Heartbeat" },
                { value: "tasks", label: "Tasks" },
              ]}
            />
          }
        />
      </div>
      <div style={{ padding: "24px 32px 32px" }}>
        {tab === "decisions" && <DecisionsTab audits={audits} trust={trust} setTrust={setTrust} />}
        {tab === "subagents" && <SubagentsTab />}
        {tab === "channels" && <ChannelsTab />}
        {tab === "heartbeat" && <HeartbeatTab />}
        {tab === "tasks" && <TasksTab />}
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
        {audits.map((e) => {
          const sm = splitSummary(e.summary);
          return (
          <div
            key={e.id}
            style={{
              display: "grid",
              gridTemplateColumns: "88px 1fr auto",
              alignItems: "center",
              gap: 14,
              padding: "12px 18px",
              borderBottom: "1px solid var(--hairline)",
            }}
          >
            <span style={{ justifySelf: "start" }}><Tag color={kindColor(e.kind)}>{sm.role || e.kind}</Tag></span>
            <div style={{ minWidth: 0 }}>
              {sm.where && (
                <div style={{ fontSize: 11.5, color: "var(--text3)", marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {sm.where}
                </div>
              )}
              <div
                title={sm.body}
                style={{
                  fontSize: 12.5,
                  color: "var(--text)",
                  lineHeight: 1.45,
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                }}
              >
                {sm.body}
              </div>
              {e.session_id && !sm.where && (
                <div style={{ fontSize: 10.5, color: "var(--muted)", fontFamily: "var(--fm)", marginTop: 2 }}>
                  session {e.session_id.slice(0, 8)}
                </div>
              )}
            </div>
            <span style={{ fontSize: 10.5, fontFamily: "var(--fm)", color: "var(--muted)" }}>
              {relTime(e.ts)}
            </span>
          </div>
          );
        })}
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

function kindColor(kind: string): "cedar" | "pine" | "dawn" | "ember" | "stone" | "muted" {
  if (/deny|block|error|fail/i.test(kind)) return "ember";
  if (/approv|permission/i.test(kind)) return "dawn";
  if (/tool|exec|bash|write|edit/i.test(kind)) return "pine";
  if (/message|chat/i.test(kind)) return "stone";
  return "cedar";
}

function relTime(ts: number | string | null | undefined): string {
  if (!ts) return "—";
  const secs = ageSecs(ts);
  return secs < 10 ? "just now" : `${fmtAge(secs)} ago`;
}

/** Audit summaries from the message fallback look like
 *  "[session title] assistant: <markdown…>". Split them so the row shows
 *  the session, the role, and a plain excerpt — not raw widget HTML. */
function splitSummary(summary: string): { where: string; role: string; body: string } {
  const m = summary.match(/^\[([^\]]*)\]\s*(user|assistant|system|tool)\s*:\s*([\s\S]*)$/);
  if (!m) return { where: "", role: "", body: plainExcerpt(summary, 220) };
  return { where: m[1].trim(), role: m[2], body: plainExcerpt(m[3], 220) || "(no text)" };
}

// ── Shared bits ──────────────────────────────────────────────────────────────

type StatusTone = "pine" | "dawn" | "ember" | "muted";

function statusTone(status: string): StatusTone {
  if (/done|completed|success/.test(status)) return "pine";
  if (/running|decomposing|verifying|pending|queued/.test(status)) return "dawn";
  if (/fail|timeout|error|cancel/.test(status)) return "ember";
  return "muted";
}

function TabIntro({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 14 }}>
      <div style={{ flex: 1, fontSize: 12.5, color: "var(--text3)", lineHeight: 1.5 }}>{children}</div>
      {right}
    </div>
  );
}

function EmptyCard({ icon, title, body }: { icon: React.ReactNode; title: string; body?: string }) {
  return (
    <CedarCard padding={0}>
      <EmptyState icon={icon} title={title} hint={body} />
    </CedarCard>
  );
}

function ErrorLine({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <div style={{ marginTop: 12, padding: "8px 12px", background: "var(--ember-dim)", color: "var(--ember)", border: "1px solid var(--ember)", borderRadius: 6, fontSize: 12 }}>
      {error}
    </div>
  );
}

const mono: React.CSSProperties = { fontFamily: "var(--fm)", fontSize: 10.5, color: "var(--muted)" };

// ── Subagents ────────────────────────────────────────────────────────────────

function SubagentsTab() {
  const [items, setItems] = useState<Awaited<ReturnType<typeof api.listSubagents>>>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => api.listSubagents().then((d) => { setItems(d); setError(null); }).catch((e) => setError(String(e)));

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, []);

  return (
    <div>
      <TabIntro right={<Btn size="sm" kind="ghost" icon={<RefreshCw size={11} />} onClick={refresh}>Refresh</Btn>}>
        Background subagent runs spawned via <code>spawn_run</code>. The result auto-injects into the parent session's next turn.
      </TabIntro>
      {items.length === 0 ? (
        <EmptyCard icon={<Bot size={20} />} title="No subagent runs yet." body="They appear here when a session hands work to a background agent." />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {items.map((s) => (
            <CedarCard key={s.id} padding={14}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <Tag color="cedar">{s.agent_name}</Tag>
                <Tag color={statusTone(s.status)}>{s.status}</Tag>
                <span style={mono}>{s.id.slice(0, 8)}</span>
                <span style={{ ...mono, marginLeft: "auto" }}>{relTime(s.started_at || s.finished_at)}</span>
              </div>
              <div style={{ fontSize: 12.5, color: "var(--text)", lineHeight: 1.5, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                {s.prompt}
              </div>
              {s.result && (
                <pre style={{ marginTop: 8, fontSize: 11, fontFamily: "var(--fm)", color: "var(--text2)", background: "var(--bg)", border: "1px solid var(--hairline)", borderRadius: 6, padding: "8px 10px", whiteSpace: "pre-wrap", maxHeight: 200, overflowY: "auto" }}>
                  {s.result}
                </pre>
              )}
            </CedarCard>
          ))}
        </div>
      )}
      <ErrorLine error={error} />
    </div>
  );
}

// ── Channels ─────────────────────────────────────────────────────────────────

function ChannelsTab() {
  const dialog = useDialog();
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
    const ok = await dialog.confirm({
      title: `Delete channel "${slug}"?`,
      body: "Removes it from the registry. Cannot be undone.",
      tone: "danger",
    });
    if (!ok) return;
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
    <div>
      <TabIntro
        right={!creating && <Btn size="sm" kind="solid" icon={<Plus size={11} />} onClick={() => setCreating(true)}>New channel</Btn>}
      >
        Multi-agent A2A spaces. Use <code>send_message(channel, text)</code> from inside a session to post; @mention agents to ping them.
      </TabIntro>

      {creating && (
        <CedarCard padding={14} style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
          <CedarInput value={name} onChange={(e) => setName(e.target.value)} placeholder="channel name" autoFocus />
          <CedarInput value={members} onChange={(e) => setMembers(e.target.value)} placeholder="members, comma separated (agent names)" />
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Btn size="sm" kind="ghost" onClick={() => setCreating(false)}>Cancel</Btn>
            <Btn size="sm" kind="solid" onClick={create} disabled={!name.trim()}>Create</Btn>
          </div>
        </CedarCard>
      )}

      {items.length === 0 && !creating ? (
        <EmptyCard icon={<MessagesSquare size={20} />} title="No channels yet." body="A channel lets several agents talk to each other. Create one to start." />
      ) : (
      <div style={{ display: "grid", gridTemplateColumns: "200px 1fr", gap: 14, minHeight: 320 }}>
        <CedarCard padding={6} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {items.length === 0 && <div style={{ fontSize: 12, color: "var(--muted)", textAlign: "center", padding: "16px 8px" }}>No channels.</div>}
          {items.map((c) => (
            <button
              key={c.id}
              onClick={() => setActive(c.id)}
              style={{
                display: "flex", alignItems: "center", gap: 8, textAlign: "left",
                padding: "7px 10px", borderRadius: 6, border: "none", cursor: "pointer",
                fontSize: 12.5, fontFamily: "var(--fn)",
                background: active === c.id ? "var(--cedar-dim)" : "transparent",
                color: active === c.id ? "var(--cedar-glow)" : "var(--text2)",
              }}
            >
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}># {c.id}</span>
              <span style={mono}>{c.members.length}</span>
            </button>
          ))}
        </CedarCard>

        <CedarCard padding={0} style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
          {!current && (
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12.5, color: "var(--muted)" }}>
              {items.length ? "Select a channel." : "Create a channel to start."}
            </div>
          )}
          {current && (
            <>
              <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 13.5, fontWeight: 500, color: "var(--text)" }}># {current.id}</span>
                <span style={mono}>{current.members.map((m) => m.agent).join(", ") || "no members"}</span>
                <span style={{ marginLeft: "auto" }}>
                  <Btn size="sm" kind="ghost" icon={<Trash2 size={11} />} onClick={() => del(current.id)} title="Delete channel" />
                </span>
              </div>
              <div style={{ flex: 1, overflowY: "auto", padding: 14, display: "flex", flexDirection: "column", gap: 6 }}>
                {current.messages.length === 0 && <div style={{ fontSize: 12, color: "var(--muted)", textAlign: "center", padding: "32px 0" }}>No messages.</div>}
                {current.messages.map((m) => (
                  <div key={m.id} style={{ fontSize: 12.5, lineHeight: 1.5 }}>
                    <span style={{ color: "var(--cedar-glow)", fontFamily: "var(--fm)", marginRight: 8 }}>@{m.from}</span>
                    <span style={{ color: "var(--text)" }}>{m.text}</span>
                  </div>
                ))}
              </div>
              <div style={{ borderTop: "1px solid var(--border)", padding: 10, display: "flex", gap: 8 }}>
                <CedarInput value={postFrom} onChange={(e) => setPostFrom(e.target.value)} placeholder="from" style={{ width: 90, fontFamily: "var(--fm)", fontSize: 11.5 }} />
                <CedarInput value={postText} onChange={(e) => setPostText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") post(); }} placeholder="message…" style={{ flex: 1 }} />
                <Btn size="sm" kind="solid" onClick={post} disabled={!postText.trim()}>Post</Btn>
              </div>
            </>
          )}
        </CedarCard>
      </div>
      )}

      <ErrorLine error={error} />
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
  const dirty = content !== orig;

  return (
    <div>
      <TabIntro>
        The heartbeat loop reads this checklist on a fixed interval (default 5 min). Each unchecked <code>- [ ]</code> item
        runs as one subagent turn; the line then flips to <code>- [x]</code>. Lines tagged <code>&lt;!-- KEEP --&gt;</code> reset
        to unchecked after the next tick so they keep firing.
      </TabIntro>
      <CedarCard padding={0}>
        <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ ...mono, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{path || "HEARTBEAT.md"}</span>
          {justSaved && <Tag color="pine">saved</Tag>}
          {dirty && !justSaved && <Tag color="dawn">unsaved</Tag>}
          <Btn size="sm" kind="solid" icon={<Save size={11} />} onClick={save} disabled={saving || !dirty}>Save</Btn>
        </div>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={20}
          spellCheck={false}
          style={{ display: "block", width: "100%", border: "none", outline: "none", resize: "vertical", background: "transparent", padding: "12px 14px", fontFamily: "var(--fm)", fontSize: 12, lineHeight: 1.6, color: "var(--text)" }}
        />
      </CedarCard>
      <ErrorLine error={error} />
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

  const stepColor = (st: string) =>
    st === "done" ? "var(--pine)" : st === "running" ? "var(--dawn)" : st === "failed" ? "var(--ember)" : "var(--muted)";

  return (
    <div>
      <TabIntro>
        Submit a markdown spec; the runner decomposes it into ordered steps, executes each, and verifies acceptance against the spec.
      </TabIntro>

      <CedarCard padding={14} style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ ...mono, textTransform: "uppercase", letterSpacing: ".1em" }}>Agent</span>
          <CedarInput value={agent} onChange={(e) => setAgent(e.target.value)} placeholder="general" style={{ width: 160, fontFamily: "var(--fm)", fontSize: 12 }} />
        </div>
        <CedarTextArea
          value={spec}
          onChange={(e) => setSpec(e.target.value)}
          placeholder={"# Goal\n- step 1: …\n- step 2: …\n\n## Acceptance\n- …"}
          rows={7}
          style={{ fontFamily: "var(--fm)", fontSize: 12 }}
        />
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <Btn size="sm" kind="solid" icon={<Plus size={11} />} onClick={submit} disabled={submitting || !spec.trim()}>
            {submitting ? "Starting…" : "Kick off"}
          </Btn>
        </div>
      </CedarCard>

      {items.length === 0 ? (
        <EmptyCard icon={<ListChecks size={20} />} title="No tasks yet." body="Kicked-off specs show their steps and verdict here." />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {items.map((t) => (
            <CedarCard key={t.id} padding={14}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <Tag color={statusTone(t.status)}>{t.status}</Tag>
                <Tag color="cedar">@{t.agent}</Tag>
                <span style={mono}>{t.id.slice(0, 8)}</span>
                <span style={{ ...mono, marginLeft: "auto" }}>{relTime(t.started_at)}</span>
              </div>
              <div style={{ fontSize: 12.5, color: "var(--text2)", lineHeight: 1.5, marginBottom: 8, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                {t.spec}
              </div>
              {t.steps && t.steps.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 3, marginBottom: 8 }}>
                  {t.steps.map((s) => (
                    <div key={s.n} style={{ display: "flex", gap: 8, fontSize: 12, alignItems: "flex-start" }}>
                      <span style={{ width: 14, textAlign: "center", fontFamily: "var(--fm)", color: stepColor(s.status), flexShrink: 0 }}>
                        {s.status === "done" ? "✓" : s.status === "failed" ? "✗" : s.status === "running" ? "…" : "·"}
                      </span>
                      <span style={{ color: "var(--text)" }}>{s.text}</span>
                    </div>
                  ))}
                </div>
              )}
              {t.verdict && (
                <div style={{ fontSize: 12, color: "var(--text3)", fontStyle: "italic", borderLeft: "2px solid var(--cedar-line)", paddingLeft: 10 }}>{t.verdict}</div>
              )}
            </CedarCard>
          ))}
        </div>
      )}
      <ErrorLine error={error} />
    </div>
  );
}
