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
import { api, type AgentConfig } from "@/api/client";

export default function AgentsPage() {
  const [agents, setAgents] = useState<AgentConfig[]>([]);
  const [activeName, setActiveName] = useState<string | null>(null);
  const [editing, setEditing] = useState<AgentConfig | null>(null);
  const [creating, setCreating] = useState(false);

  const refresh = async () => {
    try {
      const data = await api.listAgents();
      setAgents(data);
      if (!activeName && data.length > 0) setActiveName(data[0].name);
    } catch {}
  };

  useEffect(() => {
    refresh();
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
      alert(`Failed: ${e}`);
    }
  };

  const remove = async (name: string) => {
    if (!confirm(`Delete agent "${name}"?`)) return;
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
        {/* Left rail */}
        <CedarCard padding={0}>
          <div
            style={{
              padding: "12px 14px",
              borderBottom: "1px solid var(--border)",
              fontFamily: "var(--fm)",
              fontSize: 10.5,
              color: "var(--muted)",
              textTransform: "uppercase",
              letterSpacing: ".12em",
            }}
          >
            All agents · {agents.length}
          </div>
          {agents.length === 0 && (
            <div style={{ padding: 24, textAlign: "center", fontSize: 12.5, color: "var(--muted)" }}>
              No agents yet.
            </div>
          )}
          {agents.map((a) => (
            <div
              key={a.name}
              onClick={() => { setActiveName(a.name); setEditing(null); }}
              style={{
                padding: "10px 14px",
                borderBottom: "1px solid var(--hairline)",
                cursor: "pointer",
                background: activeName === a.name ? "var(--cedar-dim)" : "transparent",
                borderLeft: `2px solid ${activeName === a.name ? "var(--cedar-glow)" : "transparent"}`,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Bot size={13} style={{ color: "var(--cedar-2)", flexShrink: 0 }} />
                <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {a.name}
                </span>
                {a.is_default && <Star size={11} style={{ color: "var(--dawn)", fill: "var(--dawn)" }} />}
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
          ))}
        </CedarCard>

        {/* Inspector */}
        {editing ? (
          <AgentEditor
            initial={editing}
            isNew={creating}
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

            <Field label="Provider" value={<Tag color="cedar">{active.provider}</Tag>} />
            <Field label="Model" value={<span style={{ fontFamily: "var(--fm)", fontSize: 12 }}>{active.model || "default"}</span>} />
            <Field label="Approval" value={<Tag color={active.approval_mode === "yolo" ? "ember" : active.approval_mode === "trust" ? "dawn" : "cedar"}>{active.approval_mode}</Tag>} />
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
              <Bot size={28} style={{ marginBottom: 12, color: "var(--text3)" }} />
              <div style={{ fontFamily: "var(--fd)", fontSize: 22, color: "var(--text)" }}>No agent selected</div>
              <div style={{ fontSize: 13, marginTop: 8 }}>Pick one on the left, or raise a new one.</div>
            </div>
          </CedarCard>
        )}
      </div>
    </CedarPage>
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
  onCancel,
  onSave,
}: {
  initial: AgentConfig;
  isNew: boolean;
  onCancel: () => void;
  onSave: (a: AgentConfig) => void;
}) {
  const [a, setA] = useState<AgentConfig>(initial);

  const inp = (k: keyof AgentConfig, type: "text" | "textarea" = "text") => {
    const Component = type === "text" ? "input" : "textarea";
    return (
      <Component
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

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
        <Wrap label="Name">{inp("name")}</Wrap>
        <Wrap label="Provider">
          <select
            value={a.provider}
            onChange={(e) => setA({ ...a, provider: e.target.value })}
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
            {["claude-code", "kiro-cli", "codex", "gemini", "ollama", "anthropic"].map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </Wrap>
        <Wrap label="Model">{inp("model")}</Wrap>
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
      <Wrap label="Work directory">{inp("work_dir")}</Wrap>
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
