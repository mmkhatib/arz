// Settings — Cedar-styled sectioned form.

import { useEffect, useState } from "react";
import { Save, Settings as Cog } from "lucide-react";
import {
  CedarPage,
  CedarPageHeader,
  CedarCard,
  Btn,
  TopoLines,
} from "@/components/CedarUI";
import { api, type Settings } from "@/api/client";
import { useTheme } from "@/hooks/useTheme";

export default function SettingsPage() {
  const [s, setS] = useState<Settings | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const { mode, setMode, colorTheme, setColorTheme, density, setDensity, themes, densities } = useTheme();

  useEffect(() => { api.getSettings().then(setS).catch(() => {}); }, []);

  const save = async () => {
    if (!s) return;
    try {
      await api.saveSettings(s);
      setSavedAt(Date.now());
      setTimeout(() => setSavedAt(null), 2000);
    } catch (e) {
      alert(`Save failed: ${e}`);
    }
  };

  return (
    <CedarPage>
      <div style={{ position: "relative", overflow: "hidden" }}>
        <TopoLines height={120} opacity={0.5} />
        <CedarPageHeader
          eyebrow="preferences"
          title={
            <>
              The <em style={{ fontStyle: "italic", color: "var(--cedar-glow)" }}>settings</em>.
            </>
          }
          sub="Tune the runtime, theme, and behavior."
          right={
            <Btn kind="solid" icon={<Save size={13} />} onClick={save} disabled={!s}>
              {savedAt ? "Saved!" : "Save"}
            </Btn>
          }
        />
      </div>

      <div style={{ padding: "24px 32px 32px", display: "flex", flexDirection: "column", gap: 18, maxWidth: 800, margin: "0 auto", width: "100%" }}>
        {/* Appearance */}
        <CedarCard padding={20}>
          <SectionTitle>Appearance</SectionTitle>
          <FieldRow label="Mode">
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as "light" | "dark" | "system")}
              style={selStyle}
            >
              <option value="light">Light</option>
              <option value="dark">Dark</option>
              <option value="system">System</option>
            </select>
          </FieldRow>
          <FieldRow label="Theme">
            <select value={colorTheme} onChange={(e) => setColorTheme(e.target.value as never)} style={selStyle}>
              {themes.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </FieldRow>
          <FieldRow label="Density">
            <select value={density} onChange={(e) => setDensity(e.target.value as never)} style={selStyle}>
              {densities.map((d) => (
                <option key={d.value} value={d.value}>{d.label}</option>
              ))}
            </select>
          </FieldRow>
        </CedarCard>

        {/* Provider */}
        {s && (
          <CedarCard padding={20}>
            <SectionTitle>Default provider</SectionTitle>
            <FieldRow label="Provider">
              <select
                value={s.provider}
                onChange={(e) => setS({ ...s, provider: e.target.value as Settings["provider"] })}
                style={selStyle}
              >
                {(["claude-code", "kiro-cli", "codex", "anthropic"] as const).map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </FieldRow>
            <FieldRow label="Model">
              <input
                value={s.model}
                onChange={(e) => setS({ ...s, model: e.target.value })}
                style={inpStyle}
              />
            </FieldRow>
            <FieldRow label="Bot name">
              <input
                value={s.bot_name}
                onChange={(e) => setS({ ...s, bot_name: e.target.value })}
                style={inpStyle}
              />
            </FieldRow>
          </CedarCard>
        )}

        {/* Memory */}
        {s && (
          <CedarCard padding={20}>
            <SectionTitle>Memory recall</SectionTitle>
            <FieldRow label="Auto recall">
              <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="checkbox"
                  checked={s.auto_recall}
                  onChange={(e) => setS({ ...s, auto_recall: e.target.checked })}
                />
                <span style={{ fontSize: 12.5, color: "var(--text2)" }}>
                  Auto-inject memory on every chat turn
                </span>
              </label>
            </FieldRow>
            <FieldRow label="Recall K">
              <input
                type="number"
                value={s.recall_k}
                min={0}
                max={20}
                onChange={(e) => setS({ ...s, recall_k: Number(e.target.value) })}
                style={{ ...inpStyle, width: 100 }}
              />
            </FieldRow>
          </CedarCard>
        )}

        {/* Server */}
        {s && (
          <CedarCard padding={20}>
            <SectionTitle>Server</SectionTitle>
            <FieldRow label="Host">
              <input value={s.host} onChange={(e) => setS({ ...s, host: e.target.value })} style={inpStyle} />
            </FieldRow>
            <FieldRow label="Port">
              <input
                type="number"
                value={s.port}
                onChange={(e) => setS({ ...s, port: Number(e.target.value) })}
                style={{ ...inpStyle, width: 120 }}
              />
            </FieldRow>
            <FieldRow label="Token auth">
              <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="checkbox"
                  checked={s.token_auth}
                  onChange={(e) => setS({ ...s, token_auth: e.target.checked })}
                />
                <span style={{ fontSize: 12.5, color: "var(--text2)" }}>Require bearer token</span>
              </label>
            </FieldRow>
            <FieldRow label="Log level">
              <select value={s.log_level} onChange={(e) => setS({ ...s, log_level: e.target.value })} style={selStyle}>
                {["DEBUG", "INFO", "WARNING", "ERROR"].map((l) => (
                  <option key={l} value={l}>{l}</option>
                ))}
              </select>
            </FieldRow>
          </CedarCard>
        )}

        {/* System prompt */}
        {s && (
          <CedarCard padding={20}>
            <SectionTitle>System prompt</SectionTitle>
            <textarea
              value={s.system_prompt}
              onChange={(e) => setS({ ...s, system_prompt: e.target.value })}
              rows={10}
              style={{
                width: "100%",
                padding: 12,
                background: "var(--bg)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                color: "var(--text)",
                fontSize: 12.5,
                fontFamily: "var(--fm)",
                lineHeight: 1.6,
                resize: "vertical",
              }}
            />
          </CedarCard>
        )}

        {!s && (
          <CedarCard padding={32}>
            <div style={{ textAlign: "center", color: "var(--muted)" }}>
              <Cog size={26} />
              <div style={{ marginTop: 12, fontSize: 13 }}>Loading settings…</div>
            </div>
          </CedarCard>
        )}
      </div>
    </CedarPage>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        marginBottom: 14,
        fontFamily: "var(--fm)",
        fontSize: 10.5,
        color: "var(--muted)",
        textTransform: "uppercase",
        letterSpacing: ".14em",
      }}
    >
      <span style={{ width: 18, height: 1, background: "var(--cedar-glow)" }} />
      {children}
    </div>
  );
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "8px 0", borderBottom: "1px solid var(--hairline)" }}>
      <span style={{ width: 130, fontSize: 12.5, color: "var(--text2)" }}>{label}</span>
      <div style={{ flex: 1 }}>{children}</div>
    </div>
  );
}

const inpStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  background: "var(--bg)",
  border: "1px solid var(--border)",
  borderRadius: 7,
  color: "var(--text)",
  fontSize: 13,
  fontFamily: "var(--fn)",
};

const selStyle: React.CSSProperties = {
  ...inpStyle,
};
