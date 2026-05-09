// Projects — top-level list of multi-agent projects.
// Each project wraps a Channel and tracks brief/tasks/memory/budget.

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Briefcase, Layers } from "lucide-react";
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
  TopoLines,
} from "@/components/CedarUI";
import { api, type ProjectSummary } from "@/api/client";

function relTime(epoch: number): string {
  if (!epoch) return "—";
  const m = Math.round((Date.now() / 1000 - epoch) / 60);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

const STATUS_TAG: Record<string, "cedar" | "dawn" | "muted" | "stone"> = {
  active: "cedar",
  paused: "dawn",
  done: "stone",
  archived: "muted",
};

export default function ProjectsPage() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [showCreate, setShowCreate] = useState(false);

  const refresh = () => api.listProjects().then(setProjects).catch(() => {});

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 30_000);
    return () => clearInterval(t);
  }, []);

  const handleCreated = async (id: string) => {
    await refresh();
    navigate(`/projects/${encodeURIComponent(id)}`);
  };

  const open = projects.filter((p) => p.status === "active").length;
  const totalTasks = projects.reduce((s, p) => s + p.open_tasks, 0);

  return (
    <CedarPage>
      <div style={{ position: "relative", overflow: "hidden" }}>
        <TopoLines height={120} opacity={0.5} />
        <CedarPageHeader
          eyebrow="multi-agent work"
          title={
            <>
              The <em style={{ fontStyle: "italic", color: "var(--cedar-glow)" }}>projects</em> in flight.
            </>
          }
          sub={`${open} active · ${totalTasks} open tasks across the grove. Each project wraps a channel with a brief, a task list, and a project-scoped memory namespace.`}
          right={
            <Btn kind="solid" icon={<Plus size={13} />} onClick={() => setShowCreate(true)}>
              New project
            </Btn>
          }
        />
      </div>
      <div style={{ padding: "24px 32px 32px" }}>
        {projects.length === 0 ? (
          <CedarCard padding={48}>
            <div style={{ textAlign: "center", color: "var(--muted)" }}>
              <Briefcase size={28} style={{ marginBottom: 12, color: "var(--text3)" }} />
              <div style={{ fontFamily: "var(--fd)", fontSize: 22, color: "var(--text)" }}>
                No projects yet.
              </div>
              <div style={{ fontSize: 13, marginTop: 8 }}>
                Spin up a project to give the orchestrator a brief, a task list, and a place to
                track artifacts across multiple agent sessions.
              </div>
              <div style={{ marginTop: 14 }}>
                <Btn kind="solid" icon={<Plus size={13} />} onClick={() => setShowCreate(true)}>
                  Start one
                </Btn>
              </div>
            </div>
          </CedarCard>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 14 }}>
            {projects.map((p) => (
              <CedarCard
                key={p.id}
                padding={18}
                hoverable
                onClick={() => navigate(`/projects/${encodeURIComponent(p.id)}`)}
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
                      <Briefcase size={16} />
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontFamily: "var(--fd)", fontSize: 18, color: "var(--text)" }}>
                        {p.name}
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
                        project · {relTime(p.updated_at)}
                      </div>
                    </div>
                  </div>
                  <Tag color={STATUS_TAG[p.status] || "muted"}>{p.status}</Tag>
                </div>
                {p.brief && (
                  <div
                    style={{
                      fontSize: 12.5,
                      color: "var(--text2)",
                      marginTop: 12,
                      lineHeight: 1.5,
                      maxHeight: 56,
                      overflow: "hidden",
                    }}
                  >
                    {p.brief.split("\n").slice(0, 3).join(" ").slice(0, 200)}
                  </div>
                )}
                <div
                  style={{
                    marginTop: 14,
                    paddingTop: 12,
                    borderTop: "1px solid var(--hairline)",
                    display: "flex",
                    alignItems: "center",
                    gap: 14,
                    fontSize: 10.5,
                    fontFamily: "var(--fm)",
                    color: "var(--muted)",
                  }}
                >
                  <span>{p.open_tasks} open · {p.tasks.length} total</span>
                  {p.channel_id && (
                    <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <Layers size={11} /> #{p.channel_id.slice(0, 12)}
                    </span>
                  )}
                  <div style={{ flex: 1 }} />
                  {p.budget_usd_cents > 0 && (
                    <span style={{ color: p.spent_usd_cents > p.budget_usd_cents ? "var(--ember)" : "var(--cedar-2)" }}>
                      ${(p.spent_usd_cents / 100).toFixed(2)} / ${(p.budget_usd_cents / 100).toFixed(2)}
                    </span>
                  )}
                </div>
              </CedarCard>
            ))}
          </div>
        )}
      </div>
      <NewProjectModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={handleCreated}
      />
    </CedarPage>
  );
}

function NewProjectModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (id: string) => void | Promise<void>;
}) {
  const [name, setName] = useState("");
  const [brief, setBrief] = useState("");
  const [repoPath, setRepoPath] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setName("");
      setBrief("");
      setRepoPath("");
      setError(null);
      setCreating(false);
    }
  }, [open]);

  const submit = async () => {
    const n = name.trim();
    if (!n) {
      setError("Project name is required.");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const p = await api.createProject({
        name: n,
        brief: brief.trim(),
        repo_path: repoPath.trim(),
      });
      await onCreated(p.id);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  };

  return (
    <CedarModal
      open={open}
      onClose={onClose}
      eyebrow="new project"
      title={
        <>
          Plant a <em style={{ fontStyle: "italic", color: "var(--cedar-glow)" }}>cedar</em>.
        </>
      }
      footer={
        <>
          <Btn kind="ghost" onClick={onClose} disabled={creating}>Cancel</Btn>
          <Btn kind="solid" onClick={submit} disabled={creating}>
            {creating ? "Creating…" : "Create project"}
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
            placeholder="e.g. Auth refactor"
            autoFocus
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit(); }}
          />
        </div>
        <div>
          <CedarLabel>Brief</CedarLabel>
          <CedarTextArea
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            placeholder="What is the orchestrator working on? You can edit this later."
            rows={6}
          />
          <div style={{ fontSize: 10.5, color: "var(--muted)", fontFamily: "var(--fm)", marginTop: 4 }}>
            Markdown supported. The orchestrator reads this every turn.
          </div>
        </div>
        <div>
          <CedarLabel>Repo path (optional)</CedarLabel>
          <CedarInput
            value={repoPath}
            onChange={(e) => setRepoPath(e.target.value)}
            placeholder="/Users/you/code/this-project"
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
