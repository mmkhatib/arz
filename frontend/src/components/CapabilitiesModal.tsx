import { useEffect, useState } from "react";
import { api } from "@/api/client";
import type { McpServer, PromptTemplate, ToolView } from "@/api/client";
import { Puzzle, Server, FileCode, Wrench, Plus, Trash2, Edit2, RefreshCw, AlertTriangle, Check, X, ToggleLeft, ToggleRight } from "lucide-react";

interface Props {
  onClose?: () => void;
  variant?: "modal" | "page";
}

type Tab = "mcp" | "prompts" | "tools";

export default function CapabilitiesModal({ onClose, variant = "modal" }: Props) {
  const handleClose = onClose ?? (() => {});
  const [tab, setTab] = useState<Tab>("mcp");

  useEffect(() => {
    if (variant !== "modal") return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") handleClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [variant]);

  const header = (
    <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-[var(--border)]">
      <div className="flex items-center gap-2">
        <Puzzle size={16} className="text-[var(--cedar)]" />
        <h2 className="text-[15px] font-semibold text-[var(--text)]">Capabilities</h2>
      </div>
      {variant === "modal" && (
        <button onClick={handleClose} className="text-[var(--muted)] hover:text-[var(--text)] text-xl leading-none">×</button>
      )}
    </div>
  );

  const tabs = (
    <div className="flex border-b border-[var(--border)] px-3">
      <TabBtn icon={<Server size={13} />} label="MCP Servers" active={tab === "mcp"} onClick={() => setTab("mcp")} />
      <TabBtn icon={<FileCode size={13} />} label="Prompts" active={tab === "prompts"} onClick={() => setTab("prompts")} />
      <TabBtn icon={<Wrench size={13} />} label="Tools" active={tab === "tools"} onClick={() => setTab("tools")} />
    </div>
  );

  const body = (
    <div className="overflow-y-auto px-5 py-4 flex-1">
      {tab === "mcp" && <McpTab />}
      {tab === "prompts" && <PromptsTab />}
      {tab === "tools" && <ToolsTab />}
    </div>
  );

  if (variant === "page") {
    return (
      <div className="flex flex-col h-full bg-[var(--bg)] min-w-0 flex-1 overflow-hidden">
        {header}
        {tabs}
        {body}
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
    >
      <div className="bg-[var(--bg)] border border-[var(--border)] rounded-2xl shadow-2xl w-full max-w-3xl mx-4 max-h-[88vh] flex flex-col">
        {header}
        {tabs}
        {body}
      </div>
    </div>
  );
}

function TabBtn({ icon, label, active, onClick }: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={["flex items-center gap-1.5 px-4 py-2 text-[12px] border-b-2 transition-colors", active ? "border-[var(--cedar)] text-[var(--text)]" : "border-transparent text-[var(--muted)] hover:text-[var(--text)]"].join(" ")}
    >
      {icon}{label}
    </button>
  );
}

// ── MCP tab ──────────────────────────────────────────────────────────────────

function McpTab() {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [error, setError] = useState<string | null>(null);

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

  const grouped = servers.reduce<Record<string, McpServer[]>>((acc, s) => {
    (acc[s.source] ??= []).push(s);
    return acc;
  }, {});

  return (
    <div className="flex flex-col gap-4">
      {Object.keys(grouped).length === 0 && !error && (
        <div className="text-center text-[var(--muted)]/60 text-[12px] py-10">
          No MCP servers found. Add servers to <code className="text-[var(--cedar)]">~/.claude/mcp.json</code> or <code className="text-[var(--cedar)]">~/.kiro/mcp.json</code>.
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
                <button
                  onClick={() => toggle(s)}
                  title={s.enabled ? "Disable" : "Enable"}
                  className="shrink-0 text-[var(--muted)] hover:text-[var(--cedar)]"
                >
                  {s.enabled ? <ToggleRight size={18} className="text-[var(--cedar)]" /> : <ToggleLeft size={18} />}
                </button>
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
