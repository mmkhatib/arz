// Capabilities — MCP servers, prompts, builtin tools.
// Tabs across the top, then content.

import { useEffect, useRef, useState } from "react";
import { Wrench, Sparkles, Server, Plus, Loader2, RefreshCw, Trash2, Play, Pencil, ExternalLink } from "lucide-react";
import {
  CedarPage,
  CedarPageHeader,
  CedarCard,
  CedarModal,
  CedarInput,
  CedarTextArea,
  CedarLabel,
  Btn,
  Tag,
  SegSeg,
  Toggle,
  TopoLines,
} from "@/components/CedarUI";
import { api, type McpServer, type PromptTemplate, type ToolView } from "@/api/client";
import { useDialog } from "@/components/Dialog";

type Tab = "mcp" | "prompts" | "tools";

export default function CapabilitiesPage() {
  const [tab, setTab] = useState<Tab>("mcp");
  const [mcps, setMcps] = useState<McpServer[]>([]);
  const [prompts, setPrompts] = useState<PromptTemplate[]>([]);
  const [tools, setTools] = useState<ToolView[]>([]);
  const [showInstall, setShowInstall] = useState(false);
  const [showNewPrompt, setShowNewPrompt] = useState(false);
  const [editingTool, setEditingTool] = useState<{ name: string; isNew: boolean } | null>(null);

  const refreshMcps = () => api.listMcpServers().then(setMcps).catch(() => {});
  const refreshTools = () => api.listTools().then(setTools).catch(() => {});
  const refreshPrompts = () => api.listPrompts().then(setPrompts).catch(() => {});

  useEffect(() => {
    refreshMcps();
    refreshPrompts();
    refreshTools();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <CedarPage>
      <div style={{ position: "relative", overflow: "hidden" }}>
        <TopoLines height={120} opacity={0.5} />
        <CedarPageHeader
          eyebrow="powers + tools"
          title={
            <>
              The <em style={{ fontStyle: "italic", color: "var(--cedar-glow)" }}>capabilities</em> of the grove.
            </>
          }
          sub={`${mcps.length} MCP servers · ${prompts.length} saved prompts · ${tools.length} builtin tools`}
          right={
            <>
              <SegSeg<Tab>
                value={tab}
                onChange={setTab}
                options={[
                  { value: "mcp", label: "MCP" },
                  { value: "prompts", label: "Prompts" },
                  { value: "tools", label: "Tools" },
                ]}
              />
              {tab === "mcp" && (
                <Btn kind="solid" icon={<Plus size={13} />} onClick={() => setShowInstall(true)}>
                  Install MCP
                </Btn>
              )}
              {tab === "prompts" && (
                <Btn kind="solid" icon={<Plus size={13} />} onClick={() => setShowNewPrompt(true)}>
                  New prompt
                </Btn>
              )}
              {tab === "tools" && (
                <>
                  <Btn
                    kind="soft"
                    icon={<RefreshCw size={12} />}
                    onClick={async () => {
                      await api.reloadTools();
                      refreshTools();
                    }}
                    title="Re-scan ~/.arz/tools/"
                  >
                    Reload
                  </Btn>
                  <Btn
                    kind="solid"
                    icon={<Plus size={13} />}
                    onClick={() => setEditingTool({ name: "", isNew: true })}
                  >
                    New tool
                  </Btn>
                </>
              )}
            </>
          }
        />
      </div>
      <div style={{ padding: "24px 32px 32px" }}>
        {tab === "mcp" && (
          <McpView mcps={mcps} setMcps={setMcps} onAdd={() => setShowInstall(true)} />
        )}
        {tab === "prompts" && (
          <PromptsView
            prompts={prompts}
            setPrompts={setPrompts}
            showNew={showNewPrompt}
            closeNew={() => setShowNewPrompt(false)}
          />
        )}
        {tab === "tools" && (
          <ToolsView tools={tools} onEdit={(name) => setEditingTool({ name, isNew: false })} />
        )}
      </div>
      <InstallMcpModal
        open={showInstall}
        onClose={() => setShowInstall(false)}
        onInstalled={() => { refreshMcps(); }}
      />
      <ToolEditorModal
        open={editingTool !== null}
        initialName={editingTool?.name ?? ""}
        isNew={editingTool?.isNew ?? true}
        onClose={() => setEditingTool(null)}
        onSaved={() => { refreshTools(); setEditingTool(null); }}
        onDeleted={() => { refreshTools(); setEditingTool(null); }}
      />
    </CedarPage>
  );
}

function McpView({
  mcps,
  setMcps,
  onAdd,
}: {
  mcps: McpServer[];
  setMcps: (m: McpServer[]) => void;
  onAdd: () => void;
}) {
  if (mcps.length === 0) {
    return (
      <CedarCard padding={48}>
        <div style={{ textAlign: "center", color: "var(--muted)" }}>
          <Server size={28} style={{ marginBottom: 12, color: "var(--text3)" }} />
          <div style={{ fontFamily: "var(--fd)", fontSize: 22, color: "var(--text)" }}>
            No MCP servers yet.
          </div>
          <div style={{ fontSize: 13, marginTop: 8, marginBottom: 14 }}>
            Install one from a git URL, an npm package, or a local path.
          </div>
          <Btn kind="solid" icon={<Plus size={13} />} onClick={onAdd}>
            Install MCP
          </Btn>
        </div>
      </CedarCard>
    );
  }
  const grouped: Record<string, McpServer[]> = {};
  for (const m of mcps) (grouped[m.source] ||= []).push(m);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {Object.entries(grouped).map(([source, items]) => (
        <section key={source}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              marginBottom: 10,
              fontFamily: "var(--fm)",
              fontSize: 10.5,
              color: "var(--muted)",
              textTransform: "uppercase",
              letterSpacing: ".14em",
            }}
          >
            <span style={{ width: 16, height: 1, background: "var(--cedar-glow)" }} />
            {source}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 12 }}>
            {items.map((m) => (
              <McpCard
                key={`${m.source}-${m.name}`}
                m={m}
                onToggled={(updated) =>
                  setMcps(mcps.map((x) => (x.source === updated.source && x.name === updated.name ? updated : x)))
                }
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function McpCard({ m, onToggled }: { m: McpServer; onToggled: (updated: McpServer) => void }) {
  const [busy, setBusy] = useState(false);
  const dim = !m.enabled;
  return (
    <CedarCard
      padding={18}
      hoverable
      style={{
        opacity: dim ? 0.55 : 1,
        filter: dim ? "saturate(0.3)" : undefined,
        transition: "opacity .15s, filter .15s",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 8,
              background: "var(--cedar-dim)",
              border: "1px solid var(--cedar-line)",
              color: "var(--cedar-glow)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <Server size={16} />
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontFamily: "var(--fd)", fontSize: 18, color: "var(--text)" }}>{m.name}</span>
              {m.source_url && (
                <a
                  href={m.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={`Open ${m.source_url}`}
                  style={{ color: "var(--muted)", display: "inline-flex", alignItems: "center" }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <ExternalLink size={12} />
                </a>
              )}
            </div>
            <div
              style={{
                fontSize: 10.5,
                color: "var(--muted)",
                fontFamily: "var(--fm)",
                textTransform: "uppercase",
                letterSpacing: ".08em",
                marginTop: 2,
              }}
            >
              mcp · {m.source}{!m.enabled && " · disabled"}
            </div>
          </div>
        </div>
        <Toggle
          on={m.enabled}
          title={m.enabled ? "Disable" : "Enable"}
          onClick={async () => {
            if (busy) return;
            setBusy(true);
            try {
              const updated = await api.toggleMcpServer(m.source, m.name);
              onToggled(updated);
            } catch {} finally {
              setBusy(false);
            }
          }}
        />
      </div>
      {m.description && (
        <div style={{ fontSize: 12.5, color: "var(--text2)", marginTop: 10, lineHeight: 1.45 }}>
          {m.description}
        </div>
      )}
      {m.command && (
        <div
          style={{
            fontSize: 11.5,
            color: "var(--text3)",
            marginTop: 10,
            lineHeight: 1.45,
            fontFamily: "var(--fm)",
            wordBreak: "break-all",
          }}
        >
          <span style={{ color: "var(--muted)" }}>$ </span>{m.command}
        </div>
      )}
      {m.args.length > 0 && (
        <div
          style={{
            display: "flex",
            gap: 4,
            flexWrap: "wrap",
            marginTop: 12,
            paddingTop: 12,
            borderTop: "1px solid var(--hairline)",
          }}
        >
          {m.args.slice(0, 5).map((a, i) => (
            <Tag key={i} color="muted">{a}</Tag>
          ))}
        </div>
      )}
    </CedarCard>
  );
}

function PromptsView({
  prompts,
  setPrompts,
  showNew,
  closeNew,
}: {
  prompts: PromptTemplate[];
  setPrompts: (p: PromptTemplate[]) => void;
  showNew: boolean;
  closeNew: () => void;
}) {
  const dialog = useDialog();
  const [draft, setDraft] = useState({ title: "", body: "" });
  useEffect(() => { if (!showNew) setDraft({ title: "", body: "" }); }, [showNew]);
  const submit = async () => {
    if (!draft.title.trim() || !draft.body.trim()) return;
    try {
      const created = await api.createPrompt(draft.title, draft.body);
      setPrompts([...prompts, created]);
      closeNew();
    } catch {}
  };
  return (
    <>
      <CedarCard padding={18}>
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
          Saved prompts ({prompts.length})
        </div>
        {prompts.length === 0 && (
          <div style={{ fontSize: 12.5, color: "var(--muted)" }}>None yet — click “New prompt”.</div>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 10 }}>
          {prompts.map((p) => (
            <div
              key={p.slug}
              style={{
                padding: 12,
                border: "1px solid var(--border)",
                borderRadius: 8,
                background: "var(--surface)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text)" }}>{p.title}</div>
                <Btn
                  size="sm"
                  kind="ghost"
                  icon={<Trash2 size={11} />}
                  title="Delete prompt"
                  onClick={async () => {
                    const ok = await dialog.confirm({
                      title: `Delete prompt "${p.title}"?`,
                      tone: "danger",
                    });
                    if (!ok) return;
                    try {
                      await api.deletePrompt(p.slug);
                      setPrompts(prompts.filter((x) => x.slug !== p.slug));
                    } catch {}
                  }}
                />
              </div>
              <div
                style={{
                  fontSize: 11.5,
                  color: "var(--text3)",
                  marginTop: 4,
                  whiteSpace: "pre-wrap",
                  maxHeight: 80,
                  overflow: "hidden",
                }}
              >
                {p.body}
              </div>
              {p.tags?.length ? (
                <div style={{ display: "flex", gap: 4, marginTop: 8 }}>
                  {p.tags.map((t) => <Tag key={t} color="muted">{t}</Tag>)}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </CedarCard>
      <CedarModal
        open={showNew}
        onClose={closeNew}
        width={640}
        eyebrow="new prompt"
        title="Save a reusable prompt."
        footer={
          <>
            <Btn kind="ghost" onClick={closeNew}>Cancel</Btn>
            <Btn kind="solid" icon={<Sparkles size={13} />} onClick={submit} disabled={!draft.title.trim() || !draft.body.trim()}>
              Save prompt
            </Btn>
          </>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <CedarLabel>Title</CedarLabel>
            <CedarInput
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              placeholder="Short, memorable name"
              autoFocus
            />
          </div>
          <div>
            <CedarLabel>Body</CedarLabel>
            <CedarTextArea
              value={draft.body}
              onChange={(e) => setDraft({ ...draft, body: e.target.value })}
              placeholder="Prompt body…"
              rows={10}
            />
          </div>
        </div>
      </CedarModal>
    </>
  );
}

function ToolsView({ tools, onEdit }: { tools: ToolView[]; onEdit: (name: string) => void }) {
  if (tools.length === 0) {
    return <Empty title="No tools loaded" sub='Click "New tool" to write one. Tools live in ~/.arz/tools/.' icon={<Wrench size={28} />} />;
  }
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
        gap: 14,
      }}
    >
      {tools.map((t) => {
        const props = (t.input_schema?.properties ?? {}) as Record<string, unknown>;
        const propNames = Object.keys(props);
        const hasError = !!t.error;
        return (
          <CedarCard
            key={t.name}
            padding={18}
            hoverable
            onClick={() => onEdit(t.name)}
            style={{ position: "relative", overflow: "hidden", cursor: "pointer" }}
          >
            {/* Header — icon tile + name + kind row + Toggle/Pencil */}
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                justifyContent: "space-between",
                gap: 10,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 8,
                    background: hasError ? "rgba(180, 70, 70, 0.18)" : "var(--cedar-dim)",
                    border: `1px solid ${hasError ? "var(--ember)" : "var(--cedar-line)"}`,
                    color: hasError ? "var(--ember)" : "var(--cedar-glow)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  <Wrench size={16} />
                </div>
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontFamily: "var(--fd)",
                      fontSize: 18,
                      color: "var(--text)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {t.name}
                  </div>
                  <div
                    style={{
                      fontSize: 10.5,
                      color: "var(--muted)",
                      fontFamily: "var(--fm)",
                      textTransform: "uppercase",
                      letterSpacing: ".08em",
                      marginTop: 2,
                    }}
                  >
                    builtin · {propNames.length} input{propNames.length === 1 ? "" : "s"}
                  </div>
                </div>
              </div>
              <Pencil
                size={13}
                style={{ color: "var(--text3)", flexShrink: 0, marginTop: 2 }}
              />
            </div>

            {/* Description */}
            <div
              style={{
                fontSize: 12.5,
                color: "var(--text2)",
                marginTop: 12,
                lineHeight: 1.55,
                display: "-webkit-box",
                WebkitLineClamp: 3,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {t.description || <span style={{ color: "var(--muted)" }}>No description.</span>}
            </div>

            {/* Input-schema chips along the bottom */}
            <div
              style={{
                display: "flex",
                gap: 4,
                flexWrap: "wrap",
                marginTop: 12,
                paddingTop: 12,
                borderTop: "1px solid var(--hairline)",
              }}
            >
              {propNames.length === 0 && (
                <span style={{ fontSize: 11, color: "var(--muted)", fontFamily: "var(--fm)" }}>
                  no parameters
                </span>
              )}
              {propNames.slice(0, 5).map((p) => (
                <Tag key={p} color="muted">{p}</Tag>
              ))}
              {propNames.length > 5 && (
                <Tag color="muted">+{propNames.length - 5}</Tag>
              )}
            </div>

            {hasError && (
              <div
                style={{
                  marginTop: 10,
                  fontSize: 11,
                  color: "var(--ember)",
                  fontFamily: "var(--fm)",
                }}
              >
                load error — click to fix
              </div>
            )}
          </CedarCard>
        );
      })}
    </div>
  );
}

function ToolEditorModal({
  open,
  initialName,
  isNew,
  onClose,
  onSaved,
  onDeleted,
}: {
  open: boolean;
  initialName: string;
  isNew: boolean;
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => void;
}) {
  const dialog = useDialog();
  const [name, setName] = useState(initialName);
  const [source, setSource] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [testInput, setTestInput] = useState("{}");
  const [testOut, setTestOut] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(initialName);
    setErr(null);
    setTestOut(null);
    setTestInput("{}");
    if (isNew || !initialName) {
      setSource("");
      return;
    }
    api.getToolSource(initialName).then((r) => setSource(r.source)).catch((e) => setErr(String(e)));
  }, [open, initialName, isNew]);

  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      if (isNew) {
        if (!name.trim()) { setErr("name required"); return; }
        await api.createTool(name.trim(), source || undefined);
      } else {
        await api.putToolSource(name, source);
      }
      onSaved();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setTestOut(null);
    setErr(null);
    let payload: Record<string, unknown> = {};
    try { payload = JSON.parse(testInput || "{}"); } catch (e) { setErr(`bad JSON: ${e}`); return; }
    try {
      const r = await api.invokeTool(name, payload);
      setTestOut(r.result);
    } catch (e) {
      setErr(String(e));
    }
  };

  const del = async () => {
    const ok = await dialog.confirm({
      title: `Delete tool "${name}"?`,
      body: "File will be removed from ~/.arz/tools/.",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await api.deleteTool(name);
      onDeleted();
    } catch (e) {
      setErr(String(e));
    }
  };

  return (
    <CedarModal
      open={open}
      onClose={onClose}
      width={780}
      eyebrow={isNew ? "new tool" : "edit tool"}
      title={
        <>
          {isNew ? "Author a new " : "Edit "}
          <em style={{ fontStyle: "italic", color: "var(--cedar-glow)" }}>Python tool</em>.
        </>
      }
      footer={
        <>
          {!isNew && (
            <Btn kind="danger" icon={<Trash2 size={11} />} onClick={del} disabled={busy}>
              Delete
            </Btn>
          )}
          <Btn kind="ghost" onClick={onClose} disabled={busy}>Cancel</Btn>
          <Btn kind="solid" onClick={save} disabled={busy || (isNew && !name.trim())}>
            {busy ? <><Loader2 size={11} className="animate-spin" /> Saving…</> : "Save + reload"}
          </Btn>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div>
          <CedarLabel>Tool name</CedarLabel>
          <CedarInput
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="lowercase_with_underscores"
            disabled={!isNew}
          />
          <div style={{ fontSize: 10.5, color: "var(--muted)", fontFamily: "var(--fm)", marginTop: 4 }}>
            Saved as <code>~/.arz/tools/{name || "<name>"}.py</code>. Must define <code>tool_spec</code> dict and <code>async def run(input)</code>.
          </div>
        </div>
        <div>
          <CedarLabel>Source</CedarLabel>
          <textarea
            value={source}
            onChange={(e) => setSource(e.target.value)}
            spellCheck={false}
            rows={18}
            style={{
              width: "100%",
              padding: 12,
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              color: "var(--text)",
              fontSize: 12,
              fontFamily: "var(--fm)",
              lineHeight: 1.55,
              resize: "vertical",
              tabSize: 4,
            }}
            placeholder={isNew ? "Leave empty to start from template…" : ""}
          />
        </div>
        {!isNew && (
          <div style={{ borderTop: "1px solid var(--hairline)", paddingTop: 12 }}>
            <CedarLabel>Quick test — input JSON</CedarLabel>
            <div style={{ display: "flex", gap: 8 }}>
              <CedarInput
                value={testInput}
                onChange={(e) => setTestInput(e.target.value)}
                placeholder='{"query": "hello"}'
                style={{ flex: 1, fontFamily: "var(--fm)" }}
              />
              <Btn kind="soft" icon={<Play size={11} />} onClick={test} disabled={busy}>
                Run
              </Btn>
            </div>
            {testOut !== null && (
              <pre
                style={{
                  marginTop: 8,
                  background: "var(--bg)",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  padding: 10,
                  fontFamily: "var(--fm)",
                  fontSize: 11.5,
                  color: "var(--text2)",
                  whiteSpace: "pre-wrap",
                  maxHeight: 180,
                  overflowY: "auto",
                }}
              >
                {testOut}
              </pre>
            )}
          </div>
        )}
        {err && (
          <div style={{ fontSize: 11.5, color: "#e88", fontFamily: "var(--fm)" }}>
            {err}
          </div>
        )}
      </div>
    </CedarModal>
  );
}

function Empty({ title, sub, icon }: { title: string; sub: string; icon: React.ReactNode }) {
  return (
    <CedarCard padding={48}>
      <div style={{ textAlign: "center", color: "var(--muted)" }}>
        <div style={{ marginBottom: 12, color: "var(--text3)" }}>{icon}</div>
        <div style={{ fontFamily: "var(--fd)", fontSize: 22, color: "var(--text)" }}>{title}</div>
        <div style={{ fontSize: 13, marginTop: 8 }}>{sub}</div>
      </div>
    </CedarCard>
  );
}

// ── Install MCP modal ────────────────────────────────────────
function InstallMcpModal({
  open,
  onClose,
  onInstalled,
}: {
  open: boolean;
  onClose: () => void;
  onInstalled: () => void;
}) {
  const [source, setSource] = useState("");
  const [description, setDescription] = useState("");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [env, setEnv] = useState("");
  const [installing, setInstalling] = useState(false);
  const [log, setLog] = useState("");
  const [done, setDone] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!open) {
      setSource("");
      setDescription("");
      setCommand("");
      setArgs("");
      setEnv("");
      setInstalling(false);
      setLog("");
      setDone(false);
      abortRef.current?.abort();
      abortRef.current = null;
    }
  }, [open]);

  const start = async () => {
    const src = source.trim();
    if (!src) {
      setLog("error: source required\n");
      return;
    }
    let envObj: Record<string, string> = {};
    if (env.trim()) {
      try {
        envObj = JSON.parse(env);
        if (typeof envObj !== "object" || Array.isArray(envObj)) throw new Error("env must be a JSON object");
      } catch (e) {
        setLog(`error parsing env JSON: ${e}\n`);
        return;
      }
    }
    setInstalling(true);
    setDone(false);
    setLog(`$ install ${src}\n\n`);
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    try {
      const res = await api.installMcp(
        {
          source: src,
          description: description.trim() || undefined,
          command: command.trim() || undefined,
          args: args.trim() ? args.split(/\s+/) : undefined,
          env: envObj,
        },
        abortRef.current.signal,
      );
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        setLog((l) => l + `\nerror: ${res.status} ${txt}\n`);
        return;
      }
      const reader = res.body?.getReader();
      if (!reader) return;
      const decoder = new TextDecoder();
      while (true) {
        const { value, done: rdone } = await reader.read();
        if (rdone) break;
        setLog((l) => l + decoder.decode(value, { stream: true }));
      }
      setDone(true);
      onInstalled();
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        setLog((l) => l + `\nerror: ${e}\n`);
      }
    } finally {
      setInstalling(false);
    }
  };

  const cancel = () => {
    abortRef.current?.abort();
    setInstalling(false);
  };

  return (
    <CedarModal
      open={open}
      onClose={onClose}
      width={680}
      eyebrow="install mcp"
      title={
        <>
          Pull in a new <em style={{ fontStyle: "italic", color: "var(--cedar-glow)" }}>MCP server</em>.
        </>
      }
      footer={
        <>
          {installing ? (
            <Btn kind="danger" onClick={cancel}>Cancel install</Btn>
          ) : (
            <Btn kind="ghost" onClick={onClose}>{done ? "Close" : "Cancel"}</Btn>
          )}
          {!done && (
            <Btn kind="solid" onClick={start} disabled={installing || !source.trim()}>
              {installing ? (
                <>
                  <Loader2 size={11} className="animate-spin" /> Installing…
                </>
              ) : (
                "Install"
              )}
            </Btn>
          )}
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <CedarLabel>Source</CedarLabel>
          <CedarInput
            value={source}
            onChange={(e) => setSource(e.target.value)}
            placeholder="https://github.com/owner/repo  •  npm:@scope/pkg  •  /abs/path"
            autoFocus
            disabled={installing}
          />
          <div style={{ fontSize: 10.5, color: "var(--muted)", fontFamily: "var(--fm)", marginTop: 4 }}>
            Git URL clones + installs deps · npm: installs globally · local path is registered as-is.
          </div>
        </div>
        <div>
          <CedarLabel>Description (optional)</CedarLabel>
          <CedarInput
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What this MCP exposes — shows up on the card"
            disabled={installing}
          />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <div>
            <CedarLabel>Launch command (optional)</CedarLabel>
            <CedarInput
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder="npx · uv · python · …"
              disabled={installing}
            />
          </div>
          <div>
            <CedarLabel>Args (space separated)</CedarLabel>
            <CedarInput
              value={args}
              onChange={(e) => setArgs(e.target.value)}
              placeholder="-y @owner/server"
              disabled={installing}
            />
          </div>
        </div>
        <div>
          <CedarLabel>Env (JSON object, optional)</CedarLabel>
          <CedarTextArea
            value={env}
            onChange={(e) => setEnv(e.target.value)}
            placeholder='{"GITHUB_TOKEN": "ghp_…"}'
            rows={3}
            style={{ fontFamily: "var(--fm)", fontSize: 12 }}
            disabled={installing}
          />
        </div>
        {log && (
          <div>
            <CedarLabel>Output</CedarLabel>
            <pre
              style={{
                background: "var(--bg)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                padding: "10px 12px",
                fontFamily: "var(--fm)",
                fontSize: 11.5,
                color: "var(--text2)",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                maxHeight: 280,
                overflowY: "auto",
                margin: 0,
              }}
            >
              {log}
            </pre>
          </div>
        )}
        {done && (
          <div
            style={{
              fontSize: 12,
              color: "var(--cedar-glow)",
              background: "var(--cedar-dim)",
              border: "1px solid var(--cedar-line)",
              borderRadius: 6,
              padding: "8px 10px",
            }}
          >
            ✓ Server installed and registered. It will appear in the MCP list.
          </div>
        )}
      </div>
    </CedarModal>
  );
}
