// Settings — Cedar design: 200px nav rail + content with SettingRow.
//   General · Providers · Memory · Security · Appearance · Advanced

import { useEffect, useState } from "react";
import {
  CedarPage,
  CedarPageHeader,
  CedarCard,
  Toggle,
  SegSeg,
  TopoLines,
} from "@/components/CedarUI";
import { api, type Settings } from "@/api/client";
import { useTheme } from "@/hooks/useTheme";

type Section = "general" | "providers" | "memory" | "security" | "appearance" | "advanced";

const SECTIONS: { id: Section; label: string }[] = [
  { id: "general",    label: "General" },
  { id: "providers",  label: "Providers" },
  { id: "memory",     label: "Memory" },
  { id: "security",   label: "Security" },
  { id: "appearance", label: "Appearance" },
  { id: "advanced",   label: "Advanced" },
];

export default function SettingsPage() {
  const [section, setSection] = useState<Section>("general");
  const [s, setS] = useState<Settings | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => { api.getSettings().then(setS).catch(() => {}); }, []);

  const update = (patch: Partial<Settings>) => {
    if (!s) return;
    const next = { ...s, ...patch };
    setS(next);
    api.saveSettings(patch).then(() => {
      setSavedAt(Date.now());
      setTimeout(() => setSavedAt(null), 1500);
    }).catch(() => {});
  };

  return (
    <CedarPage>
      <div style={{ position: "relative", overflow: "hidden" }}>
        <TopoLines height={120} opacity={0.5} />
        <CedarPageHeader
          eyebrow="bones"
          title={<>Settings.</>}
          sub="Preferences live at ~/.arz/config.yaml — every change here writes there."
          right={savedAt ? (
            <span style={{ fontSize: 11, fontFamily: "var(--fm)", color: "var(--cedar-2)" }}>
              ✓ saved
            </span>
          ) : null}
        />
      </div>

      <div
        style={{
          padding: "20px 32px",
          display: "grid",
          gridTemplateColumns: "200px 1fr",
          gap: 24,
          maxWidth: 1100,
        }}
      >
        <nav style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          {SECTIONS.map((sec) => (
            <button
              key={sec.id}
              onClick={() => setSection(sec.id)}
              style={{
                padding: "8px 12px",
                textAlign: "left",
                border: "none",
                background: section === sec.id ? "var(--cedar-dim)" : "transparent",
                color: section === sec.id ? "var(--cedar-glow)" : "var(--text2)",
                fontSize: 13,
                fontWeight: section === sec.id ? 500 : 400,
                borderRadius: 7,
                cursor: "pointer",
                fontFamily: "var(--fn)",
                transition: "all .12s",
              }}
            >
              {sec.label}
            </button>
          ))}
        </nav>

        <div>
          {section === "general" && s && (
            <CedarCard padding={24}>
              <SettingRow label="Default provider" desc="Used when a session doesn't specify one.">
                <SegSeg<Settings["provider"]>
                  value={s.provider}
                  onChange={(v) => update({ provider: v })}
                  options={[
                    { value: "claude-code", label: "Claude Code" },
                    { value: "kiro-cli", label: "Kiro" },
                    { value: "codex", label: "Codex" },
                    { value: "anthropic", label: "Anthropic SDK" },
                  ]}
                />
              </SettingRow>
              <SettingRow label="Bot name" desc="Used as your assistant's name across surfaces.">
                <input value={s.bot_name} onChange={(e) => update({ bot_name: e.target.value })} style={inp} />
              </SettingRow>
              <SettingRow label="Default model" desc="Empty for provider default.">
                <input value={s.model} onChange={(e) => update({ model: e.target.value })} style={inp} />
              </SettingRow>
              <SettingRow label="Log level" desc="Gateway log verbosity.">
                <SegSeg<string>
                  value={s.log_level}
                  onChange={(v) => update({ log_level: v })}
                  options={["DEBUG", "INFO", "WARNING", "ERROR"].map((l) => ({ value: l, label: l }))}
                />
              </SettingRow>
            </CedarCard>
          )}

          {section === "providers" && s && (
            <CedarCard padding={24}>
              <SettingRow label="Provider" desc="Active provider for new sessions.">
                <SegSeg<Settings["provider"]>
                  value={s.provider}
                  onChange={(v) => update({ provider: v })}
                  options={[
                    { value: "claude-code", label: "Claude Code" },
                    { value: "kiro-cli", label: "Kiro" },
                    { value: "codex", label: "Codex" },
                    { value: "anthropic", label: "Anthropic SDK" },
                  ]}
                />
              </SettingRow>
              <SettingRow label="Model" desc="Provider-specific model identifier.">
                <input value={s.model} onChange={(e) => update({ model: e.target.value })} style={inp} />
              </SettingRow>
              <SettingRow
                label="System prompt"
                desc="Prepended to every session."
              >
                <textarea
                  value={s.system_prompt}
                  onChange={(e) => update({ system_prompt: e.target.value })}
                  rows={6}
                  style={{ ...inp, fontFamily: "var(--fm)", resize: "vertical", width: 360 }}
                />
              </SettingRow>
            </CedarCard>
          )}

          {section === "memory" && s && (
            <CedarCard padding={24}>
              <SettingRow label="Auto recall" desc="Inject memory matches at the top of every chat turn.">
                <Toggle on={s.auto_recall} onClick={() => update({ auto_recall: !s.auto_recall })} />
              </SettingRow>
              <SettingRow label="Recall K" desc="How many memory items to inject per turn.">
                <input
                  type="number"
                  value={s.recall_k}
                  min={0}
                  max={20}
                  onChange={(e) => update({ recall_k: Number(e.target.value) })}
                  style={{ ...inp, width: 100 }}
                />
              </SettingRow>
            </CedarCard>
          )}

          {section === "security" && s && (
            <CedarCard padding={24}>
              <SettingRow label="Token auth" desc="Require a bearer token for all API requests.">
                <Toggle on={s.token_auth} onClick={() => update({ token_auth: !s.token_auth })} />
              </SettingRow>
              <SettingRow label="Bind address" desc="0.0.0.0 requires token auth.">
                <input value={s.host} onChange={(e) => update({ host: e.target.value })} style={inp} />
              </SettingRow>
              <SettingRow label="Port" desc="Gateway listening port.">
                <input
                  type="number"
                  value={s.port}
                  onChange={(e) => update({ port: Number(e.target.value) })}
                  style={{ ...inp, width: 120 }}
                />
              </SettingRow>
            </CedarCard>
          )}

          {section === "appearance" && (
            <CedarCard padding={24}>
              <AppearanceSettings />
            </CedarCard>
          )}

          {section === "advanced" && (
            <CedarCard padding={24}>
              <SettingRow label="Settings file" desc="Read-only — edit values above.">
                <code style={{ fontFamily: "var(--fm)", fontSize: 12, color: "var(--text3)" }}>~/.arz/config.yaml</code>
              </SettingRow>
              <SettingRow label="Memory store" desc="Where lessons + notes are persisted.">
                <code style={{ fontFamily: "var(--fm)", fontSize: 12, color: "var(--text3)" }}>~/.arz/memory.db</code>
              </SettingRow>
            </CedarCard>
          )}

          {!s && section !== "appearance" && (
            <CedarCard padding={32} style={{ textAlign: "center", color: "var(--muted)" }}>
              Loading settings…
            </CedarCard>
          )}
        </div>
      </div>
    </CedarPage>
  );
}

function AppearanceSettings() {
  const { mode, setMode, colorTheme, setColorTheme, density, setDensity, themes, densities } = useTheme();
  return (
    <>
      <SettingRow label="Mode" desc="Dark, light, or follow system.">
        <SegSeg<typeof mode>
          value={mode}
          onChange={setMode}
          options={[
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
            { value: "system", label: "System" },
          ]}
        />
      </SettingRow>
      <SettingRow label="Theme" desc="Color palette. Cedar is the brand default.">
        <select
          value={colorTheme}
          onChange={(e) => setColorTheme(e.target.value)}
          style={{ ...inp, width: 180 }}
        >
          {themes.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
      </SettingRow>
      <SettingRow label="Density" desc="Spacing scale across the UI.">
        <SegSeg<typeof density>
          value={density}
          onChange={setDensity}
          options={densities.map((d) => ({ value: d.value, label: d.label }))}
        />
      </SettingRow>
    </>
  );
}

function SettingRow({
  label,
  desc,
  children,
}: {
  label: string;
  desc: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr auto",
        alignItems: "center",
        gap: 24,
        padding: "14px 0",
        borderBottom: "1px solid var(--hairline)",
      }}
    >
      <div>
        <div style={{ fontSize: 13, color: "var(--text)" }}>{label}</div>
        <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 2 }}>{desc}</div>
      </div>
      <div>{children}</div>
    </div>
  );
}

const inp: React.CSSProperties = {
  background: "var(--bg)",
  border: "1px solid var(--border)",
  borderRadius: 7,
  padding: "7px 10px",
  fontSize: 13,
  color: "var(--text)",
  fontFamily: "var(--fn)",
  outline: "none",
  minWidth: 240,
};
