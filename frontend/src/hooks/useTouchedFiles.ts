import { useMemo, useEffect, useRef } from "react";
import type { ToolEntry } from "@/components/ActivityPane";

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

export interface TouchedFile {
  path: string;
  ts: number;
  source: "tool";
}

export function useTouchedFiles(sessionId: string, toolEntries: ToolEntry[]): TouchedFile[] {
  const seen = useRef(new Set<string>());

  const files = useMemo(() => {
    const result: TouchedFile[] = [];
    const seenPaths = new Set<string>();
    for (const entry of toolEntries) {
      const path = extractPath(entry.name, entry.input);
      if (path && !seenPaths.has(path)) {
        seenPaths.add(path);
        result.push({ path, ts: Date.now(), source: "tool" });
      }
    }
    return result;
  }, [toolEntries]);

  useEffect(() => {
    if (files.length === 0) return;
    try {
      localStorage.setItem(`arz:files:${sessionId}`, JSON.stringify(files));
    } catch {}
  }, [sessionId, files]);

  useEffect(() => {
    seen.current = new Set(files.map((f) => f.path));
  }, [files]);

  return files;
}
