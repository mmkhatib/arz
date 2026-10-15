import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { splitLineRef, type PathRef } from "@/utils/pathRefs";
import { Wrench, Bot, ScrollText, FileText, FileCode, FileJson, Settings, Image as ImageIcon, Terminal, File, GitCompare, ListTodo, Gauge, Plus, X, Package, ChevronRight, Check, AlertTriangle, Ban, ExternalLink, FolderTree, Copy } from "lucide-react";
import { inferToolStatus, parseToolInput, stripPyRepr, toolFilePath, toolSummary } from "@/utils/toolInput";
import ArtifactsView from "./ArtifactsView";
import PanelEmpty from "./PanelEmpty";
import { api } from "@/api/client";
import SegmentedControl from "./SegmentedControl";
import { useTouchedFiles } from "@/hooks/useTouchedFiles";
import {
  usePanelTabs, isPinned, tabPath, PINNED_VIEWS, MENU_VIEWS,
  type PanelTabId, type PanelView,
} from "@/hooks/usePanelTabs";
import { collectFileChanges, latestTodos, todoProgress, type FileChange } from "@/utils/panelData";
import { FileViewer } from "./FileViewer";
import DiffTab from "./DiffTab";
import ChangesView from "./ChangesView";
import TasksView from "./TasksView";
import WorkspaceTree from "./WorkspaceTree";
import ContextBreakdown from "./ContextBreakdown";
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
  const outputText = useStreamText(entry.result || "");
  const [manualOpen, setManualOpen] = useState<boolean | null>(null);
  const expanded = manualOpen !== null ? manualOpen : isLast;
  const wasLast = useRef(isLast);
  const wasActive = useRef(isActive);
  const filePath = useMemo(() => toolFilePath(parseToolInput(entry.input)), [entry.input]);
  // Pretty-print JSON inputs (unwrapping Claude Code's `{'raw': …}` repr)
  // so the expanded card reads like the call, not like a Python dict.
  const prettyInput = useMemo(() => {
    const obj = parseToolInput(entry.input);
    return obj ? JSON.stringify(obj, null, 2) : stripPyRepr(entry.input || "");
  }, [entry.input]);
  const inputText = useStreamText(prettyInput);
  const status = entry.done ? inferToolStatus(entry.result) : "running";

  useEffect(() => {
    if (wasLast.current && !isLast) { const t = setTimeout(() => setManualOpen(false), 2000); return () => clearTimeout(t); }
    wasLast.current = isLast;
  }, [isLast]);
  useEffect(() => {
    if (wasActive.current && !isActive && manualOpen === null) { const t = setTimeout(() => setManualOpen(false), 2000); return () => clearTimeout(t); }
    wasActive.current = isActive;
  }, [isActive, manualOpen]);

  const preview = useMemo(() => {
    const raw = toolSummary(entry.input || "").replace(/\s+/g, " ");
    // A bare absolute path reads better as its last two segments.
    const short = raw.startsWith("/") && !raw.includes(" ") ? raw.split("/").slice(-2).join("/") : raw;
    return short.slice(0, 120);
  }, [entry.input]);

  return (
    <div
      className={[
        "mx-2 mb-1.5 rounded-lg border bg-[var(--bg)] overflow-hidden transition-colors",
        isActive ? "border-[var(--cedar-line)]" : expanded ? "border-[var(--border2)]" : "border-[var(--border)]",
      ].join(" ")}
    >
      <div
        className="group flex items-center gap-2 px-2.5 py-2 cursor-pointer hover:bg-[var(--s2)] transition-colors"
        onClick={() => setManualOpen(!expanded)}
      >
        <ChevronRight size={12} className={["shrink-0 text-[var(--muted)] transition-transform", expanded ? "rotate-90" : ""].join(" ")} />
        <ToolStatusIcon status={status} />
        <span className="text-[12px] font-medium text-[var(--text)] shrink-0">{entry.name}</span>
        <span className="text-[11px] font-mono text-[var(--muted)] truncate flex-1 min-w-0">{preview}</span>
        {filePath && onOpenFile && (
          <button
            onClick={(e) => { e.stopPropagation(); onOpenFile(filePath); }}
            title={`Open ${filePath}`}
            aria-label={`Open ${filePath}`}
            className="w-5 h-5 shrink-0 flex items-center justify-center rounded text-[var(--muted)] opacity-0 group-hover:opacity-100 hover:text-[var(--cedar-glow)] hover:bg-[var(--cedar-dim)]"
          >
            <ExternalLink size={11} />
          </button>
        )}
        <span className="text-[9.5px] text-[var(--muted)] font-mono shrink-0">{entry.time}</span>
      </div>
      {expanded && (
        <div className="border-t border-[var(--hairline)] bg-[var(--surface)]">
          {entry.input && (
            <div className="px-2.5 pt-2 pb-2">
              <div className="text-[9.5px] font-mono text-[var(--muted)] uppercase tracking-[.08em] mb-1">Input</div>
              <pre className="px-2.5 py-2 bg-[var(--bg)] border border-[var(--hairline)] rounded-md text-[11px] font-mono whitespace-pre-wrap break-all max-h-[180px] overflow-y-auto leading-relaxed text-[var(--text2)]">{inputText}</pre>
            </div>
          )}
          {entry.result && (
            <div className="px-2.5 pb-2.5">
              <div className="text-[9.5px] font-mono text-[var(--muted)] uppercase tracking-[.08em] mb-1">Output</div>
              {(isShellTool(entry.name) || hasAnsi(entry.result))
                ? <TerminalView text={outputText} maxHeightPx={220} />
                : <pre className="px-2.5 py-2 bg-[var(--bg)] border border-[var(--hairline)] rounded-md text-[11px] font-mono whitespace-pre-wrap break-all max-h-[220px] overflow-y-auto leading-relaxed text-[var(--text2)]">{outputText}</pre>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ToolStatusIcon({ status }: { status: ReturnType<typeof inferToolStatus> | "running" }) {
  if (status === "running") {
    return <span className="w-3 h-3 shrink-0 flex items-center justify-center"><span className="w-1.5 h-1.5 rounded-full bg-[var(--cedar-glow)] animate-pulse" /></span>;
  }
  if (status === "error") return <AlertTriangle size={12} className="shrink-0 text-[var(--ember)]" />;
  if (status === "denied") return <Ban size={12} className="shrink-0 text-[var(--dawn)]" />;
  return <Check size={12} className="shrink-0 text-[var(--pine)]" />;
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

  const isRunning = status === "running";
  return (
    <div
      onClick={() => setExpanded((v) => !v)}
      style={{
        margin: "0 8px 6px",
        border: `1px solid ${expanded ? "var(--cedar-line)" : "var(--border)"}`,
        borderRadius: 8,
        background: "var(--bg)",
        cursor: "pointer",
        transition: "border-color .12s",
        overflow: "hidden",
      }}
    >
      <div style={{ padding: "9px 10px" }}>
        {/* Header — dot + name + status */}
        <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 4 }}>
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: isRunning ? "var(--cedar-glow)" : "var(--pine)",
              boxShadow: isRunning ? "0 0 4px var(--cedar-glow)" : undefined,
              animation: isRunning ? "arz-pulse 1.6s infinite" : "none",
              flexShrink: 0,
            }}
          />
          <span
            style={{
              fontSize: 12,
              fontWeight: 500,
              color: "var(--text)",
              flex: 1,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {agentType ? `@${agentType}` : "subagent"}
          </span>
          <span
            style={{
              fontSize: 9.5,
              fontFamily: "var(--fm)",
              color: "var(--muted)",
              textTransform: "uppercase",
              letterSpacing: ".06em",
            }}
          >
            {status}
          </span>
        </div>
        {/* Role / task one-liner */}
        <div
          style={{
            fontSize: 11,
            color: "var(--text3)",
            lineHeight: 1.45,
            marginBottom: 6,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {fullTask.split("\n")[0].slice(0, 110)}
        </div>
        {/* Progress bar while running */}
        {isRunning && (
          <div
            style={{
              height: 2,
              background: "var(--s2)",
              borderRadius: 1,
              overflow: "hidden",
              marginBottom: 7,
            }}
          >
            <div
              style={{
                width: "40%",
                height: "100%",
                background: "var(--cedar-glow)",
                boxShadow: "0 0 4px var(--cedar-glow)",
                animation: "arz-slide 1.4s ease-in-out infinite",
              }}
            />
          </div>
        )}
        {/* Footer meta */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 9.5,
            fontFamily: "var(--fm)",
            color: "var(--muted)",
          }}
        >
          <span>{entry.name}</span>
          <span>·</span>
          <span>{fmtElapsed(elapsed)}</span>
          {entry.result && (
            <>
              <span>·</span>
              <span>{entry.result.length.toLocaleString()} chars</span>
            </>
          )}
          <span style={{ flex: 1 }} />
          <span>{expanded ? "▾" : "▸"}</span>
        </div>
      </div>
      {expanded && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            borderTop: "1px solid var(--hairline)",
            background: "var(--s2)",
            padding: "8px 10px",
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <div>
            <div
              style={{
                fontSize: 10,
                fontFamily: "var(--fm)",
                color: "var(--muted)",
                textTransform: "uppercase",
                letterSpacing: ".08em",
                marginBottom: 4,
              }}
            >
              Task
            </div>
            <pre
              style={{
                margin: 0,
                padding: "6px 8px",
                background: "var(--bg)",
                border: "1px solid var(--border)",
                borderRadius: 5,
                fontFamily: "var(--fm)",
                fontSize: 11,
                color: "var(--text2)",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                maxHeight: showFullTask ? 400 : 90,
                overflowY: "auto",
                lineHeight: 1.55,
              }}
            >
              {showFullTask ? fullTask : taskPreview}
            </pre>
            {hasMore && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowFullTask((v) => !v);
                }}
                style={{
                  marginTop: 4,
                  background: "transparent",
                  border: "none",
                  color: "var(--muted)",
                  fontSize: 10,
                  cursor: "pointer",
                }}
              >
                {showFullTask ? "Show less" : "Show full task"}
              </button>
            )}
          </div>
          {entry.done && entry.result && (
            <div>
              <div
                style={{
                  fontSize: 10,
                  fontFamily: "var(--fm)",
                  color: "var(--muted)",
                  textTransform: "uppercase",
                  letterSpacing: ".08em",
                  marginBottom: 4,
                }}
              >
                Output
              </div>
              {hasAnsi(entry.result)
                ? <TerminalView text={outputText} maxHeightPx={220} />
                : (
                  <pre
                    style={{
                      margin: 0,
                      padding: "6px 8px",
                      background: "var(--bg)",
                      border: "1px solid var(--border)",
                      borderRadius: 5,
                      fontFamily: "var(--fm)",
                      fontSize: 11,
                      color: "var(--text2)",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                      maxHeight: 220,
                      overflowY: "auto",
                      lineHeight: 1.55,
                    }}
                  >
                    {outputText}
                  </pre>
                )}
            </div>
          )}
          <div style={{ display: "flex", gap: 6 }}>
            <button
              onClick={handleCopy}
              style={btnStyle("ghost")}
            >
              {copied ? "Copied ✓" : "Copy task"}
            </button>
            {onSpawnSession && (
              <button onClick={handleSpawn} style={btnStyle("outline")}>
                New session
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function btnStyle(kind: "ghost" | "outline"): React.CSSProperties {
  return {
    padding: "4px 10px",
    background: kind === "outline" ? "var(--cedar-dim)" : "transparent",
    border: `1px solid ${kind === "outline" ? "var(--cedar-line)" : "var(--border)"}`,
    borderRadius: 5,
    color: kind === "outline" ? "var(--cedar-glow)" : "var(--muted)",
    fontSize: 11,
    fontFamily: "var(--fn)",
    cursor: "pointer",
  };
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

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}K`;
  return `${(bytes / 1024 / 1024).toFixed(1)}M`;
}

/* ── Types ── */
interface SseLogEntry { type: string; time: string; summary?: string; }

interface Props {
  sessionId: string;
  toolEntries: ToolEntry[];
  sseLog?: SseLogEntry[];
  seedPaths?: string[];
  requestedFile?: string | null;
  onFileOpenHandled?: () => void;
  /** Tab to surface on mount / when it changes (e.g. ContextRing click). */
  requestedTab?: PanelTabId | null;
  onTabRequestHandled?: () => void;
  onClose: () => void;
  width: number;
  onWidthChange: (w: number) => void;
  onSpawnSession?: (prompt: string) => void;
}

export const PANEL_MIN_WIDTH = 300;
export const PANEL_DEFAULT_WIDTH = 440;
export const PANEL_MAX_WIDTH = 900;

const VIEW_META: Record<PanelView, { label: string; icon: React.ComponentType<{ size?: number; className?: string }> }> = {
  files: { label: "Files", icon: FolderTree },
  artifacts: { label: "Artifacts", icon: Package },
  changes: { label: "Changes", icon: GitCompare },
  tools: { label: "Tools", icon: Wrench },
  tasks: { label: "Tasks", icon: ListTodo },
  context: { label: "Context", icon: Gauge },
  subagents: { label: "Agents", icon: Bot },
  logs: { label: "Logs", icon: ScrollText },
};

type FilesMode = "session" | "workspace";

/* ── Main component ── */
export default function ActivityPane({
  sessionId, toolEntries, sseLog = [], seedPaths, requestedFile, onFileOpenHandled,
  requestedTab, onTabRequestHandled, onClose, width, onWidthChange, onSpawnSession,
}: Props) {
  const tabs = usePanelTabs(sessionId);
  const { open: openTab, add: addTab, close: closeTab, activate } = tabs;
  const active = tabs.state.active;
  const [menuOpen, setMenuOpen] = useState(false);
  const [filesMode, setFilesMode] = useState<FilesMode>(() => {
    try { return localStorage.getItem("arz:files-mode") === "workspace" ? "workspace" : "session"; }
    catch { return "session"; }
  });
  const [workspaceFiles, setWorkspaceFiles] = useState<WorkspaceFile[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);
  const touchedFiles = useTouchedFiles(sessionId, toolEntries, seedPaths);
  const changes = useMemo(() => collectFileChanges(toolEntries), [toolEntries]);
  const changeByPath = useMemo(() => new Map(changes.map((c) => [c.path, c])), [changes]);
  const todos = useMemo(() => latestTodos(toolEntries), [toolEntries]);

  useEffect(() => {
    try { localStorage.setItem("arz:files-mode", filesMode); } catch { /* ignore */ }
  }, [filesMode]);

  // Chat links can carry a line (`path:42`, `path:10-20`); the tab is keyed
  // by path alone and the viewer scrolls to the remembered line.
  const [fileLines, setFileLines] = useState<Record<string, PathRef>>({});
  const openFile = useCallback((raw: string) => {
    const ref = splitLineRef(raw);
    if (ref.line != null) setFileLines((prev) => ({ ...prev, [ref.path]: ref }));
    openTab(`file:${ref.path}`);
  }, [openTab]);
  const openDiff = useCallback((p: string) => openTab(`diff:${p}`), [openTab]);

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

  // Fetch the session file list while the Files tab shows it; refresh every 5s
  useEffect(() => {
    if (active !== "files" || filesMode !== "session") return;
    let cancelled = false;
    const fetch = () => {
      api.fetchSessionFiles(sessionId)
        .then((data) => { if (!cancelled) setWorkspaceFiles(data); })
        .catch(() => {});
    };
    fetch();
    const id = setInterval(fetch, 5000);
    return () => { cancelled = true; clearInterval(id); };
  }, [active, filesMode, sessionId]);

  // Handle file open requested from outside (e.g., clicking a path in chat)
  useEffect(() => {
    if (requestedFile) {
      openFile(requestedFile);
      onFileOpenHandled?.();
    }
  }, [requestedFile, onFileOpenHandled, openFile]);

  useEffect(() => {
    if (requestedTab) {
      openTab(requestedTab);
      onTabRequestHandled?.();
    }
  }, [requestedTab, onTabRequestHandled, openTab]);

  // Track when each subagent callId first appeared
  const startTimesRef = useRef<Map<string, number>>(new Map());
  const subagentEntries = toolEntries.filter((e) => SUBAGENT_TOOLS.has(e.name));
  subagentEntries.forEach((e) => {
    if (!startTimesRef.current.has(e.callId)) startTimesRef.current.set(e.callId, Date.now());
  });

  // Surface the Agents tab when the first subagent appears
  const hadSubagents = useRef(false);
  useEffect(() => {
    if (subagentEntries.length > 0 && !hadSubagents.current) openTab("subagents");
    hadSubagents.current = subagentEntries.length > 0;
  }, [subagentEntries.length, openTab]);

  // Surface (but don't focus) the Tasks tab once the agent writes a plan.
  const hasTodos = !!todos && todos.length > 0;
  useEffect(() => {
    if (hasTodos) addTab("tasks");
  }, [hasTodos, addTab]);

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
    const clamp = (w: number) => Math.min(PANEL_MAX_WIDTH, Math.max(PANEL_MIN_WIDTH, w));
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      onWidthChange(clamp(dragStartW.current + dragStartX.current - e.clientX));
    };
    const onUp = (e: MouseEvent) => {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      const w = clamp(dragStartW.current + dragStartX.current - e.clientX);
      try { localStorage.setItem("arz:activity-width", String(Math.round(w))); } catch { /* ignore */ }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [onWidthChange]);

  const counts: Partial<Record<PanelView, string | number>> = {
    files: allFiles.length || undefined,
    artifacts: changes.length || undefined,
    changes: changes.length || undefined,
    tools: toolEntries.length || undefined,
    subagents: subagentEntries.length || undefined,
    logs: sseLog.length || undefined,
    tasks: hasTodos ? `${todoProgress(todos!).done}/${todos!.length}` : undefined,
  };

  const docTabs = tabs.state.open.filter((t) => tabPath(t) !== null);
  const isDoc = tabPath(active) !== null;

  return (
    <aside className="relative shrink-0 flex h-full" style={{ width }} aria-label="Side panel">
      {/* Left resize handle — a wide invisible hit area over the border,
          with a grip that shows on hover / while dragging. */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize side panel"
        className="group absolute -left-[3px] top-0 bottom-0 w-[7px] z-20 cursor-col-resize flex items-center justify-center"
        onMouseDown={handleResizeStart}
        onDoubleClick={() => { onWidthChange(PANEL_DEFAULT_WIDTH); try { localStorage.setItem("arz:activity-width", String(PANEL_DEFAULT_WIDTH)); } catch { /* ignore */ } }}
        title="Drag to resize · double-click to reset"
      >
        <span className="absolute inset-y-0 left-[3px] w-px bg-transparent group-hover:bg-[var(--cedar-line)] group-active:bg-[var(--cedar)] transition-colors" />
        <span className="relative w-[5px] h-9 rounded-full bg-[var(--border2)] opacity-0 group-hover:opacity-100 group-active:bg-[var(--cedar)] transition-opacity" />
      </div>

      <div className="flex-1 flex flex-col border-l border-[var(--border)] bg-[var(--surface)] min-w-0">
        {/* Tab strip — pinned views stay fixed at the left; opened views
            and documents scroll beside them; then "+" and close. */}
        <div role="tablist" aria-label="Side panel views" className="flex items-stretch border-b border-[var(--border)] shrink-0 min-w-0">
          {(() => {
            const renderTab = (id: PanelTabId, compact: boolean) => (
              <PanelTab
                key={id}
                id={id}
                active={active === id}
                count={(VIEW_META as Record<string, unknown>)[id] ? counts[id as PanelView] : undefined}
                busy={id === "tools" && activeIdx !== -1}
                change={changeByPath.get(tabPath(id) ?? "")}
                compact={compact}
                onActivate={() => activate(id)}
                onClose={isPinned(id) ? undefined : () => closeTab(id)}
              />
            );
            // Pinned views collapse to icon + count once the strip gets
            // crowded: a narrow panel, or any opened tab beside them.
            const crowded = width < 560 || tabs.state.open.length > 0;
            return (
              <>
                <div className="shrink-0 flex items-stretch">
                  {PINNED_VIEWS.map((id) => renderTab(id, crowded && active !== id))}
                </div>
                <div
                  className="flex-1 flex items-stretch overflow-x-auto min-w-0"
                  style={{ scrollbarWidth: "none" }}
                  onWheel={(e) => { if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) e.currentTarget.scrollLeft += e.deltaY; }}
                >
                  {tabs.state.open.map((id) => renderTab(id, false))}
                </div>
              </>
            );
          })()}
          <div className="relative shrink-0 flex items-center">
            <button
              onClick={() => setMenuOpen((v) => !v)}
              title="Open a view"
              aria-label="Open a view"
              className={["w-8 h-full flex items-center justify-center hover:text-[var(--text)] hover:bg-[var(--s2)] border-l border-[var(--hairline)]", menuOpen ? "text-[var(--text)] bg-[var(--s2)]" : "text-[var(--muted)]"].join(" ")}
            >
              <Plus size={14} />
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 top-full mt-1 z-50 w-52 rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-2)] py-1">
                  <div className="px-3 pt-1.5 pb-1 text-[9.5px] font-mono uppercase tracking-[.08em] text-[var(--muted)]">Open view</div>
                  {MENU_VIEWS.map((v) => {
                    const M = VIEW_META[v];
                    return (
                      <button
                        key={v}
                        onClick={() => { openTab(v); setMenuOpen(false); }}
                        className="w-full flex items-center gap-2.5 px-3 py-1.5 text-[12px] text-[var(--text2)] hover:bg-[var(--s2)] hover:text-[var(--text)]"
                      >
                        <M.icon size={13} />
                        <span className="flex-1 text-left">{M.label}</span>
                        {counts[v] !== undefined && (
                          <span className="text-[10px] font-mono text-[var(--muted)]">{counts[v]}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
          <button
            onClick={onClose}
            title="Close panel"
            aria-label="Close panel"
            className="w-8 shrink-0 flex items-center justify-center text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--s2)] border-l border-[var(--hairline)]"
          >
            <X size={14} />
          </button>
        </div>

        {/* Document tabs stay mounted so viewer/editor state (scroll, unsaved
            edits) survives switching tabs; only the active one is shown. */}
        {docTabs.map((id) => {
          const p = tabPath(id)!;
          return (
            <div key={id} className={active === id ? "flex-1 min-h-0 flex flex-col" : "hidden"}>
              {id.startsWith("file:") ? (
                <FileViewer
                  path={p}
                  onClose={() => closeTab(id)}
                  sessionId={sessionId}
                  line={fileLines[p]?.line}
                  endLine={fileLines[p]?.endLine}
                />
              ) : (
                <DiffTab
                  path={p}
                  change={changeByPath.get(p)}
                  onOpenFile={openFile}
                  onClose={() => closeTab(id)}
                />
              )}
            </div>
          );
        })}

        {!isDoc && (
          <div ref={scrollRef} onScroll={onScroll} className={["flex-1 overflow-y-auto", active === "tools" || active === "subagents" ? "py-2" : ""].join(" ")}>
            {/* Tools tab */}
            {active === "tools" && (
              toolEntries.length === 0 ? (
                <PanelEmpty
                  icon={Wrench}
                  title="No tool calls yet"
                  hint="Every command, search and file edit the agent makes streams here live, newest first. Click a call to see its input and output."
                />
              ) : (
                [...toolEntries].reverse().map((entry, ri) => {
                  const origIdx = toolEntries.length - 1 - ri;
                  return (
                    <ToolEntryCard
                      key={entry.callId + ri}
                      entry={entry}
                      isLast={origIdx === lastToolIdx}
                      isActive={origIdx === activeIdx}
                      onOpenFile={openFile}
                    />
                  );
                })
              )
            )}

            {/* Files tab — files this session touched, or the whole workspace tree */}
            {active === "files" && (
              <>
                <div className="px-2 py-1.5 border-b border-[var(--hairline)]">
                  <SegmentedControl
                    segments={[
                      { key: "session" as FilesMode, label: "Session", count: allFiles.length },
                      { key: "workspace" as FilesMode, label: "Workspace" },
                    ]}
                    value={filesMode}
                    onChange={setFilesMode}
                  />
                </div>
                {filesMode === "session" ? (
                  <ActivityFilesView files={allFiles} onOpen={openFile} onBrowse={() => setFilesMode("workspace")} />
                ) : (
                  <WorkspaceTree sessionId={sessionId} onOpen={openFile} fileIcon={fileIcon} />
                )}
              </>
            )}

            {active === "artifacts" && (
              <ArtifactsView changes={changes} onOpenFile={openFile} onOpenDiff={openDiff} />
            )}

            {active === "changes" && (
              <ChangesView sessionId={sessionId} changes={changes} onOpenDiff={openDiff} />
            )}

            {active === "tasks" && <TasksView todos={todos} />}

            {active === "context" && <ContextBreakdown sessionId={sessionId} refreshKey={toolEntries.length} />}

            {/* Subagents tab */}
            {active === "subagents" && (
              subagentEntries.length === 0 ? (
                <PanelEmpty
                  icon={Bot}
                  title="No subagents yet"
                  hint="When the agent delegates work to a subagent, each one shows here with its task, a live timer and its result."
                />
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
            {active === "logs" && <ActivityLogView entries={sseLog} />}
          </div>
        )}
      </div>
    </aside>
  );
}

function PanelTab({
  id, active, count, busy, change, compact, onActivate, onClose,
}: {
  id: PanelTabId;
  active: boolean;
  /** Narrow panel: inactive pinned views show icon + count only. */
  compact?: boolean;
  count?: string | number;
  busy?: boolean;
  change?: FileChange;
  onActivate: () => void;
  onClose?: () => void;
}) {
  const path = tabPath(id);
  const view = path ? null : VIEW_META[id as PanelView];
  const Icon = view ? view.icon : id.startsWith("diff:") ? GitCompare : fileIcon(path!);
  const label = view ? view.label : path!.split("/").pop() || path!;
  // Keep the active tab visible when the strip overflows (opening a view
  // from the + menu or a file from chat can land it off-screen).
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (active) ref.current?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [active]);
  return (
    <div
      ref={ref}
      role="tab"
      aria-label={path ? `${id.startsWith("diff:") ? "Diff " : ""}${label}` : label}
      aria-selected={active}
      tabIndex={0}
      onClick={onActivate}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onActivate(); } }}
      onAuxClick={(e) => { if (e.button === 1 && onClose) { e.preventDefault(); onClose(); } }}
      title={path ? `${id.startsWith("diff:") ? "Diff · " : ""}${path}` : label}
      className={[
        "group relative shrink-0 flex items-center gap-1.5 h-9 cursor-pointer text-[12px] border-r border-[var(--hairline)] transition-colors select-none outline-none focus-visible:bg-[var(--s2)]",
        active
          ? "bg-[var(--bg)] text-[var(--text)] font-medium after:absolute after:left-0 after:right-0 after:bottom-0 after:h-[2px] after:bg-[var(--cedar-glow)]"
          : "text-[var(--text3)] hover:text-[var(--text)] hover:bg-[var(--s2)]",
        compact ? "px-2.5" : "pl-3 pr-1.5",
      ].join(" ")}
    >
      <Icon size={13} className={id.startsWith("diff:") ? "text-[var(--dawn)]" : active ? "text-[var(--cedar-glow)]" : undefined} />
      {!compact && <span className={["truncate max-w-[140px]", path ? "font-mono text-[11px]" : ""].join(" ")}>{label}</span>}
      {busy && <span className="w-1.5 h-1.5 rounded-full bg-[var(--cedar)] animate-pulse" />}
      {count !== undefined && (
        <span className={["text-[9.5px] font-mono px-1 rounded-full leading-[14px]", active ? "bg-[var(--cedar-dim)] text-[var(--cedar-glow)]" : "bg-[var(--s2)] text-[var(--muted)]"].join(" ")}>{count}</span>
      )}
      {change && id.startsWith("diff:") && (
        <span className="text-[9.5px] font-mono" style={{ color: "var(--pine)" }}>+{change.added}</span>
      )}
      {onClose ? (
        <button
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          title="Close tab"
          className={[
            "w-4 h-4 flex items-center justify-center rounded hover:bg-[var(--border)] hover:text-[var(--text)]",
            active ? "opacity-70" : "opacity-0 group-hover:opacity-70",
          ].join(" ")}
        >
          <X size={10} />
        </button>
      ) : compact ? null : (
        <span className="w-0.5" />
      )}
    </div>
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
      <PanelEmpty
        icon={ScrollText}
        title="No events yet"
        hint="The raw event stream for this session — replies, tool calls, memory recalls and warnings — appears here as it happens."
      />
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

// ── ActivityFilesView — design-matched file list with click-to-open ──
// Each row is collapsable: click the chevron expands a small preview
// with View / Open buttons. Click the body opens the file in the
// FileViewer. Status row at top counts live vs static.
function ActivityFilesView({
  files,
  onOpen,
  onBrowse,
}: {
  files: WorkspaceFile[];
  onOpen: (path: string) => void;
  onBrowse: () => void;
}) {
  if (files.length === 0) {
    return (
      <PanelEmpty
        icon={FileText}
        title="No files in this session yet"
        hint="Files the agent reads, writes or that live in the session folder show up here. Open one to view or edit it in a tab."
        action={{ label: "Browse workspace", icon: FolderTree, onClick: onBrowse }}
      />
    );
  }
  const liveCount = files.filter((f) => f.live).length;
  const staticCount = files.length - liveCount;
  return (
    <div>
      <div className="flex items-center gap-3 px-3 py-2 border-b border-[var(--hairline)] text-[10.5px] font-mono text-[var(--muted)]">
        {liveCount > 0 && (
          <span className="inline-flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--cedar-glow)]" />
            {liveCount} touched
          </span>
        )}
        {staticCount > 0 && (
          <span className="inline-flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--text3)]" />
            {staticCount} in folder
          </span>
        )}
      </div>
      <div className="py-1">
        {files.map((f) => {
          const Icon = fileIcon(f.path);
          const name = f.name || f.path.split("/").pop() || f.path;
          const dir = f.rel_path.slice(0, Math.max(0, f.rel_path.length - name.length)).replace(/\/$/, "");
          return (
            <div
              key={f.path}
              role="button"
              tabIndex={0}
              onClick={() => onOpen(f.path)}
              onKeyDown={(e) => { if (e.key === "Enter") onOpen(f.path); }}
              title={f.path}
              className="group mx-1.5 flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer hover:bg-[var(--s2)] transition-colors"
            >
              <Icon size={13} className={f.live ? "shrink-0 text-[var(--cedar-glow)]" : "shrink-0 text-[var(--muted)]"} />
              <span className="min-w-0 flex-1 flex items-baseline gap-2">
                <span className="text-[12px] font-mono text-[var(--text)] truncate">{name}</span>
                {dir && <span className="text-[10px] text-[var(--muted)] truncate">{dir}</span>}
              </span>
              {f.live && <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-[var(--cedar-glow)]" title="Touched this session" />}
              {f.size > 0 && (
                <span className="shrink-0 text-[9.5px] font-mono text-[var(--muted)] group-hover:hidden">{formatSize(f.size)}</span>
              )}
              <button
                onClick={(e) => { e.stopPropagation(); void navigator.clipboard?.writeText(f.path); }}
                title="Copy path"
                aria-label="Copy path"
                className="hidden group-hover:flex w-5 h-5 shrink-0 items-center justify-center rounded text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--border)]"
              >
                <Copy size={11} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
