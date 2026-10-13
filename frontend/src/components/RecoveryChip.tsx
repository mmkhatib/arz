import { useState } from "react";
import { ChevronRight, RotateCw } from "lucide-react";
import type { RecoveryNote } from "@/utils/recovery";

/** System-sent continuation — shown as a quiet chip, expandable to the
 * exact text the model received. */
export default function RecoveryChip({ note }: { note: RecoveryNote }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="my-2 flex flex-col items-center">
      <button
        onClick={() => setOpen((v) => !v)}
        title="Arz continued this turn automatically"
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-[var(--border)] text-[11px] text-[var(--muted)] hover:text-[var(--text)] hover:border-[var(--cedar)]/50 transition-colors"
      >
        <RotateCw size={10} className="text-[var(--cedar-glow)]" />
        <span>{note.label} · auto-continued</span>
        <ChevronRight size={10} className={["transition-transform", open ? "rotate-90" : ""].join(" ")} />
      </button>
      {open && (
        <p className="mt-1.5 max-w-xl text-[11.5px] leading-relaxed text-[var(--muted)] whitespace-pre-wrap text-center">
          {note.body}
        </p>
      )}
    </div>
  );
}
