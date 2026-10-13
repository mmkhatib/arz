// Side-panel diff tab: Monaco's diff editor over one file.
//
// Two sources, toggled in the header:
//   - "vs HEAD"  — git's committed text vs the file on disk (/api/files/diff)
//   - "session"  — the agent's own Edit/Write calls replayed from the tool
//                  stream, so files outside a git checkout still get a diff
// Defaults to vs HEAD when the file is in a repo and actually differs,
// otherwise to the session edits.

import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Columns2, FileText, RefreshCw, Rows2, X } from "lucide-react";
import { api, type FileDiff } from "@/api/client";
import { langForPath } from "@/utils/hljs";
import { editsAsDiffPair, type FileChange } from "@/utils/panelData";

const DiffEditor = lazy(() =>
  import("@monaco-editor/react").then((m) => ({ default: m.DiffEditor })),
);

type Source = "git" | "session";

interface Props {
  path: string;
  change?: FileChange;
  onOpenFile: (path: string) => void;
  onClose: () => void;
}

export default function DiffTab({ path, change, onOpenFile, onClose }: Props) {
  const [git, setGit] = useState<FileDiff | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<Source | null>(null);
  const [split, setSplit] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    api
      .fetchFileDiff(path)
      .then((d) => { if (!cancelled) setGit(d); })
      .catch((e) => { if (!cancelled) { setGit(null); setError(String(e)); } });
    return () => { cancelled = true; };
  }, [path, tick]);

  const gitUsable = !!git && git.is_repo && git.original !== git.modified;
  const effective: Source = source ?? (gitUsable || !change ? "git" : "session");

  const pair = useMemo(() => {
    if (effective === "session" && change) return editsAsDiffPair(change);
    if (git) return { original: git.original, modified: git.modified };
    return null;
  }, [effective, change, git]);

  const name = path.split("/").pop() || path;
  const lang = langForPath(path) || "plaintext";

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border)] shrink-0">
        <span className="text-[12px] text-[var(--text)] font-mono truncate flex-1" title={path}>
          {name}
        </span>
        <div className="flex items-center rounded border border-[var(--border)] overflow-hidden text-[10.5px] font-mono">
          {(["git", "session"] as Source[]).map((s) => {
            const disabled = s === "session" ? !change : !git?.is_repo;
            const on = effective === s;
            return (
              <button
                key={s}
                disabled={disabled}
                onClick={() => setSource(s)}
                title={
                  s === "git"
                    ? git?.is_repo ? "Committed (HEAD) vs working copy" : "Not in a git repo"
                    : change ? `${change.edits.length} edit(s) this session` : "No edits this session"
                }
                className={[
                  "px-2 py-0.5 transition-colors",
                  on ? "bg-[var(--cedar-dim)] text-[var(--cedar-glow)]" : "text-[var(--muted)] hover:text-[var(--text)]",
                  disabled ? "opacity-40 cursor-not-allowed" : "",
                ].join(" ")}
              >
                {s === "git" ? "vs HEAD" : "session"}
              </button>
            );
          })}
        </div>
        <button
          onClick={() => setSplit((v) => !v)}
          title={split ? "Inline view" : "Side-by-side view"}
          className="w-6 h-6 flex items-center justify-center rounded text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--s2)]"
        >
          {split ? <Rows2 size={12} /> : <Columns2 size={12} />}
        </button>
        <button
          onClick={() => setTick((n) => n + 1)}
          title="Refresh"
          className="w-6 h-6 flex items-center justify-center rounded text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--s2)]"
        >
          <RefreshCw size={12} />
        </button>
        <button
          onClick={() => onOpenFile(path)}
          title="Open file"
          className="w-6 h-6 flex items-center justify-center rounded text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--s2)]"
        >
          <FileText size={12} />
        </button>
        <button
          onClick={onClose}
          title="Close diff"
          className="w-6 h-6 flex items-center justify-center rounded text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--s2)]"
        >
          <X size={12} />
        </button>
      </div>
      <div className="flex-1 min-h-0">
        {error && !change ? (
          <div className="p-4 text-[12px] text-[var(--ember)]">{error}</div>
        ) : !pair ? (
          <div className="p-4 text-[12px] text-[var(--muted)]">Loading diff…</div>
        ) : pair.original === pair.modified ? (
          <div className="p-4 text-[12px] text-[var(--muted)]">
            No differences{effective === "git" ? " from HEAD" : ""}.
          </div>
        ) : (
          <Suspense
            fallback={<div className="p-4 text-[12px] text-[var(--muted)]">Loading editor…</div>}
          >
            <DiffEditor
              height="100%"
              language={lang}
              original={pair.original}
              modified={pair.modified}
              theme="vs-dark"
              options={{
                readOnly: true,
                renderSideBySide: split,
                fontFamily: "var(--fm)",
                fontSize: 12,
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                automaticLayout: true,
                wordWrap: "on",
              }}
            />
          </Suspense>
        )}
      </div>
    </div>
  );
}
