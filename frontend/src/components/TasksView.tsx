// Side-panel "Tasks" tab: the agent's current plan, read from its latest
// TodoWrite-style tool call. Read-only mirror — the agent owns the list.

import { CheckCircle2, Circle, ListTodo, LoaderCircle } from "lucide-react";
import { todoProgress, type TodoItem } from "@/utils/panelData";
import PanelEmpty from "./PanelEmpty";

export default function TasksView({ todos }: { todos: TodoItem[] | null }) {
  if (!todos || todos.length === 0) {
    return (
      <PanelEmpty
        icon={ListTodo}
        title="No plan yet"
        hint="When the agent breaks work into steps with a todo list, the plan and its progress show here."
      />
    );
  }
  const { done, total } = todoProgress(todos);
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className="flex flex-col">
      <div className="px-3 py-2.5 border-b border-[var(--hairline)]">
        <div className="flex items-center justify-between text-[10.5px] font-mono text-[var(--muted)] mb-1.5">
          <span>
            {done}/{total} done
          </span>
          <span>{pct}%</span>
        </div>
        <div className="h-1 rounded bg-[var(--s2)] overflow-hidden">
          <div
            className="h-full bg-[var(--cedar-glow)] transition-[width] duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
      <ul className="py-1">
        {todos.map((t, i) => {
          const Icon =
            t.status === "completed" ? CheckCircle2 : t.status === "in_progress" ? LoaderCircle : Circle;
          return (
            <li key={i} className="flex items-start gap-2 px-3 py-1.5">
              <Icon
                size={13}
                className={[
                  "shrink-0 mt-[2px]",
                  t.status === "completed"
                    ? "text-[var(--pine)]"
                    : t.status === "in_progress"
                      ? "text-[var(--cedar-glow)] animate-spin [animation-duration:2.4s]"
                      : "text-[var(--muted)]",
                ].join(" ")}
              />
              <span
                className={[
                  "text-[12px] leading-snug",
                  t.status === "completed"
                    ? "text-[var(--muted)] line-through decoration-[var(--muted)]/50"
                    : t.status === "in_progress"
                      ? "text-[var(--text)] font-medium"
                      : "text-[var(--text2)]",
                ].join(" ")}
              >
                {t.status === "in_progress" && t.activeForm ? t.activeForm : t.content}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
