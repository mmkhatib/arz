import { useEffect, useRef, useState } from "react";
import { Cpu, Download, Check, ExternalLink, Loader2, X, Power, PowerOff, MemoryStick } from "lucide-react";
import { api } from "@/api/client";

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

export default function LLMInstallerPage() {
  const [clis, setClis] = useState<CliRow[]>([]);
  const [catalog, setCatalog] = useState<ModelRow[]>([]);
  const [installed, setInstalled] = useState<InstalledModel[]>([]);
  const [loaded, setLoaded] = useState<LoadedModel[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);
  const [busyMemory, setBusyMemory] = useState<string | null>(null);
  const [log, setLog] = useState<string>("");
  const abortRef = useRef<AbortController | null>(null);

  const refresh = async () => {
    try {
      const s = await api.getInstallerStatus();
      setClis(s.clis);
      setCatalog(s.model_catalog);
      setInstalled(s.ollama_installed_models);
      setLoaded(s.ollama_loaded_models || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const loadModel = async (model: string) => {
    setBusyMemory(model);
    setError(null);
    try { await api.loadOllamaModel(model); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusyMemory(null); }
  };

  const ejectModel = async (model: string) => {
    setBusyMemory(model);
    setError(null);
    try { await api.ejectOllamaModel(model); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusyMemory(null); }
  };

  const isLoaded = (name: string) => loaded.some((l) => l.name === name);

  useEffect(() => {
    refresh();
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
      if ((e as Error).name !== "AbortError") {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setInstalling(null);
    }
  };

  const cancelInstall = () => {
    abortRef.current?.abort();
    setInstalling(null);
  };

  const isModelInstalled = (m: ModelRow) =>
    installed.some((i) => i.name === m.name);

  return (
    <div className="flex flex-col h-full bg-[var(--bg)] min-w-0 flex-1 overflow-hidden">
      <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-[var(--border)]">
        <div className="flex items-center gap-2">
          <Cpu size={16} className="text-[var(--cedar)]" />
          <h2 className="text-[15px] font-semibold text-[var(--text)]">Models &amp; Runtimes</h2>
        </div>
        <button
          onClick={refresh}
          className="text-[12px] px-2 py-1 rounded-lg text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface)]"
        >
          Refresh
        </button>
      </div>

      {error && (
        <div className="mx-5 mt-3 text-red-400 text-sm bg-red-900/20 rounded-xl px-3 py-2">{error}</div>
      )}

      <div className="overflow-y-auto px-5 py-4 flex-1 flex flex-col gap-6">
        {/* CLIs */}
        <section>
          <h3 className="text-[12px] uppercase tracking-wider text-[var(--muted)] mb-2">LLM CLIs &amp; Runtimes</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {clis.map((c) => (
              <div key={c.name} className="border border-[var(--border)] rounded-lg p-3 bg-[var(--surface)] flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-semibold text-[var(--text)]">{c.name}</span>
                  {c.installed ? (
                    <span className="text-[10px] uppercase tracking-wider text-emerald-400 bg-emerald-900/30 px-1.5 py-0.5 rounded flex items-center gap-1">
                      <Check size={9} /> installed
                    </span>
                  ) : (
                    <span className="text-[10px] uppercase tracking-wider text-[var(--muted)] bg-[var(--bg)] px-1.5 py-0.5 rounded">not installed</span>
                  )}
                  <a href={c.docs_url} target="_blank" rel="noreferrer" className="ml-auto text-[var(--muted)] hover:text-[var(--text)]" title="Docs">
                    <ExternalLink size={12} />
                  </a>
                </div>
                <div className="text-[12px] text-[var(--muted)]">{c.description}</div>
                {c.path && (
                  <div className="text-[10px] font-mono text-[var(--muted)]/60 truncate">{c.path}</div>
                )}
                <div className="mt-1">
                  {!c.installed && c.installable_here && (
                    <button
                      onClick={() => install(c.name, c.name)}
                      disabled={installing !== null}
                      className="text-[12px] px-3 py-1 rounded-md bg-[var(--cedar)] text-white hover:bg-[var(--cedar-lt)] disabled:opacity-40 flex items-center gap-1"
                    >
                      {installing === c.name ? <Loader2 size={11} className="animate-spin" /> : <Download size={11} />}
                      Install
                    </button>
                  )}
                  {!c.installed && !c.installable_here && (
                    <span className="text-[11px] text-[var(--muted)]/70">No automatic install on this OS — see docs.</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Memory: currently loaded Ollama models */}
        {clis.find((c) => c.name === "ollama")?.installed && (
          <section>
            <h3 className="text-[12px] uppercase tracking-wider text-[var(--muted)] mb-2 flex items-center gap-2">
              <MemoryStick size={12} /> Loaded in memory ({loaded.length})
            </h3>
            {loaded.length === 0 ? (
              <div className="text-[12px] text-[var(--muted)]/60 border border-dashed border-[var(--border)] rounded-lg p-3 bg-[var(--surface)]">
                No Ollama models currently held in RAM/VRAM. Use the <strong>Load</strong> button below to keep one warm; <strong>Eject</strong> evicts it.
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                {loaded.map((m) => (
                  <div key={m.name} className="flex items-center gap-3 border border-[var(--border)] rounded-lg px-3 py-2 bg-[var(--surface)]">
                    <span className="text-[13px] font-mono text-[var(--text)] truncate flex-1">{m.name}</span>
                    {m.processor && <span className="text-[10px] font-mono text-[var(--cedar)] bg-[var(--cedar)]/10 px-1.5 py-0.5 rounded shrink-0">{m.processor}</span>}
                    {m.size && <span className="text-[10px] font-mono text-[var(--muted)]/60 shrink-0">{m.size}</span>}
                    {m.until && <span className="text-[10px] text-[var(--muted)]/60 shrink-0">until {m.until}</span>}
                    <button
                      onClick={() => ejectModel(m.name)}
                      disabled={busyMemory === m.name}
                      title="Unload from memory now"
                      className="text-[11px] flex items-center gap-1 px-2 py-1 rounded-md text-red-400 hover:bg-red-400/10 disabled:opacity-40 shrink-0"
                    >
                      {busyMemory === m.name ? <Loader2 size={11} className="animate-spin" /> : <PowerOff size={11} />}
                      Eject
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* Local models */}
        <section>
          <h3 className="text-[12px] uppercase tracking-wider text-[var(--muted)] mb-2">Local Models (via Ollama)</h3>
          {!clis.find((c) => c.name === "ollama")?.installed && (
            <div className="text-[12px] text-amber-400 bg-amber-900/20 rounded px-3 py-2 mb-2">
              Install Ollama first to pull these models.
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {catalog.map((m) => {
              const isInstalled = isModelInstalled(m);
              const inMem = isLoaded(m.name);
              return (
                <div key={m.id} className="border border-[var(--border)] rounded-lg p-3 bg-[var(--surface)] flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-semibold text-[var(--text)]">{m.label}</span>
                    {isInstalled && (
                      <span className="text-[10px] uppercase tracking-wider text-emerald-400 bg-emerald-900/30 px-1.5 py-0.5 rounded flex items-center gap-1">
                        <Check size={9} /> pulled
                      </span>
                    )}
                    {inMem && (
                      <span className="text-[10px] uppercase tracking-wider text-blue-400 bg-blue-900/30 px-1.5 py-0.5 rounded flex items-center gap-1">
                        <Power size={9} /> loaded
                      </span>
                    )}
                    <span className="ml-auto text-[10px] font-mono text-[var(--muted)]/60">{m.size_gb} GB</span>
                  </div>
                  <div className="text-[12px] text-[var(--muted)]">{m.description}</div>
                  <div className="text-[10px] font-mono text-[var(--muted)]/60">{m.name}</div>
                  <div className="mt-1 flex items-center gap-2">
                    {!isInstalled && (
                      <button
                        onClick={() => install(m.id, m.label)}
                        disabled={installing !== null || !clis.find((c) => c.name === "ollama")?.installed}
                        className="text-[12px] px-3 py-1 rounded-md bg-[var(--cedar)] text-white hover:bg-[var(--cedar-lt)] disabled:opacity-40 flex items-center gap-1"
                      >
                        {installing === m.id ? <Loader2 size={11} className="animate-spin" /> : <Download size={11} />}
                        Pull
                      </button>
                    )}
                    {isInstalled && !inMem && (
                      <button
                        onClick={() => loadModel(m.name)}
                        disabled={busyMemory === m.name}
                        title="Preload into memory (keep_alive=-1)"
                        className="text-[12px] px-3 py-1 rounded-md bg-[var(--bg)] border border-[var(--border)] text-[var(--text)] hover:border-[var(--cedar)]/50 disabled:opacity-40 flex items-center gap-1"
                      >
                        {busyMemory === m.name ? <Loader2 size={11} className="animate-spin" /> : <Power size={11} />}
                        Load
                      </button>
                    )}
                    {isInstalled && inMem && (
                      <button
                        onClick={() => ejectModel(m.name)}
                        disabled={busyMemory === m.name}
                        title="Unload from memory now"
                        className="text-[12px] px-3 py-1 rounded-md bg-[var(--bg)] border border-[var(--border)] text-red-400 hover:bg-red-400/10 disabled:opacity-40 flex items-center gap-1"
                      >
                        {busyMemory === m.name ? <Loader2 size={11} className="animate-spin" /> : <PowerOff size={11} />}
                        Eject
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Install log */}
        {(installing || log) && (
          <section>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-[12px] uppercase tracking-wider text-[var(--muted)]">Install Log</h3>
              {installing && (
                <button onClick={cancelInstall} className="text-[11px] text-[var(--muted)] hover:text-red-400 flex items-center gap-1">
                  <X size={11} /> Cancel
                </button>
              )}
            </div>
            <pre className="bg-black/40 border border-[var(--border)] rounded-lg p-3 text-[11px] font-mono text-[var(--text)] overflow-x-auto whitespace-pre-wrap max-h-[400px] overflow-y-auto">
{log || "(waiting…)"}
            </pre>
          </section>
        )}
      </div>
    </div>
  );
}
