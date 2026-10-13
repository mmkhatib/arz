// Side-panel "Changes" tab: every file the agent edited this session
// (from the live tool stream) plus whatever else git reports dirty in the
// workspace. Click a row to open its diff tab.

import { useEffect, useState } from "react";
import { GitBranch, GitCompare, RefreshCw } from "lucide-react";
import { api, type GitFileStatus, type GitStatus } from "@/api/client";
import type { FileChange } from "@/utils/panelData";

const STATUS_META: Record<GitFileStatus, { label: string; color: string; title: string }> = {
  M: { label: "M", color: "var(--dawn)", title: "Modified" },
  A: { label: "A", color: "var(--pine)", title: "Added" },
  D: { label: "D", color: "var(--ember)", title: "Deleted" },
  U: { label: "U", color: "var(--pine)", title: "Untracked" },
};

export function GitBadge({ status }: { status: GitFileStatus | null | undefined }) {
  if (!status) return null;
  const m = STATUS_META[status];
  return (
    <span
      title={m.title}
      className="shrink-0 font-mono text-[9.5px] font-semibold w-3 text-center"
      style={{ color: m.color }}
    >
      {m.label}
    </span>
  );
}

function DiffStat({ added, removed }: { added: number; removed: number }) {
  return (
    <span className="shrink-0 font-mono text-[10px] flex gap-1.5">
      {added > 0 && <span style={{ color: "var(--pine)" }}>+{added}</span>}
      {removed > 0 && <span style={{ color: "var(--ember)" }}>−{removed}</span>}
    </span>
  );
}

interface Props {
  sessionId: string;
  changes: FileChange[];
  onOpenDiff: (path: string) => void;
}

export default function ChangesView({ sessionId, changes, onOpenDiff }: Props) {
  const [git, setGit] = useState<GitStatus | null>(null);
  const [tick, setTick] = useState(0);

  // Refresh git status when the session's edit count moves, plus a slow
  // poll so edits made outside the agent (user's editor) show up too.
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      api.fetchGitStatus(sessionId).then((g) => { if (!cancelled) setGit(g); }).catch(() => {});
    load();
    const id = setInterval(load, 10_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [sessionId, changes.length, tick]);

  const gitByPath = new Map((git?.files ?? []).map((f) => [f.path, f]));
  const sessionPaths = new Set(changes.map((c) => c.path));
  const otherDirty = (git?.files ?? []).filter((f) => !sessionPaths.has(f.path));
  const totals = changes.reduce(
    (acc, c) => ({ added: acc.added + c.added, removed: acc.removed + c.removed }),
    { added: 0, removed: 0 },
  );

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--hairline)] text-[10.5px] font-mono text-[var(--muted)]">
        {git?.is_repo && git.branch && (
          <span className="flex items-center gap-1 truncate" title="Current branch">
            <GitBranch size={11} /> {git.branch}
          </span>
        )}
        <span className="flex-1" />
        {changes.length > 0 && (
          <span className="flex items-center gap-1.5">
            {changes.length} file{changes.length === 1 ? "" : "s"}
            <DiffStat {...totals} />
          </span>
        )}
        <button
          onClick={() => setTick((n) => n + 1)}
          title="Refresh git status"
          className="w-5 h-5 flex items-center justify-center rounded hover:text-[var(--text)] hover:bg-[var(--s2)]"
        >
          <RefreshCw size={10} />
        </button>
      </div>

      {changes.length === 0 && otherDirty.length === 0 && (
        <div className="flex flex-col items-center justify-center text-[var(--muted)]/40 gap-2 py-10">
          <GitCompare size={24} />
          <span className="text-[13px]">No changes yet</span>
        </div>
      )}

      {changes.length > 0 && (
        <Section title="This session">
          {changes.map((c) => (
            <Row
              key={c.path}
              path={c.path}
              status={gitByPath.get(c.path)?.status ?? (c.created ? "A" : "M")}
              meta={<DiffStat added={c.added} removed={c.removed} />}
              sub={`${c.edits.length} edit${c.edits.length === 1 ? "" : "s"} · ${c.lastTime}`}
              onClick={() => onOpenDiff(c.path)}
            />
          ))}
        </Section>
      )}

      {otherDirty.length > 0 && (
        <Section title="Other uncommitted">
          {otherDirty.map((f) => (
            <Row
              key={f.path}
              path={f.path}
              label={f.rel_path}
              status={f.status}
              onClick={() => onOpenDiff(f.path)}
            />
          ))}
        </Section>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="py-1">
      <div className="px-3 pt-2 pb-1 text-[9.5px] font-mono uppercase tracking-[.08em] text-[var(--muted)]">
        {title}
      </div>
      {children}
    </div>
  );
}

function Row({
  path,
  label,
  status,
  meta,
  sub,
  onClick,
}: {
  path: string;
  label?: string;
  status: GitFileStatus | null;
  meta?: React.ReactNode;
  sub?: string;
  onClick: () => void;
}) {
  const name = path.split("/").pop() || path;
  const dir = (label ?? path).slice(0, Math.max(0, (label ?? path).length - name.length)).replace(/\/$/, "");
  return (
    <button
      onClick={onClick}
      title={path}
      className="w-full text-left flex items-center gap-2 px-3 py-1.5 hover:bg-[var(--s2)] transition-colors"
    >
      <GitBadge status={status} />
      <span className="min-w-0 flex-1">
        <span className="block text-[12px] font-mono text-[var(--text)] truncate">{name}</span>
        {(dir || sub) && (
          <span className="block text-[10px] text-[var(--muted)] truncate">
            {sub ?? dir}
          </span>
        )}
      </span>
      {meta}
    </button>
  );
}
