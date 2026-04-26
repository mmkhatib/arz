import { useState, useEffect, useRef, useCallback } from "react";
import { Wrench, Bot, ScrollText, FileText, FileCode, FileJson, Settings, Image, Terminal, File, CheckCircle, Loader, X, Copy } from "lucide-react";
import { api } from "@/api/client";
import SegmentedControl from "./SegmentedControl";
import { useTouchedFiles } from "@/hooks/useTouchedFiles";

/* ── File icon map ── */
const FILE_ICONS: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  ts: FileCode, tsx: FileCode, js: FileCode, jsx: FileCode,
  py: FileCode, rs: FileCode, go: FileCode, java: FileCode, kt: FileCode, rb: FileCode,
  c: FileCode, cpp: FileCode, h: FileCode,
  json: FileJson, yaml: Settings, yml: Settings, toml: Settings, ini: Settings,
  md: FileText, mdx: FileText, txt: FileText, csv: FileText, log: FileText,
  png: Image, jpg: Image, jpeg: Image, gif: Image, svg: Image, webp: Image,
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

function ToolEntryCard({ entry, isLast, isActive }: { entry: ToolEntry; isLast: boolean; isActive: boolean }) {
  const inputText = useStreamText(entry.input || "");
  const outputText = useStreamText(entry.result || "");
  const [manualOpen, setManualOpen] = useState<boolean | null>(null);
  const expanded = manualOpen !== null ? manualOpen : isLast;
  const wasLast = useRef(isLast);
  const wasActive = useRef(isActive);

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
        {isActive ? <span className="w-2 h-2 rounded-full bg-[var(--cedar)] animate-pulse shrink-0" /> : <span className="text-[10px] text-green-400 shrink-0">✓</span>}
        <span className="text-[10px] text-[var(--muted)]/60 font-mono shrink-0">{entry.time}</span>
        <span className="text-[12px] text-[var(--muted)] bg-[var(--bg)] px-1 rounded shrink-0">{expanded ? "▾" : "▸"}</span>
      </div>
      {!expanded && previewInput && <div className="px-3 pb-2 text-[10px] text-[var(--muted)] font-mono truncate">{previewInput}</div>}
      {expanded && (
        <>
          {entry.input && <div className="px-3 pt-1 pb-2"><div className="text-[10px] text-[var(--muted)]/40 uppercase tracking-wider mb-1">Input</div><pre className="px-2.5 py-2 bg-[var(--bg)] rounded-md text-[11px] font-mono whitespace-pre-wrap break-all max-h-[150px] overflow-y-auto leading-relaxed text-[var(--muted)]">{inputText}</pre></div>}
          {entry.result && <div className="px-3 pb-2"><div className="text-[10px] text-[var(--muted)]/40 uppercase tracking-wider mb-1">Output</div><pre className="px-2.5 py-2 bg-[var(--bg)] rounded-md text-[11px] font-mono whitespace-pre-wrap break-all max-h-[200px] overflow-y-auto leading-relaxed text-[var(--muted)]">{outputText}</pre></div>}
        </>
      )}
    </div>
  );
}

/* ── SubagentCard ── */

const SUBAGENT_TOOLS = new Set(["Agent", "Task"]);

function extractTask(input: string): string {
  try {
    const obj = JSON.parse(input) as Record<string, unknown>;
    const task = obj.description ?? obj.prompt ?? obj.task ?? Object.values(obj).find((v) => typeof v === "string");
    if (typeof task === "string") return task.length > 300 ? task.slice(0, 300) + "…" : task;
  } catch {}
  return input.slice(0, 300);
}

function fmtElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function SubagentCard({ entry, startedAt }: { entry: ToolEntry; startedAt: number }) {
  const task = extractTask(entry.input);
  const outputText = useStreamText(entry.result || "");
  const [expanded, setExpanded] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  // Live elapsed timer while running
  useEffect(() => {
    if (entry.done) { setElapsed(Math.floor((Date.now() - startedAt) / 1000) * 1000); return; }
    const tick = () => setElapsed(Date.now() - startedAt);
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [entry.done, startedAt]);

  return (
    <div className={["mx-2 mb-3 rounded-lg border bg-[var(--surface)] overflow-hidden shadow-sm transition-all", entry.done ? "border-[var(--border)] opacity-80" : "border-[var(--cedar)]/40"].join(" ")}>
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
          {entry.done ? "Subagent complete" : "Subagent running…"}
        </span>
        <span className="text-[11px] text-[var(--muted)]/50 font-mono ml-auto shrink-0">{fmtElapsed(elapsed)}</span>
        {entry.done && (
          <span className="text-[12px] text-[var(--muted)] bg-[var(--bg)] px-1 rounded shrink-0 ml-1">{expanded ? "▾" : "▸"}</span>
        )}
      </div>

      {/* Task description — always visible */}
      <div className="px-3 pb-2">
        <div className="text-[10px] text-[var(--muted)]/40 uppercase tracking-wider mb-1">Task</div>
        <pre className="px-2.5 py-2 bg-[var(--bg)] rounded-md text-[11px] font-mono whitespace-pre-wrap break-all max-h-[80px] overflow-y-auto leading-relaxed text-[var(--muted)]/80">{task}</pre>
      </div>

      {/* Result — shown when done and expanded */}
      {entry.done && entry.result && expanded && (
        <div className="px-3 pb-2">
          <div className="text-[10px] text-[var(--muted)]/40 uppercase tracking-wider mb-1">Output</div>
          <pre className="px-2.5 py-2 bg-[var(--bg)] rounded-md text-[11px] font-mono whitespace-pre-wrap break-all max-h-[240px] overflow-y-auto leading-relaxed text-[var(--muted)]/80">{outputText}</pre>
        </div>
      )}
    </div>
  );
}

/* ── FileRow ── */
function FileRow({ path }: { path: string }) {
  const name = path.split("/").pop() || path;
  const parts = path.split("/").slice(0, -1);
  const fullDir = parts.join("/");
  const shortDir = parts.length > 3 ? "…/" + parts.slice(-3).join("/") : fullDir;
  const Icon = fileIcon(path);
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 hover:bg-[var(--bg)] cursor-pointer text-[13px]">
      <Icon size={12} className="text-[var(--muted)] shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-[var(--text)] truncate text-[12px]">{name}</div>
        {shortDir && <div className="text-[10px] text-[var(--muted)] truncate">{shortDir}</div>}
      </div>
    </div>
  );
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
}

/* ── File preview pane ── */
function FilePreview({ path, onClose }: { path: string; onClose: () => void }) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setContent(null); setError(null);
    api.readFile(path)
      .then((r) => setContent(r.content))
      .catch((e: Error) => setError(e.message));
  }, [path]);

  const copy = async () => {
    if (!content) return;
    try { await navigator.clipboard.writeText(content); }
    catch { const el = document.createElement("textarea"); el.value = content; document.body.appendChild(el); el.select(); document.execCommand("copy"); document.body.removeChild(el); }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const name = path.split("/").pop() || path;
  const ext = name.split(".").pop()?.toLowerCase() || "";

  return (
    <div className="border-t border-[var(--border)] flex flex-col min-h-0 max-h-[60%] shrink-0">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[var(--border)] shrink-0">
        <span className="text-[12px] font-medium text-[var(--text)] truncate flex-1" title={path}>{name}</span>
        <span className="text-[10px] text-[var(--muted)] font-mono truncate max-w-[120px] shrink-0" title={path}>{path}</span>
        {content && (
          <button onClick={copy} className="text-[10px] px-1.5 py-0.5 rounded border border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)] shrink-0">
            {copied ? "Copied!" : <Copy size={11} />}
          </button>
        )}
        <button onClick={onClose} className="text-[var(--muted)] hover:text-[var(--text)] shrink-0"><X size={13} /></button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {!content && !error && (
          <div className="flex items-center justify-center h-16 text-[var(--muted)]/40">
            <Loader size={14} className="animate-spin" />
          </div>
        )}
        {error && (
          <div className="px-3 py-2 text-[11px] text-red-400">{error}</div>
        )}
        {content && (
          <pre className="px-3 py-2 text-[11px] font-mono whitespace-pre overflow-x-auto text-[var(--muted)]/80 leading-relaxed">
            <code>{content}</code>
          </pre>
        )}
      </div>
      {ext && <div className="px-3 py-1 border-t border-[var(--border)] text-[10px] text-[var(--muted)]/40 shrink-0">{ext}</div>}
    </div>
  );
}

/* ── Main component ── */
export default function ActivityPane({ sessionId, toolEntries, sseLog = [], seedPaths, requestedFile, onFileOpenHandled, onClose, width, onWidthChange }: Props) {
  const [tab, setTab] = useState<Tab>("tools");
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);
  const files = useTouchedFiles(sessionId, toolEntries, seedPaths);

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
    { key: "files" as Tab,     label: "Files",   icon: <FileText size={12} />,   count: files.length },
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
                return <ToolEntryCard key={entry.callId + ri} entry={entry} isLast={origIdx === lastToolIdx} isActive={origIdx === activeIdx} />;
              })
            )
          )}

          {/* Files tab */}
          {tab === "files" && (
            files.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-[var(--muted)]/40 gap-2 py-8">
                <FileText size={24} /><span className="text-[13px]">No files accessed yet</span>
              </div>
            ) : (
              files.map((f) => (
                <div
                  key={f.path}
                  className={selectedFile === f.path ? "bg-[var(--cedar)]/10" : ""}
                  onClick={() => setSelectedFile((prev) => prev === f.path ? null : f.path)}
                >
                  <FileRow path={f.path} />
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
                <SubagentCard key={e.callId} entry={e} startedAt={startTimesRef.current.get(e.callId) ?? Date.now()} />
              ))
            )
          )}

          {/* Logs tab */}
          {tab === "logs" && (
            sseLog.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-[var(--muted)]/40 gap-2 py-8">
                <ScrollText size={24} /><span className="text-[13px]">No events yet</span>
              </div>
            ) : (
              <div className="px-2 flex flex-col gap-0.5">
                {sseLog.map((entry, i) => (
                  <div key={i} className="flex items-center gap-2 px-2 py-1 rounded text-[10px] font-mono hover:bg-[var(--bg)]">
                    <span className="text-[var(--cedar)] shrink-0">{entry.type}</span>
                    {entry.summary && <span className="text-[var(--muted)] truncate flex-1">{entry.summary}</span>}
                    <span className="text-[var(--muted)]/40 shrink-0">{entry.time}</span>
                  </div>
                ))}
              </div>
            )
          )}
        </div>

        {/* Inline file preview when a file is selected in the Files tab */}
        {selectedFile && (
          <FilePreview path={selectedFile} onClose={() => setSelectedFile(null)} />
        )}
      </div>
    </aside>
  );
}
