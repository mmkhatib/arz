// Models — three sections per Cedar design:
//   * CLIs — Claude Code, Kiro, Codex, Gemini (CliCard)
//   * Cloud models — live per-provider lists from GET /api/models (ProviderModelsCard)
//   * Local models — Ollama (LocalCard)

import { useEffect, useRef, useState } from "react";
import { Download, Check, ExternalLink, Loader2, X, Power, PowerOff, Wrench, RefreshCw } from "lucide-react";
import { api } from "@/api/client";
import { PROVIDER_LABELS, setOllamaInstalledModels } from "@/utils/models";
import { refreshLiveModels } from "@/hooks/useLiveModels";
import {
  CedarPage,
  CedarPageHeader,
  CedarCard,
  Btn,
  Tag,
  TopoLines,
} from "@/components/CedarUI";

interface CliRow {
  name: string;
  binary: string;
  description: string;
  installed: boolean;
  path?: string | null;
  docs_url: string;
  installable_here: boolean;
}

interface ModelRow {
  id: string;
  runtime: string;
  name: string;
  label: string;
  description: string;
  size_gb: number;
  ram_gb?: number;
  context?: number;
  license?: string;
  gpu?: "optional" | "recommended" | "required";
}

interface InstalledModel {
  name: string;
  id: string;
  size: string;
}

interface LoadedModel {
  name: string;
  id: string;
  size: string;
  processor?: string;
  until?: string;
}

function fmtCtx(n?: number): string {
  if (!n) return "—";
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

// Module-level cache + sessionStorage backup so revisits paint instantly
// with the last-known status, then refresh in the background.
type InstallerSnapshot = Awaited<ReturnType<typeof api.getInstallerStatus>>;
let _cached: InstallerSnapshot | null = null;
const _SS_KEY = "arz:installer-status-v1";
function loadCache(): InstallerSnapshot | null {
  if (_cached) return _cached;
  try {
    const raw = sessionStorage.getItem(_SS_KEY);
    if (raw) {
      _cached = JSON.parse(raw);
      return _cached;
    }
  } catch {
    // fall through
  }
  return null;
}
function saveCache(s: InstallerSnapshot): void {
  _cached = s;
  try { sessionStorage.setItem(_SS_KEY, JSON.stringify(s)); } catch { /* quota */ }
}

export default function LLMInstallerPage() {
  const initial = loadCache();
  const [clis, setClis] = useState<CliRow[]>(initial?.clis ?? []);
  const [catalog, setCatalog] = useState<ModelRow[]>(initial?.model_catalog ?? []);
  const [installed, setInstalled] = useState<InstalledModel[]>(initial?.ollama_installed_models ?? []);
  const [loaded, setLoaded] = useState<LoadedModel[]>(initial?.ollama_loaded_models ?? []);
  const [error, setError] = useState<string | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);
  const [busyMemory, setBusyMemory] = useState<string | null>(null);
  const [log, setLog] = useState<string>("");
  const [live, setLive] = useState<LiveCatalog | null>(null);
  const [liveBusy, setLiveBusy] = useState(false);

  const loadLive = async (force = false) => {
    setLiveBusy(true);
    try {
      const r = await api.getModels(force);
      setLive(r.providers);
      // Keep every picker in the app in sync with what we just fetched.
      if (force) void refreshLiveModels(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLiveBusy(false);
    }
  };
  const abortRef = useRef<AbortController | null>(null);

  const refresh = async () => {
    try {
      const s = await api.getInstallerStatus();
      setClis(s.clis);
      setCatalog(s.model_catalog);
      setInstalled(s.ollama_installed_models);
      setLoaded(s.ollama_loaded_models || []);
      setOllamaInstalledModels(
        (s.ollama_installed_models || []).map((m) => ({ id: m.name, label: m.name })),
      );
      saveCache(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const loadModel = async (m: string) => {
    setBusyMemory(m); setError(null);
    try { await api.loadOllamaModel(m); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusyMemory(null); }
  };
  const ejectModel = async (m: string) => {
    setBusyMemory(m); setError(null);
    try { await api.ejectOllamaModel(m); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusyMemory(null); }
  };
  const isLoaded = (n: string) => loaded.some((l) => l.name === n);
  const isInstalled = (m: ModelRow) => installed.some((i) => i.name === m.name);

  useEffect(() => {
    refresh();
    void loadLive();
    const t = setInterval(refresh, 30_000);
    return () => clearInterval(t);
  }, []);

  const install = async (target: string, label: string) => {
    setInstalling(target);
    setLog(`$ install ${label}\n\n`);
    setError(null);
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    try {
      const res = await api.installTarget(target, abortRef.current.signal);
      if (!res.ok) {
        const txt = await res.text();
        setLog((l) => l + `\nerror: ${res.status} ${txt}\n`);
        return;
      }
      const reader = res.body?.getReader();
      if (!reader) return;
      const decoder = new TextDecoder();
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        setLog((l) => l + decoder.decode(value, { stream: true }));
      }
      await refresh();
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError(e instanceof Error ? e.message : String(e));
    } finally {
      setInstalling(null);
    }
  };

  const cancelInstall = () => { abortRef.current?.abort(); setInstalling(null); };
  const ollamaInstalled = clis.find((c) => c.name === "ollama")?.installed ?? false;

  return (
    <CedarPage>
      <div style={{ position: "relative", overflow: "hidden" }}>
        <TopoLines height={120} opacity={0.5} />
        <CedarPageHeader
          eyebrow="pinecones"
          title={
            <>
              Models &amp; <em style={{ fontStyle: "italic", color: "var(--cedar-glow)" }}>agents</em>.
            </>
          }
          sub="The CLIs that drive sessions, the cloud models they call, and the local seeds you've planted on this machine."
          right={
            <Btn
              kind="ghost"
              icon={<RefreshCw size={12} className={liveBusy ? "animate-spin" : undefined} />}
              onClick={() => { void refresh(); void loadLive(true); }}
            >
              Refresh
            </Btn>
          }
        />
      </div>
      {error && (
        <div style={{ margin: "12px 32px 0", padding: "8px 12px", background: "var(--ember-dim)", color: "var(--ember)", border: "1px solid var(--ember)", borderRadius: 6, fontSize: 12 }}>
          {error}
        </div>
      )}
      <div style={{ padding: "8px 32px 32px" }}>
        <SectionHeader eyebrow="agents" title="CLIs" sub="Coding agents installed on your machine — engines that drive sessions." count={clis.length} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 14 }}>
          {[...clis].sort((a, b) => Number(b.installed) - Number(a.installed)).map((c) => (
            <CliCard
              key={c.name}
              cli={c}
              installing={installing === c.name}
              onInstall={() => install(c.name, c.name)}
            />
          ))}
        </div>

        <SectionHeader
          eyebrow="cones"
          title="Cloud models"
          sub="Asked live from each CLI or API — aliases like opus or pro always resolve to the newest model, so this list never goes stale."
          count={0}
        />
        {!live ? (
          <CedarCard padding={24}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--muted)" }}>
              <Loader2 size={13} className="animate-spin" /> Asking providers which models they serve…
            </div>
          </CedarCard>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 14 }}>
            {CLOUD_PROVIDERS.filter((p) => live[p]).map((p) => {
              const binary = CLI_FOR_PROVIDER[p];
              const cli = binary ? clis.find((c) => c.binary === binary || c.name === binary) : undefined;
              return (
                <ProviderModelsCard
                  key={p}
                  provider={p}
                  entry={live[p]}
                  cliInstalled={binary ? cli?.installed ?? null : null}
                />
              );
            })}
          </div>
        )}

        <SectionHeader
          eyebrow="seeds"
          title="Local models"
          sub={`Ollama-compatible. ${installed.length} pulled · ${loaded.length} loaded.`}
          count={catalog.length}
        />
        {!ollamaInstalled && (
          <div style={{ padding: "10px 14px", background: "var(--dawn-dim)", border: "1px solid var(--dawn)", borderRadius: 8, fontSize: 12, color: "var(--dawn)", marginBottom: 12 }}>
            Install Ollama first to pull these models.
          </div>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 14 }}>
          {catalog.map((m) => (
            <LocalCard
              key={m.id}
              m={m}
              installed={isInstalled(m)}
              loaded={isLoaded(m.name)}
              installing={installing === m.id}
              busy={busyMemory === m.name}
              ollamaInstalled={ollamaInstalled}
              onPull={() => install(m.id, m.label)}
              onLoad={() => loadModel(m.name)}
              onEject={() => ejectModel(m.name)}
            />
          ))}
        </div>

        {(installing || log) && (
          <>
            <SectionHeader eyebrow="output" title="Install log" sub="Live stream of pull / install progress." count={0} />
            <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", marginBottom: 8 }}>
              {installing && (
                <Btn size="sm" kind="ghost" icon={<X size={11} />} onClick={cancelInstall}>Cancel</Btn>
              )}
            </div>
            <pre
              style={{
                background: "var(--bg)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                padding: "12px 14px",
                fontSize: 11.5,
                fontFamily: "var(--fm)",
                color: "var(--text2)",
                overflowX: "auto",
                whiteSpace: "pre-wrap",
                maxHeight: 400,
                overflowY: "auto",
              }}
            >
              {log || "(waiting…)"}
            </pre>
          </>
        )}
      </div>
    </CedarPage>
  );
}

type LiveCatalog = Awaited<ReturnType<typeof api.getModels>>["providers"];

const CLOUD_PROVIDERS = ["claude-code", "codex", "gemini", "kiro-cli", "anthropic"] as const;
const CLI_FOR_PROVIDER: Record<string, string | undefined> = {
  "claude-code": "claude",
  codex: "codex",
  gemini: "gemini",
  "kiro-cli": "kiro-cli",
};

const SOURCE_INFO: Record<string, { label: string; color: "cedar" | "pine" | "dawn" | "muted"; hint: string }> = {
  "cli-aliases": { label: "aliases · always latest", color: "cedar", hint: "CLI aliases that resolve to the newest model of each family." },
  "cli-cache": { label: "live · CLI cache", color: "cedar", hint: "Read from the model cache the CLI refreshes itself." },
  cli: { label: "live · CLI", color: "cedar", hint: "Listed by the CLI just now." },
  api: { label: "live · API", color: "cedar", hint: "Listed by the provider API just now." },
  fallback: { label: "fallback", color: "dawn", hint: "Couldn't ask the provider — showing a built-in list." },
  unavailable: { label: "unavailable", color: "muted", hint: "Provider couldn't be queried." },
};

function ProviderModelsCard({
  provider,
  entry,
  cliInstalled,
}: {
  provider: string;
  entry: LiveCatalog[string];
  cliInstalled: boolean | null;
}) {
  const src = SOURCE_INFO[entry.source] ?? { label: entry.source, color: "muted" as const, hint: "" };
  const hint =
    provider === "kiro-cli" && entry.source === "fallback"
      ? "Run `kiro-cli login` to list Kiro's models."
      : provider === "anthropic" && entry.source === "fallback"
        ? "Set ANTHROPIC_API_KEY to list models live."
        : src.hint;
  return (
    <CedarCard padding={18} style={{ display: "flex", flexDirection: "column", gap: 12, opacity: cliInstalled === false ? 0.6 : 1 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ fontFamily: "var(--fd)", fontSize: 18, color: "var(--text)", flex: 1, minWidth: 0 }}>
          {PROVIDER_LABELS[provider] ?? provider}
        </div>
        <span title={hint}><Tag color={src.color}>{src.label}</Tag></span>
      </div>
      {entry.models.length === 0 ? (
        <div style={{ fontSize: 12, color: "var(--muted)" }}>No models reported.</div>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 2 }}>
          {entry.models.map((m) => (
            <li
              key={m.id || "(default)"}
              style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", borderBottom: "1px solid var(--hairline)", minWidth: 0 }}
            >
              <span style={{ fontSize: 12.5, color: "var(--text)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {m.label}
              </span>
              {m.id && m.id !== m.label && (
                <code style={{ fontSize: 10.5, fontFamily: "var(--fm)", color: "var(--muted)", whiteSpace: "nowrap" }}>{m.id}</code>
              )}
              {m.default && <Tag color="pine">default</Tag>}
            </li>
          ))}
        </ul>
      )}
      <div style={{ fontSize: 11, color: "var(--text3)", lineHeight: 1.45, marginTop: "auto" }}>
        {cliInstalled === false ? "CLI not installed." : hint}
      </div>
    </CedarCard>
  );
}

function SectionHeader({
  eyebrow,
  title,
  sub,
  count,
}: {
  eyebrow: string;
  title: string;
  sub?: string;
  count: number;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "space-between",
        margin: "28px 0 12px",
        gap: 16,
      }}
    >
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <span style={{ width: 14, height: 1, background: "var(--cedar-glow)" }} />
          <span
            style={{
              fontSize: 10,
              fontFamily: "var(--fm)",
              textTransform: "uppercase",
              letterSpacing: ".16em",
              color: "var(--cedar-2)",
            }}
          >
            {eyebrow}
          </span>
        </div>
        <div style={{ fontFamily: "var(--fd)", fontSize: 24, color: "var(--text)", lineHeight: 1.1 }}>
          {title}
        </div>
        {sub && <div style={{ fontSize: 12.5, color: "var(--text3)", marginTop: 4 }}>{sub}</div>}
      </div>
      {count > 0 && (
        <span style={{ fontSize: 10.5, fontFamily: "var(--fm)", color: "var(--muted)" }}>
          {count} {count === 1 ? "item" : "items"}
        </span>
      )}
    </div>
  );
}

function CliCard({
  cli,
  installing,
  onInstall,
}: {
  cli: CliRow;
  installing: boolean;
  onInstall: () => void;
}) {
  return (
    <CedarCard padding={18} hoverable style={{ position: "relative" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: 8,
            background: "var(--cedar-dim)",
            border: "1px solid var(--cedar-line)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--cedar-glow)",
            flexShrink: 0,
          }}
        >
          <Wrench size={16} />
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontFamily: "var(--fd)", fontSize: 18, color: "var(--text)" }}>{cli.name}</div>
          <div style={{ fontSize: 10.5, color: "var(--muted)", fontFamily: "var(--fm)", marginTop: 2 }}>
            {cli.binary}
          </div>
        </div>
        <a
          href={cli.docs_url}
          target="_blank"
          rel="noreferrer"
          style={{ color: "var(--muted)", flexShrink: 0 }}
          title="Docs"
        >
          <ExternalLink size={13} />
        </a>
      </div>
      <div style={{ fontSize: 12.5, color: "var(--text2)", marginTop: 12, lineHeight: 1.55 }}>
        {cli.description}
      </div>
      {cli.path && (
        <div
          style={{
            fontSize: 10,
            fontFamily: "var(--fm)",
            color: "var(--text3)",
            marginTop: 8,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={cli.path}
        >
          {cli.path}
        </div>
      )}
      <div
        style={{
          marginTop: 14,
          paddingTop: 12,
          borderTop: "1px solid var(--hairline)",
          display: "flex",
          gap: 6,
          alignItems: "center",
        }}
      >
        {cli.installed ? (
          <Tag color="cedar"><Check size={9} style={{ marginRight: 3 }} />installed</Tag>
        ) : (
          <Tag color="muted">not installed</Tag>
        )}
        <div style={{ flex: 1 }} />
        {!cli.installed && cli.installable_here && (
          <Btn
            size="sm"
            kind="solid"
            icon={installing ? <Loader2 size={11} className="animate-spin" /> : <Download size={11} />}
            onClick={onInstall}
            disabled={installing}
          >
            Install
          </Btn>
        )}
      </div>
    </CedarCard>
  );
}

function LocalCard({
  m,
  installed,
  loaded,
  installing,
  busy,
  ollamaInstalled,
  onPull,
  onLoad,
  onEject,
}: {
  m: ModelRow;
  installed: boolean;
  loaded: boolean;
  installing: boolean;
  busy: boolean;
  ollamaInstalled: boolean;
  onPull: () => void;
  onLoad: () => void;
  onEject: () => void;
}) {
  return (
    <CedarCard padding={18} hoverable>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: "var(--fm)", fontSize: 14, color: "var(--text)" }}>{m.label}</div>
          <div style={{ fontSize: 11, color: "var(--muted)", fontFamily: "var(--fm)", marginTop: 3 }}>
            {m.size_gb}GB · {m.ram_gb ? `${m.ram_gb}GB RAM` : "—"} · {fmtCtx(m.context)} ctx
          </div>
        </div>
        {loaded ? (
          <Tag color="cedar">
            <span
              style={{
                width: 5,
                height: 5,
                borderRadius: "50%",
                background: "var(--cedar-glow)",
                marginRight: 4,
              }}
            />
            loaded
          </Tag>
        ) : installed ? (
          <Tag color="pine">installed</Tag>
        ) : (
          <Tag color="muted">not installed</Tag>
        )}
      </div>
      <div style={{ fontSize: 12, color: "var(--text2)", marginTop: 12, lineHeight: 1.55 }}>{m.description}</div>
      <div style={{ display: "flex", gap: 5, marginTop: 12, flexWrap: "wrap" }}>
        {m.gpu === "required" && <Tag color="ember">GPU required</Tag>}
        {m.gpu === "recommended" && <Tag color="dawn">GPU rec.</Tag>}
        {m.license && <Tag color="muted">{m.license}</Tag>}
      </div>
      <div
        style={{
          marginTop: 14,
          paddingTop: 12,
          borderTop: "1px solid var(--hairline)",
          display: "flex",
          gap: 6,
          alignItems: "center",
        }}
      >
        <code
          style={{
            fontSize: 10,
            fontFamily: "var(--fm)",
            color: "var(--text3)",
            background: "var(--bg)",
            border: "1px solid var(--border)",
            padding: "2px 6px",
            borderRadius: 4,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flex: 1,
          }}
        >
          {m.name}
        </code>
        {!installed && (
          <Btn
            size="sm"
            kind="solid"
            icon={installing ? <Loader2 size={11} className="animate-spin" /> : <Download size={11} />}
            onClick={onPull}
            disabled={installing || !ollamaInstalled}
          >
            Pull
          </Btn>
        )}
        {installed && !loaded && (
          <Btn
            size="sm"
            kind="outline"
            icon={busy ? <Loader2 size={11} className="animate-spin" /> : <Power size={11} />}
            onClick={onLoad}
            disabled={busy}
          >
            Load
          </Btn>
        )}
        {installed && loaded && (
          <Btn
            size="sm"
            kind="soft"
            icon={busy ? <Loader2 size={11} className="animate-spin" /> : <PowerOff size={11} />}
            onClick={onEject}
            disabled={busy}
          >
            Eject
          </Btn>
        )}
      </div>
    </CedarCard>
  );
}
