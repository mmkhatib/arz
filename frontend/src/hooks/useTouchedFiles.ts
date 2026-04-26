import { useMemo, useEffect, useRef, useState } from "react";
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

/**
 * Tracks files touched during a session.
 * - Persists to localStorage per session.
 * - Reloads when sessionId changes (e.g., switching sessions in the sidebar).
 * - Accepts seedPaths (from loaded message history) to pre-populate the list.
 */
export function useTouchedFiles(
  sessionId: string,
  toolEntries: ToolEntry[],
  seedPaths?: string[],
): TouchedFile[] {
  // Extra = files loaded from localStorage or seeded from history
  const [extra, setExtra] = useState<TouchedFile[]>(() => loadFromStorage(sessionId));
  const prevSessionId = useRef(sessionId);

  // Reload from localStorage when sessionId changes
  useEffect(() => {
    if (sessionId !== prevSessionId.current) {
      prevSessionId.current = sessionId;
      setExtra(loadFromStorage(sessionId));
    }
  }, [sessionId]);

  // Merge seed paths (from message history) into extra once, without duplicates
  const seedRef = useRef<string[]>([]);
  useEffect(() => {
    if (!seedPaths || seedPaths.length === 0) return;
    // Only process paths we haven't seen for this session
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

  // Reset seed tracking when sessionId changes
  useEffect(() => {
    seedRef.current = [];
  }, [sessionId]);

  // Derive from live toolEntries and merge with extra
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

  // Persist whenever files list grows
  useEffect(() => {
    if (files.length > 0) saveToStorage(sessionId, files);
  }, [sessionId, files]);

  return files;
}
