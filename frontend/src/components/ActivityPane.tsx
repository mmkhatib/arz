import { useState, useEffect, useRef, useCallback } from "react";
import { Wrench, Bot, ScrollText, FileText, FileCode, FileJson, Settings, Image, Terminal, File } from "lucide-react";
import SegmentedControl from "./SegmentedControl";
import { useTouchedFiles } from "@/hooks/useTouchedFiles";

const FILE_ICONS: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  ts: FileCode, tsx: FileCode, js: FileCode, jsx: FileCode,
  py: FileCode, rs: FileCode, go: FileCode, java: FileCode, kt: FileCode, rb: FileCode,
  c: FileCode, cpp: FileCode, h: FileCode,
  json: FileJson, yaml: Settings, yml: Settings, toml: Settings, ini: Settings,
  md: FileText, mdx: FileText, txt: FileText, csv: FileText, log: FileText,
  png: Image, jpg: Image, jpeg: Image, gif: Image, svg: Image, webp: Image,
  sh: Terminal, bash: Terminal, zsh: Terminal,
};

function fileIcon(path: string): React.ComponentType<{ size?: number; className?: string }> {
  const ext = path.split(".").pop()?.toLowerCase() || "";
  return FILE_ICONS[ext] || File;
}

function useStreamText(text: string, charsPerTick = 8): string {
  const [shown, setShown] = useState(0);
  const prevText = useRef("");
  const shownRef = useRef(0);

  useEffect(() => {
    if (text !== prevText.current) {
      setShown(0);
      shownRef.current = 0;
      prevText.current = text;
    }
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
}: {
  entry: ToolEntry;
  isLast: boolean;
  isActive: boolean;
}) {
  const inputText = useStreamText(entry.input || "");
  const outputText = useStreamText(entry.result || "");
  const [manualOpen, setManualOpen] = useState<boolean | null>(null);
  const expanded = manualOpen !== null ? manualOpen : isLast;

  const wasLast = useRef(isLast);
  useEffect(() => {
    if (wasLast.current && !isLast) {
      const t = setTimeout(() => setManualOpen(false), 2000);
      return () => clearTimeout(t);
    }
    wasLast.current = isLast;
  }, [isLast]);

  const wasActive = useRef(isActive);
  useEffect(() => {
    if (wasActive.current && !isActive && manualOpen === null) {
      const t = setTimeout(() => setManualOpen(false), 2000);
      return () => clearTimeout(t);
    }
    wasActive.current = isActive;
  }, [isActive, manualOpen]);

  const previewInput = (() => {
    try {
      const obj = JSON.parse(entry.input);
      const first = Object.values(obj).find((v) => typeof v === "string") as string | undefined;
      return first ? (first.length > 80 ? first.slice(0, 77) + "…" : first) : "";
    } catch { return entry.input.slice(0, 80); }
  })();

  return (
    <div
      className={[
        "mx-2 mb-3 rounded-lg border bg-[var(--surface)] overflow-hidden shadow-sm transition-all",
        isActive ? "border-[var(--border)]/80 opacity-100" : "border-[var(--border)] opacity-70",
      ].join(" ")}
    >
      <div
        className="flex items-center gap-2 px-3 py-2.5 cursor-pointer hover:bg-[var(--bg)] transition-colors"
        onClick={() => setManualOpen(!expanded)}
      >
        <Wrench size={12} className="text-amber-400 shrink-0" />
        <span className="text-[13px] text-[var(--text)] truncate flex-1">{entry.name}</span>
        {!isActive && <span className="text-[10px] text-green-400 shrink-0">✓</span>}
        {isActive && <span className="w-2 h-2 rounded-full bg-[var(--cedar)] animate-pulse shrink-0" />}
        <span className="text-[10px] text-[var(--muted)]/60 font-mono shrink-0">{entry.time}</span>
        <span className="text-[12px] text-[var(--muted)] bg-[var(--bg)] px-1 rounded shrink-0">{expanded ? "▾" : "▸"}</span>
      </div>
      {!expanded && previewInput && (
        <div className="px-3 pb-2 text-[10px] text-[var(--muted)] font-mono truncate">{previewInput}</div>
      )}
      {expanded && (
        <>
          {entry.input && (
            <div className="px-3 pt-1 pb-2">
              <div className="text-[10px] text-[var(--muted)]/40 uppercase tracking-wider mb-1">Input</div>
              <pre className="px-2.5 py-2 bg-[var(--bg)] rounded-md text-[11px] font-mono whitespace-pre-wrap break-all max-h-[150px] overflow-y-auto leading-relaxed text-[var(--muted)]">
                {inputText}
              </pre>
            </div>
          )}
          {entry.result && (
            <div className="px-3 pb-2">
              <div className="text-[10px] text-[var(--muted)]/40 uppercase tracking-wider mb-1">Output</div>
              <pre className="px-2.5 py-2 bg-[var(--bg)] rounded-md text-[11px] font-mono whitespace-pre-wrap break-all max-h-[200px] overflow-y-auto leading-relaxed text-[var(--muted)]">
                {outputText}
              </pre>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function FileRow({ path }: { path: string }) {
  const name = path.split("/").pop() || path;
  const parts = path.split("/").slice(0, -1);
  const fullDir = parts.join("/");
  const shortDir = parts.length > 3 ? "…/" + parts.slice(-3).join("/") : fullDir;
  const Icon = fileIcon(path);

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 hover:bg-[var(--bg)] cursor-pointer text-[13px] group">
      <Icon size={12} className="text-[var(--muted)] shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-[var(--text)] truncate text-[12px]">{name}</div>
        {shortDir && <div className="text-[10px] text-[var(--muted)] truncate">{shortDir}</div>}
      </div>
    </div>
  );
}

type Tab = "tools" | "files" | "subagents" | "logs";

interface SseLogEntry {
  type: string;
  time: string;
  summary?: string;
}

interface Props {
  sessionId: string;
  toolEntries: ToolEntry[];
  sseLog?: SseLogEntry[];
  onClose: () => void;
}

export default function ActivityPane({ sessionId, toolEntries, sseLog = [], onClose }: Props) {
  const [tab, setTab] = useState<Tab>("tools");
  const scrollRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);
  const files = useTouchedFiles(sessionId, toolEntries);

  const lastToolIdx = toolEntries.reduce((last, e, i) => (e.done === false || i > last ? i : last), -1);
  const activeIdx = toolEntries.findIndex((e) => !e.done);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    isAtBottomRef.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 30;
  }, []);

  useEffect(() => {
    if (isAtBottomRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [toolEntries.length]);

  const TABS = [
    { key: "tools" as Tab,    label: "Tools",    icon: <Wrench size={12} />,     count: toolEntries.length },
    { key: "files" as Tab,    label: "Files",    icon: <FileText size={12} />,   count: files.length },
    { key: "subagents" as Tab, label: "Agents",  icon: <Bot size={12} />,        count: 0 },
    { key: "logs" as Tab,     label: "Logs",     icon: <ScrollText size={12} />, count: sseLog.length },
  ];

  return (
    <aside className="w-[300px] shrink-0 flex flex-col border-l border-[var(--border)] bg-[var(--surface)] h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border)] shrink-0">
        <span className="text-[12px] font-medium text-[var(--text)]">Activity</span>
        {activeIdx !== -1 && (
          <span className="flex items-center gap-1 text-[10px] text-[var(--cedar)] truncate max-w-[120px]">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--cedar)] animate-pulse shrink-0" />
            {toolEntries[activeIdx].name}
          </span>
        )}
        <button
          onClick={onClose}
          className="text-[var(--muted)] hover:text-[var(--text)] text-[18px] leading-none ml-2 shrink-0"
        >
          ×
        </button>
      </div>

      {/* Tab bar */}
      <div className="px-2 py-2 shrink-0 border-b border-[var(--border)]">
        <SegmentedControl segments={TABS} value={tab} onChange={setTab} />
      </div>

      {/* Content */}
      <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto py-2">
        {/* Tools tab */}
        {tab === "tools" && (
          toolEntries.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-[var(--muted)]/40 gap-2 py-8">
              <Wrench size={24} />
              <span className="text-[13px]">Waiting for activity…</span>
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
                />
              );
            })
          )
        )}

        {/* Files tab */}
        {tab === "files" && (
          files.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-[var(--muted)]/40 gap-2 py-8">
              <FileText size={24} />
              <span className="text-[13px]">No files accessed yet</span>
            </div>
          ) : (
            files.map((f) => <FileRow key={f.path} path={f.path} />)
          )
        )}

        {/* Subagents tab */}
        {tab === "subagents" && (
          <div className="flex flex-col items-center justify-center h-full text-[var(--muted)]/40 gap-2 py-8">
            <Bot size={24} />
            <span className="text-[13px]">No subagents running</span>
          </div>
        )}

        {/* Logs tab */}
        {tab === "logs" && (
          sseLog.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-[var(--muted)]/40 gap-2 py-8">
              <ScrollText size={24} />
              <span className="text-[13px]">No events yet</span>
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
    </aside>
  );
}
