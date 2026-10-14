// Settings — Cedar design: 200px nav rail + content with SettingRow.
//   General · Providers · Memory · Security · Appearance · Advanced
//
// Edits are buffered in a draft and only persisted when the user hits
// Save. Discard reverts to the last saved state.

import { useEffect, useMemo, useState } from "react";
import {
  CedarPage,
  CedarPageHeader,
  CedarCard,
  Toggle,
  SegSeg,
  Btn,
  TopoLines,
} from "@/components/CedarUI";
import { api, type Settings } from "@/api/client";
import { useTheme } from "@/hooks/useTheme";
import { modelsForProvider, defaultModelForProvider, PROVIDER_LABELS } from "@/utils/models";
import { useLiveModels } from "@/hooks/useLiveModels";

type Section = "general" | "providers" | "memory" | "security" | "appearance" | "advanced";

const SECTIONS: { id: Section; label: string }[] = [
  { id: "general", label: "General" },
  { id: "providers", label: "Providers" },
  { id: "memory", label: "Memory" },
  { id: "security", label: "Security" },
  { id: "appearance", label: "Appearance" },
  { id: "advanced", label: "Advanced" },
];

const ALL_PROVIDERS: Settings["provider"][] = [
  "claude-code",
  "kiro-cli",
  "codex",
  "anthropic",
];

export default function SettingsPage() {
  useLiveModels();
  const [section, setSection] = useState<Section>("general");
  const [saved, setSaved] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [savingMsg, setSavingMsg] = useState<string | null>(null);
  const [installer, setInstaller] = useState<Awaited<ReturnType<typeof api.getInstallerStatus>> | null>(null);
  const [memStats, setMemStats] = useState<{ markdown: number; lessons: number; vectors: number } | null>(null);

  useEffect(() => {
    api.getSettings().then((s) => { setSaved(s); setDraft(s); }).catch(() => {});
    api.getInstallerStatus().then(setInstaller).catch(() => {});
    api.memoryStats().then(setMemStats).catch(() => {});
  }, []);

  const dirty = useMemo(() => {
    if (!saved || !draft) return false;
    return JSON.stringify(saved) !== JSON.stringify(draft);
  }, [saved, draft]);

  const update = (patch: Partial<Settings>) => {
    if (!draft) return;
    setDraft({ ...draft, ...patch });
  };

  const save = async () => {
    if (!draft || !dirty) return;
    setSavingMsg("saving…");
    try {
      // Only send changed fields.
      const changes: Partial<Settings> = {};
      (Object.keys(draft) as (keyof Settings)[]).forEach((k) => {
        if (saved && draft[k] !== saved[k]) {
          // @ts-expect-error narrow per key
          changes[k] = draft[k];
        }
      });
      await api.saveSettings(changes);
      setSaved(draft);
      setSavingMsg("✓ saved");
      setTimeout(() => setSavingMsg(null), 1500);
    } catch (e) {
      setSavingMsg(`failed: ${e}`);
      setTimeout(() => setSavingMsg(null), 3000);
    }
  };

  const discard = () => {
    if (saved) setDraft(saved);
  };

  // Providers currently installed. Anthropic SDK always available (uses
  // API key), the rest require their CLI on PATH.
  const installedProviders = useMemo<Settings["provider"][]>(() => {
    if (!installer) return ALL_PROVIDERS;
    const found = new Set(
      installer.clis.filter((c: { installed: boolean }) => c.installed).map((c: { name: string }) => c.name),
    );
    const out: Settings["provider"][] = [];
    if (found.has("claude") || found.has("claude-code")) out.push("claude-code");
    if (found.has("kiro") || found.has("kiro-cli")) out.push("kiro-cli");
    if (found.has("codex")) out.push("codex");
    out.push("anthropic"); // SDK always usable
    return out;
  }, [installer]);

  const ollamaInstalled = !!installer?.clis.find(
    (c: { name: string; installed: boolean }) => c.name === "ollama" && c.installed,
  );

  return (
    <CedarPage>
      <div style={{ position: "relative", overflow: "hidden" }}>
        <TopoLines height={120} opacity={0.5} />
        <CedarPageHeader
          eyebrow="bones"
          title={<>Settings.</>}
          sub="Edits buffer locally. Hit Save to write ~/.arz/config.yaml."
          right={
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {savingMsg && (
                <span style={{ fontSize: 11, fontFamily: "var(--fm)", color: "var(--cedar-2)" }}>
                  {savingMsg}
                </span>
              )}
              <Btn kind="ghost" onClick={discard} disabled={!dirty}>
                Discard
              </Btn>
              <Btn kind="solid" onClick={save} disabled={!dirty}>
                Save {dirty ? "•" : ""}
              </Btn>
            </div>
          }
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
          {section === "general" && draft && (
            <CedarCard padding={24}>
              <SettingRow label="Bot name" desc="Your assistant's display name across surfaces.">
                <input
                  value={draft.bot_name}
                  onChange={(e) => update({ bot_name: e.target.value })}
                  style={inp}
                />
              </SettingRow>
              <SettingRow label="Log level" desc="Gateway log verbosity. Applies live on save.">
                <SegSeg<string>
                  value={draft.log_level}
                  onChange={(v) => update({ log_level: v })}
                  options={["DEBUG", "INFO", "WARNING", "ERROR"].map((l) => ({ value: l, label: l }))}
                />
              </SettingRow>
              <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 16, lineHeight: 1.55 }}>
                Default provider + model live under <strong>Providers</strong>. Each saved Agent on{" "}
                <a href="/agents" style={{ color: "var(--cedar-glow)" }}>/agents</a> can override per persona.
              </div>
            </CedarCard>
          )}

          {section === "providers" && draft && (
            <CedarCard padding={24}>
              <SettingRow label="Default provider" desc="Used when a session doesn't specify one. List filtered to providers currently installed on this machine.">
                <SegSeg<Settings["provider"]>
                  value={draft.provider}
                  onChange={(v) => {
                    // When provider changes, reset model to that provider's
                    // default so the field stays valid.
                    update({
                      provider: v,
                      model: defaultModelForProvider(v),
                    });
                  }}
                  options={installedProviders.map((p) => ({
                    value: p,
                    label: PROVIDER_LABELS[p] ?? p,
                  }))}
                />
              </SettingRow>
              <SettingRow label="Default model" desc="Picks from the selected provider's catalog. Type a custom id if yours isn't listed.">
                <ProviderModelPicker
                  provider={draft.provider}
                  model={draft.model}
                  onChange={(m) => update({ model: m })}
                />
              </SettingRow>
              <SettingRow label="System prompt" desc="Prepended to every session. Agent-specific prompts on /agents override this.">
                <textarea
                  value={draft.system_prompt}
                  onChange={(e) => update({ system_prompt: e.target.value })}
                  rows={6}
                  style={{ ...inp, fontFamily: "var(--fm)", resize: "vertical", width: 360 }}
                />
              </SettingRow>
              {ALL_PROVIDERS.length !== installedProviders.length && (
                <div
                  style={{
                    marginTop: 14,
                    fontSize: 11.5,
                    color: "var(--muted)",
                    background: "var(--cedar-dim)",
                    border: "1px solid var(--cedar-line)",
                    borderRadius: 7,
                    padding: "8px 12px",
                  }}
                >
                  Some providers aren't installed yet. Visit{" "}
                  <a href="/models" style={{ color: "var(--cedar-glow)" }}>/models</a> to add Claude Code, Kiro, Codex, Gemini, or Ollama.
                </div>
              )}
            </CedarCard>
          )}

          {section === "memory" && draft && (
            <CedarCard padding={24}>
              <SettingRow label="Auto recall" desc="Inject memory matches at the top of every chat turn.">
                <Toggle on={draft.auto_recall} onClick={() => update({ auto_recall: !draft.auto_recall })} />
              </SettingRow>
              <SettingRow label="Recall K" desc="How many memory items to inject per turn.">
                <input
                  type="number"
                  value={draft.recall_k}
                  min={0}
                  max={20}
                  onChange={(e) => update({ recall_k: Number(e.target.value) })}
                  style={{ ...inp, width: 100 }}
                />
              </SettingRow>
              <div style={{ marginTop: 14, fontSize: 11.5, color: "var(--muted)", lineHeight: 1.55 }}>
                Memory has two layers:
                <ul style={{ margin: "6px 0 0 18px" }}>
                  <li>
                    <strong>Markdown + lessons</strong> — always on. Files live in <code>~/.arz/memory/</code>.{" "}
                    {memStats && (
                      <>Currently {memStats.markdown} md + {memStats.lessons} lessons.</>
                    )}
                  </li>
                  <li style={{ marginTop: 4 }}>
                    <strong>Vector recall</strong> — needs Ollama installed locally for embeddings.{" "}
                    {ollamaInstalled ? (
                      <span style={{ color: "var(--cedar-2)" }}>
                        ✓ Ollama detected ({memStats?.vectors ?? 0} vectors).
                      </span>
                    ) : (
                      <span style={{ color: "var(--ember)" }}>
                        Not installed — install from{" "}
                        <a href="/models" style={{ color: "var(--cedar-glow)" }}>/models</a>.
                      </span>
                    )}
                  </li>
                </ul>
              </div>
              <div style={{ height: 18, borderTop: "1px solid var(--hairline)", marginTop: 18 }} />
              <SettingRow
                label="Auto-create skills (Hermes)"
                desc="After a session with enough tool calls, ask the LLM to extract a reusable skill into ~/.arz/skills/auto/. Gated by sensitive-session detection, output redaction, similarity dedup, and a full audit log."
              >
                <Toggle
                  on={draft.skills_auto_create}
                  onClick={() => update({ skills_auto_create: !draft.skills_auto_create })}
                />
              </SettingRow>
              {draft.skills_auto_create && (
                <SettingRow
                  label="Min tool calls"
                  desc="Sessions with fewer than this many tool calls are ignored."
                >
                  <input
                    type="number"
                    value={draft.skills_min_tool_calls}
                    min={1}
                    max={100}
                    onChange={(e) => update({ skills_min_tool_calls: Number(e.target.value) })}
                    style={{ ...inp, width: 100 }}
                  />
                </SettingRow>
              )}
            </CedarCard>
          )}

          {section === "security" && draft && (
            <CedarCard padding={24}>
              <SettingRow label="Token auth" desc="Require a bearer token for all API requests.">
                <Toggle on={draft.token_auth} onClick={() => update({ token_auth: !draft.token_auth })} />
              </SettingRow>
              <SettingRow label="Bind address" desc="Host the gateway listens on. 0.0.0.0 exposes it to your network — requires token auth.">
                <input
                  value={draft.host}
                  onChange={(e) => update({ host: e.target.value })}
                  style={inp}
                />
              </SettingRow>
              <SettingRow label="Port" desc="Gateway listening port.">
                <input
                  type="number"
                  value={draft.port}
                  onChange={(e) => update({ port: Number(e.target.value) })}
                  style={{ ...inp, width: 120 }}
                />
              </SettingRow>
              <div
                style={{
                  marginTop: 14,
                  fontSize: 11.5,
                  color: "var(--dawn)",
                  background: "rgba(180, 130, 60, 0.10)",
                  border: "1px solid var(--dawn)",
                  borderRadius: 7,
                  padding: "8px 12px",
                }}
              >
                Host + port changes are written to <code>config.yaml</code> on Save but take effect only after a gateway restart (<code>uv run arz gateway</code>). Token auth applies live.
              </div>
            </CedarCard>
          )}

          {section === "appearance" && (
            <>
              <CedarCard padding={24}>
                <AppearanceSettings />
              </CedarCard>
              {draft && (
                <CedarCard padding={24} style={{ marginTop: 14 }}>
                  <SettingRow
                    label="Widget density"
                    desc="How eagerly agents render inline interactive widgets (charts, dashboards, calculators) instead of plain markdown."
                  >
                    <select
                      value={draft.widget_density}
                      onChange={(e) =>
                        update({ widget_density: e.target.value as "more" | "less" | "off" })
                      }
                      style={{ ...inp, width: 150 }}
                    >
                      <option value="more">More — default</option>
                      <option value="less">Less — markdown first</option>
                      <option value="off">Off — never</option>
                    </select>
                  </SettingRow>
                  <div style={{ marginTop: 10, fontSize: 11.5, color: "var(--muted)", lineHeight: 1.55 }}>
                    Widgets are sandboxed iframes; Tailwind is preloaded and agents can pull in
                    Chart.js / D3 / Alpine from any CDN. Toggling to <code>off</code> tells the
                    model to never reach for a widget.
                  </div>
                </CedarCard>
              )}
            </>
          )}

          {section === "advanced" && (
            <CedarCard padding={24}>
              <PathsRows />
            </CedarCard>
          )}

          {!draft && section !== "appearance" && (
            <CedarCard padding={32} style={{ textAlign: "center", color: "var(--muted)" }}>
              Loading settings…
            </CedarCard>
          )}
        </div>
      </div>
    </CedarPage>
  );
}

function ProviderModelPicker({
  provider,
  model,
  onChange,
}: {
  provider: Settings["provider"];
  model: string;
  onChange: (m: string) => void;
}) {
  const options = modelsForProvider(provider);
  const inCatalog = options.find((o) => o.id === model);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
      <select
        value={inCatalog ? model : "__custom__"}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "__custom__") return;
          onChange(v);
        }}
        style={{ ...inp, width: 240 }}
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>{o.label}</option>
        ))}
        <option value="__custom__">Custom…</option>
      </select>
      <input
        value={model}
        onChange={(e) => onChange(e.target.value)}
        placeholder="model id"
        style={{ ...inp, fontFamily: "var(--fm)", fontSize: 12, width: 240 }}
      />
    </div>
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
      <SettingRow label="Density" desc="Spacing scale. Setting applies via CSS data-density; not every component reads it yet — work in progress.">
        <SegSeg<typeof density>
          value={density}
          onChange={setDensity}
          options={densities.map((d) => ({ value: d.value, label: d.label }))}
        />
      </SettingRow>
    </>
  );
}

function PathsRows() {
  const [homeHint, setHomeHint] = useState<string>("");
  useEffect(() => {
    // Probe platform from userAgent. Backend would be more accurate but
    // this is informational; the gateway writes to its own resolved
    // Path.home() regardless.
    const ua = navigator.userAgent.toLowerCase();
    if (ua.includes("win")) setHomeHint("%USERPROFILE%");
    else if (ua.includes("mac")) setHomeHint("~");
    else setHomeHint("~");
  }, []);
  const base = homeHint ? `${homeHint}/.arz` : ".arz";
  const rows: { label: string; desc: string; path: string }[] = [
    { label: "Config file", desc: "Read/written when you Save above.", path: `${base}/config.yaml` },
    { label: "Memory store", desc: "Lessons + notes + vectors.", path: `${base}/memory.db` },
    { label: "Sessions", desc: "Chat history snapshots.", path: `${base}/sessions/` },
    { label: "Agents", desc: "Saved persona configs.", path: `${base}/agents/` },
    { label: "Projects", desc: "Project briefs + tasks.", path: `${base}/projects/` },
    { label: "Tools", desc: "User-authored Python tools (hot-reloaded).", path: `${base}/tools/` },
    { label: "Workspace", desc: "Default agent working directory.", path: `${base}/workspace/` },
  ];
  return (
    <>
      {rows.map((r) => (
        <SettingRow key={r.label} label={r.label} desc={r.desc}>
          <code
            style={{
              fontFamily: "var(--fm)",
              fontSize: 12,
              color: "var(--text3)",
              userSelect: "all",
            }}
          >
            {r.path}
          </code>
        </SettingRow>
      ))}
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
