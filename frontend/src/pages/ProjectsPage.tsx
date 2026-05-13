// Projects — top-level list of multi-agent projects.
// Each project wraps a Channel and tracks brief/tasks/memory/budget.

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Briefcase, Layers, ArrowLeft, ArrowRight, Check, Sparkles, X as XIcon } from "lucide-react";
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
import { projectPath } from "@/utils/sessionUrl";

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
    const fresh = await api.listProjects().catch(() => projects);
    setProjects(fresh);
    const created = fresh.find((p) => p.id === id);
    navigate(projectPath(created?.name, id));
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
                onClick={() => navigate(projectPath(p.name, p.id))}
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

type WizStep = "goal" | "constraints" | "review";

function NewProjectModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (id: string) => void | Promise<void>;
}) {
  const [step, setStep] = useState<WizStep>("goal");

  // Step 1 — Goal & folder
  const [goal, setGoal] = useState("");
  const [folder, setFolder] = useState("");

  // Step 2 — Constraints
  const [deadline, setDeadline] = useState("");
  const [mustHavesText, setMustHavesText] = useState("");
  const [niceText, setNiceText] = useState("");
  const [successMetric, setSuccessMetric] = useState("");
  const [constraints, setConstraints] = useState("");

  // Step 3 — PM draft (LLM-generated, editable)
  const [drafting, setDrafting] = useState(false);
  const [draft, setDraft] = useState<{
    name: string;
    brief: string;
    success_criteria: string[];
    tasks: { title: string; description?: string; assignee?: string | null }[];
    suggested_agents: string[];
  } | null>(null);

  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setStep("goal");
      setGoal("");
      setFolder("");
      setDeadline("");
      setMustHavesText("");
      setNiceText("");
      setSuccessMetric("");
      setConstraints("");
      setDraft(null);
      setError(null);
      setCreating(false);
      setDrafting(false);
    }
  }, [open]);

  const splitLines = (s: string) =>
    s.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);

  const goNextFromGoal = () => {
    if (!goal.trim()) {
      setError("Tell the PM what you're building.");
      return;
    }
    setError(null);
    setStep("constraints");
  };

  const askPMForDraft = async () => {
    setDrafting(true);
    setError(null);
    try {
      const d = await api.draftProjectIntake({
        goal: goal.trim(),
        folder: folder.trim(),
        deadline: deadline.trim(),
        must_haves: splitLines(mustHavesText),
        nice_to_haves: splitLines(niceText),
        success_metric: successMetric.trim(),
        constraints: constraints.trim(),
      });
      setDraft(d);
      setStep("review");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDrafting(false);
    }
  };

  const submit = async () => {
    if (!draft) return;
    setCreating(true);
    setError(null);
    try {
      const created = await api.createProject({
        name: draft.name.trim() || "New project",
        brief: draft.brief,
        repo_path: folder.trim(),
      });
      // Persist tasks
      for (const t of draft.tasks) {
        try {
          await api.createProjectTask(created.id, {
            title: t.title,
            description: t.description,
            assignee: t.assignee || null,
          });
        } catch {
          // best-effort: keep going
        }
      }
      await onCreated(created.id);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  };

  const stepIndex = step === "goal" ? 0 : step === "constraints" ? 1 : 2;

  const footer = (() => {
    if (step === "goal") {
      return (
        <>
          <Btn kind="ghost" onClick={onClose}>Cancel</Btn>
          <Btn kind="solid" onClick={goNextFromGoal} disabled={!goal.trim()}>
            Continue <ArrowRight size={11} style={{ marginLeft: 4 }} />
          </Btn>
        </>
      );
    }
    if (step === "constraints") {
      return (
        <>
          <Btn kind="ghost" icon={<ArrowLeft size={11} />} onClick={() => setStep("goal")} disabled={drafting}>
            Back
          </Btn>
          <Btn kind="soft" icon={<Sparkles size={11} />} onClick={askPMForDraft} disabled={drafting}>
            {drafting ? "PM drafting…" : "Skip PM, write my own"}
          </Btn>
          <Btn kind="solid" onClick={askPMForDraft} disabled={drafting}>
            {drafting ? (
              <>Asking PM…</>
            ) : (
              <>Ask PM to draft <ArrowRight size={11} style={{ marginLeft: 4 }} /></>
            )}
          </Btn>
        </>
      );
    }
    return (
      <>
        <Btn kind="ghost" icon={<ArrowLeft size={11} />} onClick={() => setStep("constraints")} disabled={creating}>
          Back
        </Btn>
        <Btn kind="solid" icon={<Check size={11} />} onClick={submit} disabled={creating || !draft}>
          {creating ? "Creating…" : "Create project"}
        </Btn>
      </>
    );
  })();

  return (
    <CedarModal
      open={open}
      onClose={onClose}
      width={640}
      eyebrow={
        <span>
          new project · step {stepIndex + 1} of 3
        </span>
      }
      title={
        step === "goal" ? (
          <>
            What are we <em style={{ fontStyle: "italic", color: "var(--cedar-glow)" }}>building</em>?
          </>
        ) : step === "constraints" ? (
          <>
            Constraints &amp; <em style={{ fontStyle: "italic", color: "var(--cedar-glow)" }}>success</em>
          </>
        ) : (
          <>
            PM <em style={{ fontStyle: "italic", color: "var(--cedar-glow)" }}>draft</em> — review &amp; edit
          </>
        )
      }
      footer={footer}
    >
      <Stepper current={stepIndex} labels={["Goal", "Constraints", "Review"]} />

      {step === "goal" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 14 }}>
          <div>
            <CedarLabel>Goal</CedarLabel>
            <CedarTextArea
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="One-paragraph description of what you want built. The more specific, the better the PM's questions."
              rows={5}
              autoFocus
            />
          </div>
          <div>
            <CedarLabel>Folder / repo path</CedarLabel>
            <CedarInput
              value={folder}
              onChange={(e) => setFolder(e.target.value)}
              placeholder="/Users/you/code/my-project (where work happens)"
            />
            <div style={{ fontSize: 10.5, color: "var(--muted)", fontFamily: "var(--fm)", marginTop: 4 }}>
              Optional. Leave blank to use a sibling folder next to arz (e.g.
              <code style={{ color: "var(--cedar-2)", margin: "0 4px" }}>
                ~/workspace/projects/&lt;slug&gt;
              </code>
              ) so subagents never touch the arz source.
            </div>
          </div>
        </div>
      )}

      {step === "constraints" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <div>
              <CedarLabel>Deadline (optional)</CedarLabel>
              <CedarInput
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
                placeholder="e.g. ship by Fri"
              />
            </div>
            <div>
              <CedarLabel>Success metric</CedarLabel>
              <CedarInput
                value={successMetric}
                onChange={(e) => setSuccessMetric(e.target.value)}
                placeholder="how do we know we won?"
              />
            </div>
          </div>
          <div>
            <CedarLabel>Must-haves (one per line)</CedarLabel>
            <CedarTextArea
              value={mustHavesText}
              onChange={(e) => setMustHavesText(e.target.value)}
              rows={3}
              placeholder={"login flow works\npasses prod load test"}
            />
          </div>
          <div>
            <CedarLabel>Nice-to-haves (one per line)</CedarLabel>
            <CedarTextArea
              value={niceText}
              onChange={(e) => setNiceText(e.target.value)}
              rows={3}
              placeholder={"animated transitions\ndarkmode polish"}
            />
          </div>
          <div>
            <CedarLabel>Other constraints</CedarLabel>
            <CedarTextArea
              value={constraints}
              onChange={(e) => setConstraints(e.target.value)}
              rows={2}
              placeholder="tech stack you must use, budget caps, audiences, etc."
            />
          </div>
          <div style={{ fontSize: 11, color: "var(--text3)", lineHeight: 1.5 }}>
            Cedar's PM agent will read these and draft a brief, success criteria, and a starter
            task list using a cheap model — usually a few seconds. You can edit everything in the
            next step before the project is created.
          </div>
        </div>
      )}

      {step === "review" && draft && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 14 }}>
          <div>
            <CedarLabel>Project name</CedarLabel>
            <CedarInput
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </div>
          <div>
            <CedarLabel>Brief (markdown)</CedarLabel>
            <CedarTextArea
              value={draft.brief}
              onChange={(e) => setDraft({ ...draft, brief: e.target.value })}
              rows={10}
              style={{ fontFamily: "var(--fm)", fontSize: 12 }}
            />
          </div>
          <div>
            <CedarLabel>Success criteria</CedarLabel>
            <BulletEditor
              items={draft.success_criteria}
              onChange={(items) => setDraft({ ...draft, success_criteria: items })}
              placeholder="checkable success criterion"
            />
          </div>
          <div>
            <CedarLabel>Suggested starter tasks</CedarLabel>
            <TasksEditor
              tasks={draft.tasks}
              onChange={(tasks) => setDraft({ ...draft, tasks })}
            />
          </div>
          {draft.suggested_agents.length > 0 && (
            <div>
              <CedarLabel>Suggested agents</CedarLabel>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {draft.suggested_agents.map((a) => (
                  <Tag key={a} color="cedar">@{a}</Tag>
                ))}
              </div>
              <div style={{ fontSize: 10.5, color: "var(--muted)", fontFamily: "var(--fm)", marginTop: 4 }}>
                Add or wire these on the Agents page after the project is created.
              </div>
            </div>
          )}
        </div>
      )}

      {error && (
        <div
          style={{
            marginTop: 14,
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
    </CedarModal>
  );
}

function Stepper({ current, labels }: { current: number; labels: string[] }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      {labels.map((label, i) => {
        const active = i === current;
        const done = i < current;
        return (
          <div key={label} style={{ display: "flex", alignItems: "center", gap: 6, flex: 1 }}>
            <div
              style={{
                width: 22,
                height: 22,
                borderRadius: "50%",
                border: `1px solid ${active || done ? "var(--cedar-line)" : "var(--border)"}`,
                background: active ? "var(--cedar-dim)" : done ? "var(--cedar)" : "var(--bg)",
                color: done ? "#fff" : active ? "var(--cedar-glow)" : "var(--text3)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 10.5,
                fontFamily: "var(--fm)",
                flexShrink: 0,
              }}
            >
              {done ? <Check size={11} /> : i + 1}
            </div>
            <span
              style={{
                fontSize: 11,
                fontFamily: "var(--fm)",
                color: active ? "var(--text)" : "var(--text3)",
                textTransform: "uppercase",
                letterSpacing: ".12em",
              }}
            >
              {label}
            </span>
            {i < labels.length - 1 && (
              <div
                style={{
                  flex: 1,
                  height: 1,
                  background: done ? "var(--cedar-line)" : "var(--border)",
                  marginLeft: 4,
                  marginRight: 4,
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function BulletEditor({
  items,
  onChange,
  placeholder,
}: {
  items: string[];
  onChange: (items: string[]) => void;
  placeholder: string;
}) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const v = draft.trim();
    if (!v) return;
    onChange([...items, v]);
    setDraft("");
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {items.length === 0 && (
        <div style={{ fontSize: 11.5, color: "var(--muted)" }}>None yet — add some below.</div>
      )}
      {items.map((it, idx) => (
        <div key={idx} style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--cedar-glow)" }} />
          <CedarInput
            value={it}
            onChange={(e) => {
              const next = [...items];
              next[idx] = e.target.value;
              onChange(next);
            }}
            style={{ flex: 1 }}
          />
          <button
            onClick={() => onChange(items.filter((_, i) => i !== idx))}
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
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={placeholder}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          style={{ flex: 1 }}
        />
        <Btn size="sm" kind="outline" icon={<Plus size={11} />} onClick={add} disabled={!draft.trim()}>
          Add
        </Btn>
      </div>
    </div>
  );
}

function TasksEditor({
  tasks,
  onChange,
}: {
  tasks: { title: string; description?: string; assignee?: string | null }[];
  onChange: (tasks: { title: string; description?: string; assignee?: string | null }[]) => void;
}) {
  if (tasks.length === 0) {
    return <div style={{ fontSize: 11.5, color: "var(--muted)" }}>No tasks suggested.</div>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {tasks.map((t, idx) => (
        <div
          key={idx}
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 140px auto",
            gap: 6,
            alignItems: "center",
          }}
        >
          <CedarInput
            value={t.title}
            onChange={(e) => {
              const next = [...tasks];
              next[idx] = { ...t, title: e.target.value };
              onChange(next);
            }}
            placeholder="task title"
          />
          <CedarInput
            value={t.assignee ?? ""}
            onChange={(e) => {
              const next = [...tasks];
              next[idx] = { ...t, assignee: e.target.value || null };
              onChange(next);
            }}
            placeholder="@assignee"
          />
          <button
            onClick={() => onChange(tasks.filter((_, i) => i !== idx))}
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
      <div>
        <Btn
          size="sm"
          kind="outline"
          icon={<Plus size={11} />}
          onClick={() => onChange([...tasks, { title: "", assignee: null }])}
        >
          Add task
        </Btn>
      </div>
    </div>
  );
}
