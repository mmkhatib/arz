// Shared task detail modal. Used by ChannelsPage (right-rail click) and
// ProjectDetailPage (task list click). Keep it self-contained — caller
// supplies onClose, onOpenFile (which may navigate), and optionally
// onGotoProject to jump to the full project page.

import type { ProjectTask } from "@/api/client";
import { CedarModal, CedarLabel, Btn, Tag } from "@/components/CedarUI";
import { FileText } from "lucide-react";

const PRIORITY_COLOR: Record<string, "ember" | "dawn" | "muted" | "stone"> = {
  critical: "ember",
  high: "dawn",
  normal: "muted",
  low: "stone",
};

export function TaskDetailModal({
  task,
  onClose,
  onOpenFile,
  onGotoProject,
}: {
  task: ProjectTask;
  onClose: () => void;
  onOpenFile: (path: string) => void;
  onGotoProject?: () => void;
}) {
  const priority = task.priority ?? "normal";
  return (
    <CedarModal
      open
      onClose={onClose}
      eyebrow={`task · ${task.status.replace("_", " ")}`}
      title={task.title}
      footer={
        <>
          {onGotoProject && (
            <Btn kind="outline" onClick={onGotoProject}>
              Open in project →
            </Btn>
          )}
          <Btn kind="ghost" onClick={onClose}>
            Close
          </Btn>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {task.assignee && (
            <span style={{ fontSize: 12, fontFamily: "var(--fm)", color: "var(--cedar-2)" }}>
              assigned to @{task.assignee}
            </span>
          )}
          {priority !== "normal" && <Tag color={PRIORITY_COLOR[priority]}>{priority}</Tag>}
        </div>
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
            <div style={{ fontSize: 12, color: "var(--muted)" }}>No files produced yet.</div>
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
                  <span
                    style={{
                      flex: 1,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
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
            flexWrap: "wrap",
          }}
        >
          <span>id: {task.id}</span>
          <span>created: {new Date(task.created_at * 1000).toLocaleString()}</span>
          {task.started_at && (
            <span>started: {new Date(task.started_at * 1000).toLocaleString()}</span>
          )}
          {task.finished_at && (
            <span>finished: {new Date(task.finished_at * 1000).toLocaleString()}</span>
          )}
        </div>
      </div>
    </CedarModal>
  );
}
