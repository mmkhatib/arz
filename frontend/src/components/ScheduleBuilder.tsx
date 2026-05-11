// ScheduleBuilder — human-friendly cron picker.
// Output is a 5-field cron expression, but the user picks frequency from
// a dropdown and fills only the fields that matter for that frequency.
// "Advanced" mode exposes the raw expression for power users.
//
// Supported modes:
//   every-minutes   →  */N * * * *
//   every-hours     →  0 */N * * *
//   hourly          →  M * * * *           (M = minute past the hour)
//   daily           →  M H * * *
//   weekly          →  M H * * D           (D = 0–6 Sun–Sat)
//   monthly         →  M H D * *
//   advanced        →  user-supplied raw expression
//
// `describe(cron)` renders a plain-English summary for any saved cron.

import { useEffect, useState } from "react";
import { CedarInput, CedarLabel } from "./CedarUI";

export type ScheduleMode =
  | "every-minutes"
  | "every-hours"
  | "hourly"
  | "daily"
  | "weekly"
  | "monthly"
  | "advanced";

interface State {
  mode: ScheduleMode;
  everyN: number; // for every-minutes / every-hours
  minute: number; // 0–59
  hour: number;   // 0–23
  weekday: number; // 0 Sun – 6 Sat
  dayOfMonth: number; // 1–31
  raw: string;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const DEFAULT: State = {
  mode: "daily",
  everyN: 15,
  minute: 0,
  hour: 9,
  weekday: 1,
  dayOfMonth: 1,
  raw: "0 9 * * *",
};

export function buildCron(s: State): string {
  switch (s.mode) {
    case "every-minutes":
      return `*/${clampInt(s.everyN, 1, 59)} * * * *`;
    case "every-hours":
      return `0 */${clampInt(s.everyN, 1, 23)} * * *`;
    case "hourly":
      return `${clampInt(s.minute, 0, 59)} * * * *`;
    case "daily":
      return `${clampInt(s.minute, 0, 59)} ${clampInt(s.hour, 0, 23)} * * *`;
    case "weekly":
      return `${clampInt(s.minute, 0, 59)} ${clampInt(s.hour, 0, 23)} * * ${clampInt(s.weekday, 0, 6)}`;
    case "monthly":
      return `${clampInt(s.minute, 0, 59)} ${clampInt(s.hour, 0, 23)} ${clampInt(s.dayOfMonth, 1, 31)} * *`;
    case "advanced":
      return s.raw.trim() || "0 9 * * *";
  }
}

export function parseCron(expr: string): State {
  const e = (expr || "").trim();
  // Common aliases
  if (e === "@hourly") return { ...DEFAULT, mode: "hourly", minute: 0 };
  if (e === "@daily" || e === "@midnight") return { ...DEFAULT, mode: "daily", hour: 0, minute: 0 };
  if (e === "@weekly") return { ...DEFAULT, mode: "weekly", hour: 0, minute: 0, weekday: 0 };
  if (e === "@monthly") return { ...DEFAULT, mode: "monthly", hour: 0, minute: 0, dayOfMonth: 1 };

  const parts = e.split(/\s+/);
  if (parts.length !== 5) {
    return { ...DEFAULT, mode: "advanced", raw: e || DEFAULT.raw };
  }
  const [mn, hr, dom, mon, dow] = parts;

  // every-minutes:  */N * * * *
  if (/^\*\/\d+$/.test(mn) && hr === "*" && dom === "*" && mon === "*" && dow === "*") {
    return { ...DEFAULT, mode: "every-minutes", everyN: Number(mn.slice(2)) };
  }
  // every-hours:  0 */N * * *
  if (mn === "0" && /^\*\/\d+$/.test(hr) && dom === "*" && mon === "*" && dow === "*") {
    return { ...DEFAULT, mode: "every-hours", everyN: Number(hr.slice(2)) };
  }
  // hourly:  M * * * *
  if (/^\d+$/.test(mn) && hr === "*" && dom === "*" && mon === "*" && dow === "*") {
    return { ...DEFAULT, mode: "hourly", minute: Number(mn) };
  }
  // daily:  M H * * *
  if (/^\d+$/.test(mn) && /^\d+$/.test(hr) && dom === "*" && mon === "*" && dow === "*") {
    return { ...DEFAULT, mode: "daily", minute: Number(mn), hour: Number(hr) };
  }
  // weekly:  M H * * D
  if (/^\d+$/.test(mn) && /^\d+$/.test(hr) && dom === "*" && mon === "*" && /^\d+$/.test(dow)) {
    return {
      ...DEFAULT,
      mode: "weekly",
      minute: Number(mn),
      hour: Number(hr),
      weekday: Number(dow) % 7,
    };
  }
  // monthly:  M H D * *
  if (/^\d+$/.test(mn) && /^\d+$/.test(hr) && /^\d+$/.test(dom) && mon === "*" && dow === "*") {
    return {
      ...DEFAULT,
      mode: "monthly",
      minute: Number(mn),
      hour: Number(hr),
      dayOfMonth: Number(dom),
    };
  }
  return { ...DEFAULT, mode: "advanced", raw: e };
}

export function describe(expr: string): string {
  const s = parseCron(expr);
  switch (s.mode) {
    case "every-minutes":
      return `Every ${s.everyN} minute${s.everyN === 1 ? "" : "s"}`;
    case "every-hours":
      return `Every ${s.everyN} hour${s.everyN === 1 ? "" : "s"}`;
    case "hourly":
      return s.minute === 0
        ? "Hourly on the hour"
        : `Hourly at :${String(s.minute).padStart(2, "0")}`;
    case "daily":
      return `Daily at ${fmtTime(s.hour, s.minute)}`;
    case "weekly":
      return `Weekly on ${DAYS[s.weekday]} at ${fmtTime(s.hour, s.minute)}`;
    case "monthly":
      return `Monthly on day ${s.dayOfMonth} at ${fmtTime(s.hour, s.minute)}`;
    case "advanced":
      return `Custom: ${expr}`;
  }
}

function fmtTime(h: number, m: number): string {
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function clampInt(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

export function ScheduleBuilder({
  value,
  onChange,
}: {
  value: string;
  onChange: (cron: string) => void;
}) {
  const [state, setState] = useState<State>(() => parseCron(value));

  // If parent passes a different cron in (e.g. switching from create→edit),
  // sync our internal state. We compare against the cron we'd emit so we
  // don't fight our own onChange.
  useEffect(() => {
    if (buildCron(state) !== value) {
      setState(parseCron(value));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const update = (patch: Partial<State>) => {
    const next = { ...state, ...patch };
    setState(next);
    onChange(buildCron(next));
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <ModeRow mode={state.mode} onChange={(mode) => update({ mode })} />
      <FieldsRow state={state} update={update} />
      <div
        style={{
          fontSize: 11.5,
          color: "var(--cedar-2)",
          fontFamily: "var(--fm)",
          padding: "6px 10px",
          background: "var(--cedar-dim)",
          border: "1px solid var(--cedar-line)",
          borderRadius: 6,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <span>{describe(buildCron(state))}</span>
        <code style={{ fontSize: 10.5, color: "var(--muted)" }}>{buildCron(state)}</code>
      </div>
    </div>
  );
}

function ModeRow({
  mode,
  onChange,
}: {
  mode: ScheduleMode;
  onChange: (m: ScheduleMode) => void;
}) {
  const opts: { v: ScheduleMode; label: string }[] = [
    { v: "every-minutes", label: "Every N min" },
    { v: "every-hours", label: "Every N hr" },
    { v: "hourly", label: "Hourly" },
    { v: "daily", label: "Daily" },
    { v: "weekly", label: "Weekly" },
    { v: "monthly", label: "Monthly" },
    { v: "advanced", label: "Custom" },
  ];
  return (
    <div>
      <CedarLabel>How often</CedarLabel>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {opts.map((o) => {
          const on = mode === o.v;
          return (
            <button
              key={o.v}
              type="button"
              onClick={() => onChange(o.v)}
              style={{
                padding: "5px 10px",
                fontSize: 11.5,
                borderRadius: 6,
                border: `1px solid ${on ? "var(--cedar-glow)" : "var(--border)"}`,
                background: on ? "var(--cedar-dim)" : "var(--bg)",
                color: on ? "var(--cedar-glow)" : "var(--text2)",
                cursor: "pointer",
                fontFamily: "var(--fn)",
              }}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function FieldsRow({
  state,
  update,
}: {
  state: State;
  update: (p: Partial<State>) => void;
}) {
  if (state.mode === "advanced") {
    return (
      <div>
        <CedarLabel>Cron expression</CedarLabel>
        <CedarInput
          value={state.raw}
          onChange={(e) => update({ raw: e.target.value })}
          placeholder="0 9 * * *"
          style={{ fontFamily: "var(--fm)" }}
        />
        <div style={{ fontSize: 10.5, color: "var(--muted)", fontFamily: "var(--fm)", marginTop: 4 }}>
          5 fields: minute · hour · day-of-month · month · day-of-week. Escape hatch for the unusual.
        </div>
      </div>
    );
  }

  if (state.mode === "every-minutes" || state.mode === "every-hours") {
    const isMin = state.mode === "every-minutes";
    const max = isMin ? 59 : 23;
    return (
      <Row label={`Every how many ${isMin ? "minutes" : "hours"}?`}>
        <NumberPicker
          value={state.everyN}
          min={1}
          max={max}
          onChange={(v) => update({ everyN: v })}
        />
        <span style={{ fontSize: 12, color: "var(--muted)" }}>{isMin ? "min" : "hr"}</span>
      </Row>
    );
  }

  if (state.mode === "hourly") {
    return (
      <Row label="At what minute past the hour?">
        <NumberPicker
          value={state.minute}
          min={0}
          max={59}
          onChange={(v) => update({ minute: v })}
        />
        <span style={{ fontSize: 12, color: "var(--muted)" }}>:MM</span>
      </Row>
    );
  }

  if (state.mode === "daily") {
    return <TimeRow state={state} update={update} />;
  }

  if (state.mode === "weekly") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <Row label="Which day of the week?">
          <div style={{ display: "flex", gap: 4 }}>
            {DAYS.map((d, i) => {
              const on = state.weekday === i;
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => update({ weekday: i })}
                  style={{
                    padding: "5px 9px",
                    fontSize: 11,
                    fontFamily: "var(--fm)",
                    borderRadius: 6,
                    border: `1px solid ${on ? "var(--cedar-glow)" : "var(--border)"}`,
                    background: on ? "var(--cedar-dim)" : "var(--bg)",
                    color: on ? "var(--cedar-glow)" : "var(--text2)",
                    cursor: "pointer",
                  }}
                >
                  {d}
                </button>
              );
            })}
          </div>
        </Row>
        <TimeRow state={state} update={update} />
      </div>
    );
  }

  // monthly
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <Row label="On which day of the month?">
        <NumberPicker
          value={state.dayOfMonth}
          min={1}
          max={31}
          onChange={(v) => update({ dayOfMonth: v })}
        />
        <span style={{ fontSize: 12, color: "var(--muted)" }}>1–31</span>
      </Row>
      <TimeRow state={state} update={update} />
    </div>
  );
}

function TimeRow({
  state,
  update,
}: {
  state: State;
  update: (p: Partial<State>) => void;
}) {
  // <input type="time"> gives a native HH:MM picker on all platforms.
  const hh = String(state.hour).padStart(2, "0");
  const mm = String(state.minute).padStart(2, "0");
  return (
    <Row label="At what time?">
      <input
        type="time"
        value={`${hh}:${mm}`}
        onChange={(e) => {
          const [h, m] = e.target.value.split(":").map((x) => Number(x));
          if (Number.isFinite(h) && Number.isFinite(m)) update({ hour: h, minute: m });
        }}
        style={{
          padding: "6px 10px",
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: 6,
          color: "var(--text)",
          fontSize: 13,
          fontFamily: "var(--fn)",
          colorScheme: "dark",
        }}
      />
    </Row>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <CedarLabel>{label}</CedarLabel>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>{children}</div>
    </div>
  );
}

function NumberPicker({
  value,
  min,
  max,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <input
      type="number"
      min={min}
      max={max}
      value={value}
      onChange={(e) => onChange(clampInt(Number(e.target.value), min, max))}
      style={{
        width: 80,
        padding: "6px 10px",
        background: "var(--bg)",
        border: "1px solid var(--border)",
        borderRadius: 6,
        color: "var(--text)",
        fontSize: 13,
        fontFamily: "var(--fn)",
      }}
    />
  );
}
