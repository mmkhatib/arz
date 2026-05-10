// Project detail — brief, criteria, tasks, files, agents, log.
// Buttons let the user edit the project (in a Cedar modal) and kick
// off the orchestrator on a tied channel.

import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Briefcase,
  Layers,
  Plus,
  Trash2,
  Pencil,
  Play,
  CheckCircle2,
  X as XIcon,
  FileText,
} from "lucide-react";
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
  TopoLines,
} from "@/components/CedarUI";
import {
  api,
  type ProjectSummary,
  type ProjectTask,
  type ProjectTaskStatus,
} from "@/api/client";

type Tab = "brief" | "tasks" | "files" | "subagents" | "log";

const STATUS_TAG: Record<ProjectTaskStatus, "cedar" | "dawn" | "ember" | "stone" | "muted"> = {
  planned: "muted",
  in_progress: "cedar",
  blocked: "dawn",
  done: "stone",
  failed: "ember",
};

const STATUS_ORDER: ProjectTaskStatus[] = [
  "in_progress",
  "blocked",
  "planned",
  "done",
  "failed",
];

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [tab, setTab] = useState<Tab>("brief");
  const [showAddTask, setShowAddTask] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [kickoffBusy, setKickoffBusy] = useState(false);
  const [selectedTask, setSelectedTask] = useState<ProjectTask | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  const refresh = async () => {
    if (!id) return;
    try {
      const p = await api.getProject(id);
      setProject(p);
    } catch (e) {
      alert(`Project load failed: ${e}`);
    }
  };

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 15_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!project) {
    return (
      <CedarPage>
        <CedarPageHeader title="Loading…" />
      </CedarPage>
    );
  }

  const addTask = () => setShowAddTask(true);

  const setTaskStatus = async (task: ProjectTask, status: ProjectTaskStatus) => {
    try {
      await api.patchProjectTask(project.id, task.id, { status });
      await refresh();
    } catch {}
  };

  const removeTask = async (task: ProjectTask) => {
    if (!confirm(`Delete task "${task.title}"?`)) return;
    try {
      await api.deleteProjectTask(project.id, task.id);
      await refresh();
    } catch {}
  };

  const kickoff = async () => {
    setKickoffBusy(true);
    try {
      const r = await api.kickoffProject(project.id);
      await refresh();
      // Navigate to channels page; the orchestrator turn streams in
      // the channel feed.
      navigate(`/channels?ch=${encodeURIComponent(r.channel_id)}`);
    } catch (e) {
      alert(`Kickoff failed: ${e}`);
    } finally {
      setKickoffBusy(false);
    }
  };

  const tasksByStatus: Record<ProjectTaskStatus, ProjectTask[]> = {
    planned: [],
    in_progress: [],
    blocked: [],
    done: [],
    failed: [],
  };
  for (const t of project.tasks) tasksByStatus[t.status].push(t);

  // Aggregate artifact paths across all tasks for the Files tab.
  const allArtifacts: { path: string; task?: ProjectTask }[] = [];
  for (const t of project.tasks) {
    for (const path of t.artifacts || []) {
      allArtifacts.push({ path, task: t });
    }
  }

  return (
    <CedarPage>
      <div style={{ position: "relative", overflow: "hidden" }}>
        <TopoLines height={120} opacity={0.5} />
        <CedarPageHeader
          eyebrow={`project · ${project.status}`}
          title={
            <>
              {project.name}
              {project.channel_id && (
                <em
                  style={{
                    fontStyle: "italic",
                    color: "var(--cedar-glow)",
                    fontSize: 18,
                    marginLeft: 12,
                  }}
                >
                  ↳ channel
                </em>
              )}
            </>
          }
          sub={`${project.open_tasks} open · ${project.tasks.length} total tasks${
            project.success_criteria.length
              ? ` · ${project.success_criteria.length} success criteria`
              : ""
          }`}
          right={
            <>
              <Btn kind="ghost" icon={<ArrowLeft size={13} />} onClick={() => navigate("/projects")}>
                All projects
              </Btn>
              <Btn kind="outline" icon={<Pencil size={13} />} onClick={() => setShowEdit(true)}>
                Edit
              </Btn>
              {project.channel_id ? (
                <Btn
                  kind="solid"
                  icon={<Layers size={13} />}
                  onClick={() => navigate(`/channels?ch=${encodeURIComponent(project.channel_id!)}`)}
                >
                  Open channel
                </Btn>
              ) : (
                <Btn
                  kind="solid"
                  icon={<Play size={13} />}
                  onClick={kickoff}
                  disabled={kickoffBusy}
                >
                  {kickoffBusy ? "Starting…" : "Start project"}
                </Btn>
              )}
            </>
          }
        />
      </div>
      <div style={{ padding: "16px 32px 0" }}>
        <SegSeg<Tab>
          value={tab}
          onChange={setTab}
          options={[
            { value: "brief", label: "Brief" },
            { value: "tasks", label: `Tasks (${project.open_tasks})` },
            { value: "files", label: `Files (${allArtifacts.length})` },
            { value: "subagents", label: "Agents" },
            { value: "log", label: "Log" },
          ]}
        />
      </div>
      <div style={{ padding: "20px 32px 32px" }}>
        {tab === "brief" && <BriefTab project={project} onEdit={() => setShowEdit(true)} />}

        {tab === "tasks" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              {project.channel_id && (
                <Btn
                  size="sm"
                  kind="soft"
                  icon={<Play size={11} />}
                  onClick={() => navigate(`/channels?ch=${encodeURIComponent(project.channel_id!)}`)}
                >
                  Open chat
                </Btn>
              )}
              <Btn size="sm" kind="solid" icon={<Plus size={11} />} onClick={addTask}>
                New task
              </Btn>
            </div>
            {project.tasks.length === 0 ? (
              <CedarCard padding={48}>
                <div style={{ textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
                  No tasks yet. Orchestrator will populate this as the project runs — or add one
                  manually above.
                </div>
              </CedarCard>
            ) : (
              STATUS_ORDER.map((status) => {
                const items = tasksByStatus[status];
                if (items.length === 0) return null;
                return (
                  <CedarCard key={status} padding={0}>
                    <div
                      style={{
                        padding: "10px 16px",
                        borderBottom: "1px solid var(--border)",
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                      }}
                    >
                      <Tag color={STATUS_TAG[status]}>{status.replace("_", " ")}</Tag>
                      <span
                        style={{
                          fontSize: 11,
                          color: "var(--muted)",
                          fontFamily: "var(--fm)",
                        }}
                      >
                        {items.length}
                      </span>
                    </div>
                    {items.map((t) => (
                      <TaskRow
                        key={t.id}
                        t={t}
                        onSelect={() => setSelectedTask(t)}
                        onStatus={(s) => setTaskStatus(t, s)}
                        onRemove={() => removeTask(t)}
                        onOpenFile={(p) => {
                          setSelectedFile(p);
                          setTab("files");
                        }}
                      />
                    ))}
                  </CedarCard>
                );
              })
            )}
            {selectedTask && (
              <TaskDetailModal
                task={selectedTask}
                onClose={() => setSelectedTask(null)}
                onOpenFile={(p) => {
                  setSelectedFile(p);
                  setSelectedTask(null);
                  setTab("files");
                }}
              />
            )}
          </div>
        )}

        {tab === "files" && (
          <FilesTab
            artifacts={allArtifacts}
            selectedPath={selectedFile}
            onSelect={setSelectedFile}
          />
        )}

        {(tab === "subagents" || tab === "log") && (
          <CedarCard padding={48}>
            <div style={{ textAlign: "center", color: "var(--muted)" }}>
              <Briefcase size={28} style={{ marginBottom: 12, color: "var(--text3)" }} />
              <div style={{ fontFamily: "var(--fd)", fontSize: 22, color: "var(--text)" }}>
                {tab === "subagents" ? "Subagents" : "Log"} aggregator coming up.
              </div>
              <div style={{ fontSize: 13, marginTop: 8 }}>
                Will roll up across all sessions tied to this project.
              </div>
            </div>
          </CedarCard>
        )}
      </div>

      <NewTaskModal
        open={showAddTask}
        onClose={() => setShowAddTask(false)}
        onSubmit={async (body) => {
          try {
            await api.createProjectTask(project.id, body);
            await refresh();
          } catch (e) {
            alert(`Add task failed: ${e}`);
          }
        }}
      />

      <EditProjectModal
        open={showEdit}
        onClose={() => setShowEdit(false)}
        project={project}
        onSaved={refresh}
      />
    </CedarPage>
  );
}

// ── Brief tab ──────────────────────────────────────────────
function BriefTab({ project, onEdit }: { project: ProjectSummary; onEdit: () => void }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 18 }}>
      <CedarCard padding={20}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 12,
          }}
        >
          <div
            style={{
              fontSize: 10.5,
              color: "var(--muted)",
              fontFamily: "var(--fm)",
              textTransform: "uppercase",
              letterSpacing: ".12em",
            }}
          >
            Brief
          </div>
          <Btn size="sm" kind="ghost" icon={<Pencil size={11} />} onClick={onEdit}>
            Edit project
          </Btn>
        </div>
        <pre
          style={{
            whiteSpace: "pre-wrap",
            fontFamily: "var(--fm)",
            fontSize: 12.5,
            lineHeight: 1.6,
            color: "var(--text2)",
            margin: 0,
          }}
        >
          {project.brief || "_No brief yet — click Edit project to write one._"}
        </pre>
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
          Success criteria
        </div>
        {project.success_criteria.length === 0 ? (
          <div style={{ fontSize: 12, color: "var(--muted)" }}>
            None yet — Edit project to add some.
          </div>
        ) : (
          <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
            {project.success_criteria.map((c, i) => (
              <li
                key={i}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 8,
                  padding: "5px 0",
                  fontSize: 12.5,
                  color: "var(--text)",
                  borderBottom: "1px solid var(--hairline)",
                }}
              >
                <CheckCircle2 size={12} style={{ color: "var(--cedar-glow)", flexShrink: 0, marginTop: 2 }} />
                <span style={{ flex: 1 }}>{c}</span>
              </li>
            ))}
          </ul>
        )}
      </CedarCard>
    </div>
  );
}

// ── Task row ───────────────────────────────────────────────
function TaskRow({
  t,
  onSelect,
  onStatus,
  onRemove,
  onOpenFile,
}: {
  t: ProjectTask;
  onSelect: () => void;
  onStatus: (s: ProjectTaskStatus) => void;
  onRemove: () => void;
  onOpenFile: (path: string) => void;
}) {
  return (
    <div
      style={{
        padding: "10px 16px",
        borderBottom: "1px solid var(--hairline)",
        display: "flex",
        alignItems: "center",
        gap: 12,
      }}
    >
      <button
        onClick={onSelect}
        style={{
          flex: 1,
          minWidth: 0,
          background: "transparent",
          border: "none",
          color: "var(--text)",
          fontSize: 13,
          textAlign: "left",
          cursor: "pointer",
          padding: 0,
        }}
      >
        <div>{t.title}</div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginTop: 3,
            fontSize: 10.5,
            fontFamily: "var(--fm)",
            color: "var(--muted)",
          }}
        >
          {t.assignee && <span style={{ color: "var(--cedar-2)" }}>@{t.assignee}</span>}
          {t.depends_on.length > 0 && <span>blocked by {t.depends_on.length}</span>}
          {t.artifacts.length > 0 && (
            <span>
              {t.artifacts.length} file{t.artifacts.length === 1 ? "" : "s"}
            </span>
          )}
          {t.started_at && (
            <span>
              started {new Date(t.started_at * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
        </div>
        {t.artifacts.length > 0 && (
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 6 }}>
            {t.artifacts.slice(0, 3).map((a) => (
              <span
                key={a}
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenFile(a);
                }}
                style={{
                  fontSize: 10.5,
                  fontFamily: "var(--fm)",
                  color: "var(--cedar-glow)",
                  background: "var(--cedar-dim)",
                  border: "1px solid var(--cedar-line)",
                  padding: "1px 7px",
                  borderRadius: 4,
                  cursor: "pointer",
                  maxWidth: 240,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {a.split("/").pop()}
              </span>
            ))}
            {t.artifacts.length > 3 && (
              <span style={{ fontSize: 10.5, color: "var(--muted)", fontFamily: "var(--fm)" }}>
                +{t.artifacts.length - 3} more
              </span>
            )}
          </div>
        )}
      </button>
      <select
        value={t.status}
        onChange={(e) => onStatus(e.target.value as ProjectTaskStatus)}
        style={{
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: 6,
          color: "var(--text)",
          fontFamily: "var(--fn)",
          fontSize: 11.5,
          padding: "3px 6px",
        }}
      >
        {(["planned", "in_progress", "blocked", "done", "failed"] as ProjectTaskStatus[]).map((s) => (
          <option key={s} value={s}>
            {s.replace("_", " ")}
          </option>
        ))}
      </select>
      <button
        onClick={onRemove}
        title="Delete task"
        style={{
          background: "transparent",
          border: "none",
          color: "var(--muted)",
          cursor: "pointer",
          padding: 4,
        }}
      >
        <Trash2 size={11} />
      </button>
    </div>
  );
}

function TaskDetailModal({
  task,
  onClose,
  onOpenFile,
}: {
  task: ProjectTask;
  onClose: () => void;
  onOpenFile: (path: string) => void;
}) {
  return (
    <CedarModal
      open
      onClose={onClose}
      eyebrow={`task · ${task.status.replace("_", " ")}`}
      title={task.title}
      footer={
        <Btn kind="ghost" onClick={onClose}>
          Close
        </Btn>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {task.assignee && (
          <div style={{ fontSize: 12, fontFamily: "var(--fm)", color: "var(--cedar-2)" }}>
            assigned to @{task.assignee}
          </div>
        )}
        {task.description && (
          <div>
            <CedarLabel>Description</CedarLabel>
            <div
              style={{
                fontSize: 13,
                color: "var(--text2)",
                lineHeight: 1.55,
                whiteSpace: "pre-wrap",
              }}
            >
              {task.description}
            </div>
          </div>
        )}
        {task.depends_on.length > 0 && (
          <div>
            <CedarLabel>Depends on</CedarLabel>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {task.depends_on.map((d) => (
                <Tag key={d} color="muted">
                  {d}
                </Tag>
              ))}
            </div>
          </div>
        )}
        <div>
          <CedarLabel>Artifacts</CedarLabel>
          {task.artifacts.length === 0 ? (
            <div style={{ fontSize: 12, color: "var(--muted)" }}>
              No files produced yet.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {task.artifacts.map((a) => (
                <button
                  key={a}
                  onClick={() => onOpenFile(a)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "6px 10px",
                    border: "1px solid var(--border)",
                    background: "var(--bg)",
                    borderRadius: 6,
                    color: "var(--text)",
                    fontSize: 12,
                    fontFamily: "var(--fm)",
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  <FileText size={11} className="text-[var(--cedar-glow)]" />
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {a}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div
          style={{
            display: "flex",
            gap: 14,
            fontSize: 10.5,
            fontFamily: "var(--fm)",
            color: "var(--muted)",
            paddingTop: 10,
            borderTop: "1px solid var(--hairline)",
          }}
        >
          <span>id: {task.id}</span>
          <span>created: {new Date(task.created_at * 1000).toLocaleString()}</span>
          {task.finished_at && <span>finished: {new Date(task.finished_at * 1000).toLocaleString()}</span>}
        </div>
      </div>
    </CedarModal>
  );
}

// ── Files tab ──────────────────────────────────────────────
function FilesTab({
  artifacts,
  selectedPath,
  onSelect,
}: {
  artifacts: { path: string; task?: ProjectTask }[];
  selectedPath: string | null;
  onSelect: (path: string | null) => void;
}) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!selectedPath) {
      setContent(null);
      return;
    }
    setLoading(true);
    api
      .readFile(selectedPath)
      .then((r) => setContent(r.content))
      .catch((e) => setContent(`error: ${e}`))
      .finally(() => setLoading(false));
  }, [selectedPath]);

  if (artifacts.length === 0) {
    return (
      <CedarCard padding={48}>
        <div style={{ textAlign: "center", color: "var(--muted)" }}>
          <FileText size={28} style={{ marginBottom: 12, color: "var(--text3)" }} />
          <div style={{ fontFamily: "var(--fd)", fontSize: 22, color: "var(--text)" }}>
            No files yet.
          </div>
          <div style={{ fontSize: 13, marginTop: 8 }}>
            As tasks complete, the orchestrator records the files they produced here. Click any
            file to open the rendered preview.
          </div>
        </div>
      </CedarCard>
    );
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: 18 }}>
      <CedarCard padding={0}>
        {artifacts.map((a) => {
          const active = a.path === selectedPath;
          return (
            <button
              key={a.path}
              onClick={() => onSelect(a.path)}
              style={{
                width: "100%",
                textAlign: "left",
                padding: "10px 14px",
                background: active ? "var(--cedar-dim)" : "transparent",
                border: "none",
                borderLeft: `2px solid ${active ? "var(--cedar-glow)" : "transparent"}`,
                borderBottom: "1px solid var(--hairline)",
                color: active ? "var(--text)" : "var(--text2)",
                cursor: "pointer",
              }}
            >
              <div
                style={{
                  fontSize: 12.5,
                  fontFamily: "var(--fm)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {a.path.split("/").pop()}
              </div>
              <div
                style={{
                  fontSize: 10.5,
                  color: "var(--muted)",
                  marginTop: 2,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {a.task ? `from ${a.task.title.slice(0, 40)}` : "—"}
              </div>
            </button>
          );
        })}
      </CedarCard>
      <CedarCard padding={0}>
        {!selectedPath ? (
          <div style={{ padding: 32, fontSize: 12.5, color: "var(--muted)", textAlign: "center" }}>
            Pick a file on the left.
          </div>
        ) : loading ? (
          <div style={{ padding: 32, fontSize: 12.5, color: "var(--muted)" }}>Loading…</div>
        ) : (
          <pre
            style={{
              padding: 18,
              fontFamily: "var(--fm)",
              fontSize: 12,
              lineHeight: 1.55,
              color: "var(--text)",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              maxHeight: "70vh",
              overflowY: "auto",
              margin: 0,
            }}
          >
            {content}
          </pre>
        )}
      </CedarCard>
    </div>
  );
}

// ── New task modal ─────────────────────────────────────────
function NewTaskModal({
  open,
  onClose,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (body: { title: string; description?: string; assignee?: string | null }) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assignee, setAssignee] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setTitle("");
      setDescription("");
      setAssignee("");
      setError(null);
      setSubmitting(false);
    }
  }, [open]);

  const submit = async () => {
    const t = title.trim();
    if (!t) {
      setError("Title required.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({
        title: t,
        description: description.trim() || undefined,
        assignee: assignee.trim().replace(/^@/, "") || null,
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <CedarModal
      open={open}
      onClose={onClose}
      eyebrow="new task"
      title={
        <>
          Add a <em style={{ fontStyle: "italic", color: "var(--cedar-glow)" }}>task</em>.
        </>
      }
      footer={
        <>
          <Btn kind="ghost" onClick={onClose} disabled={submitting}>Cancel</Btn>
          <Btn kind="solid" onClick={submit} disabled={submitting}>
            {submitting ? "Adding…" : "Add task"}
          </Btn>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <CedarLabel>Title</CedarLabel>
          <CedarInput
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. wire up token refresh test"
            autoFocus
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit(); }}
          />
        </div>
        <div>
          <CedarLabel>Description (optional)</CedarLabel>
          <CedarTextArea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Context, links, edge cases."
            rows={4}
          />
        </div>
        <div>
          <CedarLabel>Assignee (optional)</CedarLabel>
          <CedarInput
            value={assignee}
            onChange={(e) => setAssignee(e.target.value)}
            placeholder="agent name (e.g. coder)"
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

// ── Edit project modal — single-pane, wizard-friendly ──────
function EditProjectModal({
  open,
  onClose,
  project,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  project: ProjectSummary;
  onSaved: () => void | Promise<void>;
}) {
  const [name, setName] = useState(project.name);
  const [brief, setBrief] = useState(project.brief);
  const [repoPath, setRepoPath] = useState(project.repo_path);
  const [criteria, setCriteria] = useState<string[]>(project.success_criteria);
  const [criteriaDraft, setCriteriaDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName(project.name);
      setBrief(project.brief);
      setRepoPath(project.repo_path);
      setCriteria(project.success_criteria);
      setCriteriaDraft("");
      setError(null);
      setSubmitting(false);
    }
  }, [open, project]);

  const addCriterion = () => {
    const v = criteriaDraft.trim();
    if (!v) return;
    setCriteria([...criteria, v]);
    setCriteriaDraft("");
  };
  const removeCriterion = (i: number) =>
    setCriteria(criteria.filter((_, idx) => idx !== i));
  const editCriterion = (i: number, v: string) => {
    const next = [...criteria];
    next[i] = v;
    setCriteria(next);
  };

  const submit = async () => {
    if (!name.trim()) {
      setError("Name required.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await api.patchProject(project.id, {
        name: name.trim(),
        brief,
        repo_path: repoPath.trim(),
        success_criteria: criteria.filter((c) => c.trim()),
      } as Partial<ProjectSummary>);
      await onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <CedarModal
      open={open}
      onClose={onClose}
      width={720}
      eyebrow="edit project"
      title={
        <>
          Refine the <em style={{ fontStyle: "italic", color: "var(--cedar-glow)" }}>brief</em>.
        </>
      }
      footer={
        <>
          <Btn kind="ghost" onClick={onClose} disabled={submitting}>Cancel</Btn>
          <Btn kind="solid" onClick={submit} disabled={submitting}>
            {submitting ? "Saving…" : "Save changes"}
          </Btn>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 14 }}>
          <div>
            <CedarLabel>Name</CedarLabel>
            <CedarInput value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <CedarLabel>Repo / folder</CedarLabel>
            <CedarInput value={repoPath} onChange={(e) => setRepoPath(e.target.value)} />
          </div>
        </div>
        <div>
          <CedarLabel>Brief (markdown)</CedarLabel>
          <CedarTextArea
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            rows={12}
            style={{ fontFamily: "var(--fm)", fontSize: 12 }}
          />
        </div>
        <div>
          <CedarLabel>Success criteria</CedarLabel>
          {criteria.length === 0 && (
            <div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 6 }}>
              None yet — add some below.
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {criteria.map((c, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <CheckCircle2 size={12} style={{ color: "var(--cedar-glow)" }} />
                <CedarInput
                  value={c}
                  onChange={(e) => editCriterion(i, e.target.value)}
                  style={{ flex: 1 }}
                />
                <button
                  onClick={() => removeCriterion(i)}
                  title="Remove"
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "var(--muted)",
                    cursor: "pointer",
                    padding: 4,
                  }}
                >
                  <XIcon size={11} />
                </button>
              </div>
            ))}
            <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
              <CedarInput
                value={criteriaDraft}
                onChange={(e) => setCriteriaDraft(e.target.value)}
                placeholder="add a checkable success criterion"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addCriterion();
                  }
                }}
                style={{ flex: 1 }}
              />
              <Btn
                size="sm"
                kind="outline"
                icon={<Plus size={11} />}
                onClick={addCriterion}
                disabled={!criteriaDraft.trim()}
              >
                Add
              </Btn>
            </div>
          </div>
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
