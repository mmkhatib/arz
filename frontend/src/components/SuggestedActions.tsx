import { CornerDownLeft, Sparkles } from "lucide-react";

/* Ranked "what next" row under the newest assistant reply.
 *
 * Every reply is asked to end with `[OPTIONS: …]` (see prompts/base.md);
 * `extractOptions` lifts that line out of the prose and hands the choices
 * here IN THE MODEL'S ORDER — first is the one it recommends, so it is the
 * one that gets the filled treatment. Clicking sends the label verbatim as
 * the user's next message, which means it steers into a running turn or
 * queues behind one exactly like typing it would.
 *
 * Rendered for the LAST assistant message only. Older turns already got
 * their answer, and a chat that keeps every historical chip row reads as
 * clutter rather than as a prompt to act.
 */
export default function SuggestedActions({
  choices,
  onPick,
  disabled = false,
}: {
  choices: string[];
  onPick: (text: string) => void;
  /** Dim + block while the reply that offered these is still streaming. */
  disabled?: boolean;
}) {
  if (choices.length === 0) return null;

  return (
    <div className={`mt-2 flex flex-col gap-1.5 ${disabled ? "opacity-50 pointer-events-none" : ""}`}>
      <div className="flex items-center gap-1.5 px-0.5 text-[9.5px] font-mono uppercase tracking-[0.14em] text-[var(--text3)]">
        <Sparkles size={10} className="text-[var(--cedar-glow)]" />
        Suggested next
        <span className="flex-1 h-px bg-[var(--border)]" />
      </div>

      <div className="flex flex-wrap gap-1.5">
        {choices.map((choice, i) => {
          const top = i === 0;
          return (
            <button
              key={`${i}-${choice}`}
              onClick={() => onPick(choice)}
              title={top ? `${choice} — recommended` : choice}
              className={[
                "group inline-flex items-center gap-1.5 max-w-full rounded-lg px-2.5 py-1.5",
                "text-[12.5px] text-left leading-snug transition-all duration-150",
                "hover:-translate-y-px active:translate-y-0",
                top
                  ? "bg-[var(--cedar-dim)] border border-[var(--cedar-line)] text-[var(--cedar-glow)] hover:bg-[var(--cedar)] hover:text-white hover:border-[var(--cedar)]"
                  : "bg-[var(--surface)] border border-[var(--border)] text-[var(--text2)] hover:border-[var(--cedar-line)] hover:text-[var(--cedar-glow)]",
              ].join(" ")}
            >
              <span
                className={[
                  "shrink-0 font-mono text-[9.5px] tabular-nums",
                  top ? "text-[var(--cedar-glow)] group-hover:text-white/80" : "text-[var(--muted)]",
                ].join(" ")}
              >
                {i + 1}
              </span>
              <span className="truncate">{choice}</span>
              <CornerDownLeft
                size={11}
                className={[
                  "shrink-0 transition-opacity",
                  top ? "opacity-70" : "opacity-0 group-hover:opacity-60",
                ].join(" ")}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}
