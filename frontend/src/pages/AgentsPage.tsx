// Agents — custom personas, LLM-agnostic.
// Left rail: agent list w/ status pulse. Right pane: inspector.

import { useEffect, useState } from "react";
import { Bot, Plus, Trash2, Edit3, Star } from "lucide-react";
import {
  CedarPage,
  CedarPageHeader,
  CedarCard,
  Btn,
  Tag,
  TopoLines,
} from "@/components/CedarUI";
import { api, type AgentConfig, type AgentStats } from "@/api/client";
import { useDialog } from "@/components/Dialog";
import { modelsForProvider, PROVIDER_LABELS } from "@/utils/models";
import { useLiveModels } from "@/hooks/useLiveModels";
import { shortModelLabel } from "@/utils/format";

const ALL_PROVIDERS = ["claude-code", "kiro-cli", "codex", "gemini", "ollama", "anthropic"];

function effectiveProviders(a: AgentConfig): string[] {
  if (a.providers && a.providers.length > 0) return a.providers;
  return a.provider ? [a.provider] : [];
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1000) return (n / 1000).toFixed(1) + "k";
  return String(n);
}

function fmtRelTime(ts: number | null): string {
  if (!ts) return "never";
  const d = Math.round((Date.now() / 1000 - ts) / 86400);
  if (d < 1) return "today";
  if (d < 7) return `${d}d ago`;
  if (d < 60) return `${Math.round(d / 7)}w ago`;
  return `${Math.round(d / 30)}mo ago`;
}

export default function AgentsPage() {
  const dialog = useDialog();
  const [agents, setAgents] = useState<AgentConfig[]>([]);
  const [stats, setStats] = useState<Record<string, AgentStats>>({});
  const [installedProviders, setInstalledProviders] = useState<string[]>([]);
  const [activeName, setActiveName] = useState<string | null>(null);
  const [editing, setEditing] = useState<AgentConfig | null>(null);
  const [creating, setCreating] = useState(false);

  const refresh = async () => {
    try {
      const data = await api.listAgents();
      setAgents(data);
      if (!activeName && data.length > 0) setActiveName(data[0].name);
    } catch {}
    try {
      const s = await api.agentStats();
      const map: Record<string, AgentStats> = {};
      for (const row of s) map[row.name] = row;
      setStats(map);
    } catch {}
  };

  useEffect(() => {
    refresh();
    api.getInstallerStatus().then((r) => {
      const installed = r.clis.filter((c) => c.installed).map((c) => c.name);
      // ollama present as any local model
      if (r.ollama_installed_models?.length > 0 && !installed.includes("ollama")) {
        installed.push("ollama");
      }
      if (!installed.includes("anthropic")) installed.push("anthropic");
      setInstalledProviders(installed);
    }).catch(() => setInstalledProviders(ALL_PROVIDERS));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const active = agents.find((a) => a.name === activeName) || null;

  const submitEdit = async (a: AgentConfig) => {
    try {
      if (creating) await api.createAgent(a);
      else await api.updateAgent(a.name, a);
      await refresh();
      setActiveName(a.name);
      setEditing(null);
      setCreating(false);
    } catch (e) {
      await dialog.notify({ title: "Save failed", body: String(e), tone: "danger" });
    }
  };

  const remove = async (name: string) => {
    const ok = await dialog.confirm({
      title: `Delete agent "${name}"?`,
      body: "Removes its config file. Sessions referencing it will fall back to defaults.",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await api.deleteAgent(name);
      await refresh();
      if (activeName === name) setActiveName(null);
    } catch {}
  };

  return (
    <CedarPage>
      <div style={{ position: "relative", overflow: "hidden" }}>
        <TopoLines height={120} opacity={0.5} />
        <CedarPageHeader
          eyebrow="custom personas"
          title={
            <>
              The <em style={{ fontStyle: "italic", color: "var(--cedar-glow)" }}>agents</em> you've raised.
            </>
          }
          sub="Each agent is a system prompt + tool allowlist + approval policy. LLM-agnostic."
          right={
            <Btn
              kind="solid"
              icon={<Plus size={13} />}
              onClick={() => {
                setCreating(true);
                setEditing({
                  name: "",
                  provider: "claude-code",
                  model: "",
                  work_dir: "",
                  system_prompt: "",
                  approval_mode: "normal",
                  tool_allowlist: [],
                  description: "",
                  is_default: false,
                });
              }}
            >
              New agent
            </Btn>
          }
        />
      </div>
      <div
        style={{
          padding: "24px 32px 32px",
          display: "grid",
          gridTemplateColumns: "300px 1fr",
          gap: 18,
        }}
      >
        {/* Left rail — search + Popular / All sections */}
        <AgentRail
          agents={agents}
          stats={stats}
          activeName={activeName}
          onPick={(name) => { setActiveName(name); setEditing(null); }}
        />

        {/* Inspector */}
        {editing ? (
          <AgentEditor
            initial={editing}
            isNew={creating}
            installedProviders={installedProviders}
            onCancel={() => { setEditing(null); setCreating(false); }}
            onSave={submitEdit}
          />
        ) : active ? (
          <CedarCard padding={20}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 14 }}>
              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 10.5,
                    color: "var(--muted)",
                    fontFamily: "var(--fm)",
                    textTransform: "uppercase",
                    letterSpacing: ".12em",
                    marginBottom: 6,
                  }}
                >
                  Persona
                </div>
                <h2 style={{ fontFamily: "var(--fd)", fontSize: 26, color: "var(--text)", margin: 0, lineHeight: 1.15 }}>
                  {active.name}
                </h2>
                {active.description && (
                  <p style={{ fontSize: 13, color: "var(--text2)", marginTop: 6, lineHeight: 1.5 }}>
                    {active.description}
                  </p>
                )}
              </div>
              <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                <Btn size="sm" kind="outline" icon={<Edit3 size={11} />} onClick={() => setEditing(active)}>Edit</Btn>
                <Btn size="sm" kind="danger" icon={<Trash2 size={11} />} onClick={() => remove(active.name)}>Delete</Btn>
              </div>
            </div>

            <Field
              label="Compatible LLMs"
              value={
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                  {effectiveProviders(active).map((p) => (
                    <Tag key={p} color={p === active.provider ? "cedar" : "muted"}>{p}{p === active.provider ? " ★" : ""}</Tag>
                  ))}
                </div>
              }
            />
            <Field label="Model" value={<span style={{ fontFamily: "var(--fm)", fontSize: 12 }}>{active.model ? `${shortModelLabel(active.model)}${shortModelLabel(active.model) !== active.model ? ` · ${active.model}` : ""}` : `${PROVIDER_LABELS[active.provider || ""] ?? "Provider"} default`}</span>} />
            <Field label="Approval" value={<Tag color={active.approval_mode === "yolo" ? "ember" : active.approval_mode === "trust" ? "dawn" : "cedar"}>{active.approval_mode}</Tag>} />
            <Field
              label="Usage"
              value={
                <StatsRow s={stats[active.name]} />
              }
            />
            {active.work_dir && <Field label="Work dir" value={<span style={{ fontFamily: "var(--fm)", fontSize: 11.5, color: "var(--text3)" }}>{active.work_dir}</span>} />}
            {active.tool_allowlist?.length > 0 && (
              <Field
                label="Tools"
                value={
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                    {active.tool_allowlist.map((t) => <Tag key={t} color="muted">{t}</Tag>)}
                  </div>
                }
              />
            )}
            {active.system_prompt && (
              <div style={{ marginTop: 18 }}>
                <div
                  style={{
                    fontSize: 10.5,
                    color: "var(--muted)",
                    fontFamily: "var(--fm)",
                    textTransform: "uppercase",
                    letterSpacing: ".12em",
                    marginBottom: 6,
                  }}
                >
                  System prompt
                </div>
                <pre
                  style={{
                    background: "var(--bg)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    padding: 14,
                    fontFamily: "var(--fm)",
                    fontSize: 12,
                    lineHeight: 1.6,
                    color: "var(--text)",
                    whiteSpace: "pre-wrap",
                    margin: 0,
                  }}
                >
                  {active.system_prompt}
                </pre>
              </div>
            )}
          </CedarCard>
        ) : (
          <CedarCard padding={48}>
            <div style={{ textAlign: "center", color: "var(--muted)" }}>
              <Bot size={28} style={{ margin: "0 auto 12px", color: "var(--text3)" }} />
              <div style={{ fontFamily: "var(--fd)", fontSize: 22, color: "var(--text)" }}>No agent selected</div>
              <div style={{ fontSize: 13, marginTop: 8 }}>Pick one on the left, or raise a new one.</div>
            </div>
          </CedarCard>
        )}
      </div>
    </CedarPage>
  );
}

function StatsRow({ s }: { s: AgentStats | undefined }) {
  if (!s || s.runs === 0) {
    return <span style={{ fontFamily: "var(--fm)", fontSize: 11.5, color: "var(--text3)" }}>never used</span>;
  }
  return (
    <div style={{ display: "flex", gap: 12, fontFamily: "var(--fm)", fontSize: 11.5, color: "var(--text2)", flexWrap: "wrap" }}>
      <Stat label="runs" value={String(s.runs)} />
      <Stat label="msgs" value={String(s.messages)} />
      <Stat label="tokens" value={`${fmtTokens(s.tokens_in)}↓ / ${fmtTokens(s.tokens_out)}↑`} />
      <Stat label="last" value={fmtRelTime(s.last_used)} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "baseline", gap: 4 }}>
      <span style={{ color: "var(--muted)", fontSize: 10 }}>{label}</span>
      <span style={{ color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>{value}</span>
    </span>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 0", borderBottom: "1px solid var(--hairline)" }}>
      <span
        style={{
          width: 100,
          fontSize: 10.5,
          color: "var(--muted)",
          fontFamily: "var(--fm)",
          textTransform: "uppercase",
          letterSpacing: ".12em",
        }}
      >
        {label}
      </span>
      <span style={{ fontSize: 12.5, color: "var(--text)" }}>{value}</span>
    </div>
  );
}

function AgentEditor({
  initial,
  isNew,
  installedProviders,
  onCancel,
  onSave,
}: {
  initial: AgentConfig;
  isNew: boolean;
  installedProviders: string[];
  onCancel: () => void;
  onSave: (a: AgentConfig) => void;
}) {
  const [a, setA] = useState<AgentConfig>({
    ...initial,
    providers: initial.providers && initial.providers.length > 0
      ? initial.providers
      : (initial.provider ? [initial.provider] : []),
  });
  useLiveModels();
  const picks = a.providers ?? [];
  const togglePick = (p: string) => {
    const next = picks.includes(p) ? picks.filter((x) => x !== p) : [...picks, p];
    // Keep preferred provider valid — fall to first remaining when removed.
    const preferred = picks.includes(p) && a.provider === p
      ? (next[0] || "")
      : (a.provider || next[0] || "");
    setA({ ...a, providers: next, provider: preferred });
  };

  const inp = (
    k: keyof AgentConfig,
    type: "text" | "textarea" = "text",
    extra: { placeholder?: string; list?: string } = {},
  ) => {
    const Component = type === "text" ? "input" : "textarea";
    return (
      <Component
        {...extra}
        className="placeholder:text-[var(--muted)] placeholder:opacity-70 focus:outline-none focus:border-[var(--cedar-line)]"
        value={(a[k] as string) ?? ""}
        onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
          setA({ ...a, [k]: e.target.value })
        }
        rows={type === "textarea" ? 8 : undefined}
        style={{
          width: "100%",
          padding: "8px 10px",
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: 7,
          color: "var(--text)",
          fontSize: 13,
          fontFamily: type === "textarea" ? "var(--fm)" : "var(--fn)",
          resize: type === "textarea" ? "vertical" : undefined,
        }}
      />
    );
  };

  return (
    <CedarCard padding={20}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <h2 style={{ fontFamily: "var(--fd)", fontSize: 22, color: "var(--text)", margin: 0 }}>
          {isNew ? "New agent" : "Edit agent"}
        </h2>
        <div style={{ display: "flex", gap: 6 }}>
          <Btn size="sm" kind="outline" onClick={onCancel}>Cancel</Btn>
          <Btn size="sm" kind="solid" onClick={() => onSave(a)} disabled={!a.name.trim()}>Save</Btn>
        </div>
      </div>

      <Wrap label="Name">{inp("name")}</Wrap>
      <div style={{ height: 12 }} />
      <Wrap label="Compatible LLMs — click the star to set the preferred one">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
          {ALL_PROVIDERS.map((p) => {
            const checked = picks.includes(p);
            const installed = installedProviders.length === 0 || installedProviders.includes(p);
            const isPreferred = a.provider === p;
            return (
              <button
                key={p}
                type="button"
                onClick={() => togglePick(p)}
                disabled={!installed && !checked}
                title={installed ? "" : "Not installed"}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "5px 10px",
                  background: checked ? "var(--cedar-dim)" : "var(--bg)",
                  border: `1px solid ${checked ? "var(--cedar-line)" : "var(--border)"}`,
                  borderRadius: 7,
                  color: checked ? "var(--cedar-glow)" : (installed ? "var(--text)" : "var(--muted)"),
                  fontSize: 12,
                  fontFamily: "var(--fn)",
                  cursor: !installed && !checked ? "not-allowed" : "pointer",
                  opacity: !installed && !checked ? 0.5 : 1,
                }}
              >
                <span style={{
                  width: 12, height: 12, borderRadius: 3, display: "inline-flex",
                  alignItems: "center", justifyContent: "center", fontSize: 10,
                  background: checked ? "var(--cedar-glow)" : "transparent",
                  color: "var(--bg)",
                  border: checked ? "none" : "1px solid var(--border)",
                }}>{checked ? "✓" : ""}</span>
                {p}
                {checked && (
                  <span
                    role="button"
                    onClick={(e) => { e.stopPropagation(); setA({ ...a, provider: p }); }}
                    title={isPreferred ? "Preferred" : "Set as preferred"}
                    style={{
                      cursor: "pointer",
                      color: isPreferred ? "var(--dawn)" : "var(--muted)",
                      fontSize: 11,
                      marginLeft: 2,
                    }}
                  >
                    {isPreferred ? "★" : "☆"}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <div style={{ marginTop: 6, fontSize: 11, color: "var(--muted)" }}>
          The starred one is used by default when spawning a session with this agent.
        </div>
      </Wrap>
      <div style={{ height: 12 }} />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
        <Wrap label="Model">
          {inp("model", "text", {
            placeholder: `${PROVIDER_LABELS[a.provider || ""] ?? "Provider"} default`,
            list: "agent-model-options",
          })}
          {/* Suggestions come from the live per-provider catalog; any
              other model id the CLI accepts can still be typed. */}
          <datalist id="agent-model-options">
            {modelsForProvider(a.provider || undefined)
              .filter((m) => m.id)
              .map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
          </datalist>
        </Wrap>
        <Wrap label="Approval">
          <select
            value={a.approval_mode}
            onChange={(e) => setA({ ...a, approval_mode: e.target.value })}
            style={{
              width: "100%",
              padding: "8px 10px",
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: 7,
              color: "var(--text)",
              fontSize: 13,
              fontFamily: "var(--fn)",
            }}
          >
            {["normal", "trust_reads", "trust", "yolo"].map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </Wrap>
      </div>

      <Wrap label="Description">{inp("description")}</Wrap>
      <div style={{ height: 12 }} />
      <Wrap label="Work directory">{inp("work_dir", "text", { placeholder: "~/.arz/workspace/<session> when blank" })}</Wrap>
      <div style={{ height: 12 }} />
      <Wrap label="System prompt">{inp("system_prompt", "textarea")}</Wrap>
      <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8 }}>
        <input
          type="checkbox"
          checked={a.is_default}
          onChange={(e) => setA({ ...a, is_default: e.target.checked })}
        />
        <span style={{ fontSize: 12.5, color: "var(--text)" }}>Set as default agent</span>
      </div>
    </CedarCard>
  );
}

function Wrap({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div
        style={{
          fontSize: 10.5,
          color: "var(--muted)",
          fontFamily: "var(--fm)",
          textTransform: "uppercase",
          letterSpacing: ".12em",
          marginBottom: 5,
        }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}

// ── Left rail — search + Popular / All sections ──────────────
function AgentRail({
  agents,
  stats,
  activeName,
  onPick,
}: {
  agents: AgentConfig[];
  stats: Record<string, AgentStats>;
  activeName: string | null;
  onPick: (name: string) => void;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();

  const matches = (a: AgentConfig) =>
    !q ||
    a.name.toLowerCase().includes(q) ||
    a.description.toLowerCase().includes(q) ||
    effectiveProviders(a).some((p) => p.toLowerCase().includes(q));

  const popular = agents.filter((a) => a.popular && matches(a));
  const rest = agents.filter((a) => !a.popular && matches(a));
  const showPopularSection = popular.length > 0 && (!q || popular.length > 0);

  return (
    <CedarCard padding={0} style={{ display: "flex", flexDirection: "column", maxHeight: "70vh" }}>
      <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)" }}>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search agents…"
          style={{
            width: "100%",
            padding: "6px 10px",
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            color: "var(--text)",
            fontSize: 12.5,
            fontFamily: "var(--fn)",
          }}
        />
      </div>
      <div style={{ overflowY: "auto", flex: 1 }}>
        {showPopularSection && (
          <SectionHeader label={`Popular · ${popular.length}`} />
        )}
        {showPopularSection &&
          popular.map((a) => (
            <AgentRow key={a.name} a={a} stat={stats[a.name]} active={activeName === a.name} onPick={() => onPick(a.name)} />
          ))}
        {(rest.length > 0 || !showPopularSection) && (
          <SectionHeader label={`${q ? "Results" : "All agents"} · ${rest.length + (showPopularSection ? 0 : popular.length)}`} />
        )}
        {!showPopularSection &&
          popular.map((a) => (
            <AgentRow key={a.name} a={a} stat={stats[a.name]} active={activeName === a.name} onPick={() => onPick(a.name)} />
          ))}
        {rest.map((a) => (
          <AgentRow key={a.name} a={a} stat={stats[a.name]} active={activeName === a.name} onPick={() => onPick(a.name)} />
        ))}
        {popular.length === 0 && rest.length === 0 && (
          <div style={{ padding: 24, textAlign: "center", fontSize: 12.5, color: "var(--muted)" }}>
            {q ? `No agents match "${query}".` : "No agents yet."}
          </div>
        )}
      </div>
    </CedarCard>
  );
}

function SectionHeader({ label }: { label: string }) {
  return (
    <div
      style={{
        padding: "10px 14px 6px",
        fontFamily: "var(--fm)",
        fontSize: 10,
        color: "var(--muted)",
        textTransform: "uppercase",
        letterSpacing: ".14em",
        background: "var(--s2)",
        borderBottom: "1px solid var(--hairline)",
        position: "sticky",
        top: 0,
        zIndex: 1,
      }}
    >
      {label}
    </div>
  );
}

function AgentRow({
  a,
  stat,
  active,
  onPick,
}: {
  a: AgentConfig;
  stat?: AgentStats;
  active: boolean;
  onPick: () => void;
}) {
  return (
    <div
      onClick={onPick}
      style={{
        padding: "10px 14px",
        borderBottom: "1px solid var(--hairline)",
        cursor: "pointer",
        background: active ? "var(--cedar-dim)" : "transparent",
        borderLeft: `2px solid ${active ? "var(--cedar-glow)" : "transparent"}`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Bot size={13} style={{ color: "var(--cedar-2)", flexShrink: 0 }} />
        <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {a.name}
        </span>
        {a.is_default && <Star size={11} style={{ color: "var(--dawn)", fill: "var(--dawn)" }} />}
        {stat && stat.runs > 0 && (
          <span
            title={`${stat.runs} run${stat.runs === 1 ? "" : "s"} · ${stat.messages} msgs`}
            style={{
              fontSize: 10,
              fontFamily: "var(--fm)",
              color: "var(--muted)",
              padding: "1px 6px",
              border: "1px solid var(--border)",
              borderRadius: 999,
              flexShrink: 0,
            }}
          >
            {stat.runs}
          </span>
        )}
      </div>
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
        {a.description || a.provider}
      </div>
    </div>
  );
}
