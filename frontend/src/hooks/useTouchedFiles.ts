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
// quoted JSON-strings, or plain text with a path token.
function extractPath(toolName: string, toolInput: string): string | null {
  if (!toolName || !toolInput) return null;
  const lower = toolName.toLowerCase();
  const looksLikeFileTool =
    FILE_TOOLS.has(toolName) ||
    /file|read|write|edit|view|notebook/.test(lower);
  if (!looksLikeFileTool) return null;

  // 1. JSON object with a known key.
  try {
    const obj = JSON.parse(toolInput);
    if (obj && typeof obj === "object") {
      for (const k of PATH_KEYS) {
        const v = (obj as Record<string, unknown>)[k];
        if (typeof v === "string" && v.trim()) return v.trim();
      }
      // Some tools nest input under "params" or "args".
      for (const wrap of ["params", "args", "arguments"]) {
        const inner = (obj as Record<string, unknown>)[wrap];
        if (inner && typeof inner === "object") {
          for (const k of PATH_KEYS) {
            const v = (inner as Record<string, unknown>)[k];
            if (typeof v === "string" && v.trim()) return v.trim();
          }
        }
      }
    } else if (typeof obj === "string" && looksLikePath(obj)) {
      return obj;
    }
  } catch {
    /* not JSON */
  }

  // 2. Plain string input — may itself be a path or a quoted path.
  const trimmed = toolInput.trim();
  if (looksLikePath(trimmed)) return trimmed;

  // 3. Find a path-looking token in the raw text (handles tool inputs
  //    that include file paths as the first arg).
  const m = trimmed.match(/(?:["']?)([\/\w.\-_~]*\/[\w.\-_]+\.[\w]+)(?:["']?)/);
  if (m) return m[1];

  return null;
}

function looksLikePath(s: string): boolean {
  if (!s || s.length > 500) return false;
  // Heuristic: contains a slash and an extension, OR is an absolute path.
  return /^\/?[\w.\-_~/]+\.[a-z0-9]{1,8}$/i.test(s) || s.startsWith("/");
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
