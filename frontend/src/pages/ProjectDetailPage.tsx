// Project detail — brief, tasks, files, agents, log. Single-pane
// version of the Channels right-rail; reachable directly when the
// user wants to focus on the project rather than the chat thread.

import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Briefcase, Layers, Plus, Trash2 } from "lucide-react";
import {
  CedarPage,
  CedarPageHeader,
  CedarCard,
  Btn,
  Tag,
  SegSeg,
  TopoLines,
} from "@/components/CedarUI";
import { api, type ProjectSummary, type ProjectTask, type ProjectTaskStatus } from "@/api/client";

type Tab = "brief" | "tasks" | "files" | "subagents" | "log";

const STATUS_TAG: Record<ProjectTaskStatus, "cedar" | "dawn" | "ember" | "stone" | "muted"> = {
  planned: "muted",
  in_progress: "cedar",
  blocked: "dawn",
  done: "stone",
  failed: "ember",
};

const STATUS_ORDER: ProjectTaskStatus[] = ["in_progress", "blocked", "planned", "done", "failed"];

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [tab, setTab] = useState<Tab>("brief");
  const [briefDraft, setBriefDraft] = useState("");
  const [editingBrief, setEditingBrief] = useState(false);

  const refresh = async () => {
    if (!id) return;
    try {
      const p = await api.getProject(id);
      setProject(p);
      if (!editingBrief) setBriefDraft(p.brief);
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

  const saveBrief = async () => {
    try {
      await api.patchProject(project.id, { brief: briefDraft });
      setEditingBrief(false);
      await refresh();
    } catch (e) {
      alert(`Save failed: ${e}`);
    }
  };

  const addTask = async () => {
    const title = window.prompt("Task title:");
    if (!title?.trim()) return;
    try {
      await api.createProjectTask(project.id, { title: title.trim() });
      await refresh();
    } catch (e) {
      alert(`Add task failed: ${e}`);
    }
  };

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

  const tasksByStatus: Record<ProjectTaskStatus, ProjectTask[]> = {
    planned: [], in_progress: [], blocked: [], done: [], failed: [],
  };
  for (const t of project.tasks) tasksByStatus[t.status].push(t);

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
                  style={{ fontStyle: "italic", color: "var(--cedar-glow)", fontSize: 18, marginLeft: 12 }}
                >
                  ↳ channel
                </em>
              )}
            </>
          }
          sub={`${project.open_tasks} open · ${project.tasks.length} total tasks`}
          right={
            <>
              <Btn kind="ghost" icon={<ArrowLeft size={13} />} onClick={() => navigate("/projects")}>
                All projects
              </Btn>
              {project.channel_id && (
                <Btn kind="outline" icon={<Layers size={13} />} onClick={() => navigate("/channels")}>
                  Open channel
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
            { value: "files", label: "Files" },
            { value: "subagents", label: "Agents" },
            { value: "log", label: "Log" },
          ]}
        />
      </div>
      <div style={{ padding: "20px 32px 32px" }}>
        {tab === "brief" && (
          <CedarCard padding={20}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
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
              {!editingBrief ? (
                <Btn size="sm" kind="ghost" onClick={() => setEditingBrief(true)}>Edit</Btn>
              ) : (
                <div style={{ display: "flex", gap: 6 }}>
                  <Btn size="sm" kind="ghost" onClick={() => { setBriefDraft(project.brief); setEditingBrief(false); }}>Cancel</Btn>
                  <Btn size="sm" kind="solid" onClick={saveBrief}>Save</Btn>
                </div>
              )}
            </div>
            {editingBrief ? (
              <textarea
                value={briefDraft}
                onChange={(e) => setBriefDraft(e.target.value)}
                rows={16}
                style={{
                  width: "100%",
                  background: "var(--bg)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  padding: 12,
                  fontFamily: "var(--fm)",
                  fontSize: 12.5,
                  lineHeight: 1.6,
                  color: "var(--text)",
                  resize: "vertical",
                  outline: "none",
                }}
              />
            ) : (
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
                {project.brief || "_No brief yet — click Edit to write one._"}
              </pre>
            )}
          </CedarCard>
        )}

        {tab === "tasks" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <Btn size="sm" kind="solid" icon={<Plus size={11} />} onClick={addTask}>New task</Btn>
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
                      <span style={{ fontSize: 11, color: "var(--muted)", fontFamily: "var(--fm)" }}>
                        {items.length}
                      </span>
                    </div>
                    {items.map((t) => (
                      <div
                        key={t.id}
                        style={{
                          padding: "10px 16px",
                          borderBottom: "1px solid var(--hairline)",
                          display: "flex",
                          alignItems: "center",
                          gap: 12,
                        }}
                      >
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, color: "var(--text)" }}>{t.title}</div>
                          {t.assignee && (
                            <div
                              style={{
                                fontSize: 10.5,
                                fontFamily: "var(--fm)",
                                color: "var(--cedar-2)",
                                marginTop: 2,
                              }}
                            >
                              @{t.assignee}
                              {t.depends_on.length > 0 && ` · blocked by ${t.depends_on.length}`}
                            </div>
                          )}
                        </div>
                        <select
                          value={t.status}
                          onChange={(e) => setTaskStatus(t, e.target.value as ProjectTaskStatus)}
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
                            <option key={s} value={s}>{s.replace("_", " ")}</option>
                          ))}
                        </select>
                        <button
                          onClick={() => removeTask(t)}
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
                    ))}
                  </CedarCard>
                );
              })
            )}
          </div>
        )}

        {(tab === "files" || tab === "subagents" || tab === "log") && (
          <CedarCard padding={48}>
            <div style={{ textAlign: "center", color: "var(--muted)" }}>
              <Briefcase size={28} style={{ marginBottom: 12, color: "var(--text3)" }} />
              <div style={{ fontFamily: "var(--fd)", fontSize: 22, color: "var(--text)" }}>
                {tab === "files" ? "Files" : tab === "subagents" ? "Subagents" : "Log"} aggregator coming up.
              </div>
              <div style={{ fontSize: 13, marginTop: 8 }}>
                Will roll up across all sessions tied to this project. Wired to the same data the
                Activity rail uses inside chat.
              </div>
            </div>
          </CedarCard>
        )}
      </div>
    </CedarPage>
  );
}
