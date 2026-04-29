import { useEffect, useState } from "react";
import { api } from "@/api/client";
import type { AgentConfig } from "@/api/client";
import { Bot, Plus, Trash2, Edit2, Star, StarOff, X, Check, Play } from "lucide-react";
import { useNavigate } from "react-router-dom";

interface Props {
  onClose?: () => void;
  variant?: "modal" | "page";
}

const BLANK: Omit<AgentConfig, "name"> = {
  provider: "claude-code",
  model: "",
  work_dir: "",
  system_prompt: "",
  approval_mode: "normal",
  tool_allowlist: [],
  description: "",
  is_default: false,
};

const APPROVAL_MODES = [
  { id: "normal", label: "Normal" },
  { id: "trust_reads", label: "Trust reads" },
  { id: "trust", label: "Trust all" },
  { id: "yolo", label: "Yolo" },
];

export default function AgentsModal({ onClose, variant = "modal" }: Props) {
  const handleClose = onClose ?? (() => {});
  const navigate = useNavigate();
  const [agents, setAgents] = useState<AgentConfig[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editingName, setEditingName] = useState<string | null>(null);

  const [form, setForm] = useState<AgentConfig>({ name: "", ...BLANK });

  const refresh = () =>
    api.listAgents().then(setAgents).catch((e) => setError(String(e)));

  useEffect(() => {
    refresh();
    if (variant !== "modal") return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") handleClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [variant]);

  const startCreate = () => {
    setForm({ name: "", ...BLANK });
    setEditingName(null);
    setCreating(true);
  };

  const startEdit = (a: AgentConfig) => {
    setForm({ ...a });
    setEditingName(a.name);
    setCreating(true);
  };

  const cancel = () => {
    setCreating(false);
    setEditingName(null);
  };

  const save = async () => {
    if (!form.name.trim()) return;
    setError(null);
    try {
      if (editingName) {
        await api.updateAgent(editingName, form);
      } else {
        await api.createAgent(form);
      }
      setCreating(false);
      setEditingName(null);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const del = async (name: string) => {
    if (!confirm(`Delete agent "${name}"?`)) return;
    try {
      await api.deleteAgent(name);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const setDefault = async (agent: AgentConfig) => {
    try {
      await api.updateAgent(agent.name, { ...agent, is_default: !agent.is_default });
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const startSession = async (agent: AgentConfig) => {
    try {
      const s = await api.createSessionFromAgent(agent.name);
      // Hop to the chat page with this session selected.
      sessionStorage.setItem("arz:next-session", s.id);
      if (variant === "modal") handleClose();
      navigate("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const header = (
    <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-[var(--border)]">
      <div className="flex items-center gap-2">
        <Bot size={16} className="text-[var(--cedar)]" />
        <h2 className="text-[15px] font-semibold text-[var(--text)]">Agents</h2>
      </div>
      {variant === "modal" && (
        <button onClick={handleClose} className="text-[var(--muted)] hover:text-[var(--text)] text-xl leading-none">×</button>
      )}
    </div>
  );

  const formPanel = (
    <div className="mb-4 border border-[var(--border)] rounded-lg p-4 bg-[var(--surface)] flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-semibold text-[var(--text)]">{editingName ? `Edit "${editingName}"` : "New agent"}</span>
        <button onClick={cancel} className="text-[var(--muted)] hover:text-[var(--text)]"><X size={14} /></button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Field label="Name *">
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            disabled={!!editingName}
            placeholder="e.g. fast-claude"
            className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-md px-2 py-1.5 text-[13px] text-[var(--text)] focus:outline-none focus:border-[var(--cedar)]"
          />
        </Field>
        <Field label="Description">
          <input
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="Short description"
            className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-md px-2 py-1.5 text-[13px] text-[var(--text)] focus:outline-none focus:border-[var(--cedar)]"
          />
        </Field>
        <Field label="Preferred provider (default for new sessions only)">
          <select value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })} className="input">
            <option value="claude-code">claude-code</option>
            <option value="kiro-cli">kiro-cli</option>
            <option value="codex">codex</option>
            <option value="anthropic">anthropic</option>
          </select>
        </Field>
        <Field label="Preferred model (default for new sessions only)">
          <input
            value={form.model}
            onChange={(e) => setForm({ ...form, model: e.target.value })}
            placeholder="e.g. claude-opus-4-7 (leave blank for default)"
            className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-md px-2 py-1.5 text-[13px] text-[var(--text)] focus:outline-none focus:border-[var(--cedar)]"
          />
        </Field>
        <Field label="Work directory">
          <input
            value={form.work_dir}
            onChange={(e) => setForm({ ...form, work_dir: e.target.value })}
            placeholder="~/projects/myapp"
            className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-md px-2 py-1.5 text-[13px] text-[var(--text)] focus:outline-none focus:border-[var(--cedar)]"
          />
        </Field>
        <Field label="Approval mode">
          <select value={form.approval_mode} onChange={(e) => setForm({ ...form, approval_mode: e.target.value })} className="input">
            {APPROVAL_MODES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </Field>
        <Field label="Tool allowlist (comma-separated)" className="md:col-span-2">
          <input
            value={form.tool_allowlist.join(", ")}
            onChange={(e) => setForm({ ...form, tool_allowlist: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
            placeholder="read_file, bash, …  (blank = all tools)"
            className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-md px-2 py-1.5 text-[13px] text-[var(--text)] focus:outline-none focus:border-[var(--cedar)]"
          />
        </Field>
        <Field label="System prompt" className="md:col-span-2">
          <textarea
            value={form.system_prompt}
            onChange={(e) => setForm({ ...form, system_prompt: e.target.value })}
            rows={4}
            placeholder="Optional system prompt injected at session start…"
            className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-md px-2 py-1.5 text-[13px] text-[var(--text)] focus:outline-none focus:border-[var(--cedar)] resize-y min-h-[80px]"
          />
        </Field>
      </div>

      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-[12px] text-[var(--muted)] cursor-pointer">
          <input
            type="checkbox"
            checked={form.is_default}
            onChange={(e) => setForm({ ...form, is_default: e.target.checked })}
            className="accent-[var(--cedar)]"
          />
          Set as default agent
        </label>
        <button
          onClick={save}
          disabled={!form.name.trim()}
          className="flex items-center gap-1 px-4 py-1.5 rounded-md bg-[var(--cedar)] text-white text-[12px] disabled:opacity-40 hover:bg-[var(--cedar-lt)]"
        >
          <Check size={12} /> Save
        </button>
      </div>
    </div>
  );

  const body = (
    <div className="flex-1 overflow-y-auto px-5 py-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[12px] text-[var(--muted)]">{agents.length} agent{agents.length !== 1 ? "s" : ""}</span>
        {!creating && (
          <button
            onClick={startCreate}
            className="flex items-center gap-1 px-3 py-1 rounded-md bg-[var(--cedar)] text-white text-[12px] hover:bg-[var(--cedar-lt)]"
          >
            <Plus size={11} /> New agent
          </button>
        )}
      </div>

      {creating && formPanel}

      <div className="flex flex-col gap-2">
        {agents.length === 0 && !creating && (
          <div className="text-center text-[var(--muted)]/60 text-[12px] py-10">
            No agents yet. Create one to spawn sessions with preset config.
          </div>
        )}
        {agents.map((a) => (
          <div
            key={a.name}
            className="flex items-start gap-3 border border-[var(--border)] rounded-lg p-3 bg-[var(--surface)]"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[13px] font-semibold text-[var(--text)] truncate">{a.name}</span>
                <span className="text-[10px] font-mono text-[var(--cedar)] bg-[var(--cedar)]/10 px-1.5 py-0.5 rounded shrink-0">{a.provider}</span>
                {a.model && <span className="text-[10px] font-mono text-[var(--muted)]/70 shrink-0">{a.model}</span>}
                {a.is_default && <span className="text-[10px] uppercase tracking-wider text-amber-400 shrink-0">default</span>}
              </div>
              {a.description && <div className="text-[12px] text-[var(--muted)] mb-1">{a.description}</div>}
              <div className="flex flex-wrap gap-2 text-[10px] font-mono text-[var(--muted)]/60">
                {a.work_dir && <span>dir: {a.work_dir}</span>}
                {a.approval_mode !== "normal" && <span>approval: {a.approval_mode}</span>}
                {a.tool_allowlist.length > 0 && <span>tools: {a.tool_allowlist.join(", ")}</span>}
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button onClick={() => startSession(a)} title="Start a fresh session with this agent" className="px-2 py-1 rounded-md bg-[var(--cedar)]/10 text-[var(--cedar)] hover:bg-[var(--cedar)]/20 text-[11px] flex items-center gap-1">
                <Play size={11} fill="currentColor" /> Start
              </button>
              <button onClick={() => setDefault(a)} title={a.is_default ? "Unset default" : "Set as default"} className="p-1 rounded text-[var(--muted)] hover:text-amber-400 hover:bg-[var(--bg)]">
                {a.is_default ? <Star size={13} fill="currentColor" /> : <StarOff size={13} />}
              </button>
              <button onClick={() => startEdit(a)} title="Edit" className="p-1 rounded text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--bg)]">
                <Edit2 size={13} />
              </button>
              <button onClick={() => del(a.name)} title="Delete" className="p-1 rounded text-[var(--muted)] hover:text-red-400 hover:bg-[var(--bg)]">
                <Trash2 size={13} />
              </button>
            </div>
          </div>
        ))}
      </div>
      {error && <div className="mt-3 text-red-400 text-[11px] bg-red-900/20 rounded px-2 py-1">{error}</div>}
    </div>
  );

  if (variant === "page") {
    return (
      <div className="flex flex-col h-full bg-[var(--bg)] min-w-0 flex-1 overflow-hidden">
        {header}
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
        {body}
      </div>
    </div>
  );
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={["flex flex-col gap-1", className].filter(Boolean).join(" ")}>
      <label className="text-[10px] uppercase tracking-wider text-[var(--muted)]">{label}</label>
      {children}
    </div>
  );
}
