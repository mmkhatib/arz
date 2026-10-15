// Overview — "the forest view".
// Cedar redesign: hero w/ topo lines + display-serif title, 4 stat cards
// w/ topo background, and a 2-column lower section pairing Active
// conversations w/ Up next + Today's autonomy.

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Sparkles, Plus, MessageSquare, Clock, Activity } from "lucide-react";
import {
  CedarPage,
  CedarPageHeader,
  CedarCard,
  Btn,
  Tag,
  TopoLines,
} from "@/components/CedarUI";
import { api, type OverviewResponse, type SessionSummary, type CronEntry } from "@/api/client";
import { describe as describeCron } from "@/components/ScheduleBuilder";
import { parseServerTime } from "@/utils/format";

function relTime(iso: string): string {
  const d = parseServerTime(iso).getTime();
  if (Number.isNaN(d)) return "";
  const m = Math.round((Date.now() - d) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  const day = Math.round(h / 24);
  if (day < 7) return `${day}d`;
  return new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function OverviewPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [crons, setCrons] = useState<CronEntry[]>([]);

  const refresh = () => {
    api.getOverview(10).then(setData).catch(() => {});
    api.fetchSessions().then(setSessions).catch(() => {});
    api.listCrons().then(setCrons).catch(() => {});
  };

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 30_000);
    return () => clearInterval(t);
  }, []);

  const counts = data?.counts;
  const providersOn = data?.providers?.filter((p) => p.installed).length ?? 0;
  const adjective = !data
    ? "settling"
    : counts && counts.sessions_active > 3
    ? "thriving"
    : counts && counts.sessions_active > 0
    ? "humming"
    : "resting";

  const stats = [
    {
      lbl: "Active sessions",
      v: counts?.sessions_active ?? 0,
      sub: `${counts?.sessions_history ?? 0} archived`,
      accent: "cedar-glow",
    },
    {
      lbl: "Memory",
      v: (counts?.memory_lessons ?? 0) + (counts?.memory_notes ?? 0),
      sub: `${counts?.memory_lessons ?? 0} lessons · ${counts?.memory_notes ?? 0} notes`,
      accent: "cedar-2",
    },
    {
      lbl: "Schedule",
      v: counts?.crons ?? 0,
      sub: `${data?.cron_health?.enabled ?? 0} enabled`,
      accent: "stone",
    },
    {
      lbl: "Providers",
      v: providersOn,
      sub: `${data?.providers?.length ?? 0} known`,
      accent: "pine",
    },
  ];

  const recent = sessions.slice(0, 4);
  const upcoming = crons.filter((c) => c.enabled).slice(0, 3);

  return (
    <CedarPage topo>
      <div style={{ position: "relative", overflow: "hidden" }}>
        <TopoLines height={140} opacity={0.6} />
        <CedarPageHeader
          eyebrow="forest view"
          title={
            <>
              Hello — your cedar is{" "}
              <em style={{ fontStyle: "italic", color: "var(--cedar-glow)" }}>{adjective}</em>.
            </>
          }
          sub={
            counts
              ? `${counts.sessions_active} conversations active, ${counts.crons} jobs scheduled, ${
                  counts.memory_lessons + counts.memory_notes
                } memories on file.`
              : "Loading the forest…"
          }
          right={
            <>
              <Btn
                kind="soft"
                icon={<Sparkles size={13} />}
                onClick={() => navigate("/autonomy")}
                title="Recent autonomous actions, scheduled fires, and memory writes"
              >
                What changed today?
              </Btn>
              <Btn kind="solid" icon={<Plus size={13} />} onClick={() => navigate("/")}>
                New chat
              </Btn>
            </>
          }
        />
      </div>

      {/* Stat cards */}
      <div
        style={{
          padding: "24px 32px",
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 14,
        }}
      >
        {stats.map((s) => (
          <CedarCard key={s.lbl} padding={18} style={{ position: "relative", overflow: "hidden" }}>
            <TopoLines height={60} opacity={0.3} />
            <div
              style={{
                fontSize: 10.5,
                color: "var(--muted)",
                fontFamily: "var(--fm)",
                textTransform: "uppercase",
                letterSpacing: ".1em",
              }}
            >
              {s.lbl}
            </div>
            <div
              style={{
                fontFamily: "var(--fd)",
                fontSize: 38,
                fontWeight: 400,
                color: "var(--text)",
                lineHeight: 1,
                marginTop: 6,
              }}
            >
              {s.v}
            </div>
            <div
              style={{
                fontSize: 11,
                color: `var(--${s.accent})`,
                marginTop: 6,
                fontFamily: "var(--fm)",
              }}
            >
              {s.sub}
            </div>
          </CedarCard>
        ))}
      </div>

      {/* Two-column lower section */}
      <div
        style={{
          padding: "0 32px 32px",
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 18,
        }}
      >
        {/* Active conversations */}
        <CedarCard padding={0}>
          <div
            style={{
              padding: "14px 18px",
              borderBottom: "1px solid var(--border)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <MessageSquare size={15} />
              <span style={{ fontSize: 13, fontWeight: 500 }}>Active conversations</span>
            </div>
            <Btn size="sm" kind="ghost" onClick={() => navigate("/")}>
              Open chat →
            </Btn>
          </div>
          {recent.length === 0 && (
            <div style={{ padding: 24, textAlign: "center", fontSize: 12, color: "var(--muted)" }}>
              No active sessions yet.
            </div>
          )}
          {recent.map((s) => (
            <div
              key={s.id}
              onClick={() => navigate(`/?sid=${encodeURIComponent(s.id)}`)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 18px",
                borderBottom: "1px solid var(--hairline)",
                cursor: "pointer",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--s2)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: s.pinned ? "var(--cedar-glow)" : "var(--border2)",
                  flexShrink: 0,
                }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 12.5,
                    color: "var(--text)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {s.title}
                </div>
                <div
                  style={{
                    fontSize: 10.5,
                    color: "var(--muted)",
                    fontFamily: "var(--fm)",
                    marginTop: 2,
                  }}
                >
                  {s.message_count} msgs · {relTime(s.updated_at)}
                </div>
              </div>
              <Tag color={s.provider === "kiro-cli" ? "stone" : "cedar"}>
                {s.provider === "kiro-cli"
                  ? "Kiro"
                  : s.provider === "codex"
                  ? "Codex"
                  : s.provider === "gemini"
                  ? "Gemini"
                  : "CC"}
              </Tag>
            </div>
          ))}
        </CedarCard>

        {/* Up next + Autonomy */}
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <CedarCard padding={0}>
            <div
              style={{
                padding: "14px 18px",
                borderBottom: "1px solid var(--border)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Clock size={15} />
                <span style={{ fontSize: 13, fontWeight: 500 }}>Up next</span>
              </div>
              <Btn size="sm" kind="ghost" onClick={() => navigate("/schedule")}>
                Schedule →
              </Btn>
            </div>
            {upcoming.length === 0 && (
              <div style={{ padding: 24, textAlign: "center", fontSize: 12, color: "var(--muted)" }}>
                No scheduled jobs.
              </div>
            )}
            {upcoming.map((c) => (
              <div
                key={c.id}
                style={{
                  padding: "10px 18px",
                  borderBottom: "1px solid var(--hairline)",
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, color: "var(--text)" }}>{c.name}</div>
                  <div
                    style={{
                      fontSize: 10.5,
                      color: "var(--muted)",
                      marginTop: 2,
                    }}
                  >
                    {describeCron(c.schedule)}
                  </div>
                </div>
                <Tag color="dawn">cron</Tag>
              </div>
            ))}
          </CedarCard>

          <CedarCard padding={18} style={{ position: "relative", overflow: "hidden" }}>
            <TopoLines height={120} opacity={0.4} />
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <Activity size={15} />
              <span style={{ fontSize: 13, fontWeight: 500 }}>Today's autonomy</span>
            </div>
            <div style={{ fontSize: 12, color: "var(--text2)", lineHeight: 1.6 }}>
              Arzeh acted{" "}
              <strong style={{ color: "var(--text)" }}>
                {data?.recent_activity?.length ?? 0} times
              </strong>{" "}
              recently — see Autonomy for the full ledger.
            </div>
            <div style={{ display: "flex", gap: 6, marginTop: 12 }}>
              {Array.from({ length: 32 }).map((_, i) => {
                const acted = i < (data?.recent_activity?.length ?? 0);
                return (
                  <div
                    key={i}
                    style={{
                      flex: 1,
                      height: 18,
                      borderRadius: 2,
                      background: acted ? "var(--cedar)" : "var(--border)",
                      opacity: acted ? 0.55 + (i % 3) * 0.15 : 0.4,
                    }}
                  />
                );
              })}
            </div>
          </CedarCard>
        </div>
      </div>
    </CedarPage>
  );
}
