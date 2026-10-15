// Schedule — recurring intentions. Three layouts per design:
//   * Sun  (default) — 24-hour clock dial w/ job pins on circumference
//   * Tape           — horizontal hour-strip per cron
//   * List           — card grid w/ cron expr + prompt + actions

import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, Play, Power, CalendarClock } from "lucide-react";
import EmptyState from "@/components/EmptyState";
import {
  CedarPage,
  CedarPageHeader,
  CedarCard,
  CedarModal,
  CedarInput,
  CedarTextArea,
  CedarLabel,
  Btn,
  Tag,
  SegSeg,
  TopoLines,
} from "@/components/CedarUI";
import { api, type CronEntry } from "@/api/client";
import { useDialog } from "@/components/Dialog";
import { ScheduleBuilder, describe as describeCron } from "@/components/ScheduleBuilder";

type Variant = "sun" | "tape" | "list";

const VARIANT_BLURB: Record<Variant, string> = {
  sun: "The dial is a 24-hour orbit; each job sits where it next fires.",
  tape: "Each row is a job laid across the day; the line marks now.",
  list: "Every job with its last run, status and controls.",
};

export default function SchedulePage() {
  const [variant, setVariant] = useState<Variant>(
    () => (localStorage.getItem("arz:schedule-variant") as Variant) || "sun",
  );
  useEffect(() => { localStorage.setItem("arz:schedule-variant", variant); }, [variant]);

  const [crons, setCrons] = useState<CronEntry[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<CronEntry | null>(null);
  const refresh = () => api.listCrons().then(setCrons).catch(() => {});
  useEffect(() => { refresh(); }, []);

  const enabled = crons.filter((c) => c.enabled).length;

  return (
    <CedarPage>
      <div style={{ position: "relative", overflow: "hidden" }}>
        <TopoLines height={120} opacity={0.5} />
        <CedarPageHeader
          eyebrow="cycles"
          title={
            <>
              The day's <em style={{ fontStyle: "italic", color: "var(--cedar-glow)" }}>tides</em>.
            </>
          }
          sub={`${crons.length} recurring job${crons.length === 1 ? "" : "s"} · ${enabled} enabled. ${VARIANT_BLURB[variant]}`}
          right={
            <>
              <SegSeg<Variant>
                value={variant}
                onChange={setVariant}
                options={[
                  { value: "sun", label: "Dial" },
                  { value: "tape", label: "Timeline" },
                  { value: "list", label: "List" },
                ]}
              />
              <Btn kind="solid" icon={<Plus size={13} />} onClick={() => setShowAdd(true)}>
                New job
              </Btn>
            </>
          }
        />
      </div>
      <div style={{ padding: "24px 32px 32px" }}>
        {variant === "sun" && <SunView crons={crons} onEdit={setEditing} />}
        {variant === "tape" && <TapeView crons={crons} onEdit={setEditing} />}
        {variant === "list" && <ListView crons={crons} onEdit={setEditing} refresh={refresh} />}
      </div>
      <JobModal
        open={showAdd || editing !== null}
        onClose={() => { setShowAdd(false); setEditing(null); }}
        onSaved={() => { refresh(); setShowAdd(false); setEditing(null); }}
        editing={editing}
      />
    </CedarPage>
  );
}

function JobModal({
  open,
  onClose,
  onSaved,
  editing,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  editing?: CronEntry | null;
}) {
  const isEdit = !!editing;
  const [name, setName] = useState("");
  const [schedule, setSchedule] = useState("0 9 * * *");
  const [prompt, setPrompt] = useState("");
  const [persistent, setPersistent] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setError(null);
      setSubmitting(false);
      return;
    }
    if (editing) {
      setName(editing.name);
      setSchedule(editing.schedule);
      setPrompt(editing.prompt);
      setPersistent(!!editing.persistent_session);
      setEnabled(!!editing.enabled);
    } else {
      setName("");
      setSchedule("0 9 * * *");
      setPrompt("");
      setPersistent(false);
      setEnabled(true);
    }
  }, [open, editing]);

  const submit = async () => {
    if (!name.trim() || !prompt.trim() || !schedule.trim()) {
      setError("Name, schedule, and prompt all required.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      if (isEdit && editing) {
        await api.updateCron(editing.id, {
          name: name.trim(),
          prompt: prompt.trim(),
          schedule: schedule.trim(),
          enabled,
          persistent_session: persistent,
        });
      } else {
        await api.createCron(name.trim(), prompt.trim(), schedule.trim(), enabled, persistent);
      }
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <CedarModal
      open={open}
      onClose={onClose}
      width={580}
      eyebrow={isEdit ? "edit job" : "new job"}
      title={
        isEdit ? (
          <>Edit <em style={{ fontStyle: "italic", color: "var(--cedar-glow)" }}>{editing?.name}</em>.</>
        ) : (
          <>Schedule a <em style={{ fontStyle: "italic", color: "var(--cedar-glow)" }}>recurring</em> task.</>
        )
      }
      footer={
        <>
          <Btn kind="ghost" onClick={onClose} disabled={submitting}>Cancel</Btn>
          <Btn kind="solid" onClick={submit} disabled={submitting}>
            {submitting ? "Saving…" : isEdit ? "Save changes" : "Schedule"}
          </Btn>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <CedarLabel>Name</CedarLabel>
          <CedarInput value={name} onChange={(e) => setName(e.target.value)} placeholder="Morning brief" autoFocus />
        </div>
        <div>
          <CedarLabel>When should it fire?</CedarLabel>
          <ScheduleBuilder value={schedule} onChange={setSchedule} />
        </div>
        <div>
          <CedarLabel>Prompt</CedarLabel>
          <CedarTextArea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={5}
            placeholder="What should the agent do when this fires?"
          />
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--text)" }}>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            style={{ accentColor: "var(--cedar)" }}
          />
          Enabled (uncheck to pause without deleting)
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--text)" }}>
          <input
            type="checkbox"
            checked={persistent}
            onChange={(e) => setPersistent(e.target.checked)}
            style={{ accentColor: "var(--cedar)" }}
          />
          Persistent session (reuses the same chat across fires — costs grow over time)
        </label>
        {error && (
          <div
            style={{
              fontSize: 12,
              color: "var(--ember)",
              background: "var(--ember-dim)",
              border: "1px solid var(--ember)",
              borderRadius: 6,
              padding: "8px 10px",
            }}
          >
            {error}
          </div>
        )}
      </div>
    </CedarModal>
  );
}

// ── Sun — 24-hour clock dial ──────────────────────────────────
function SunView({ crons, onEdit }: { crons: CronEntry[]; onEdit: (c: CronEntry) => void }) {
  // Re-render each minute so the hand and the clock face stay current.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  const hr = now.getHours() + now.getMinutes() / 60;
  const angle = (h: number) => (h / 24) * Math.PI * 2 - Math.PI / 2;

  // Map each cron to an hour. If schedule has "<min> <hr>" prefix, use that;
  // else stagger by index.
  const jobs = crons.map((c, i) => {
    const m = c.schedule.match(/^\s*\d+\s+(\d+)/);
    const hour = m ? Number(m[1]) : (hr + 1 + i * 4.5) % 24;
    return { ...c, hour };
  });

  const cx = 200;
  const cy = 200;
  const R_ORBIT = 160;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 24, alignItems: "start" }}>
      <div style={{ position: "relative", aspectRatio: "1", maxWidth: 540, margin: "0 auto", width: "100%" }}>
        <svg viewBox="-60 -60 520 520" style={{ width: "100%", height: "100%", overflow: "visible" }}>
          <defs>
            <linearGradient id="dayg" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="var(--stone)" stopOpacity=".3" />
              <stop offset="50%" stopColor="var(--dawn)" stopOpacity=".4" />
              <stop offset="100%" stopColor="var(--stone)" stopOpacity=".3" />
            </linearGradient>
          </defs>
          {/* Day arc */}
          <circle cx={cx} cy={cy} r={R_ORBIT} fill="none" stroke="var(--border2)" strokeWidth="1" strokeDasharray="2 4" />
          {/* Hour ticks */}
          {Array.from({ length: 24 }).map((_, i) => {
            const a = angle(i);
            const r1 = 168;
            const r2 = i % 6 === 0 ? 180 : 174;
            const x1 = cx + r1 * Math.cos(a);
            const y1 = cy + r1 * Math.sin(a);
            const x2 = cx + r2 * Math.cos(a);
            const y2 = cy + r2 * Math.sin(a);
            return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--border2)" strokeWidth={i % 6 === 0 ? 1.5 : 0.8} />;
          })}
          {[0, 6, 12, 18].map((i) => {
            const a = angle(i);
            const x = cx + 210 * Math.cos(a);
            const y = cy + 210 * Math.sin(a);
            return (
              <text
                key={i}
                x={x}
                y={y}
                textAnchor="middle"
                dominantBaseline="middle"
                fontFamily="var(--fm)"
                fontSize="11"
                fill="var(--muted)"
              >
                {String(i).padStart(2, "0")}
              </text>
            );
          })}
          {/* Now indicator — starts outside the centre readout so the
              hand never strikes through the time. */}
          {(() => {
            const a = angle(hr);
            return (
              <g>
                <line
                  x1={cx + 78 * Math.cos(a)}
                  y1={cy + 78 * Math.sin(a)}
                  x2={cx + R_ORBIT * Math.cos(a)}
                  y2={cy + R_ORBIT * Math.sin(a)}
                  stroke="var(--cedar-glow)"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
                <circle cx={cx + R_ORBIT * Math.cos(a)} cy={cy + R_ORBIT * Math.sin(a)} r="4" fill="var(--cedar-glow)" />
              </g>
            );
          })()}
          <circle cx={cx} cy={cy} r="70" fill="var(--surface)" stroke="var(--border)" strokeWidth="1" />
          {/* Job pins */}
          {jobs.map((j) => {
            const a = angle(j.hour);
            const x = cx + R_ORBIT * Math.cos(a);
            const y = cy + R_ORBIT * Math.sin(a);
            const lx = cx + 140 * Math.cos(a);
            const ly = cy + 140 * Math.sin(a);
            return (
              <g key={j.id}>
                <line x1={lx} y1={ly} x2={x} y2={y} stroke="var(--cedar-line)" strokeWidth="1" />
                <circle cx={x} cy={y} r="7" fill={j.enabled ? "var(--cedar-glow)" : "var(--muted)"} stroke="var(--surface)" strokeWidth="2" />
                <text
                  x={x + (Math.cos(a) > 0 ? 14 : -14)}
                  y={y + 4}
                  textAnchor={Math.cos(a) > 0 ? "start" : "end"}
                  fontFamily="var(--fn)"
                  fontSize="11"
                  fill="var(--text)"
                >
                  {j.name.slice(0, 20)}
                </text>
              </g>
            );
          })}
          {/* Center time */}
          <text x={cx} y={cy + 4} textAnchor="middle" fontFamily="var(--fd)" fontSize="30" fill="var(--text)">
            {now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </text>
          <text
            x={cx}
            y={cy + 24}
            textAnchor="middle"
            fontFamily="var(--fm)"
            fontSize="10"
            fill="var(--muted)"
            letterSpacing=".2em"
          >
            NOW
          </text>
        </svg>
      </div>

      <CedarCard padding={0}>
        <div
          style={{
            padding: "14px 16px",
            borderBottom: "1px solid var(--border)",
            fontSize: 11,
            textTransform: "uppercase",
            letterSpacing: ".1em",
            color: "var(--muted)",
            fontFamily: "var(--fm)",
          }}
        >
          Up next
        </div>
        {jobs.length === 0 && (
          <div style={{ padding: 24, fontSize: 12, color: "var(--muted)", textAlign: "center" }}>
            No scheduled jobs.
          </div>
        )}
        {jobs.slice(0, 5).map((j) => (
          <div
            key={j.id}
            onClick={() => onEdit(j)}
            style={{ padding: "12px 16px", borderBottom: "1px solid var(--hairline)", cursor: "pointer" }}
            title="Click to edit"
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: j.enabled ? "var(--cedar-glow)" : "var(--muted)",
                }}
              />
              <span style={{ fontSize: 13, color: "var(--text)" }}>{j.name}</span>
            </div>
            <div
              style={{
                fontSize: 11,
                color: "var(--text3)",
                marginTop: 4,
              }}
            >
              {describeCron(j.schedule)}
            </div>
            <div style={{ fontSize: 11, color: "var(--cedar-2)", fontFamily: "var(--fm)", marginTop: 2 }}>
              {j.last_run_at ? `last fired ${relTime(j.last_run_at)}` : "not yet fired"}
            </div>
          </div>
        ))}
      </CedarCard>
    </div>
  );
}

function relTime(epoch: number): string {
  const m = Math.round((Date.now() / 1000 - epoch) / 60);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

// ── Tape — horizontal hour strip ─────────────────────────────
function TapeView({ crons, onEdit }: { crons: CronEntry[]; onEdit: (c: CronEntry) => void }) {
  const HOURS = Array.from({ length: 24 }, (_, i) => i);
  const nowFrac = ((new Date().getHours() + new Date().getMinutes() / 60) / 24) * 100;
  return (
    <CedarCard padding={0}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "180px 1fr",
          borderBottom: "1px solid var(--border)",
          alignItems: "center",
        }}
      >
        <div
          style={{
            padding: "10px 14px",
            fontSize: 11,
            color: "var(--muted)",
            fontFamily: "var(--fm)",
            textTransform: "uppercase",
            letterSpacing: ".1em",
          }}
        >
          Job
        </div>
        {/* Same inset as the rows below so labels sit on the bars' hours. */}
        <div style={{ padding: "0 14px 0 0" }}>
          <div style={{ position: "relative", height: 30, fontSize: 9.5, color: "var(--muted)", fontFamily: "var(--fm)" }}>
            {[0, 6, 12, 18].map((h) => (
              <span key={h} style={{ position: "absolute", top: 9, left: `${(h / 24) * 100}%` }}>
                {String(h).padStart(2, "0")}
              </span>
            ))}
            <span
              style={{
                position: "absolute",
                top: 9,
                left: `${nowFrac}%`,
                transform: "translateX(-50%)",
                color: "var(--ember)",
                background: "var(--surface)",
                padding: "0 4px",
                letterSpacing: ".1em",
              }}
            >
              NOW
            </span>
          </div>
        </div>
      </div>
      {crons.length === 0 && (
        <div style={{ padding: 32, color: "var(--muted)", fontSize: 12.5, textAlign: "center" }}>
          No scheduled jobs.
        </div>
      )}
      {crons.map((c) => {
        const isHourly = /@hourly/.test(c.schedule);
        const m = c.schedule.match(/^\s*\d+\s+(\d+)/);
        const fixedHour = m ? Number(m[1]) : null;
        return (
          <div
            key={c.id}
            onClick={() => onEdit(c)}
            style={{
              display: "grid",
              gridTemplateColumns: "180px 1fr",
              alignItems: "center",
              borderBottom: "1px solid var(--hairline)",
              cursor: "pointer",
            }}
            title="Click to edit"
          >
            <div style={{ padding: "12px 14px" }}>
              <div style={{ fontSize: 12.5, color: "var(--text)" }}>{c.name}</div>
              <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 2 }}>
                {describeCron(c.schedule)}
              </div>
            </div>
            <div style={{ padding: "0 14px 0 0" }}>
            <div style={{ position: "relative", height: 32 }}>
              {[6, 12, 18].map((h) => (
                <div
                  key={`g${h}`}
                  style={{ position: "absolute", top: 4, bottom: 4, left: `${(h / 24) * 100}%`, width: 1, background: "var(--hairline)" }}
                />
              ))}
              {isHourly &&
                HOURS.map((h) => (
                  <div
                    key={h}
                    style={{
                      position: "absolute",
                      top: 8,
                      left: `${(h / 24) * 100}%`,
                      width: 8,
                      height: 16,
                      background: c.enabled ? "var(--cedar-glow)" : "var(--muted)",
                      opacity: c.enabled ? 0.7 : 0.4,
                      borderRadius: 2,
                    }}
                  />
                ))}
              {!isHourly && fixedHour != null && (
                <div
                  style={{
                    position: "absolute",
                    top: 6,
                    left: `${(fixedHour / 24) * 100}%`,
                    width: 14,
                    height: 20,
                    background: c.enabled ? "var(--cedar-glow)" : "var(--muted)",
                    borderRadius: 3,
                  }}
                />
              )}
              <div
                style={{
                  position: "absolute",
                  top: 0,
                  bottom: 0,
                  left: `${nowFrac}%`,
                  width: 1,
                  background: "var(--ember)",
                }}
                title="now"
              />
            </div>
            </div>
          </div>
        );
      })}
    </CedarCard>
  );
}

// ── List — card grid ────────────────────────────────────────
function ListView({
  crons,
  onEdit,
  refresh,
}: {
  crons: CronEntry[];
  onEdit: (c: CronEntry) => void;
  refresh: () => void;
}) {
  const dialog = useDialog();
  if (crons.length === 0) {
    return (
      <CedarCard padding={0}>
        <EmptyState
          icon={<CalendarClock size={22} />}
          title="Nothing scheduled."
          hint="Recurring jobs run a prompt on a timer — a morning brief, a nightly cleanup, a weekly report. Use New job to add one."
        />
      </CedarCard>
    );
  }

  const toggle = async (c: CronEntry) => {
    try { await api.updateCron(c.id, { enabled: !c.enabled }); refresh(); } catch {}
  };
  const runNow = async (c: CronEntry) => {
    try {
      await api.runCronNow(c.id);
      await dialog.notify({ title: "Queued", body: `"${c.name}" will fire shortly.`, tone: "ok" });
    } catch (e) {
      await dialog.notify({ title: "Run failed", body: String(e), tone: "danger" });
    }
  };
  const del = async (c: CronEntry) => {
    const ok = await dialog.confirm({
      title: `Delete "${c.name}"?`,
      body: "Removes the schedule. Past runs stay in history.",
      tone: "danger",
    });
    if (!ok) return;
    try { await api.deleteCron(c.id); refresh(); } catch {}
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
      {crons.map((c) => (
        <CedarCard key={c.id} padding={18} hoverable>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: c.enabled ? "var(--cedar-glow)" : "var(--muted)",
              }}
            />
            <span style={{ fontFamily: "var(--fd)", fontSize: 18, color: "var(--text)" }}>{c.name}</span>
            <div style={{ flex: 1 }} />
            <Tag color={c.persistent_session ? "stone" : "muted"}>
              {c.persistent_session ? "persistent" : "fresh"}
            </Tag>
          </div>
          <div
            style={{
              display: "inline-block",
              fontSize: 11.5,
              color: "var(--cedar-2)",
              background: "var(--cedar-dim)",
              padding: "4px 9px",
              borderRadius: 5,
              border: "1px solid var(--cedar-line)",
              marginBottom: 10,
            }}
            title={c.schedule}
          >
            {describeCron(c.schedule)}
          </div>
          <div
            style={{
              fontSize: 12.5,
              color: "var(--text2)",
              lineHeight: 1.55,
              marginBottom: 12,
              maxHeight: 60,
              overflow: "hidden",
            }}
          >
            {c.prompt}
          </div>
          <div
            style={{
              display: "flex",
              gap: 14,
              fontSize: 10.5,
              fontFamily: "var(--fm)",
              color: "var(--muted)",
              borderTop: "1px solid var(--hairline)",
              paddingTop: 10,
              marginBottom: 10,
            }}
          >
            <span>last {c.last_run_at ? relTime(c.last_run_at) : "—"}</span>
            <span>{c.last_status ?? "—"}</span>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <Btn size="sm" kind="solid" icon={<Pencil size={11} />} onClick={() => onEdit(c)}>
              Edit
            </Btn>
            <Btn size="sm" kind="soft" icon={<Power size={11} />} onClick={() => toggle(c)}>
              {c.enabled ? "Pause" : "Enable"}
            </Btn>
            <Btn size="sm" kind="ghost" icon={<Play size={11} />} onClick={() => runNow(c)}>
              Run now
            </Btn>
            <Btn size="sm" kind="danger" icon={<Trash2 size={11} />} onClick={() => del(c)} title="Delete" />
          </div>
        </CedarCard>
      ))}
    </div>
  );
}
