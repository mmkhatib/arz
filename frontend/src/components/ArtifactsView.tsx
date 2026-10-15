// Side-panel "Artifacts" tab: the files the agent produced this session —
// created or edited — grouped by kind. Click a row to open the file in a
// tab; the diff button opens what changed.

import { useState } from "react";
import {
  Check, Code2, Copy, Database, FileText, GitCompare, Globe, Image as ImageIcon, Package, File,
} from "lucide-react";
import {
  ARTIFACT_KIND_LABEL, groupArtifacts, type ArtifactKind, type FileChange,
} from "@/utils/panelData";
import { DiffStat } from "./ChangesView";
import PanelEmpty from "./PanelEmpty";

const KIND_META: Record<ArtifactKind, { icon: React.ComponentType<{ size?: number }>; color: string; bg: string }> = {
  html:  { icon: Globe,     color: "var(--dawn)",       bg: "var(--dawn-dim)" },
  doc:   { icon: FileText,  color: "var(--stone)",      bg: "var(--stone-dim)" },
  code:  { icon: Code2,     color: "var(--cedar-glow)", bg: "var(--cedar-dim)" },
  data:  { icon: Database,  color: "var(--pine)",       bg: "var(--pine-dim)" },
  image: { icon: ImageIcon, color: "var(--ember)",      bg: "var(--ember-dim)" },
  other: { icon: File,      color: "var(--text3)",      bg: "var(--s2)" },
};

function splitPath(p: string): { name: string; dir: string } {
  const parts = p.split(/[\\/]/);
  const name = parts.pop() || p;
  return { name, dir: parts.slice(-3).join("/") };
}

export default function ArtifactsView({
  changes,
  onOpenFile,
  onOpenDiff,
}: {
  changes: FileChange[];
  onOpenFile: (path: string) => void;
  onOpenDiff: (path: string) => void;
}) {
  if (changes.length === 0) {
    return (
      <PanelEmpty
        icon={Package}
        title="No artifacts yet"
        hint="Files the agent writes or edits in this session collect here — pages, docs, code and data — ready to open in a tab."
      />
    );
  }
  const groups = groupArtifacts(changes);
  const created = changes.filter((c) => c.created).length;
  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-3 px-3 py-2 border-b border-[var(--hairline)] text-[10.5px] font-mono text-[var(--muted)]">
        <span>{changes.length} file{changes.length === 1 ? "" : "s"}</span>
        {created > 0 && <span>{created} new</span>}
        <span className="flex-1" />
        <span className="flex gap-2">
          {groups.map((g) => {
            const M = KIND_META[g.kind];
            return (
              <span key={g.kind} className="inline-flex items-center gap-1" title={ARTIFACT_KIND_LABEL[g.kind]}>
                <span style={{ color: M.color }}><M.icon size={10} /></span>
                {g.items.length}
              </span>
            );
          })}
        </span>
      </div>
      {groups.map((g) => (
        <section key={g.kind} className="py-1">
          <div className="px-3 pt-2 pb-1 text-[9.5px] font-mono uppercase tracking-[.08em] text-[var(--muted)]">
            {ARTIFACT_KIND_LABEL[g.kind]} <span className="opacity-60">· {g.items.length}</span>
          </div>
          {g.items.map((c) => (
            <ArtifactRow key={c.path} change={c} kind={g.kind} onOpenFile={onOpenFile} onOpenDiff={onOpenDiff} />
          ))}
        </section>
      ))}
    </div>
  );
}

function ArtifactRow({
  change, kind, onOpenFile, onOpenDiff,
}: {
  change: FileChange;
  kind: ArtifactKind;
  onOpenFile: (p: string) => void;
  onOpenDiff: (p: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const M = KIND_META[kind];
  const { name, dir } = splitPath(change.path);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpenFile(change.path)}
      onKeyDown={(e) => { if (e.key === "Enter") onOpenFile(change.path); }}
      title={change.path}
      className="group mx-1.5 flex items-center gap-2.5 px-2 py-1.5 rounded-md cursor-pointer hover:bg-[var(--s2)] transition-colors"
    >
      <span
        className="w-7 h-7 shrink-0 rounded-md flex items-center justify-center"
        style={{ color: M.color, background: M.bg }}
      >
        <M.icon size={13} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="text-[12px] font-mono text-[var(--text)] truncate">{name}</span>
          <span
            className="shrink-0 text-[9px] font-mono uppercase tracking-wider px-1 rounded"
            style={change.created
              ? { color: "var(--pine)", background: "var(--pine-dim)" }
              : { color: "var(--dawn)", background: "var(--dawn-dim)" }}
          >
            {change.created ? "new" : "edited"}
          </span>
        </span>
        <span className="block text-[10px] text-[var(--muted)] truncate">
          {dir ? `${dir}/` : ""}
        </span>
      </span>
      <span className="group-hover:hidden"><DiffStat added={change.added} removed={change.removed} /></span>
      <span className="hidden group-hover:flex items-center gap-0.5">
        <IconBtn title="View diff" onClick={() => onOpenDiff(change.path)}><GitCompare size={12} /></IconBtn>
        <IconBtn
          title={copied ? "Copied" : "Copy path"}
          onClick={() => {
            void navigator.clipboard?.writeText(change.path).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1200);
            });
          }}
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
        </IconBtn>
      </span>
    </div>
  );
}

function IconBtn({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      title={title}
      aria-label={title}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className="w-6 h-6 flex items-center justify-center rounded text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--border)]"
    >
      {children}
    </button>
  );
}
