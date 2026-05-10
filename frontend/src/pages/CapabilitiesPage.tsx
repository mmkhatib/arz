// Capabilities — MCP servers, prompts, builtin tools.
// Tabs across the top, then content.

import { useEffect, useRef, useState } from "react";
import { Wrench, Sparkles, Server, Plus, Loader2 } from "lucide-react";
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

type Tab = "mcp" | "prompts" | "tools";

export default function CapabilitiesPage() {
  const [tab, setTab] = useState<Tab>("mcp");
  const [mcps, setMcps] = useState<McpServer[]>([]);
  const [prompts, setPrompts] = useState<PromptTemplate[]>([]);
  const [tools, setTools] = useState<ToolView[]>([]);
  const [showInstall, setShowInstall] = useState(false);

  const refreshMcps = () => api.listMcpServers().then(setMcps).catch(() => {});

  useEffect(() => {
    refreshMcps();
    api.listPrompts().then(setPrompts).catch(() => {});
    api.listTools().then(setTools).catch(() => {});
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
            </>
          }
        />
      </div>
      <div style={{ padding: "24px 32px 32px" }}>
        {tab === "mcp" && (
          <McpView mcps={mcps} setMcps={setMcps} onAdd={() => setShowInstall(true)} />
        )}
        {tab === "prompts" && <PromptsView prompts={prompts} setPrompts={setPrompts} />}
        {tab === "tools" && <ToolsView tools={tools} />}
      </div>
      <InstallMcpModal
        open={showInstall}
        onClose={() => setShowInstall(false)}
        onInstalled={() => { refreshMcps(); }}
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
              <CedarCard key={`${m.source}-${m.name}`} padding={18} hoverable>
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
                      <div style={{ fontFamily: "var(--fd)", fontSize: 18, color: "var(--text)" }}>{m.name}</div>
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
                        mcp · {m.source}
                      </div>
                    </div>
                  </div>
                  <Toggle
                    on={m.enabled}
                    title={m.enabled ? "Disable" : "Enable"}
                    onClick={async () => {
                      try {
                        const updated = await api.toggleMcpServer(m.source, m.name);
                        setMcps(mcps.map((x) => (x.source === updated.source && x.name === updated.name ? updated : x)));
                      } catch {}
                    }}
                  />
                </div>
                <div style={{ fontSize: 12.5, color: "var(--text2)", marginTop: 12, lineHeight: 1.5, fontFamily: "var(--fm)" }}>
                  {m.command}
                </div>
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
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function PromptsView({ prompts, setPrompts }: { prompts: PromptTemplate[]; setPrompts: (p: PromptTemplate[]) => void }) {
  const [draft, setDraft] = useState({ title: "", body: "" });
  const submit = async () => {
    if (!draft.title.trim() || !draft.body.trim()) return;
    try {
      const created = await api.createPrompt(draft.title, draft.body);
      setPrompts([...prompts, created]);
      setDraft({ title: "", body: "" });
    } catch {}
  };
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1.1fr 1fr", gap: 18 }}>
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
        {prompts.length === 0 && <div style={{ fontSize: 12.5, color: "var(--muted)" }}>None yet.</div>}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
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
              <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text)" }}>{p.title}</div>
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
          New prompt
        </div>
        <input
          value={draft.title}
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          placeholder="Title"
          style={{
            width: "100%",
            padding: "8px 10px",
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: 7,
            color: "var(--text)",
            fontSize: 13,
            fontFamily: "var(--fn)",
            marginBottom: 10,
          }}
        />
        <textarea
          value={draft.body}
          onChange={(e) => setDraft({ ...draft, body: e.target.value })}
          placeholder="Prompt body…"
          rows={8}
          style={{
            width: "100%",
            padding: "10px",
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: 7,
            color: "var(--text)",
            fontSize: 13,
            fontFamily: "var(--fn)",
            resize: "vertical",
          }}
        />
        <div style={{ marginTop: 10, display: "flex", justifyContent: "flex-end" }}>
          <Btn kind="solid" icon={<Sparkles size={13} />} onClick={submit} disabled={!draft.title.trim() || !draft.body.trim()}>
            Save
          </Btn>
        </div>
      </CedarCard>
    </div>
  );
}

function ToolsView({ tools }: { tools: ToolView[] }) {
  if (tools.length === 0) {
    return <Empty title="No tools loaded" sub="Builtin tools live under src/arz/tools/." icon={<Wrench size={28} />} />;
  }
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
      {tools.map((t) => (
        <CedarCard key={t.name} padding={14}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <Wrench size={13} style={{ color: "var(--cedar-2)" }} />
            <span style={{ fontSize: 12.5, fontWeight: 500, color: "var(--text)" }}>{t.name}</span>
          </div>
          <div style={{ fontSize: 11.5, color: "var(--text3)", lineHeight: 1.5 }}>
            {t.description?.slice(0, 140) || "—"}
          </div>
        </CedarCard>
      ))}
    </div>
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
