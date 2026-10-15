/** Pure derivations the side panel builds from the live tool stream.
 *
 *  - `collectFileChanges` folds Edit / MultiEdit / Write calls into one
 *    record per file so the Changes tab can list "what the agent touched"
 *    with +/− counts, and the diff tab can replay the session's edits even
 *    when the file isn't under git.
 *  - `latestTodos` reads the most recent TodoWrite-style call so the Tasks
 *    tab shows the agent's current plan.
 */
import type { ToolEntry } from "@/components/ActivityPane";
import { diffLines, diffStats } from "@/utils/lineDiff";
import { extractEditChanges, parseToolInput, toolFilePath } from "@/utils/toolInput";

export interface FileEdit {
  tool: string;
  oldText: string;
  newText: string;
  time: string;
}

export interface FileChange {
  path: string;
  /** True when the first touch was a Write — the file is (probably) new. */
  created: boolean;
  edits: FileEdit[];
  added: number;
  removed: number;
  lastTime: string;
}

const WRITE_TOOLS = /^(Write|write_file|create_file|write_to_file|save_file)$/i;

export function collectFileChanges(entries: ToolEntry[]): FileChange[] {
  const byPath = new Map<string, FileChange>();
  const touch = (path: string, edit: FileEdit, isWrite: boolean) => {
    let rec = byPath.get(path);
    if (!rec) {
      rec = { path, created: isWrite, edits: [], added: 0, removed: 0, lastTime: edit.time };
      byPath.set(path, rec);
    }
    rec.edits.push(edit);
    const s = diffStats(diffLines(edit.oldText, edit.newText));
    rec.added += s.added;
    rec.removed += s.removed;
    rec.lastTime = edit.time;
  };
  for (const e of entries) {
    if (WRITE_TOOLS.test(e.name)) {
      const obj = parseToolInput(e.input);
      const path = toolFilePath(obj);
      const content = obj?.content ?? obj?.contents ?? obj?.text;
      if (path && typeof content === "string") {
        touch(path, { tool: e.name, oldText: "", newText: content, time: e.time }, true);
      }
      continue;
    }
    for (const c of extractEditChanges(e.name, e.input)) {
      touch(c.path, { tool: e.name, oldText: c.oldText, newText: c.newText, time: e.time }, false);
    }
  }
  // Most recently touched first — that's what the user is looking for.
  return [...byPath.values()].reverse();
}

/** Stitch a file's session edits into one before/after pair for a diff
 *  view. Each edit's hunk is shown in order, separated by a marker line,
 *  so a non-git file still gets a readable "what changed" diff. */
export function editsAsDiffPair(change: FileChange): { original: string; modified: string } {
  if (change.edits.length === 1) {
    return { original: change.edits[0].oldText, modified: change.edits[0].newText };
  }
  const sep = (i: number, e: FileEdit) => `// ── edit ${i + 1} · ${e.tool} · ${e.time} ──`;
  const original = change.edits.map((e, i) => `${sep(i, e)}\n${e.oldText}`).join("\n\n");
  const modified = change.edits.map((e, i) => `${sep(i, e)}\n${e.newText}`).join("\n\n");
  return { original, modified };
}

export type TodoStatus = "pending" | "in_progress" | "completed";

export interface TodoItem {
  content: string;
  status: TodoStatus;
  activeForm?: string;
}

const TODO_TOOLS = /^(TodoWrite|todo_write|update_todos|todo)$/i;

function normStatus(raw: unknown): TodoStatus {
  const s = String(raw ?? "").toLowerCase().replace(/[\s-]/g, "_");
  if (s === "completed" || s === "done" || s === "complete") return "completed";
  if (s === "in_progress" || s === "active" || s === "doing" || s === "running") return "in_progress";
  return "pending";
}

/** Latest todo list from the tool stream, or null when the agent never
 *  wrote one. Later calls replace earlier ones wholesale (TodoWrite
 *  semantics), so only the last parseable call matters. */
export function latestTodos(entries: ToolEntry[]): TodoItem[] | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (!TODO_TOOLS.test(e.name)) continue;
    const obj = parseToolInput(e.input);
    const list = obj?.todos ?? obj?.items ?? obj?.tasks;
    if (!Array.isArray(list)) continue;
    const items: TodoItem[] = [];
    for (const raw of list) {
      if (!raw || typeof raw !== "object") continue;
      const r = raw as Record<string, unknown>;
      const content = r.content ?? r.title ?? r.text ?? r.task;
      if (typeof content !== "string" || !content.trim()) continue;
      items.push({
        content,
        status: normStatus(r.status ?? (r.done === true ? "completed" : undefined)),
        activeForm: typeof r.activeForm === "string" ? r.activeForm : undefined,
      });
    }
    return items;
  }
  return null;
}

export function todoProgress(items: TodoItem[]): { done: number; total: number } {
  return { done: items.filter((t) => t.status === "completed").length, total: items.length };
}

/* ── Artifacts ──────────────────────────────────────────────────── */

export type ArtifactKind = "html" | "code" | "doc" | "data" | "image" | "other";

export const ARTIFACT_KIND_ORDER: ArtifactKind[] = ["html", "doc", "code", "data", "image", "other"];

export const ARTIFACT_KIND_LABEL: Record<ArtifactKind, string> = {
  html: "Pages",
  code: "Code",
  doc: "Docs",
  data: "Data",
  image: "Images",
  other: "Other",
};

const CODE_EXTS = new Set([
  "ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "rb", "go", "rs", "java", "kt", "cs", "cpp",
  "c", "h", "hpp", "swift", "php", "sql", "sh", "bash", "zsh", "fish", "lua", "pl", "scala",
  "clj", "cljs", "ex", "exs", "elm", "erl", "dart", "css", "scss", "less", "vue", "svelte",
]);

export function classifyArtifact(path: string): ArtifactKind {
  const ext = (path.split(".").pop() || "").toLowerCase();
  if (ext === "html" || ext === "htm") return "html";
  if (["md", "markdown", "mdx", "rst", "txt", "pdf", "docx"].includes(ext)) return "doc";
  if (["json", "yaml", "yml", "toml", "csv", "tsv", "ndjson", "log", "xml"].includes(ext)) return "data";
  if (["png", "jpg", "jpeg", "gif", "svg", "webp", "ico"].includes(ext)) return "image";
  if (CODE_EXTS.has(ext)) return "code";
  return "other";
}

/** Files the agent produced this session (created or edited), grouped by
 *  kind in display order. Empty groups are dropped. */
export function groupArtifacts(changes: FileChange[]): { kind: ArtifactKind; items: FileChange[] }[] {
  const by = new Map<ArtifactKind, FileChange[]>();
  for (const c of changes) {
    const k = classifyArtifact(c.path);
    by.set(k, [...(by.get(k) ?? []), c]);
  }
  return ARTIFACT_KIND_ORDER.filter((k) => by.has(k)).map((kind) => ({ kind, items: by.get(kind)! }));
}
