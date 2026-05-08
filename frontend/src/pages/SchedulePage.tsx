// Schedule — cron jobs as a forest of recurring intentions.
// Three layouts: Calendar (default), Timeline, Grid.

import { useEffect, useMemo, useState } from "react";
import { Plus, Clock } from "lucide-react";
import {
  CedarPage,
  CedarPageHeader,
  CedarCard,
  Btn,
  Tag,
  SegSeg,
  TopoLines,
} from "@/components/CedarUI";
import { api, type CronEntry } from "@/api/client";

type Variant = "calendar" | "timeline" | "grid";

export default function SchedulePage() {
  const [variant, setVariant] = useState<Variant>(
    () => (localStorage.getItem("arz:schedule-variant") as Variant) || "calendar",
  );
  useEffect(() => { localStorage.setItem("arz:schedule-variant", variant); }, [variant]);

  const [crons, setCrons] = useState<CronEntry[]>([]);
  useEffect(() => { api.listCrons().then(setCrons).catch(() => {}); }, []);

  const enabled = crons.filter((c) => c.enabled).length;

  return (
    <CedarPage>
      <div style={{ position: "relative", overflow: "hidden" }}>
        <TopoLines height={120} opacity={0.5} />
        <CedarPageHeader
          eyebrow="recurring intentions"
          title={
            <>
              The <em style={{ fontStyle: "italic", color: "var(--cedar-glow)" }}>schedule</em>.
            </>
          }
          sub={`${crons.length} cron jobs · ${enabled} enabled`}
          right={
            <>
              <SegSeg<Variant>
                value={variant}
                onChange={setVariant}
                options={[
                  { value: "calendar", label: "Calendar" },
                  { value: "timeline", label: "Timeline" },
                  { value: "grid", label: "Grid" },
                ]}
              />
              <Btn kind="solid" icon={<Plus size={13} />}>New job</Btn>
            </>
          }
        />
      </div>
      <div style={{ padding: "24px 32px 32px" }}>
        {variant === "calendar" && <CalendarView crons={crons} />}
        {variant === "timeline" && <TimelineView crons={crons} />}
        {variant === "grid" && <GridView crons={crons} />}
      </div>
    </CedarPage>
  );
}

function CalendarView({ crons }: { crons: CronEntry[] }) {
  const cells = useMemo(() => {
    const today = new Date();
    const first = new Date(today.getFullYear(), today.getMonth(), 1);
    const startDow = first.getDay();
    const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
    const grid: { date: Date | null; runs: number }[] = [];
    for (let i = 0; i < startDow; i++) grid.push({ date: null, runs: 0 });
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(today.getFullYear(), today.getMonth(), d);
      const runs = crons.filter((c) => {
        if (!c.last_run_at) return false;
        const r = new Date(c.last_run_at * 1000);
        return (
          r.getFullYear() === date.getFullYear() &&
          r.getMonth() === date.getMonth() &&
          r.getDate() === date.getDate()
        );
      }).length;
      grid.push({ date, runs });
    }
    while (grid.length % 7 !== 0) grid.push({ date: null, runs: 0 });
    return grid;
  }, [crons]);

  const monthLabel = new Date().toLocaleString("default", { month: "long", year: "numeric" });
  const todayKey = new Date().toDateString();

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 18, alignItems: "start" }}>
      <CedarCard padding={20}>
        <h3 style={{ fontFamily: "var(--fd)", fontSize: 22, color: "var(--text)", margin: "0 0 14px" }}>
          {monthLabel}
        </h3>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(7, 1fr)",
            gap: 6,
            marginBottom: 6,
          }}
        >
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
            <div
              key={d}
              style={{
                fontSize: 10,
                fontFamily: "var(--fm)",
                color: "var(--muted)",
                textTransform: "uppercase",
                letterSpacing: ".12em",
                textAlign: "center",
              }}
            >
              {d}
            </div>
          ))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6 }}>
          {cells.map((c, i) => {
            if (!c.date) return <div key={i} style={{ aspectRatio: 1 }} />;
            const isToday = c.date.toDateString() === todayKey;
            return (
              <div
                key={i}
                title={c.runs ? `${c.runs} runs` : "no runs"}
                style={{
                  aspectRatio: 1,
                  borderRadius: 8,
                  border: `1px solid ${isToday ? "var(--cedar-glow)" : "var(--border)"}`,
                  background: c.runs ? "var(--cedar-dim)" : "var(--surface)",
                  padding: 6,
                  display: "flex",
                  flexDirection: "column",
                  position: "relative",
                }}
              >
                <span style={{ fontSize: 11, color: "var(--text3)" }}>{c.date.getDate()}</span>
                {c.runs > 0 && (
                  <div
                    style={{
                      display: "flex",
                      gap: 3,
                      marginTop: "auto",
                      flexWrap: "wrap",
                    }}
                  >
                    {Array.from({ length: Math.min(c.runs, 4) }).map((_, j) => (
                      <span
                        key={j}
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: "50%",
                          background: "var(--cedar-glow)",
                        }}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </CedarCard>
      <CedarCard padding={18}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <Clock size={14} />
          <span style={{ fontSize: 13, fontWeight: 500 }}>Up next</span>
        </div>
        {crons.filter((c) => c.enabled).length === 0 && (
          <div style={{ fontSize: 12, color: "var(--muted)" }}>No enabled jobs.</div>
        )}
        {crons.filter((c) => c.enabled).slice(0, 5).map((c) => (
          <div
            key={c.id}
            style={{
              padding: "10px 0",
              borderBottom: "1px solid var(--hairline)",
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, color: "var(--text)" }}>{c.name}</div>
              <div
                style={{
                  fontSize: 10.5,
                  fontFamily: "var(--fm)",
                  color: "var(--muted)",
                  marginTop: 2,
                }}
              >
                {c.schedule}
              </div>
            </div>
            <Tag color="dawn">cron</Tag>
          </div>
        ))}
      </CedarCard>
    </div>
  );
}

function TimelineView({ crons }: { crons: CronEntry[] }) {
  const days = 7;
  const now = Date.now();
  const start = now - (days - 1) * 86_400_000;
  const ticks = Array.from({ length: days }, (_, i) => {
    const d = new Date(start + i * 86_400_000);
    return { t: d.getTime(), label: `${d.getMonth() + 1}/${d.getDate()}` };
  });

  return (
    <CedarCard padding={20}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `200px repeat(${days}, 1fr)`,
          gap: 8,
          marginBottom: 8,
        }}
      >
        <span />
        {ticks.map((t) => (
          <span
            key={t.t}
            style={{
              fontSize: 10,
              fontFamily: "var(--fm)",
              color: "var(--muted)",
              textTransform: "uppercase",
              letterSpacing: ".12em",
              textAlign: "center",
            }}
          >
            {t.label}
          </span>
        ))}
      </div>
      {crons.length === 0 && (
        <div style={{ padding: 24, color: "var(--muted)", fontSize: 12.5, textAlign: "center" }}>
          No scheduled jobs.
        </div>
      )}
      {crons.map((c) => {
        const last = c.last_run_at ? c.last_run_at * 1000 : null;
        const offset = last && last >= start ? ((last - start) / (now - start)) * 100 : null;
        return (
          <div
            key={c.id}
            style={{
              display: "grid",
              gridTemplateColumns: "200px 1fr",
              gap: 8,
              padding: "10px 0",
              borderBottom: "1px solid var(--hairline)",
              alignItems: "center",
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontSize: 12.5,
                  color: "var(--text)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {c.name}
              </div>
              <div
                style={{
                  fontSize: 10.5,
                  fontFamily: "var(--fm)",
                  color: "var(--muted)",
                  marginTop: 2,
                }}
              >
                {c.schedule}
              </div>
            </div>
            <div style={{ position: "relative", height: 18, background: "var(--s2)", borderRadius: 6 }}>
              {/* "now" line */}
              <div
                style={{
                  position: "absolute",
                  right: 0,
                  top: -2,
                  bottom: -2,
                  width: 2,
                  background: "var(--ember)",
                }}
                title="now"
              />
              {offset !== null && (
                <div
                  style={{
                    position: "absolute",
                    top: 4,
                    bottom: 4,
                    width: 6,
                    borderRadius: 99,
                    background: "var(--cedar-glow)",
                    boxShadow: "0 0 6px var(--cedar-glow)",
                    left: `calc(${offset}% - 3px)`,
                  }}
                  title={`Last run ${new Date(last!).toLocaleString()}`}
                />
              )}
            </div>
          </div>
        );
      })}
    </CedarCard>
  );
}

function GridView({ crons }: { crons: CronEntry[] }) {
  return (
    <CedarCard padding={0}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1.4fr 1.6fr 80px 80px 110px 110px 60px",
          gap: 12,
          padding: "10px 18px",
          borderBottom: "1px solid var(--border)",
          fontFamily: "var(--fm)",
          fontSize: 10.5,
          color: "var(--muted)",
          textTransform: "uppercase",
          letterSpacing: ".12em",
        }}
      >
        <span>Name</span>
        <span>Cron</span>
        <span>State</span>
        <span>Persist</span>
        <span>Next</span>
        <span>Last</span>
        <span>Runs</span>
      </div>
      {crons.length === 0 && (
        <div style={{ padding: 24, color: "var(--muted)", fontSize: 12.5, textAlign: "center" }}>
          No scheduled jobs.
        </div>
      )}
      {crons.map((c) => (
        <div
          key={c.id}
          style={{
            display: "grid",
            gridTemplateColumns: "1.4fr 1.6fr 80px 80px 110px 110px 60px",
            gap: 12,
            padding: "12px 18px",
            borderBottom: "1px solid var(--hairline)",
            alignItems: "center",
            fontSize: 12.5,
          }}
        >
          <div>
            <div style={{ color: "var(--text)" }}>{c.name}</div>
            <div
              style={{
                fontSize: 10.5,
                color: "var(--muted)",
                fontFamily: "var(--fm)",
                marginTop: 2,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={c.prompt}
            >
              {c.prompt.slice(0, 60)}
            </div>
          </div>
          <span style={{ fontFamily: "var(--fm)", fontSize: 11.5, color: "var(--cedar-2)" }}>
            {c.schedule}
          </span>
          <Tag color={c.enabled ? "cedar" : "muted"}>{c.enabled ? "on" : "off"}</Tag>
          <Tag color={c.persistent_session ? "stone" : "muted"}>
            {c.persistent_session ? "yes" : "no"}
          </Tag>
          <span style={{ fontFamily: "var(--fm)", fontSize: 11, color: "var(--text3)" }}>—</span>
          <span style={{ fontFamily: "var(--fm)", fontSize: 11, color: "var(--text3)" }}>
            {c.last_run_at ? new Date(c.last_run_at * 1000).toLocaleDateString() : "—"}
          </span>
          <span style={{ fontFamily: "var(--fm)", fontSize: 11, color: "var(--text3)" }}>—</span>
        </div>
      ))}
    </CedarCard>
  );
}
