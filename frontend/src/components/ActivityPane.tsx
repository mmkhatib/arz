import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Wrench, Bot, ScrollText, FileText, FileCode, FileJson, Settings, Image as ImageIcon, Terminal, File, CheckCircle, Loader } from "lucide-react";
import { api } from "@/api/client";
import SegmentedControl from "./SegmentedControl";
import { useTouchedFiles } from "@/hooks/useTouchedFiles";
import { FileViewer } from "./FileViewer";
import TerminalView, { isShellTool } from "./TerminalView";
import { hasAnsi } from "@/utils/ansi";

/* ── File icon map ── */
const FILE_ICONS: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  ts: FileCode, tsx: FileCode, js: FileCode, jsx: FileCode,
  py: FileCode, rs: FileCode, go: FileCode, java: FileCode, kt: FileCode, rb: FileCode,
  c: FileCode, cpp: FileCode, h: FileCode,
  json: FileJson, yaml: Settings, yml: Settings, toml: Settings, ini: Settings,
  md: FileText, mdx: FileText, txt: FileText, csv: FileText, log: FileText,
  png: ImageIcon, jpg: ImageIcon, jpeg: ImageIcon, gif: ImageIcon, svg: ImageIcon, webp: ImageIcon,
  sh: Terminal, bash: Terminal, zsh: Terminal,
};
function fileIcon(path: string) {
  return FILE_ICONS[path.split(".").pop()?.toLowerCase() || ""] || File;
}

/* ── Typewriter hook ── */
function useStreamText(text: string, charsPerTick = 8): string {
  const [shown, setShown] = useState(0);
  const prevText = useRef("");
  const shownRef = useRef(0);
  useEffect(() => {
    if (text !== prevText.current) { setShown(0); shownRef.current = 0; prevText.current = text; }
    if (shownRef.current >= text.length) return;
    const id = setInterval(() => {
      const next = Math.min(shownRef.current + charsPerTick, text.length);
      shownRef.current = next;
      setShown(next);
      if (next >= text.length) clearInterval(id);
    }, 30);
    return () => clearInterval(id);
  }, [text, charsPerTick]);
  return text.slice(0, shown);
}

/* ── ToolEntryCard ── */
export interface ToolEntry {
  callId: string;
  name: string;
  input: string;
  result?: string;
  done: boolean;
  time: string;
}

function ToolEntryCard({
  entry,
  isLast,
  isActive,
  onOpenFile,
}: {
  entry: ToolEntry;
  isLast: boolean;
  isActive: boolean;
  onOpenFile?: (path: string) => void;
}) {
  const inputText = useStreamText(entry.input || "");
  const outputText = useStreamText(entry.result || "");
  const [manualOpen, setManualOpen] = useState<boolean | null>(null);
  const expanded = manualOpen !== null ? manualOpen : isLast;
  const wasLast = useRef(isLast);
  const wasActive = useRef(isActive);
  const filePath = useMemo(() => {
    try {
      const obj = JSON.parse(entry.input);
      return (obj?.file_path || obj?.path || obj?.filename || obj?.target_file) ?? null;
    } catch { return null; }
  }, [entry.input]);

  useEffect(() => {
    if (wasLast.current && !isLast) { const t = setTimeout(() => setManualOpen(false), 2000); return () => clearTimeout(t); }
    wasLast.current = isLast;
  }, [isLast]);
  useEffect(() => {
    if (wasActive.current && !isActive && manualOpen === null) { const t = setTimeout(() => setManualOpen(false), 2000); return () => clearTimeout(t); }
    wasActive.current = isActive;
  }, [isActive, manualOpen]);

  const previewInput = (() => {
    try { const obj = JSON.parse(entry.input); const first = Object.values(obj).find((v) => typeof v === "string") as string | undefined; return first ? first.slice(0, 80) : ""; }
    catch { return entry.input.slice(0, 80); }
  })();

  return (
    <div className={["mx-2 mb-2 rounded-lg border bg-[var(--surface)] overflow-hidden shadow-sm transition-all", isActive ? "border-[var(--border)]/80" : "border-[var(--border)] opacity-70"].join(" ")}>
      <div className="flex items-center gap-2 px-3 py-2.5 cursor-pointer hover:bg-[var(--bg)] transition-colors" onClick={() => setManualOpen(!expanded)}>
        <Wrench size={12} className="text-amber-400 shrink-0" />
        <span className="text-[13px] text-[var(--text)] truncate flex-1">{entry.name}</span>
        {filePath && onOpenFile && (
          <button
            onClick={(e) => { e.stopPropagation(); onOpenFile(filePath); }}
            title={`Open ${filePath}`}
            className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--cedar-dim)] text-[var(--cedar-glow)] hover:bg-[var(--cedar-line)] shrink-0"
          >
            open
          </button>
        )}
        {isActive ? <span className="w-2 h-2 rounded-full bg-[var(--cedar)] animate-pulse shrink-0" /> : <span className="text-[10px] text-green-400 shrink-0">✓</span>}
        <span className="text-[10px] text-[var(--muted)]/60 font-mono shrink-0">{entry.time}</span>
        <span className="text-[12px] text-[var(--muted)] bg-[var(--bg)] px-1 rounded shrink-0">{expanded ? "▾" : "▸"}</span>
      </div>
      {!expanded && previewInput && <div className="px-3 pb-2 text-[10px] text-[var(--muted)] font-mono truncate">{previewInput}</div>}
      {expanded && (
        <>
          {entry.input && <div className="px-3 pt-1 pb-2"><div className="text-[10px] text-[var(--muted)]/40 uppercase tracking-wider mb-1">Input</div><pre className="px-2.5 py-2 bg-[var(--bg)] rounded-md text-[11px] font-mono whitespace-pre-wrap break-all max-h-[150px] overflow-y-auto leading-relaxed text-[var(--muted)]">{inputText}</pre></div>}
          {entry.result && (
            <div className="px-3 pb-2">
              <div className="text-[10px] text-[var(--muted)]/40 uppercase tracking-wider mb-1">Output</div>
              {(isShellTool(entry.name) || hasAnsi(entry.result))
                ? <TerminalView text={outputText} maxHeightPx={200} />
                : <pre className="px-2.5 py-2 bg-[var(--bg)] rounded-md text-[11px] font-mono whitespace-pre-wrap break-all max-h-[200px] overflow-y-auto leading-relaxed text-[var(--muted)]">{outputText}</pre>}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ── SubagentCard ── */

const SUBAGENT_TOOLS = new Set(["Agent", "Task"]);

function fmtElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function extractFullTask(input: string): string {
  try {
    const obj = JSON.parse(input) as Record<string, unknown>;
    const task = obj.description ?? obj.prompt ?? obj.task;
    if (typeof task === "string") return task;
    const first = Object.values(obj).find((v) => typeof v === "string");
    return typeof first === "string" ? first : input;
  } catch {
    return input;
  }
}

function extractAgentType(input: string): string | null {
  try {
    const obj = JSON.parse(input) as Record<string, unknown>;
    const t = obj.subagent_type ?? obj.agent ?? obj.type;
    return typeof t === "string" ? t : null;
  } catch {
    return null;
  }
}

function SubagentCard({
  entry,
  startedAt,
  onSpawnSession,
}: {
  entry: ToolEntry;
  startedAt: number;
  onSpawnSession?: (prompt: string) => void;
}) {
  const fullTask = extractFullTask(entry.input);
  const agentType = extractAgentType(entry.input);
  const outputText = useStreamText(entry.result || "");
  const [expanded, setExpanded] = useState(false);
  const [showFullTask, setShowFullTask] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [copied, setCopied] = useState(false);

  // Live elapsed timer while running
  useEffect(() => {
    if (entry.done) { setElapsed(Math.floor((Date.now() - startedAt) / 1000) * 1000); return; }
    const tick = () => setElapsed(Date.now() - startedAt);
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [entry.done, startedAt]);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    void navigator.clipboard.writeText(fullTask).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const handleSpawn = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSpawnSession?.(fullTask);
  };

  const taskPreview = fullTask.length > 240 ? fullTask.slice(0, 240) + "…" : fullTask;
  const hasMore = fullTask.length > 240;
  const status = !entry.done ? "running" : "complete";

  return (
    <div className={["mx-2 mb-3 rounded-lg border bg-[var(--surface)] overflow-hidden shadow-sm transition-all", entry.done ? "border-[var(--border)] opacity-90" : "border-[var(--cedar)]/40"].join(" ")}>
      {/* Header */}
      <div
        className={["flex items-center gap-2 px-3 py-2.5 transition-colors", entry.done ? "cursor-pointer hover:bg-[var(--bg)]" : ""].join(" ")}
        onClick={entry.done ? () => setExpanded((v) => !v) : undefined}
      >
        {entry.done
          ? <CheckCircle size={13} className="text-green-400 shrink-0" />
          : <Loader size={13} className="text-[var(--cedar)] animate-spin shrink-0" />
        }
        <span className="text-[13px] font-medium text-[var(--text)] shrink-0">
          {entry.done ? "Subagent" : "Subagent running…"}
        </span>
        {agentType && (
          <span className="text-[10px] font-mono text-[var(--cedar)] bg-[var(--cedar)]/10 px-1.5 py-0.5 rounded shrink-0">
            {agentType}
          </span>
        )}
        <span className={[
          "text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0",
          status === "running" ? "bg-amber-400/20 text-amber-300" : "bg-green-500/20 text-green-400",
        ].join(" ")}>{status}</span>
        <span className="text-[11px] text-[var(--muted)]/50 font-mono ml-auto shrink-0">{fmtElapsed(elapsed)}</span>
        {entry.done && (
          <span className="text-[12px] text-[var(--muted)] bg-[var(--bg)] px-1 rounded shrink-0 ml-1">{expanded ? "▾" : "▸"}</span>
        )}
      </div>

      {/* Task description — always visible */}
      <div className="px-3 pb-2">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] text-[var(--muted)]/40 uppercase tracking-wider">Task</span>
          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              className="text-[10px] text-[var(--muted)] hover:text-[var(--text)] transition-colors"
              title="Copy task to clipboard"
            >
              {copied ? "Copied ✓" : "Copy"}
            </button>
            {onSpawnSession && (
              <button
                onClick={handleSpawn}
                className="text-[10px] text-[var(--muted)] hover:text-[var(--cedar)] transition-colors"
                title="Open this task as a new session"
              >
                New session
              </button>
            )}
          </div>
        </div>
        <pre
          className={[
            "px-2.5 py-2 bg-[var(--bg)] rounded-md text-[11px] font-mono whitespace-pre-wrap break-words leading-relaxed text-[var(--muted)]/80",
            showFullTask ? "max-h-[400px] overflow-y-auto" : "max-h-[80px] overflow-y-auto",
          ].join(" ")}
        >
          {showFullTask ? fullTask : taskPreview}
        </pre>
        {hasMore && (
          <button
            onClick={(e) => { e.stopPropagation(); setShowFullTask((v) => !v); }}
            className="mt-1 text-[10px] text-[var(--muted)] hover:text-[var(--text)] transition-colors"
          >
            {showFullTask ? "Show less" : "Show full task"}
          </button>
        )}
      </div>

      {/* Result — shown when done and expanded */}
      {entry.done && entry.result && expanded && (
        <div className="px-3 pb-2">
          <div className="text-[10px] text-[var(--muted)]/40 uppercase tracking-wider mb-1">Output</div>
          {hasAnsi(entry.result || "")
            ? <TerminalView text={outputText} maxHeightPx={240} />
            : <pre className="px-2.5 py-2 bg-[var(--bg)] rounded-md text-[11px] font-mono whitespace-pre-wrap break-all max-h-[240px] overflow-y-auto leading-relaxed text-[var(--muted)]/80">{outputText}</pre>}
        </div>
      )}
    </div>
  );
}


/* ── WorkspaceFile type ── */
interface WorkspaceFile {
  path: string;
  rel_path: string;
  name: string;
  ext: string;
  size: number;
  live?: boolean; // touched during this session
}

/* ── FileRow ── */
function FileRow({ file, active }: { file: WorkspaceFile; active: boolean }) {
  const Icon = fileIcon(file.path);
  const dir = file.rel_path.includes("/")
    ? file.rel_path.slice(0, file.rel_path.lastIndexOf("/"))
    : "";
  return (
    <div className={[
      "flex items-center gap-2 px-3 py-1.5 cursor-pointer text-[13px] transition-colors",
      active ? "bg-[var(--cedar)]/10" : "hover:bg-[var(--bg)]",
    ].join(" ")}>
      <Icon size={12} className="text-[var(--muted)] shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-[var(--text)] truncate text-[12px] flex items-center gap-1">
          <span className="truncate">{file.name}</span>
          {file.live && <span className="w-1.5 h-1.5 rounded-full bg-[var(--cedar)] animate-pulse shrink-0" title="Touched this session" />}
        </div>
        {dir && <div className="text-[10px] text-[var(--muted)] truncate">{dir}</div>}
      </div>
      <span className="text-[9px] text-[var(--muted)]/40 font-mono shrink-0">{formatSize(file.size)}</span>
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}K`;
  return `${(bytes / 1024 / 1024).toFixed(1)}M`;
}

/* ── Types ── */
type Tab = "tools" | "files" | "subagents" | "logs";

interface SseLogEntry { type: string; time: string; summary?: string; }

interface Props {
  sessionId: string;
  toolEntries: ToolEntry[];
  sseLog?: SseLogEntry[];
  seedPaths?: string[];
  requestedFile?: string | null;
  onFileOpenHandled?: () => void;
  onClose: () => void;
  width: number;
  onWidthChange: (w: number) => void;
  onSpawnSession?: (prompt: string) => void;
}

/* ── Main component ── */
export default function ActivityPane({ sessionId, toolEntries, sseLog = [], seedPaths, requestedFile, onFileOpenHandled, onClose, width, onWidthChange, onSpawnSession }: Props) {
  const [tab, setTab] = useState<Tab>("files");
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [workspaceFiles, setWorkspaceFiles] = useState<WorkspaceFile[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);
  const touchedFiles = useTouchedFiles(sessionId, toolEntries, seedPaths);

  // Build merged file list: workspace scan + tool-touched
  const allFiles = useMemo<WorkspaceFile[]>(() => {
    const wsPathSet = new Set(workspaceFiles.map((f) => f.path));
    const livePathSet = new Set(touchedFiles.map((f) => f.path));
    // Workspace files get live marker if also touched
    const merged: WorkspaceFile[] = workspaceFiles.map((f) => ({
      ...f,
      live: livePathSet.has(f.path),
    }));
    // Add tool-touched files not in workspace (e.g. files outside workspace dir)
    for (const tf of touchedFiles) {
      if (!wsPathSet.has(tf.path)) {
        merged.push({
          path: tf.path,
          rel_path: tf.path.split("/").pop() || tf.path,
          name: tf.path.split("/").pop() || tf.path,
          ext: tf.path.split(".").pop()?.toLowerCase() || "",
          size: 0,
          live: true,
        });
      }
    }
    return merged;
  }, [workspaceFiles, touchedFiles]);

  // Fetch workspace files when Files tab is active; auto-refresh every 5s
  useEffect(() => {
    if (tab !== "files") return;
    let cancelled = false;
    const fetch = () => {
      api.fetchSessionFiles(sessionId)
        .then((data) => { if (!cancelled) setWorkspaceFiles(data); })
        .catch(() => {});
    };
    fetch();
    const id = setInterval(fetch, 5000);
    return () => { cancelled = true; clearInterval(id); };
  }, [tab, sessionId]);

  // Handle file open requested from outside (e.g., clicking a path in chat)
  useEffect(() => {
    if (requestedFile) {
      setTab("files");
      setSelectedFile(requestedFile);
      onFileOpenHandled?.();
    }
  }, [requestedFile, onFileOpenHandled]);

  // Track when each subagent callId first appeared
  const startTimesRef = useRef<Map<string, number>>(new Map());
  const subagentEntries = toolEntries.filter((e) => SUBAGENT_TOOLS.has(e.name));
  subagentEntries.forEach((e) => {
    if (!startTimesRef.current.has(e.callId)) startTimesRef.current.set(e.callId, Date.now());
  });

  // Auto-switch to Subagents tab when first subagent appears
  const hadSubagents = useRef(false);
  useEffect(() => {
    if (subagentEntries.length > 0 && !hadSubagents.current) { setTab("subagents"); }
    hadSubagents.current = subagentEntries.length > 0;
  }, [subagentEntries.length]);

  // Auto-switch to Files tab and open the latest touched file when one
  // appears. Acts like a "default to source view" — the moment the agent
  // creates or edits a file, that file is shown rendered with syntax
  // highlighting in the right pane.
  const lastSeenTouchedPath = useRef<string | null>(null);
  useEffect(() => {
    if (touchedFiles.length === 0) return;
    const latest = touchedFiles[touchedFiles.length - 1];
    if (latest.path === lastSeenTouchedPath.current) return;
    lastSeenTouchedPath.current = latest.path;
    setTab("files");
    setSelectedFile(latest.path);
  }, [touchedFiles]);

  const lastToolIdx = toolEntries.reduce((last, e, i) => (!e.done ? i : last), -1);
  const activeIdx = toolEntries.findIndex((e) => !e.done);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    isAtBottomRef.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 30;
  }, []);

  useEffect(() => {
    if (isAtBottomRef.current && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [toolEntries.length]);

  // Resize drag
  const dragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartW = useRef(0);

  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    dragStartX.current = e.clientX;
    dragStartW.current = width;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const delta = dragStartX.current - e.clientX;
      const w = Math.min(600, Math.max(220, dragStartW.current + delta));
      onWidthChange(w);
    };
    const onUp = (e: MouseEvent) => {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      const delta = dragStartX.current - e.clientX;
      const w = Math.min(600, Math.max(220, dragStartW.current + delta));
      localStorage.setItem("arz:activity-width", String(Math.round(w)));
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [onWidthChange]);

  const TABS = [
    { key: "tools" as Tab,     label: "Tools",   icon: <Wrench size={12} />,     count: toolEntries.length },
    { key: "files" as Tab,     label: "Files",   icon: <FileText size={12} />,   count: allFiles.length },
    { key: "subagents" as Tab, label: "Agents",  icon: <Bot size={12} />,        count: subagentEntries.length },
    { key: "logs" as Tab,      label: "Logs",    icon: <ScrollText size={12} />, count: sseLog.length },
  ];

  return (
    <aside className="shrink-0 flex h-full" style={{ width }}>
      {/* Left resize handle */}
      <div
        className="w-1 shrink-0 cursor-col-resize hover:bg-[var(--cedar)]/40 active:bg-[var(--cedar)] transition-colors"
        onMouseDown={handleResizeStart}
      />

      <div className="flex-1 flex flex-col border-l border-[var(--border)] bg-[var(--surface)] min-w-0">
        {/* FileViewer takes over the full pane when a file is selected */}
        {selectedFile ? (
          <FileViewer path={selectedFile} onClose={() => setSelectedFile(null)} sessionId={sessionId} />
        ) : (
          <>
            {/* Header */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border)] shrink-0">
              <span className="text-[12px] font-medium text-[var(--text)]">Activity</span>
              {activeIdx !== -1 && (
                <span className="flex items-center gap-1 text-[10px] text-[var(--cedar)] truncate max-w-[100px]">
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--cedar)] animate-pulse shrink-0" />
                  {toolEntries[activeIdx].name}
                </span>
              )}
              <button onClick={onClose} className="text-[var(--muted)] hover:text-[var(--text)] text-[18px] leading-none ml-2 shrink-0">×</button>
            </div>

            {/* Tab bar */}
            <div className="px-2 py-2 shrink-0 border-b border-[var(--border)] overflow-x-auto">
              <SegmentedControl segments={TABS} value={tab} onChange={setTab} />
            </div>

            {/* Content */}
            <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto py-2">
              {/* Tools tab */}
              {tab === "tools" && (
                toolEntries.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-[var(--muted)]/40 gap-2 py-8">
                    <Wrench size={24} /><span className="text-[13px]">Waiting for activity…</span>
                  </div>
                ) : (
                  [...toolEntries].reverse().map((entry, ri) => {
                    const origIdx = toolEntries.length - 1 - ri;
                    return (
                      <ToolEntryCard
                        key={entry.callId + ri}
                        entry={entry}
                        isLast={origIdx === lastToolIdx}
                        isActive={origIdx === activeIdx}
                        onOpenFile={(p) => { setTab("files"); setSelectedFile(p); }}
                      />
                    );
                  })
                )
              )}

              {/* Files tab */}
              {tab === "files" && (
                allFiles.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-[var(--muted)]/40 gap-2 py-8">
                    <FileText size={24} /><span className="text-[13px]">No files yet</span>
                  </div>
                ) : (
                  allFiles.map((f) => (
                    <div
                      key={f.path}
                      onClick={() => setSelectedFile(f.path)}
                    >
                      <FileRow file={f} active={false} />
                    </div>
                  ))
                )
              )}

              {/* Subagents tab */}
              {tab === "subagents" && (
                subagentEntries.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-[var(--muted)]/40 gap-2 py-8">
                    <Bot size={24} /><span className="text-[13px]">No subagents yet</span>
                  </div>
                ) : (
                  subagentEntries.map((e) => (
                    <SubagentCard
                      key={e.callId}
                      entry={e}
                      startedAt={startTimesRef.current.get(e.callId) ?? Date.now()}
                      onSpawnSession={onSpawnSession}
                    />
                  ))
                )
              )}

              {/* Logs tab */}
              {tab === "logs" && <ActivityLogView entries={sseLog} />}
            </div>
          </>
        )}
      </div>
    </aside>
  );
}

// ── ActivityLogView — design-matched log w/ level filters ──────
// Maps SSE event types onto five levels (asst / tool / sub / memory /
// warn) so the chip filter is meaningful. Anything else lands in "sys".
const LEVEL_META: Record<string, { color: string; glyph: string; label: string }> = {
  sys:    { color: "var(--text3)",      glyph: "·", label: "sys" },
  user:   { color: "var(--stone)",      glyph: "›", label: "user" },
  asst:   { color: "var(--cedar-glow)", glyph: "✦", label: "asst" },
  tool:   { color: "var(--cedar-2)",    glyph: "⚒", label: "tool" },
  sub:    { color: "var(--dawn)",       glyph: "⊚", label: "sub" },
  memory: { color: "var(--pine)",       glyph: "◉", label: "memory" },
  warn:   { color: "var(--ember)",      glyph: "!", label: "warn" },
};

function classifyLevel(type: string): keyof typeof LEVEL_META {
  const t = type.toLowerCase();
  if (t.includes("tool")) return "tool";
  if (t.includes("subagent") || t.includes("spawn")) return "sub";
  if (t.includes("memory") || t.includes("recall")) return "memory";
  if (t.includes("error") || t.includes("warn") || t.includes("fail")) return "warn";
  if (t.includes("user")) return "user";
  if (t === "text_chunk" || t === "complete" || t.includes("asst")) return "asst";
  return "sys";
}

function ActivityLogView({ entries }: { entries: { type: string; time: string; summary?: string }[] }) {
  const [filter, setFilter] = useState<string>("all");
  const [query, setQuery] = useState("");
  const filters: { key: string; label: string }[] = [
    { key: "all", label: "all" },
    { key: "asst", label: "asst" },
    { key: "tool", label: "tool" },
    { key: "sub", label: "sub" },
    { key: "memory", label: "memory" },
    { key: "warn", label: "warn" },
    { key: "sys", label: "sys" },
  ];
  const decorated = useMemo(
    () => entries.map((e) => ({ ...e, level: classifyLevel(e.type) })),
    [entries],
  );
  const q = query.trim().toLowerCase();
  const visible = decorated.filter((e) => {
    if (filter !== "all" && e.level !== filter) return false;
    if (q && !`${e.type} ${e.summary ?? ""}`.toLowerCase().includes(q)) return false;
    return true;
  });
  const counts: Record<string, number> = { all: decorated.length };
  for (const e of decorated) counts[e.level] = (counts[e.level] ?? 0) + 1;

  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-[var(--muted)]/40 gap-2 py-8">
        <ScrollText size={24} />
        <span className="text-[13px]">No events yet</span>
      </div>
    );
  }
  return (
    <div className="flex flex-col h-full min-h-0">
      <div
        className="flex items-center gap-2 px-2.5 py-2 border-b border-[var(--hairline)] overflow-x-auto"
        style={{ scrollbarWidth: "thin" }}
      >
        {filters.map((f) => {
          const on = filter === f.key;
          const c = counts[f.key] ?? 0;
          return (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className="shrink-0 transition-colors"
              style={{
                padding: "3px 9px",
                fontSize: 10.5,
                fontFamily: "var(--fm)",
                borderRadius: 4,
                background: on ? "var(--cedar-dim)" : "transparent",
                color: on ? "var(--cedar-glow)" : "var(--text3)",
                border: `1px solid ${on ? "var(--cedar-line)" : "transparent"}`,
                textTransform: "uppercase",
                letterSpacing: ".05em",
                cursor: "pointer",
              }}
            >
              {f.label} <span style={{ opacity: 0.55 }}>{c}</span>
            </button>
          );
        })}
      </div>
      <div className="px-2.5 py-1.5 border-b border-[var(--hairline)]">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter events…"
          className="w-full bg-[var(--bg)] border border-[var(--border)] rounded px-2 py-1 text-[11px] text-[var(--text)] focus:outline-none focus:border-[var(--cedar-line)]"
          style={{ fontFamily: "var(--fn)" }}
        />
      </div>
      <div className="flex-1 overflow-y-auto py-1" style={{ fontFamily: "var(--fm)", fontSize: 11 }}>
        {visible.map((e, i) => {
          const m = LEVEL_META[e.level];
          return (
            <div
              key={i}
              className="flex gap-2 px-3 py-1 items-baseline transition-colors hover:bg-[var(--s2)]"
              style={{ borderLeft: `2px solid transparent` }}
            >
              <span className="text-[var(--muted)] shrink-0" style={{ fontSize: 9.5, width: 56 }}>
                {e.time}
              </span>
              <span
                className="shrink-0 text-center"
                style={{ color: m.color, fontSize: 10, width: 12 }}
                title={m.label}
              >
                {m.glyph}
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-[var(--text2)] truncate">{e.type}</div>
                {e.summary && (
                  <div
                    className="text-[var(--muted)] truncate"
                    style={{ marginTop: 1 }}
                    title={e.summary}
                  >
                    {e.summary}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {visible.length === 0 && (
          <div className="px-3 py-6 text-center text-[var(--muted)]" style={{ fontSize: 11 }}>
            No events match.
          </div>
        )}
      </div>
      <div
        className="flex items-center gap-2 px-2.5 py-1.5 border-t border-[var(--hairline)]"
        style={{ fontFamily: "var(--fm)", fontSize: 10 }}
      >
        <span
          className="rounded-full"
          style={{
            width: 5,
            height: 5,
            background: "var(--cedar-glow)",
            animation: "arz-pulse 1.6s infinite",
          }}
        />
        <span className="text-[var(--muted)] flex-1">streaming · SSE</span>
        <span className="text-[var(--muted)]">
          {visible.length}/{entries.length}
        </span>
      </div>
    </div>
  );
}
