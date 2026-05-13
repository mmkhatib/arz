import { useMemo, useEffect, useRef, useState } from "react";
import type { ToolEntry } from "@/components/ActivityPane";

// Tools across providers that touch files. Lenient list — claude-code,
// kiro, codex, gemini, ollama, anthropic SDK all use slightly different
// names. Anything that looks like a file op gets in.
const FILE_TOOLS = new Set([
  // Claude Code
  "Read", "Write", "Edit", "MultiEdit", "NotebookEdit", "Glob", "Grep",
  // Kiro / Codex / generic
  "read_file", "write_file", "edit_file", "create_file",
  "view_file", "view", "list_files", "file_search",
  "str_replace_editor", "str_replace_based_edit_tool", "str_replace",
  "write_to_file", "apply_patch",
  // Anthropic computer-use / common shapes
  "open_file", "save_file", "create",
]);

// Keys that commonly hold the file path inside a tool input JSON.
const PATH_KEYS = [
  "file_path", "path", "filepath", "filename", "file",
  "target_file", "source_file", "notebook_path",
  "pattern", // Glob/Grep
  "uri",
];

// Try hard to extract a usable path from a tool's input. Accepts JSON,
// Python-repr wrapped JSON (the `{'raw': '…'}` shape Claude Code emits),
// quoted JSON-strings, plain text, and Windows-style paths.
function extractPath(toolName: string, toolInput: string): string | null {
  if (!toolName || !toolInput) return null;
  const lower = toolName.toLowerCase();
  const looksLikeFileTool =
    FILE_TOOLS.has(toolName) ||
    /file|read|write|edit|view|notebook/.test(lower);
  if (!looksLikeFileTool) return null;

  // 0. Some providers (claude-code) wrap the JSON in a Python repr like
  //    {'raw': '<json string>'} — single-quoted, with escaped inner JSON.
  //    Pull the inner JSON out before parsing so we don't blow past it.
  let candidate = toolInput;
  const rawMatch = candidate.match(/['"]raw['"]\s*:\s*['"]([\s\S]*)['"]\s*\}\s*$/);
  if (rawMatch) {
    // The inner string has escaped quotes — unescape the most common ones.
    candidate = rawMatch[1].replace(/\\\\/g, "\\").replace(/\\"/g, '"').replace(/\\'/g, "'");
  }

  // 1. JSON object with a known key.
  for (const text of [candidate, toolInput]) {
    try {
      const obj = JSON.parse(text);
      const found = pickPathFromObject(obj);
      if (found) return found;
    } catch {
      /* not JSON, fall through */
    }
  }

  // 2. Regex-pull `"file_path": "..."` out of the raw blob, regardless of
  //    JSON shape. Covers double- and single-quoted wrappers and works
  //    when the outer container isn't strict JSON.
  for (const key of PATH_KEYS) {
    // Build a regex that matches "key" : "value" with either quote style.
    const re = new RegExp(
      `['"]` + key + `['"]\\s*:\\s*['"]([^'"]+?\\.[A-Za-z0-9]{1,8})['"]`,
    );
    const m = (candidate.match(re) || toolInput.match(re));
    if (m && m[1]) return m[1];
  }

  // 3. Plain string input — may itself be a path or a quoted path.
  const trimmed = (candidate || toolInput).trim();
  if (looksLikePath(trimmed)) return trimmed;

  // 4. Find a path-looking token in the raw text (handles tool inputs
  //    that include file paths as the first arg). Covers both POSIX and
  //    Windows separators.
  const m = trimmed.match(
    /(?:["']?)([A-Za-z]:[\\/][^\s"'`,;)\]]+\.[A-Za-z0-9]{1,8}|\/[^\s"'`,;)\]]+\.[A-Za-z0-9]{1,8}|\.{0,2}[\/\\][^\s"'`,;)\]]+\.[A-Za-z0-9]{1,8})(?:["']?)/,
  );
  if (m) return m[1];

  return null;
}

function pickPathFromObject(obj: unknown): string | null {
  if (!obj || typeof obj !== "object") {
    if (typeof obj === "string" && looksLikePath(obj)) return obj;
    return null;
  }
  const record = obj as Record<string, unknown>;
  for (const k of PATH_KEYS) {
    const v = record[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  for (const wrap of ["params", "args", "arguments", "raw"]) {
    const inner = record[wrap];
    if (typeof inner === "string") {
      // `raw` is often a stringified JSON blob; try parsing it.
      try {
        const parsed = JSON.parse(inner);
        const found = pickPathFromObject(parsed);
        if (found) return found;
      } catch {
        /* skip */
      }
    } else if (inner && typeof inner === "object") {
      const found = pickPathFromObject(inner);
      if (found) return found;
    }
  }
  return null;
}

function looksLikePath(s: string): boolean {
  if (!s || s.length > 500) return false;
  // POSIX (/foo/bar.ext or rel/bar.ext or bar.ext) or Windows (C:\foo\bar.ext).
  if (/^[A-Za-z]:[\\/]/.test(s)) return true;
  if (/^\/?[\w.\-_~/]+\.[a-z0-9]{1,8}$/i.test(s)) return true;
  // Bare filename with an extension counts — agents writing `hello.html`
  // in the cwd shouldn't get skipped.
  if (/^[\w.\-_~]+\.[a-z0-9]{1,8}$/i.test(s)) return true;
  return false;
}

export interface TouchedFile {
  path: string;
  ts: number;
  source: "tool" | "history" | "opened";
}

function storageKey(sessionId: string) {
  return `arz:files:${sessionId}`;
}

function loadFromStorage(sessionId: string): TouchedFile[] {
  try {
    const raw = localStorage.getItem(storageKey(sessionId));
    return raw ? (JSON.parse(raw) as TouchedFile[]) : [];
  } catch {
    return [];
  }
}

function saveToStorage(sessionId: string, files: TouchedFile[]) {
  try {
    localStorage.setItem(storageKey(sessionId), JSON.stringify(files));
  } catch {}
}

export function useTouchedFiles(
  sessionId: string,
  toolEntries: ToolEntry[],
  seedPaths?: string[],
): TouchedFile[] {
  const [extra, setExtra] = useState<TouchedFile[]>(() => loadFromStorage(sessionId));
  const prevSessionId = useRef(sessionId);

  useEffect(() => {
    if (sessionId !== prevSessionId.current) {
      prevSessionId.current = sessionId;
      setExtra(loadFromStorage(sessionId));
    }
  }, [sessionId]);

  const seedRef = useRef<string[]>([]);
  useEffect(() => {
    if (!seedPaths || seedPaths.length === 0) return;
    const newSeeds = seedPaths.filter((p) => !seedRef.current.includes(p));
    if (newSeeds.length === 0) return;
    seedRef.current = [...seedRef.current, ...newSeeds];
    setExtra((prev) => {
      const existingPaths = new Set(prev.map((f) => f.path));
      const toAdd = newSeeds
        .filter((p) => !existingPaths.has(p))
        .map((p) => ({ path: p, ts: Date.now(), source: "history" as const }));
      return toAdd.length > 0 ? [...prev, ...toAdd] : prev;
    });
  }, [seedPaths]);

  useEffect(() => { seedRef.current = []; }, [sessionId]);

  const files = useMemo(() => {
    const extraPaths = new Set(extra.map((f) => f.path));
    const newFromTools: TouchedFile[] = [];
    const seenInTools = new Set<string>();
    for (const entry of toolEntries) {
      const path = extractPath(entry.name, entry.input);
      if (path && !extraPaths.has(path) && !seenInTools.has(path)) {
        seenInTools.add(path);
        newFromTools.push({ path, ts: Date.now(), source: "tool" });
      }
    }
    return [...extra, ...newFromTools];
  }, [toolEntries, extra]);

  useEffect(() => {
    if (files.length > 0) saveToStorage(sessionId, files);
  }, [sessionId, files]);

  return files;
}

// Re-export so other modules can mirror seed-extraction logic.
export { extractPath as extractPathFromToolInput, FILE_TOOLS };
