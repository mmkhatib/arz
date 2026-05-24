// Goal modal — text editor + two sliders for the auto-iter budget.
//
// Replaces the old single-textfield dialog so users can tune how long
// the loop should keep trying before parking. Two independent caps,
// both enforced server-side (chat.py auto-iter loop):
//
//   - Iterations: 1..50 (hard backend clamp = 200, UI cap = 50)
//   - Wall-clock: 0..60 minutes (0 = unlimited; backend cap = 3600s)
//
// Whichever cap trips first stops the loop and surfaces a chip in chat.

import { useEffect, useState } from "react";

interface Props {
  open: boolean;
  initialGoal: string;
  initialMaxIterations: number;
  initialMaxRuntimeS: number;
  onClose: () => void;
  onSubmit: (patch: { goal: string; max_iterations: number; max_runtime_s: number }) => void;
}

const MAX_ITER = 50;
const MAX_RUNTIME_MIN = 60;

export default function GoalModal({
  open,
  initialGoal,
  initialMaxIterations,
  initialMaxRuntimeS,
  onClose,
  onSubmit,
}: Props) {
  const [goal, setGoal] = useState(initialGoal);
  const [iters, setIters] = useState(Math.min(MAX_ITER, Math.max(1, initialMaxIterations || 20)));
  const [runtimeMin, setRuntimeMin] = useState(
    Math.min(MAX_RUNTIME_MIN, Math.max(0, Math.round((initialMaxRuntimeS || 0) / 60))),
  );

  useEffect(() => {
    if (!open) return;
    setGoal(initialGoal);
    setIters(Math.min(MAX_ITER, Math.max(1, initialMaxIterations || 20)));
    setRuntimeMin(
      Math.min(MAX_RUNTIME_MIN, Math.max(0, Math.round((initialMaxRuntimeS || 0) / 60))),
    );
  }, [open, initialGoal, initialMaxIterations, initialMaxRuntimeS]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const submit = () => {
    const trimmed = goal.trim();
    onSubmit({
      goal: trimmed,
      max_iterations: iters,
      max_runtime_s: runtimeMin * 60,
    });
  };

  const isEdit = initialGoal.trim().length > 0;
  const runtimeLabel = runtimeMin === 0 ? "unlimited" : `${runtimeMin} min`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-[520px] max-w-[92vw] rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl"
        style={{ fontFamily: "var(--ft, system-ui, sans-serif)" }}
      >
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <div>
            <div
              className="text-[10px] uppercase tracking-[.12em] text-[var(--muted)]"
              style={{ fontFamily: "var(--fm, ui-monospace, monospace)" }}
            >
              goal
            </div>
            <h2 className="text-[15px] font-medium text-[var(--text)] mt-0.5">
              {isEdit ? "Edit goal" : "Set goal"}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-[var(--muted)] hover:text-[var(--text)] text-xl leading-none -mt-1"
          >
            ×
          </button>
        </div>

        <div className="px-4 pb-2 text-[12px] text-[var(--muted)] leading-relaxed">
          Persistent objective. Injected into every turn so the model keeps it in mind. The
          evaluator re-checks after each reply and re-prompts the writer until met — or until one
          of the budgets below trips.
        </div>

        <div className="px-4 pt-2">
          <label className="block text-[11px] uppercase tracking-[.08em] text-[var(--muted)] mb-1">
            Goal
          </label>
          <textarea
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder="Ship the auth refactor and document the API."
            rows={3}
            autoFocus
            className="w-full px-3 py-2 text-[13px] bg-[var(--bg)] border border-[var(--border)] rounded-md text-[var(--text)] placeholder:text-[var(--muted)] focus:outline-none focus:border-[var(--cedar-line)] resize-none"
          />
        </div>

        <div className="px-4 pt-4">
          <div className="flex items-baseline justify-between mb-1">
            <label className="text-[11px] uppercase tracking-[.08em] text-[var(--muted)]">
              Max iterations
            </label>
            <span
              className="text-[12px] text-[var(--text)] tabular-nums"
              style={{ fontFamily: "var(--fm, ui-monospace, monospace)" }}
            >
              {iters} <span className="text-[var(--muted)]">/ {MAX_ITER}</span>
            </span>
          </div>
          <input
            type="range"
            min={1}
            max={MAX_ITER}
            step={1}
            value={iters}
            onChange={(e) => setIters(parseInt(e.target.value, 10))}
            className="w-full accent-[var(--cedar-glow,#c8a060)]"
          />
          <div
            className="text-[10.5px] text-[var(--muted)] mt-1"
            style={{ fontFamily: "var(--fm, ui-monospace, monospace)" }}
          >
            Stops after {iters} writer turn{iters === 1 ? "" : "s"}.
          </div>
        </div>

        <div className="px-4 pt-4 pb-4">
          <div className="flex items-baseline justify-between mb-1">
            <label className="text-[11px] uppercase tracking-[.08em] text-[var(--muted)]">
              Max wall-clock time
            </label>
            <span
              className="text-[12px] text-[var(--text)] tabular-nums"
              style={{ fontFamily: "var(--fm, ui-monospace, monospace)" }}
            >
              {runtimeLabel}{" "}
              <span className="text-[var(--muted)]">/ {MAX_RUNTIME_MIN}m</span>
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={MAX_RUNTIME_MIN}
            step={1}
            value={runtimeMin}
            onChange={(e) => setRuntimeMin(parseInt(e.target.value, 10))}
            className="w-full accent-[var(--cedar-glow,#c8a060)]"
          />
          <div
            className="text-[10.5px] text-[var(--muted)] mt-1"
            style={{ fontFamily: "var(--fm, ui-monospace, monospace)" }}
          >
            {runtimeMin === 0
              ? "No time limit (iteration cap still applies)."
              : `Loop parks ${runtimeMin} minute${runtimeMin === 1 ? "" : "s"} after the goal was set.`}
          </div>
        </div>

        <div className="flex justify-end gap-2 px-4 py-3 border-t border-[var(--border)] bg-[var(--bg)] rounded-b-xl">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-[12px] text-[var(--muted)] hover:text-[var(--text)] rounded-md hover:bg-[var(--s2)]"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            className="px-3 py-1.5 text-[12px] bg-[var(--cedar-dim)] border border-[var(--cedar-line)] text-[var(--cedar-glow)] rounded-md hover:bg-[var(--s2)]"
          >
            {goal.trim() ? (isEdit ? "Update goal" : "Set goal") : "Clear goal"}
          </button>
        </div>
      </div>
    </div>
  );
}
