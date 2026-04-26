import { useState } from "react";

const TOOL_ICONS: Record<string, string> = {
  Read: "📄", Write: "✏️", Edit: "✏️", MultiEdit: "✏️",
  Bash: "⚡", Glob: "🔍", Grep: "🔍",
  WebFetch: "🌐", WebSearch: "🌐",
  Task: "🤖", Agent: "🤖",
};

const FILE_TOOLS = new Set(["Read", "Write", "Edit", "MultiEdit", "Glob", "Grep"]);

function extractPath(toolName: string, toolInput: string): string | null {
  if (!FILE_TOOLS.has(toolName)) return null;
  try {
    const obj = JSON.parse(toolInput);
    return (obj.file_path || obj.path || obj.pattern || null) as string | null;
  } catch {
    return null;
  }
}

function previewInput(input: string): string {
  try {
    const obj = JSON.parse(input);
    const first = Object.values(obj).find((v) => typeof v === "string") as string | undefined;
    if (!first) return "";
    return first.length > 80 ? first.slice(0, 77) + "…" : first;
  } catch {
    return "";
  }
}

export interface ToolEntry {
  callId: string;
  name: string;
  input: string;
  result?: string;
  done: boolean;
  time: string;
}

interface Props {
  toolEntries: ToolEntry[];
  onClose: () => void;
}

type Tab = "tools" | "files";

export default function ActivityPane({ toolEntries, onClose }: Props) {
  const [tab, setTab] = useState<Tab>("tools");

  const files = [...new Set(
    toolEntries
      .map((e) => extractPath(e.name, e.input))
      .filter((p): p is string => p !== null)
  )];

  const reversed = [...toolEntries].reverse();
  const activeTool = toolEntries.find((e) => !e.done);

  return (
    <aside className="w-[280px] shrink-0 flex flex-col border-l border-[var(--border)] bg-[var(--surface)] h-full">
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-[var(--border)] shrink-0">
        <span className="text-[12px] font-medium text-[var(--text)]">Activity</span>
        {activeTool && (
          <span className="flex items-center gap-1 text-[10px] text-[var(--cedar)]">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--cedar)] animate-pulse" />
            {activeTool.name}
          </span>
        )}
        <button
          onClick={onClose}
          className="text-[var(--muted)] hover:text-[var(--text)] text-[16px] leading-none ml-2"
        >
          ×
        </button>
      </div>

      <div className="flex border-b border-[var(--border)] shrink-0">
        {(["tools", "files"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={[
              "flex-1 py-1.5 text-[11px] font-medium capitalize transition-colors",
              tab === t
                ? "text-[var(--cedar)] border-b-2 border-[var(--cedar)] -mb-px"
                : "text-[var(--muted)] hover:text-[var(--text)]",
            ].join(" ")}
          >
            {t === "tools" ? `🔧 Tools (${toolEntries.length})` : `📁 Files (${files.length})`}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2 flex flex-col gap-1.5">
        {tab === "tools" && (
          toolEntries.length === 0 ? (
            <p className="text-[11px] text-[var(--muted)] text-center mt-8">No tool calls yet</p>
          ) : (
            reversed.map((entry, i) => {
              const isActive = !entry.done;
              const inputPreview = previewInput(entry.input);
              const resultPreview = entry.result
                ? (entry.result.length > 120 ? entry.result.slice(0, 117) + "…" : entry.result)
                : null;
              const displayName = entry.name === "Agent" || entry.name === "Task" ? "Subagent" : entry.name;

              return (
                <div
                  key={entry.callId + i}
                  className={[
                    "rounded-lg border px-2.5 py-2 transition-colors",
                    isActive
                      ? "border-[var(--cedar)]/40 bg-[var(--cedar)]/5"
                      : "border-[var(--border)] bg-transparent opacity-80",
                  ].join(" ")}
                >
                  <div className="flex items-center gap-1.5 mb-1">
                    {isActive ? (
                      <span className="w-2 h-2 rounded-full bg-[var(--cedar)] animate-pulse shrink-0" />
                    ) : (
                      <span className="text-[10px] text-green-500 shrink-0">✓</span>
                    )}
                    <span className="text-[11px]">{TOOL_ICONS[entry.name] ?? "🔧"}</span>
                    <span className="text-[11px] font-medium text-[var(--text)] font-mono">{displayName}</span>
                    <span className="text-[10px] text-[var(--muted)] ml-auto">{entry.time}</span>
                  </div>
                  {inputPreview && (
                    <div className="text-[10px] text-[var(--muted)] font-mono break-all leading-relaxed mb-1">
                      {inputPreview}
                    </div>
                  )}
                  {resultPreview && (
                    <div className="text-[10px] text-[var(--muted)]/70 font-mono break-all leading-relaxed border-t border-[var(--border)] pt-1 mt-1">
                      {resultPreview}
                    </div>
                  )}
                </div>
              );
            })
          )
        )}

        {tab === "files" && (
          files.length === 0 ? (
            <p className="text-[11px] text-[var(--muted)] text-center mt-8">No files accessed yet</p>
          ) : (
            files.map((f, i) => {
              const parts = f.split("/");
              const name = parts[parts.length - 1];
              const dir = parts.slice(0, -1).join("/");
              return (
                <div key={i} className="flex items-start gap-2 px-2 py-1.5 rounded-lg hover:bg-[var(--border)]/40">
                  <span className="text-[11px] mt-0.5 shrink-0">📄</span>
                  <div className="min-w-0">
                    <div className="text-[11px] font-medium text-[var(--text)] truncate">{name}</div>
                    <div className="text-[10px] text-[var(--muted)] truncate">{dir}</div>
                  </div>
                </div>
              );
            })
          )
        )}
      </div>
    </aside>
  );
}
