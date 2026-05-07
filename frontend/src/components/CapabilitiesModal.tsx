import { useEffect, useState } from "react";
import { api } from "@/api/client";
import type { McpServer, PromptTemplate, ToolView } from "@/api/client";
import { Puzzle, Server, FileCode, Wrench, Plus, Trash2, Edit2, RefreshCw, AlertTriangle, Check, X, ToggleLeft, ToggleRight, Shield } from "lucide-react";
import SecondaryNav from "@/components/SecondaryNav";
import { PageShell, PageHeader } from "@/components/PageShell";

interface Props {
  onClose?: () => void;
  variant?: "modal" | "page";
}

type Tab = "mcp" | "prompts" | "tools" | "hooks";

export default function CapabilitiesModal({ onClose, variant = "modal" }: Props) {
  const handleClose = onClose ?? (() => {});
  const [tab, setTab] = useState<Tab>("mcp");

  useEffect(() => {
    if (variant !== "modal") return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") handleClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [variant]);

  const navItems = [
    { id: "mcp" as const,     label: "MCP Servers", icon: <Server size={13} /> },
    { id: "prompts" as const, label: "Prompts",     icon: <FileCode size={13} /> },
    { id: "tools" as const,   label: "Tools",       icon: <Wrench size={13} /> },
    { id: "hooks" as const,   label: "Hooks",       icon: <Shield size={13} /> },
  ];

  const tabBody = () => (
    <>
      {tab === "mcp" && <McpTab />}
      {tab === "prompts" && <PromptsTab />}
      {tab === "tools" && <ToolsTab />}
      {tab === "hooks" && <HooksTab />}
    </>
  );

  return (
    <PageShell variant={variant} maxWidth="max-w-4xl" onClose={handleClose}>
      {variant === "modal" && (
        <PageHeader icon={<Puzzle size={16} />} title="Capabilities" onClose={handleClose} />
      )}
      <div className="flex flex-1 min-h-0">
        <SecondaryNav<Tab>
          title={variant === "page" ? "Capabilities" : undefined}
          icon={variant === "page" ? <Puzzle size={16} /> : undefined}
          value={tab}
          onChange={setTab}
          items={navItems}
          widthClass={variant === "modal" ? "w-44" : "w-56"}
        />
        <div className="overflow-y-auto px-5 py-4 flex-1">{tabBody()}</div>
      </div>
    </PageShell>
  );
}

// ── MCP tab ──────────────────────────────────────────────────────────────────

function McpTab() {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showInstall, setShowInstall] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [installSource, setInstallSource] = useState("");
  const [installLog, setInstallLog] = useState("");

  const refresh = () =>
    api.listMcpServers().then(setServers).catch((e) => setError(String(e)));

  useEffect(() => { refresh(); }, []);

  const toggle = async (server: McpServer) => {
    try {
      const updated = await api.toggleMcpServer(server.source, server.name);
      setServers((prev) => prev.map((s) => s.name === server.name && s.source === server.source ? updated : s));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const removeArzServer = async (name: string) => {
    if (!confirm(`Remove '${name}' from arz registry (deletes the cloned dir)?`)) return;
    try {
      await api.deleteMcpRegistry(name);
      refresh();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  const runInstall = async () => {
    if (!installSource.trim()) return;
    setInstalling(true);
    setInstallLog(`$ install ${installSource}\n\n`);
    try {
      const res = await api.installMcp({
        source: installSource.trim(),
      });
      if (!res.ok) {
        const txt = await res.text();
        setInstallLog((l) => l + `\nerror: ${res.status} ${txt}\n`);
        return;
      }
      const reader = res.body?.getReader();
      if (!reader) return;
      const decoder = new TextDecoder();
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        setInstallLog((l) => l + decoder.decode(value, { stream: true }));
      }
      await refresh();
      setInstallSource("");
    } catch (e) {
      setInstallLog((l) => l + `\nerror: ${e instanceof Error ? e.message : String(e)}\n`);
    } finally {
      setInstalling(false);
    }
  };

  const grouped = servers.reduce<Record<string, McpServer[]>>((acc, s) => {
    (acc[s.source] ??= []).push(s);
    return acc;
  }, {});

  return (
    <div className="flex flex-col gap-4">
      {/* Install controls */}
      <div className="flex items-center justify-between">
        <div className="text-[12px] text-[var(--muted)]">
          Install an MCP server by pointing arz at a git repo, npm package, or local path.
        </div>
        {!showInstall && (
          <button
            onClick={() => setShowInstall(true)}
            className="flex items-center gap-1 px-3 py-1 rounded-md bg-[var(--cedar)] text-white text-[12px] hover:bg-[var(--cedar-lt)]"
          >
            <Plus size={11} /> Install MCP
          </button>
        )}
      </div>

      {showInstall && (
        <div className="border border-[var(--border)] rounded-lg p-3 bg-[var(--surface)] flex flex-col gap-2">
          <div className="text-[12px] font-semibold text-[var(--text)]">Install MCP server</div>
          <input
            value={installSource}
            onChange={(e) => setInstallSource(e.target.value)}
            placeholder="https://github.com/owner/mcp-server.git, npm:@scope/pkg, or /abs/path"
            disabled={installing}
            className="bg-[var(--bg)] border border-[var(--border)] rounded-md px-2 py-1.5 text-[12px] font-mono text-[var(--text)] focus:outline-none focus:border-[var(--cedar)]"
          />
          <div className="text-[10px] text-[var(--muted)]">
            Server name is taken from the source — the repo / package / directory name.
          </div>
          <div className="flex gap-2">
            <button
              onClick={runInstall}
              disabled={installing || !installSource.trim()}
              className="flex items-center gap-1 px-3 py-1 rounded-md bg-[var(--cedar)] text-white text-[12px] disabled:opacity-40"
            >
              {installing && <RefreshCw size={11} className="animate-spin" />}
              Install
            </button>
            <button onClick={() => { setShowInstall(false); setInstallLog(""); }} disabled={installing} className="text-[12px] text-[var(--muted)] hover:text-[var(--text)]">Cancel</button>
          </div>
          {installLog && (
            <pre className="bg-black/40 border border-[var(--border)] rounded p-2 text-[11px] font-mono text-[var(--text)] overflow-x-auto whitespace-pre-wrap max-h-[300px] overflow-y-auto">{installLog}</pre>
          )}
        </div>
      )}

      {Object.keys(grouped).length === 0 && !error && (
        <div className="text-center text-[var(--muted)]/60 text-[12px] py-10">
          No MCP servers configured yet. Click <strong>Install MCP</strong> above to add one.
        </div>
      )}
      {Object.entries(grouped).map(([source, list]) => (
        <div key={source}>
          <div className="text-[10px] uppercase tracking-wider text-[var(--muted)] mb-2">{source}</div>
          <div className="flex flex-col gap-2">
            {list.map((s) => (
              <div key={s.name} className={["flex items-start gap-3 border rounded-lg p-3 bg-[var(--surface)]", s.enabled ? "border-[var(--border)]" : "border-[var(--border)]/40 opacity-60"].join(" ")}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[13px] font-mono font-medium text-[var(--text)] truncate">{s.name}</span>
                    {!s.enabled && <span className="text-[10px] uppercase tracking-wider text-[var(--muted)] bg-[var(--bg)] px-1.5 py-0.5 rounded">disabled</span>}
                  </div>
                  <div className="text-[11px] font-mono text-[var(--muted)]/70 truncate">
                    {s.command} {s.args.join(" ")}
                  </div>
                  {Object.keys(s.env).length > 0 && (
                    <div className="text-[10px] font-mono text-[var(--muted)]/50 mt-1">env: {Object.keys(s.env).join(", ")}</div>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => toggle(s)}
                    title={s.enabled ? "Disable" : "Enable"}
                    className="text-[var(--muted)] hover:text-[var(--cedar)]"
                  >
                    {s.enabled ? <ToggleRight size={18} className="text-[var(--cedar)]" /> : <ToggleLeft size={18} />}
                  </button>
                  {source === "arz" && (
                    <button
                      onClick={() => removeArzServer(s.name)}
                      title="Remove"
                      className="text-[var(--muted)] hover:text-red-400"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
      {error && <div className="text-red-400 text-[11px] bg-red-900/20 rounded px-2 py-1">{error}</div>}
    </div>
  );
}

// ── Prompts tab ───────────────────────────────────────────────────────────────

function PromptsTab() {
  const [prompts, setPrompts] = useState<PromptTemplate[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editSlug, setEditSlug] = useState<string | null>(null);
  const [form, setForm] = useState({ title: "", body: "", tags: "" });

  const refresh = () => api.listPrompts().then(setPrompts).catch((e) => setError(String(e)));
  useEffect(() => { refresh(); }, []);

  const startCreate = () => {
    setForm({ title: "", body: "", tags: "" });
    setEditSlug(null);
    setCreating(true);
  };

  const startEdit = (p: PromptTemplate) => {
    setForm({ title: p.title, body: p.body, tags: p.tags.join(", ") });
    setEditSlug(p.slug);
    setCreating(true);
  };

  const cancel = () => { setCreating(false); setEditSlug(null); };

  const save = async () => {
    if (!form.title.trim() || !form.body.trim()) return;
    const tags = form.tags.split(",").map((t) => t.trim()).filter(Boolean);
    setError(null);
    try {
      if (editSlug) {
        await api.updatePrompt(editSlug, form.title, form.body, tags);
      } else {
        await api.createPrompt(form.title, form.body, tags);
      }
      setCreating(false);
      setEditSlug(null);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const del = async (slug: string) => {
    if (!confirm("Delete this prompt?")) return;
    try {
      await api.deletePrompt(slug);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-[12px] text-[var(--muted)]">{prompts.length} prompt{prompts.length !== 1 ? "s" : ""}</span>
        {!creating && (
          <button onClick={startCreate} className="flex items-center gap-1 px-3 py-1 rounded-md bg-[var(--cedar)] text-white text-[12px] hover:bg-[var(--cedar-lt)]">
            <Plus size={11} /> New prompt
          </button>
        )}
      </div>

      {creating && (
        <div className="border border-[var(--border)] rounded-lg p-3 bg-[var(--surface)] flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-semibold text-[var(--text)]">{editSlug ? "Edit prompt" : "New prompt"}</span>
            <button onClick={cancel} className="text-[var(--muted)] hover:text-[var(--text)]"><X size={13} /></button>
          </div>
          <input
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="Title"
            className="bg-[var(--bg)] border border-[var(--border)] rounded-md px-2 py-1.5 text-[13px] text-[var(--text)] focus:outline-none focus:border-[var(--cedar)]"
          />
          <textarea
            value={form.body}
            onChange={(e) => setForm({ ...form, body: e.target.value })}
            placeholder="Prompt body…"
            rows={5}
            className="bg-[var(--bg)] border border-[var(--border)] rounded-md px-2 py-1.5 text-[13px] text-[var(--text)] focus:outline-none focus:border-[var(--cedar)] resize-y"
          />
          <div className="flex gap-2">
            <input
              value={form.tags}
              onChange={(e) => setForm({ ...form, tags: e.target.value })}
              placeholder="tags, comma, separated"
              className="flex-1 bg-[var(--bg)] border border-[var(--border)] rounded-md px-2 py-1.5 text-[12px] text-[var(--text)] focus:outline-none focus:border-[var(--cedar)]"
            />
            <button
              onClick={save}
              disabled={!form.title.trim() || !form.body.trim()}
              className="flex items-center gap-1 px-3 py-1 rounded-md bg-[var(--cedar)] text-white text-[12px] disabled:opacity-40 hover:bg-[var(--cedar-lt)]"
            >
              <Check size={12} /> Save
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2">
        {prompts.length === 0 && !creating && (
          <div className="text-center text-[var(--muted)]/60 text-[12px] py-8">No prompts yet.</div>
        )}
        {prompts.map((p) => (
          <div key={p.slug} className="group flex items-start gap-3 border border-[var(--border)] rounded-lg p-3 bg-[var(--surface)]">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[13px] font-medium text-[var(--text)] truncate">{p.title}</span>
                <span className="text-[10px] font-mono text-[var(--muted)]/50">/{p.slug}</span>
              </div>
              <pre className="text-[12px] text-[var(--muted)] whitespace-pre-wrap break-words max-h-[80px] overflow-y-auto">{p.body}</pre>
              {p.tags.length > 0 && (
                <div className="flex gap-1 mt-1">
                  {p.tags.map((t) => (
                    <span key={t} className="text-[10px] font-mono text-[var(--cedar)] bg-[var(--cedar)]/10 px-1.5 py-0.5 rounded">{t}</span>
                  ))}
                </div>
              )}
            </div>
            <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100">
              <button onClick={() => startEdit(p)} className="p-1 rounded text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--bg)]"><Edit2 size={12} /></button>
              <button onClick={() => del(p.slug)} className="p-1 rounded text-[var(--muted)] hover:text-red-400 hover:bg-[var(--bg)]"><Trash2 size={12} /></button>
            </div>
          </div>
        ))}
      </div>
      {error && <div className="text-red-400 text-[11px] bg-red-900/20 rounded px-2 py-1">{error}</div>}
    </div>
  );
}

// ── Tools tab ─────────────────────────────────────────────────────────────────

function ToolsTab() {
  const [tools, setTools] = useState<ToolView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [reloading, setReloading] = useState(false);

  const refresh = () => api.listTools().then(setTools).catch((e) => setError(String(e)));
  useEffect(() => { refresh(); }, []);

  const reload = async () => {
    setReloading(true);
    setError(null);
    try {
      await api.reloadTools();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setReloading(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] text-[var(--muted)]">
          Drop Python files in <code className="text-[var(--cedar)]">~/.arz/tools/</code> — each declares <code>tool_spec</code> and <code>async run(input)</code>.
        </span>
        <button
          onClick={reload}
          disabled={reloading}
          className="flex items-center gap-1 px-3 py-1 rounded-md bg-[var(--cedar)] text-white text-[12px] disabled:opacity-40 hover:bg-[var(--cedar-lt)] shrink-0"
        >
          <RefreshCw size={11} className={reloading ? "animate-spin" : ""} /> Reload
        </button>
      </div>
      <div className="flex flex-col gap-2">
        {tools.length === 0 && (
          <div className="text-center text-[var(--muted)]/60 text-[12px] py-8">No tools loaded.</div>
        )}
        {tools.map((t) => (
          <div
            key={t.source_path}
            className={["border rounded-lg p-3 bg-[var(--surface)]", t.error ? "border-amber-400/40" : "border-[var(--border)]"].join(" ")}
          >
            <div className="flex items-center gap-2 mb-1">
              <Wrench size={12} className="text-[var(--cedar)]" />
              <span className="text-[13px] font-mono text-[var(--text)]">{t.name}</span>
              {t.error && <AlertTriangle size={11} className="text-amber-400" />}
              <span className="text-[10px] font-mono text-[var(--muted)]/60 truncate ml-auto">{t.source_path}</span>
            </div>
            <div className="text-[12px] text-[var(--muted)]">{t.description}</div>
            {t.error && (
              <pre className="mt-2 text-[10px] text-red-400 bg-red-900/10 rounded p-2 whitespace-pre-wrap overflow-x-auto">{t.error}</pre>
            )}
          </div>
        ))}
      </div>
      {error && <div className="text-red-400 text-[11px] bg-red-900/20 rounded px-2 py-1">{error}</div>}
    </div>
  );
}

// ── Hooks tab — auto-approve, auto-reply, deny ──────────────────────────────

function HooksTab() {
  const [autoApprove, setAutoApprove] = useState<string>("");
  const [autoReplies, setAutoReplies] = useState<{ pattern: string; reply: string }[]>([]);
  const [deny, setDeny] = useState<{ pattern: string; reason: string; severity?: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [savedFlag, setSavedFlag] = useState(0);
  const [saving, setSaving] = useState(false);

  const refresh = async () => {
    try {
      const h = await api.getHooks();
      setAutoApprove((h.auto_approve_tools || []).join(", "));
      setAutoReplies(h.auto_replies || []);
      setDeny(h.deny || []);
    } catch (e) { setError(String(e)); }
  };
  useEffect(() => { refresh(); }, []);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const tools = autoApprove.split(",").map((s) => s.trim()).filter(Boolean);
      await api.putHooks({ auto_approve_tools: tools, auto_replies: autoReplies, deny });
      setSavedFlag(Date.now());
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setSaving(false); }
  };

  const justSaved = Date.now() - savedFlag < 1500;

  return (
    <div className="flex flex-col gap-4">
      <div className="text-[12px] text-[var(--muted)]">
        Hooks customise tool approval and message handling. Stored in
        <code className="text-[var(--cedar)] ml-1">~/.arz/hooks.json</code>.
        Bundled deny patterns (rm -rf /, fork bombs, secret exfil, …) always apply.
      </div>

      <div>
        <label className="text-[10px] uppercase tracking-wider text-[var(--muted)] block mb-1">Auto-approve tools (comma-separated)</label>
        <input
          value={autoApprove}
          onChange={(e) => setAutoApprove(e.target.value)}
          placeholder="Read, Glob, Grep, WebSearch"
          className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-md px-2 py-1.5 text-[13px] text-[var(--text)] focus:outline-none focus:border-[var(--cedar)]"
        />
        <div className="text-[10px] text-[var(--muted)]/70 mt-1">Names listed here skip the permission prompt for any session.</div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-[10px] uppercase tracking-wider text-[var(--muted)]">Auto-replies</label>
          <button
            onClick={() => setAutoReplies([...autoReplies, { pattern: "", reply: "" }])}
            className="text-[11px] flex items-center gap-1 text-[var(--muted)] hover:text-[var(--text)]"
          >
            <Plus size={11} /> Add
          </button>
        </div>
        <div className="flex flex-col gap-1">
          {autoReplies.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                value={r.pattern}
                onChange={(e) => setAutoReplies(autoReplies.map((x, j) => j === i ? { ...x, pattern: e.target.value } : x))}
                placeholder="(?i)^ping$"
                className="flex-1 bg-[var(--bg)] border border-[var(--border)] rounded-md px-2 py-1 text-[12px] font-mono text-[var(--text)] focus:outline-none focus:border-[var(--cedar)]"
              />
              <input
                value={r.reply}
                onChange={(e) => setAutoReplies(autoReplies.map((x, j) => j === i ? { ...x, reply: e.target.value } : x))}
                placeholder="pong"
                className="flex-1 bg-[var(--bg)] border border-[var(--border)] rounded-md px-2 py-1 text-[12px] text-[var(--text)] focus:outline-none focus:border-[var(--cedar)]"
              />
              <button onClick={() => setAutoReplies(autoReplies.filter((_, j) => j !== i))} className="p-1 rounded text-[var(--muted)] hover:text-red-400">
                <Trash2 size={12} />
              </button>
            </div>
          ))}
          {autoReplies.length === 0 && <div className="text-[11px] text-[var(--muted)]/60">None.</div>}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-[10px] uppercase tracking-wider text-[var(--muted)]">Extra deny patterns (regex)</label>
          <button
            onClick={() => setDeny([...deny, { pattern: "", reason: "", severity: "warn" }])}
            className="text-[11px] flex items-center gap-1 text-[var(--muted)] hover:text-[var(--text)]"
          >
            <Plus size={11} /> Add
          </button>
        </div>
        <div className="flex flex-col gap-1">
          {deny.map((d, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                value={d.pattern}
                onChange={(e) => setDeny(deny.map((x, j) => j === i ? { ...x, pattern: e.target.value } : x))}
                placeholder="terraform.*destroy"
                className="flex-1 bg-[var(--bg)] border border-[var(--border)] rounded-md px-2 py-1 text-[12px] font-mono text-[var(--text)] focus:outline-none focus:border-[var(--cedar)]"
              />
              <input
                value={d.reason}
                onChange={(e) => setDeny(deny.map((x, j) => j === i ? { ...x, reason: e.target.value } : x))}
                placeholder="reason"
                className="flex-1 bg-[var(--bg)] border border-[var(--border)] rounded-md px-2 py-1 text-[12px] text-[var(--text)] focus:outline-none focus:border-[var(--cedar)]"
              />
              <select
                value={d.severity || "warn"}
                onChange={(e) => setDeny(deny.map((x, j) => j === i ? { ...x, severity: e.target.value } : x))}
                className="bg-[var(--bg)] border border-[var(--border)] rounded-md px-2 py-1 text-[11px] text-[var(--text)]"
              >
                <option value="warn">warn</option>
                <option value="block">block</option>
              </select>
              <button onClick={() => setDeny(deny.filter((_, j) => j !== i))} className="p-1 rounded text-[var(--muted)] hover:text-red-400">
                <Trash2 size={12} />
              </button>
            </div>
          ))}
          {deny.length === 0 && <div className="text-[11px] text-[var(--muted)]/60">None (defaults still apply).</div>}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button onClick={save} disabled={saving} className="flex items-center gap-1 px-4 py-1.5 rounded-md bg-[var(--cedar)] text-white text-[12px] disabled:opacity-40 hover:bg-[var(--cedar-lt)]">
          <Check size={11} /> Save
        </button>
        {justSaved && <span className="text-[10px] uppercase tracking-wider text-[var(--accent)] animate-pulse">saved</span>}
      </div>
      {error && <div className="text-red-400 text-[11px] bg-red-900/20 rounded px-2 py-1">{error}</div>}
    </div>
  );
}
