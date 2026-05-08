// Autopilot — multi-stage plan runner with editable preview.
//
// Flow:
//   1. User describes a goal (or pastes a markdown spec)
//   2. "Generate plan" → /api/taskrun/plan returns step strings
//   3. User reviews, edits any step, can add/remove rows
//   4. "Run plan" → /api/taskrun (with steps) kicks off backend
//   5. Page polls /api/taskrun/{id} and renders stage status live
//
// For simple tasks the user can also paste their own steps and skip
// the generate phase.

import { useEffect, useRef, useState } from "react";
import { Wand2, Plus, Trash2, Play, X, RefreshCw } from "lucide-react";
import { api } from "@/api/client";
import { CedarPage, CedarPageHeader, TopoLines } from "@/components/CedarUI";

type TaskRecord = Awaited<ReturnType<typeof api.getTask>>;

function fmtElapsed(rec: TaskRecord): string {
  const start = rec.started_at;
  const end = rec.finished_at || Date.now() / 1000;
  if (!start) return "—";
  const s = Math.max(0, end - start);
  if (s < 60) return `${s.toFixed(0)}s`;
  if (s < 3600) return `${(s / 60).toFixed(1)}m`;
  return `${(s / 3600).toFixed(1)}h`;
}

const STATUS_COLOR: Record<string, string> = {
  pending: "text-[var(--muted)]",
  running: "text-blue-400 animate-pulse",
  done: "text-emerald-400",
  failed: "text-red-400",
};

export default function AutopilotPage() {
  // Plan-builder state
  const [goal, setGoal] = useState("");
  const [agent, setAgent] = useState("general");
  const [steps, setSteps] = useState<string[]>([]);
  const [planning, setPlanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Active run state
  const [runId, setRunId] = useState<string | null>(null);
  const [run, setRun] = useState<TaskRecord | null>(null);
  const pollRef = useRef<number | null>(null);

  // Past runs
  const [history, setHistory] = useState<TaskRecord[]>([]);
  const refreshHistory = () => api.listTasks().then(setHistory).catch(() => {});

  useEffect(() => {
    refreshHistory();
  }, []);

  // Poll the active run until it finishes.
  useEffect(() => {
    if (!runId) return;
    const tick = async () => {
      try {
        const r = await api.getTask(runId);
        setRun(r);
        if (r.status === "done" || r.status === "failed") {
          if (pollRef.current) window.clearInterval(pollRef.current);
          refreshHistory();
        }
      } catch {
        // ignore — task might've been deleted
      }
    };
    tick();
    pollRef.current = window.setInterval(tick, 2000);
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [runId]);

  const generatePlan = async () => {
    if (!goal.trim()) return;
    setPlanning(true);
    setError(null);
    try {
      const r = await api.planTask(goal.trim(), agent);
      setSteps(r.steps);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPlanning(false);
    }
  };

  const runPlan = async () => {
    const cleanSteps = steps.map((s) => s.trim()).filter(Boolean);
    if (!goal.trim() || cleanSteps.length === 0) return;
    setError(null);
    try {
      const r = await api.kickoffTask(goal.trim(), agent, cleanSteps);
      setRunId(r.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const cancelRun = async () => {
    if (!runId) return;
    try {
      await api.cancelTask(runId);
    } catch {
      // ignore
    }
  };

  const reset = () => {
    setRunId(null);
    setRun(null);
  };

  const editStep = (i: number, text: string) => {
    setSteps((prev) => prev.map((s, idx) => (idx === i ? text : s)));
  };
  const removeStep = (i: number) => {
    setSteps((prev) => prev.filter((_, idx) => idx !== i));
  };
  const addStep = () => setSteps((prev) => [...prev, ""]);

  return (
    <CedarPage>
      <div style={{ position: "relative", overflow: "hidden" }}>
        <TopoLines height={120} opacity={0.5} />
        <CedarPageHeader
          eyebrow="autonomous rules"
          title={
            <>
              The <em style={{ fontStyle: "italic", color: "var(--cedar-glow)" }}>autopilot</em>.
            </>
          }
          sub="WHEN a condition fires, THEN take action. Multi-stage plan runner."
        />
      </div>
      <div className="overflow-y-auto px-8 py-6 flex-1 flex flex-col gap-4 max-w-4xl mx-auto w-full">
        {/* Active run takes over the page */}
        {run && (
          <div className="border border-[var(--cedar)]/40 rounded-lg bg-[var(--surface)] flex flex-col">
            <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--border)]">
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-semibold text-[var(--text)] truncate max-w-[320px]" title={run.spec}>
                  {run.spec.slice(0, 80)}
                </span>
                <span className={["text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded font-mono", STATUS_COLOR[run.status] ?? "text-[var(--muted)]"].join(" ")}>
                  {run.status}
                </span>
                <span className="text-[10px] text-[var(--muted)]/70 font-mono">{fmtElapsed(run)}</span>
              </div>
              <div className="flex items-center gap-1">
                {run.status === "running" || run.status === "decomposing" || run.status === "verifying" ? (
                  <button
                    onClick={cancelRun}
                    className="text-[11px] px-2 py-1 rounded-md text-red-400 hover:bg-red-400/10 flex items-center gap-1"
                    title="Cancel"
                  >
                    <X size={11} /> Cancel
                  </button>
                ) : (
                  <button
                    onClick={reset}
                    className="text-[11px] px-2 py-1 rounded-md text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--bg)]"
                  >
                    Done
                  </button>
                )}
              </div>
            </div>
            <div className="p-4 flex flex-col gap-2">
              {run.steps.map((s) => (
                <div key={s.n} className="flex items-start gap-2 text-[12px]">
                  <span className={["w-6 text-center font-mono shrink-0", STATUS_COLOR[s.status] ?? "text-[var(--muted)]"].join(" ")}>
                    {s.status === "done" ? "✓" : s.status === "failed" ? "✗" : s.status === "running" ? "…" : "·"}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-[var(--text)]">{s.text}</div>
                    {s.result && s.status !== "running" && (
                      <pre className="mt-1 text-[11px] font-mono text-[var(--muted)] bg-[var(--bg)] rounded p-2 whitespace-pre-wrap max-h-[160px] overflow-y-auto">
                        {s.result}
                      </pre>
                    )}
                  </div>
                </div>
              ))}
              {run.verdict && (
                <div className="mt-2 border-l-2 border-[var(--cedar)] pl-3 text-[12px] text-[var(--muted)] italic">
                  {run.verdict}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Plan builder — hidden while a run is active so the page focuses on the run */}
        {!run && (
          <div className="border border-[var(--border)] rounded-lg bg-[var(--surface)] flex flex-col gap-3 p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[13px] font-semibold text-[var(--text)]">Goal</span>
              <div className="flex items-center gap-2 text-[11px] text-[var(--muted)]">
                <span>Agent</span>
                <input
                  value={agent}
                  onChange={(e) => setAgent(e.target.value)}
                  className="w-32 bg-[var(--bg)] border border-[var(--border)] rounded-md px-2 py-1 text-[12px] font-mono text-[var(--text)] focus:outline-none focus:border-[var(--cedar)]"
                />
              </div>
            </div>
            <textarea
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder={"Describe what you want done. Multi-step or research-then-implement work — Autopilot will break it into stages.\n\nExample: refactor the chat panel to extract message rendering into its own component and add unit tests for it."}
              rows={5}
              className="bg-[var(--bg)] border border-[var(--border)] rounded-md px-2 py-1.5 text-[13px] text-[var(--text)] focus:outline-none focus:border-[var(--cedar)] resize-y"
            />
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={generatePlan}
                disabled={planning || !goal.trim()}
                className="flex items-center gap-1 px-3 py-1 rounded-md bg-[var(--bg)] border border-[var(--border)] text-[var(--text)] text-[12px] hover:border-[var(--cedar)]/50 disabled:opacity-40"
              >
                {planning ? <RefreshCw size={11} className="animate-spin" /> : <Wand2 size={11} />}
                {planning ? "Planning…" : "Generate plan"}
              </button>
            </div>

            {/* Editable plan */}
            {steps.length > 0 && (
              <div className="border border-[var(--border)] rounded-lg bg-[var(--bg)] flex flex-col">
                <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border)]">
                  <span className="text-[12px] font-semibold text-[var(--text)]">Plan</span>
                  <span className="text-[10px] uppercase tracking-wider text-[var(--muted)]/70 font-mono">
                    {steps.length} stage{steps.length === 1 ? "" : "s"}
                  </span>
                </div>
                <div className="flex flex-col">
                  {steps.map((s, i) => (
                    <div key={i} className="group flex items-start gap-2 px-3 py-2 border-b border-[var(--border)]/40 last:border-b-0">
                      <span className="w-6 text-center font-mono text-[var(--muted)]/70 shrink-0 mt-1.5">{i + 1}.</span>
                      <textarea
                        value={s}
                        onChange={(e) => editStep(i, e.target.value)}
                        rows={Math.max(1, Math.min(6, s.split("\n").length))}
                        className="flex-1 bg-transparent border-0 px-0 py-1 text-[12px] text-[var(--text)] focus:outline-none focus:bg-[var(--surface)] resize-none"
                      />
                      <button
                        onClick={() => removeStep(i)}
                        className="opacity-0 group-hover:opacity-100 text-[var(--muted)] hover:text-red-400 mt-1 shrink-0"
                        title="Remove stage"
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-between px-3 py-2 border-t border-[var(--border)]">
                  <button
                    onClick={addStep}
                    className="flex items-center gap-1 text-[11px] text-[var(--cedar)] hover:bg-[var(--surface)] px-2 py-1 rounded"
                  >
                    <Plus size={11} /> Add stage
                  </button>
                  <button
                    onClick={runPlan}
                    disabled={steps.length === 0 || !goal.trim()}
                    className="flex items-center gap-1 px-3 py-1 rounded-md bg-[var(--cedar)] text-white text-[12px] disabled:opacity-40 hover:bg-[var(--cedar-lt)]"
                  >
                    <Play size={11} /> Run plan
                  </button>
                </div>
              </div>
            )}

            {error && <div className="text-red-400 text-[11px] bg-red-900/20 rounded px-2 py-1">{error}</div>}
          </div>
        )}

        {/* Run history */}
        {!run && history.length > 0 && (
          <div className="border border-[var(--border)] rounded-lg bg-[var(--surface)] flex flex-col">
            <div className="px-4 py-2 border-b border-[var(--border)] text-[10px] uppercase tracking-wider text-[var(--muted)]">
              Recent runs
            </div>
            <div className="flex flex-col">
              {history.slice(0, 20).map((h) => (
                <button
                  key={h.id}
                  onClick={() => { setRunId(h.id); setRun(h); }}
                  className="text-left flex items-center gap-3 px-4 py-2 border-b border-[var(--border)]/40 last:border-b-0 hover:bg-[var(--bg)]"
                >
                  <span className={["text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded font-mono shrink-0", STATUS_COLOR[h.status] ?? "text-[var(--muted)]"].join(" ")}>
                    {h.status}
                  </span>
                  <span className="text-[12px] text-[var(--text)] truncate flex-1">{h.spec.slice(0, 100)}</span>
                  <span className="text-[10px] text-[var(--muted)]/60 font-mono shrink-0">
                    {h.steps.length} stage{h.steps.length === 1 ? "" : "s"}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </CedarPage>
  );
}
