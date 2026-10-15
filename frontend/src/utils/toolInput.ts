/** Helpers for reading tool-call payloads as they arrive from providers.
 *
 * Inputs show up as JSON strings, Python-repr dicts (`{'raw': '<json>'}`
 * from Claude Code), or opaque text. Everything here degrades to "show
 * the raw string" rather than throwing.
 */

export type ToolInputObject = Record<string, unknown>;

/** Unwrap Claude Code's `{'raw': '<json>'}` repr wrapper. */
export function stripPyRepr(raw: string): string {
  const m = raw.match(/^\s*\{\s*['"]raw['"]\s*:\s*['"]([\s\S]*)['"]\s*\}\s*$/);
  if (!m) return raw;
  return unescapePyString(m[1]);
}

const PY_ESCAPES: Record<string, string> = { n: "\n", t: "\t", r: "\r", "\\": "\\", "'": "'", '"': '"' };

/** Single-pass Python string-literal unescape. Sequential replaces get
 *  `\\"` wrong (it's an escaped backslash followed by a quote). */
function unescapePyString(s: string): string {
  return s.replace(/\\(x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|.)/g, (_, e: string) => {
    if (e.length > 1) return String.fromCharCode(parseInt(e.slice(1), 16));
    return PY_ESCAPES[e] ?? "\\" + e;
  });
}

export function parseToolInput(input: string): ToolInputObject | null {
  if (!input) return null;
  for (const text of [input, stripPyRepr(input)]) {
    try {
      const v = JSON.parse(text);
      if (v && typeof v === "object" && !Array.isArray(v)) return v as ToolInputObject;
    } catch {
      /* try next */
    }
  }
  return null;
}

export function toolFilePath(obj: ToolInputObject | null): string | null {
  if (!obj) return null;
  const fp = obj.file_path ?? obj.path ?? obj.target_file ?? obj.filename ?? obj.notebook_path;
  return typeof fp === "string" && fp ? fp : null;
}

/** One-line summary for a collapsed tool row. */
export function toolSummary(input: string): string {
  const obj = parseToolInput(input);
  if (!obj) return input.slice(0, 160);
  const pick = (k: string) => (typeof obj[k] === "string" ? (obj[k] as string) : "");
  const first = Object.values(obj).find((v) => typeof v === "string") as string | undefined;
  return (
    pick("command") ||
    pick("cmd") ||
    pick("pattern") ||
    pick("query") ||
    pick("url") ||
    toolFilePath(obj) ||
    pick("description") ||
    first ||
    ""
  );
}

export interface EditChange {
  path: string;
  oldText: string;
  newText: string;
}

const EDIT_TOOLS = /^(Edit|MultiEdit|str_replace|str_replace_editor|replace|edit_file)$/i;

/** Pull before/after text out of an Edit-family tool call. MultiEdit
 *  yields one change per entry in `edits`. Returns [] for anything that
 *  isn't an edit or doesn't carry both sides. */
export function extractEditChanges(name: string, input: string): EditChange[] {
  if (!EDIT_TOOLS.test(name)) return [];
  const obj = parseToolInput(input);
  const path = toolFilePath(obj);
  if (!obj || !path) return [];
  const one = (e: ToolInputObject): EditChange | null => {
    const o = e.old_string ?? e.old_str ?? e.oldText;
    const n = e.new_string ?? e.new_str ?? e.newText;
    if (typeof o !== "string" || typeof n !== "string") return null;
    return { path, oldText: o, newText: n };
  };
  if (Array.isArray(obj.edits)) {
    return (obj.edits as ToolInputObject[])
      .map((e) => (e && typeof e === "object" ? one(e) : null))
      .filter((c): c is EditChange => c !== null);
  }
  const c = one(obj);
  return c ? [c] : [];
}

export type ToolStatus = "running" | "done" | "error" | "denied";

/** Status of a saved tool call, inferred from its stitched output. A
 *  call with no output finished silently (most providers skip empty
 *  results), so it counts as done. */
export function inferToolStatus(output: string | undefined): ToolStatus {
  if (!output) return "done";
  const head = output.slice(0, 400);
  if (/\b(permission denied by user|user (rejected|denied)|tool use was rejected)\b/i.test(head)) {
    return "denied";
  }
  if (/^\s*(error|exception|traceback)\b|<tool_use_error>|\bexit code [1-9]\d*\b/i.test(head)) {
    return "error";
  }
  return "done";
}

/** Split a payload into display lines, keeping the first `max` and
 *  reporting how many were dropped. */
export function truncateLines(text: string, max: number): { shown: string; hidden: number } {
  const lines = text.split("\n");
  if (lines.length <= max) return { shown: text, hidden: 0 };
  return { shown: lines.slice(0, max).join("\n"), hidden: lines.length - max };
}
