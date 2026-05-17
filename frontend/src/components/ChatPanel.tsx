import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/api/client";
import type { MessageRecord, SessionDetail } from "@/api/client";
import MessageBubble from "./MessageBubble";
import InputBar, { type ApprovalMode } from "./InputBar";
import CollapsibleToolGroup from "./CollapsibleToolGroup";
import WelcomeView from "./WelcomeView";
import CompareModal from "./CompareModal";
import { GitBranch, Zap, ChevronDown, Edit3, Sparkles, MoreHorizontal, Activity as ActivityIcon, Target, Check, X as XIcon } from "lucide-react";
import { formatTokens } from "@/utils/tokens";
import { stripInlineTags } from "@/utils/stripInline";
import { useDialog } from "@/components/Dialog";

/* Preserved for revert: original three-dot bouncer. Was the only
 * "model is thinking" indicator before the word-ticker landed. Kept
 * exported under a Classic name so swapping back is a one-line change. */
export function ThinkingDotsClassic() {
  return (
    <span className="inline-flex items-center gap-1 py-0.5">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="w-1.5 h-1.5 rounded-full bg-[var(--cedar)] opacity-60"
          style={{ animation: `arz-bounce 1.2s ease-in-out ${i * 0.2}s infinite` }}
        />
      ))}
    </span>
  );
}

/* Words cycled by ThinkingDots. Mirrors Claude Code's vibe — verbs that
 * actually evoke deliberation rather than a flat "Loading…". Sampled in
 * shuffle order so the same word doesn't surface twice in a row. */
const _THINKING_VERBS = [
  "Pondering", "Considering", "Computing", "Thinking", "Reasoning",
  "Synthesizing", "Reflecting", "Cogitating", "Mulling", "Brewing",
  "Plotting", "Sketching", "Weighing", "Investigating", "Parsing",
  "Distilling", "Crafting", "Tuning", "Hatching", "Sleuthing",
  "Untangling", "Threading", "Stitching", "Wrangling", "Drafting",
  "Composing", "Aligning", "Mapping", "Tracing", "Conjuring",
  "Spelunking", "Forging", "Whittling", "Refining", "Polishing",
  "Deliberating", "Charting", "Tinkering", "Surveying", "Branching",
  "Sequencing", "Decoding", "Calibrating", "Resolving", "Sharpening",
  "Sifting", "Stewing", "Marinating", "Percolating", "Excavating",
  "Foraging", "Foreshadowing", "Annotating", "Reckoning", "Scaffolding",
];

/*
 * Letter ticker — mirrors codepen.io/jackrugile/pen/GROaam.
 *
 * Each letter scrambles through random glyphs at varying opacity, then
 * locks in left-to-right one letter at a time. Once the word is fully
 * resolved we hold briefly, then swap to the next verb and re-scramble.
 *
 * Height stays at the row's natural line-height (no leading bouncing
 * dots and no trailing "…", per the spec the user pasted in).
 */
const _SCRAMBLE_CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890!@#$%^&*()-_=+{}|[]\\;':\"<>?,./`~".split("");
const _CYCLES_PER_LETTER = 5;   // how many random frames before locking the next letter
const _FRAME_INTERVAL_MS = 32;  // ~30 fps — feels like the codepen
const _HOLD_AFTER_RESOLVE_MS = 750;

function randChar(): string {
  return _SCRAMBLE_CHARS[Math.floor(Math.random() * _SCRAMBLE_CHARS.length)];
}

function ThinkingDots() {
  const [wordIdx, setWordIdx] = useState(() =>
    Math.floor(Math.random() * _THINKING_VERBS.length),
  );
  const target = (_THINKING_VERBS[wordIdx] || "Thinking").toUpperCase();
  const [display, setDisplay] = useState<string[]>(() => target.split(""));
  const [locked, setLocked] = useState<number>(0); // how many letters have resolved
  const [opacities, setOpacities] = useState<number[]>(() => target.split("").map(() => 1));
  const cycleRef = useRef(0);
  const timerRef = useRef<number | null>(null);

  // When the target word changes, reset to scramble state.
  useEffect(() => {
    setDisplay(target.split("").map(() => randChar()));
    setOpacities(target.split("").map(() => Math.random()));
    setLocked(0);
    cycleRef.current = 0;
  }, [target]);

  // Frame loop — drives the scramble + locks one letter every
  // _CYCLES_PER_LETTER frames.
  useEffect(() => {
    const tick = () => {
      setLocked((curLocked) => {
        // Snapshot the locked count so the closure stays consistent
        // with the display/opacity updates we issue below.
        if (curLocked >= target.length) {
          // Word fully resolved — hold, then swap to the next verb.
          timerRef.current = window.setTimeout(() => {
            setWordIdx((prev) => {
              let next = Math.floor(Math.random() * _THINKING_VERBS.length);
              if (next === prev) next = (next + 1) % _THINKING_VERBS.length;
              return next;
            });
          }, _HOLD_AFTER_RESOLVE_MS);
          return curLocked;
        }

        // Scramble every letter past curLocked + jitter their opacity.
        setDisplay((prev) =>
          prev.map((ch, i) => {
            if (i < curLocked) return ch;
            if (target[i] === " ") return " ";
            return randChar();
          }),
        );
        setOpacities((prev) =>
          prev.map((_op, i) => (i < curLocked ? 1 : Math.random())),
        );

        if (cycleRef.current < _CYCLES_PER_LETTER) {
          cycleRef.current += 1;
          timerRef.current = window.setTimeout(tick, _FRAME_INTERVAL_MS);
          return curLocked;
        }

        // Cycle done — lock the next letter and continue.
        cycleRef.current = 0;
        setDisplay((prev) => prev.map((ch, i) => (i === curLocked ? target[i] : ch)));
        setOpacities((prev) => prev.map((op, i) => (i === curLocked ? 1 : op)));
        timerRef.current = window.setTimeout(tick, _FRAME_INTERVAL_MS);
        return curLocked + 1;
      });
    };
    timerRef.current = window.setTimeout(tick, _FRAME_INTERVAL_MS);
    return () => {
      if (timerRef.current != null) window.clearTimeout(timerRef.current);
    };
  }, [target]);

  return (
    <span
      className="inline-flex items-center py-0.5"
      style={{
        fontFamily: "var(--fm)",
        fontSize: 12.5,
        lineHeight: 1,
        letterSpacing: ".08em",
        // Soft cedar glow matching the codepen's green halo.
        textShadow:
          "0 0 8px color-mix(in srgb, var(--cedar-glow) 45%, transparent), 0 0 4px color-mix(in srgb, var(--cedar-glow) 30%, transparent)",
      }}
    >
      {display.map((ch, i) => (
        <span
          key={i}
          style={{
            display: "inline-block",
            width: ch === " " ? "0.4em" : "0.7em",
            textAlign: "center",
            color: i < locked ? "var(--cedar-glow)" : "var(--text)",
            opacity: i < locked ? 1 : opacities[i] ?? 1,
            transition: i < locked ? "color .15s" : "none",
          }}
        >
          {ch}
        </span>
      ))}
    </span>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="w-[80px] shrink-0 text-[var(--muted)] uppercase tracking-wider text-[9.5px]">
        {label}
      </span>
      <span className="text-[var(--text)] truncate" title={value}>{value}</span>
    </div>
  );
}

const SESSION_COLORS: { value: number | null; label: string; css: string }[] = [
  { value: null, label: "Default", css: "transparent" },
  { value: 1, label: "Cedar", css: "var(--cedar-glow)" },
  { value: 2, label: "Dawn", css: "var(--dawn)" },
  { value: 3, label: "Ember", css: "var(--ember)" },
  { value: 4, label: "Stone", css: "var(--stone)" },
  { value: 5, label: "Pine", css: "var(--pine)" },
  { value: 6, label: "Sky", css: "#7aa7d6" },
  { value: 7, label: "Plum", css: "#a47ad6" },
];

function SessionTitle({
  title,
  messageCount,
  sessionId,
  provider,
  model,
  agent,
  color,
  onRename,
  onRegenerate,
  onColorChange,
}: {
  title: string;
  messageCount: number;
  sessionId: string;
  provider?: string | null;
  model?: string | null;
  agent?: string | null;
  color?: number | null;
  onRename: (next: string) => void | Promise<void>;
  onRegenerate: () => void | Promise<void>;
  onColorChange?: (color: number | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const [regenerating, setRegenerating] = useState(false);

  useEffect(() => {
    if (!editing) setDraft(title);
  }, [title, editing]);

  const commit = async () => {
    const next = draft.trim();
    if (next && next !== title) await onRename(next);
    setEditing(false);
  };

  const regenerate = async () => {
    if (regenerating || messageCount < 2) return;
    setRegenerating(true);
    try {
      await onRegenerate();
    } finally {
      setRegenerating(false);
    }
  };

  const [menuOpen, setMenuOpen] = useState(false);
  const [mcps, setMcps] = useState<{ name: string; enabled: boolean; source: string }[] | null>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest("[data-title-menu]")) setMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuOpen]);

  // Lazy-load MCPs the first time the menu opens — keeps the
  // common case (menu never opened) cheap.
  useEffect(() => {
    if (!menuOpen || mcps !== null) return;
    api.listMcpServers().then(setMcps).catch(() => setMcps([]));
  }, [menuOpen, mcps]);

  void sessionId; // currently informational; reserved for deep links
  const colorCss =
    SESSION_COLORS.find((c) => c.value === (color ?? null))?.css ?? "transparent";
  const enabledMcps = (mcps ?? []).filter((m) => m.enabled);

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          else if (e.key === "Escape") { setDraft(title); setEditing(false); }
        }}
        className="flex-1 min-w-0 bg-[var(--bg)] border border-[var(--cedar-line)] rounded-md px-2.5 py-1 text-[13px] font-medium text-[var(--text)] focus:outline-none"
        maxLength={200}
      />
    );
  }

  // MeshClaw-style: title sits in a bordered box that doubles as a
  // dropdown trigger. On hover, two compact actions appear (Edit and
  // ✨ AI rename) — these are duplicated inside the dropdown menu so
  // they're discoverable without hover (e.g. on touch).
  return (
    <div className="relative group flex items-center min-w-0" data-title-menu>
      <button
        onClick={() => setMenuOpen((o) => !o)}
        title="Session options"
        className={[
          "flex items-center gap-2 min-w-0 px-2.5 py-1 rounded-md border transition-colors",
          menuOpen
            ? "border-[var(--cedar-line)] bg-[var(--cedar-dim)]"
            : "border-[var(--border)] hover:border-[var(--cedar-line)] hover:bg-[var(--s2)]",
        ].join(" ")}
      >
        {colorCss !== "transparent" && (
          <span
            className="shrink-0 w-2 h-2 rounded-full"
            style={{ background: colorCss }}
            aria-hidden
          />
        )}
        <h2 className="text-[13px] font-medium text-[var(--text)] truncate max-w-[420px]">
          {title}
        </h2>
        <ChevronDown size={12} className="text-[var(--muted)] shrink-0" />
      </button>

      {/* Hover-revealed quick actions */}
      <div className="ml-1 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
        <button
          onClick={() => setEditing(true)}
          title="Rename"
          className="w-6 h-6 flex items-center justify-center rounded text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--s2)]"
        >
          <Edit3 size={11} />
        </button>
        <button
          onClick={regenerate}
          disabled={regenerating || messageCount < 2}
          title={messageCount < 2 ? "Send a message first" : "Rename with AI"}
          className="w-6 h-6 flex items-center justify-center rounded text-[var(--cedar-glow)] hover:bg-[var(--cedar-dim)] disabled:opacity-30 disabled:cursor-not-allowed"
        >
          {regenerating ? <span className="text-[11px]">…</span> : <Sparkles size={11} />}
        </button>
      </div>

      {menuOpen && (
        <div className="absolute left-0 top-full mt-1 z-40 w-[300px] rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-xl py-1.5">
          {/* Loaded context summary */}
          <div className="px-3 py-2 border-b border-[var(--hairline)] text-[11px] flex flex-col gap-1 font-mono">
            <Row label="Provider" value={provider || "—"} />
            <Row label="Model" value={model || "—"} />
            <Row label="Agent" value={agent ? `@${agent}` : "none"} />
            <Row label="MCP servers" value={`${enabledMcps.length} loaded`} />
          </div>

          {/* Color picker */}
          {onColorChange && (
            <div className="px-3 py-2 border-b border-[var(--hairline)]">
              <div className="text-[10px] uppercase tracking-wider text-[var(--muted)] mb-1.5 font-mono">
                Color label
              </div>
              <div className="flex flex-wrap gap-1">
                {SESSION_COLORS.map((c) => {
                  const active = (color ?? null) === c.value;
                  return (
                    <button
                      key={String(c.value)}
                      onClick={() => onColorChange(c.value)}
                      title={c.label}
                      className={[
                        "w-5 h-5 rounded-full border transition-transform",
                        active
                          ? "border-[var(--cedar-glow)] scale-110"
                          : "border-[var(--border)] hover:border-[var(--cedar-line)]",
                      ].join(" ")}
                      style={{
                        background: c.css,
                        boxShadow: c.value === null ? "inset 0 0 0 1px var(--border)" : undefined,
                      }}
                    />
                  );
                })}
              </div>
            </div>
          )}

          {/* Actions */}
          <button
            onClick={() => { setEditing(true); setMenuOpen(false); }}
            className="flex items-center gap-2 w-full text-left px-3 py-1.5 text-[12px] text-[var(--text)] hover:bg-[var(--s2)]"
          >
            <Edit3 size={12} className="text-[var(--muted)]" />
            Rename manually
          </button>
          <button
            onClick={() => { void regenerate(); setMenuOpen(false); }}
            disabled={messageCount < 2}
            className="flex items-center gap-2 w-full text-left px-3 py-1.5 text-[12px] text-[var(--text)] hover:bg-[var(--s2)] disabled:opacity-40"
          >
            <Sparkles size={12} className="text-[var(--cedar-glow)]" />
            Rename with AI
          </button>
          <a
            href="/capabilities"
            onClick={() => setMenuOpen(false)}
            className="flex items-center gap-2 w-full text-left px-3 py-1.5 text-[12px] text-[var(--muted)] hover:bg-[var(--s2)] hover:text-[var(--text)]"
          >
            <ActivityIcon size={12} />
            Manage MCPs & tools →
          </a>
        </div>
      )}
    </div>
  );
}

function ExportMenu({ sessionId }: { sessionId: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const close = () => setOpen(false);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest("[data-export-menu]")) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const copyLink = () => {
    // Prefer the current path (already /chat/<slug>?sid=...), so what
    // we put on the clipboard matches what's in the address bar. Falls
    // back to a /chat/<sid> shape if for some reason there's no slug.
    const path = window.location.pathname.startsWith("/chat/")
      ? window.location.pathname + window.location.search
      : `/chat/session?sid=${encodeURIComponent(sessionId)}`;
    const url = `${window.location.origin}${path}`;
    void navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
    close();
  };

  return (
    <div className="relative" data-export-menu>
      <button
        onClick={() => setOpen((v) => !v)}
        title="Export / share"
        className={[
          "flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[12px] transition-colors",
          open
            ? "border-[var(--cedar-line)] bg-[var(--cedar-dim)] text-[var(--cedar-glow)]"
            : "border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)] hover:border-[var(--cedar-line)] hover:bg-[var(--s2)]",
        ].join(" ")}
      >
        ⤓ Export
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-30 min-w-[180px] rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-xl py-1">
          <a
            href={api.exportSessionUrl(sessionId, "markdown")}
            onClick={close}
            className="block px-3 py-1.5 text-[12px] text-[var(--text)] hover:bg-[var(--bg)]"
          >
            Download Markdown
          </a>
          <a
            href={api.exportSessionUrl(sessionId, "json")}
            onClick={close}
            className="block px-3 py-1.5 text-[12px] text-[var(--text)] hover:bg-[var(--bg)]"
          >
            Download JSON
          </a>
          <button
            onClick={copyLink}
            className="block w-full text-left px-3 py-1.5 text-[12px] text-[var(--text)] hover:bg-[var(--bg)]"
          >
            {copied ? "Link copied ✓" : "Copy session link"}
          </button>
        </div>
      )}
    </div>
  );
}

/* ── ArtifactsMenu ───────────────────────────────────────────────
 *
 * Lists every file the agent touched in this session (Write / Edit /
 * MultiEdit / etc). Grouped by extension family for scan-ability. Click
 * a row → bubble onFileOpen up so the Activity pane swaps to the file.
 */
type ArtifactGroup = "html" | "code" | "doc" | "data" | "image" | "other";

function classifyArtifact(path: string): ArtifactGroup {
  const ext = (path.split(".").pop() || "").toLowerCase();
  if (["html", "htm"].includes(ext)) return "html";
  if (["md", "markdown", "mdx", "rst", "txt", "pdf", "docx"].includes(ext)) return "doc";
  if (["json", "yaml", "yml", "toml", "csv", "tsv", "ndjson", "log"].includes(ext)) return "data";
  if (["png", "jpg", "jpeg", "gif", "svg", "webp", "ico"].includes(ext)) return "image";
  if (
    [
      "ts", "tsx", "js", "jsx", "py", "rb", "go", "rs", "java", "kt", "cs", "cpp",
      "c", "h", "hpp", "swift", "php", "sql", "sh", "bash", "zsh", "fish", "lua",
      "pl", "scala", "clj", "cljs", "ex", "exs", "elm", "erl", "dart", "css", "scss",
      "less", "vue", "svelte",
    ].includes(ext)
  ) return "code";
  return "other";
}

const ARTIFACT_LABEL: Record<ArtifactGroup, string> = {
  html: "HTML",
  code: "Code",
  doc: "Docs",
  data: "Data",
  image: "Images",
  other: "Other",
};

function ArtifactsMenu({
  messages,
  onOpenFile,
}: {
  messages: { tool_calls?: { name: string; input: string }[] }[];
  onOpenFile?: (path: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [paths, setPaths] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest("[data-artifacts-menu]")) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  // Re-derive every time the message list grows — keep cheap by lazy-
  // importing the extractor on first use.
  useEffect(() => {
    let cancelled = false;
    void import("@/hooks/useTouchedFiles").then(({ extractPathFromToolInput }) => {
      if (cancelled) return;
      const seen = new Set<string>();
      const out: string[] = [];
      for (const msg of messages) {
        for (const tc of msg.tool_calls ?? []) {
          const p = extractPathFromToolInput(tc.name, tc.input);
          if (p && !seen.has(p)) {
            seen.add(p);
            out.push(p);
          }
        }
      }
      setPaths(out);
    });
    return () => { cancelled = true; };
  }, [messages]);

  const grouped = useMemo(() => {
    const g: Record<ArtifactGroup, string[]> = { html: [], code: [], doc: [], data: [], image: [], other: [] };
    for (const p of paths) g[classifyArtifact(p)].push(p);
    return g;
  }, [paths]);

  const count = paths.length;

  return (
    <div className="relative" data-artifacts-menu>
      <button
        onClick={() => setOpen((v) => !v)}
        title={count === 0 ? "No artifacts yet" : `${count} artifact${count === 1 ? "" : "s"}`}
        className={[
          "flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[12px] transition-colors",
          open
            ? "border-[var(--cedar-line)] bg-[var(--cedar-dim)] text-[var(--cedar-glow)]"
            : "border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)] hover:border-[var(--cedar-line)] hover:bg-[var(--s2)]",
        ].join(" ")}
      >
        📦 Artifacts
        {count > 0 && (
          <span className="text-[10px] font-mono opacity-70">{count}</span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-30 min-w-[280px] max-w-[420px] max-h-[60vh] overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-xl py-1">
          {count === 0 ? (
            <div className="px-3 py-3 text-[11.5px] text-[var(--muted)]">
              The agent hasn't created any files in this session yet.
            </div>
          ) : (
            (Object.keys(grouped) as ArtifactGroup[])
              .filter((g) => grouped[g].length > 0)
              .map((g) => (
                <div key={g}>
                  <div className="px-3 pt-2 pb-1 text-[9.5px] font-mono uppercase tracking-[.12em] text-[var(--muted)]">
                    {ARTIFACT_LABEL[g]} <span className="opacity-60">· {grouped[g].length}</span>
                  </div>
                  {grouped[g].map((p) => {
                    const name = p.split(/[\\/]/).pop() || p;
                    return (
                      <button
                        key={p}
                        onClick={() => {
                          onOpenFile?.(p);
                          setOpen(false);
                        }}
                        title={p}
                        className="block w-full text-left px-3 py-1.5 text-[12px] text-[var(--text)] hover:bg-[var(--bg)] truncate"
                      >
                        <span className="text-[var(--cedar-glow)]">{name}</span>
                        {p.length > name.length && (
                          <span className="ml-2 text-[10px] font-mono text-[var(--muted)] opacity-60">
                            {p.slice(0, p.length - name.length).replace(/[\\/]$/, "")}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              ))
          )}
        </div>
      )}
    </div>
  );
}

function MoreMenu({
  sessionId,
  autonudgeGoal,
  autonudgeIdleS,
  goal,
  goalStatus,
  onForked,
  onAutonudgeChange,
  onGoalChange,
}: {
  sessionId: string;
  autonudgeGoal: string | null;
  autonudgeIdleS: number;
  goal: string | null;
  goalStatus: "active" | "done";
  onForked: (id: string) => void;
  onAutonudgeChange: (goal: string | null, idle_s: number) => void;
  onGoalChange: (goal: string | null, status: "active" | "done") => void;
}) {
  const dialog = useDialog();
  const [open, setOpen] = useState(false);
  const isAutoOn = !!(autonudgeGoal && autonudgeIdleS > 0);
  const goalActive = !!(goal && goalStatus === "active");

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest("[data-more-menu]")) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const fork = async () => {
    setOpen(false);
    try {
      const f = await api.forkSession(sessionId);
      onForked(f.id);
    } catch (e) {
      console.error("fork failed", e);
    }
  };

  const toggleAuto = async () => {
    setOpen(false);
    if (isAutoOn) {
      await api.setAutoNudge(sessionId, { goal: null, idle_s: 0 });
      onAutonudgeChange(null, 0);
      return;
    }
    const goal = await dialog.prompt({
      title: "AutoNudge goal",
      body: "What should this session keep working on while idle?",
      defaultValue: autonudgeGoal ?? "",
      placeholder: "Refactor the auth layer, ship docs, etc.",
      okLabel: "Next",
      eyebrow: "autonudge — step 1",
    });
    if (!goal) return;
    const idleStr = await dialog.prompt({
      title: "Idle threshold (seconds)",
      body: "Nudge fires after this many seconds without activity. Minimum 30s.",
      defaultValue: String(autonudgeIdleS || 120),
      placeholder: "120",
      okLabel: "Enable",
      eyebrow: "autonudge — step 2",
    });
    if (idleStr === null) return;
    const idle_s = Math.max(30, parseInt(idleStr || "120", 10) || 120);
    await api.setAutoNudge(sessionId, { goal, idle_s, reset_iterations: true });
    onAutonudgeChange(goal, idle_s);
  };

  const editGoal = async () => {
    setOpen(false);
    const next = await dialog.prompt({
      title: goalActive ? "Edit goal" : "Set goal",
      body: "Persistent objective. Injected into every turn so the model keeps it in mind across restarts.",
      defaultValue: goal ?? "",
      placeholder: "Ship the auth refactor and document the API.",
      okLabel: goalActive ? "Update" : "Set",
      eyebrow: "goal",
    });
    if (next === null) return;
    const trimmed = next.trim();
    if (!trimmed) {
      await api.clearGoal(sessionId);
      onGoalChange(null, "active");
      return;
    }
    await api.setGoal(sessionId, trimmed);
    onGoalChange(trimmed, "active");
  };

  const completeGoal = async () => {
    setOpen(false);
    if (!goalActive) return;
    await api.markGoalDone(sessionId);
    onGoalChange(goal, "done");
  };

  const clearGoal = async () => {
    setOpen(false);
    if (!goal) return;
    await api.clearGoal(sessionId);
    onGoalChange(null, "active");
  };

  return (
    <div className="relative" data-more-menu>
      <button
        onClick={() => setOpen((o) => !o)}
        title="More actions"
        className={[
          "flex items-center justify-center w-8 h-7 rounded-md border transition-colors",
          open
            ? "border-[var(--cedar-line)] bg-[var(--cedar-dim)] text-[var(--cedar-glow)]"
            : "border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)] hover:border-[var(--cedar-line)] hover:bg-[var(--s2)]",
        ].join(" ")}
      >
        <MoreHorizontal size={13} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-40 min-w-[220px] rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-xl py-1">
          <button
            onClick={fork}
            className="flex items-center gap-2 w-full text-left px-3 py-1.5 text-[12px] text-[var(--text)] hover:bg-[var(--s2)]"
          >
            <GitBranch size={12} className="text-[var(--muted)]" />
            Fork session
          </button>
          <button
            onClick={toggleAuto}
            className="flex items-center gap-2 w-full text-left px-3 py-1.5 text-[12px] text-[var(--text)] hover:bg-[var(--s2)]"
          >
            <Zap size={12} className={isAutoOn ? "text-amber-400" : "text-[var(--muted)]"} />
            {isAutoOn
              ? `AutoNudge ON · disable (${autonudgeIdleS}s)`
              : "AutoNudge — set goal"}
          </button>
          <div className="my-1 border-t border-[var(--border)]" />
          <button
            onClick={editGoal}
            className="flex items-center gap-2 w-full text-left px-3 py-1.5 text-[12px] text-[var(--text)] hover:bg-[var(--s2)]"
          >
            <Target
              size={12}
              className={goalActive ? "text-emerald-400" : "text-[var(--muted)]"}
            />
            {goalActive ? "Edit goal" : "Set persistent goal"}
          </button>
          {goalActive && (
            <button
              onClick={completeGoal}
              className="flex items-center gap-2 w-full text-left px-3 py-1.5 text-[12px] text-[var(--text)] hover:bg-[var(--s2)]"
            >
              <Check size={12} className="text-emerald-400" />
              Mark goal done
            </button>
          )}
          {goal && (
            <button
              onClick={clearGoal}
              className="flex items-center gap-2 w-full text-left px-3 py-1.5 text-[12px] text-[var(--muted)] hover:bg-[var(--s2)]"
            >
              <XIcon size={12} />
              Clear goal
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function SessionTotals({ messages }: { messages: MessageRecord[] }) {
  let inTok = 0,
    outTok = 0,
    credits = 0,
    creditUnit = "";
  for (const m of messages) {
    if (!m.usage) continue;
    inTok += m.usage.input_tokens;
    outTok += m.usage.output_tokens;
    if (m.usage.credits) {
      credits += m.usage.credits;
      if (!creditUnit && m.usage.credit_unit) creditUnit = m.usage.credit_unit;
    }
  }
  if (inTok === 0 && outTok === 0 && credits === 0) return null;
  const tokenStr = inTok > 0 || outTok > 0 ? `${formatTokens(inTok)}↑ ${formatTokens(outTok)}↓` : "";
  const creditStr = credits > 0 ? `${credits.toFixed(3)} ${creditUnit || "¢"}` : "";
  const title = [
    inTok > 0 || outTok > 0 ? `tokens: ${inTok} in, ${outTok} out` : null,
    credits > 0 ? `${credits.toFixed(4)} ${creditUnit || "credits"}` : null,
  ].filter(Boolean).join(" • ");
  return (
    <span className="ml-3 text-[11px] font-mono text-[var(--muted)] flex items-center gap-2" title={title}>
      {tokenStr && <span>{tokenStr}</span>}
      {creditStr && <span>{creditStr}</span>}
    </span>
  );
}

interface Props {
  sessionId: string;
  onToolCall?: (tc: { callId: string; name: string; input: string; time: string }) => void;
  onToolResult?: (callId: string, content: string) => void;
  activityOpen?: boolean;
  onToggleActivity?: () => void;
  onTitleChange?: (title: string) => void;
  onSseEvent?: (type: string, summary?: string) => void;
  onSeedFiles?: (paths: string[]) => void;
  onSeedTools?: (tools: { callId: string; name: string; input: string; result?: string; time: string; done: boolean }[]) => void;
  onFileOpen?: (path: string) => void;
  onOpenSidebar?: () => void;
  /** Counter from parent — when it changes, the input bar refocuses. */
  focusSignal?: number;
  /** Switch the parent to display the newly-forked session. */
  onSessionForked?: (newSessionId: string) => void;
}

export default function ChatPanel({
  sessionId,
  onToolCall,
  onToolResult,
  activityOpen,
  onToggleActivity,
  onTitleChange,
  onSseEvent,
  onSeedFiles,
  onSeedTools,
  onFileOpen,
  onOpenSidebar,
  focusSignal,
  onSessionForked,
}: Props) {
  const [localFocusBump, setLocalFocusBump] = useState(0);
  const bumpFocusSignal = () => setLocalFocusBump((n) => n + 1);
  const effectiveFocusSignal = (focusSignal ?? 0) + localFocusBump;
  const [messages, setMessages] = useState<MessageRecord[]>([]);
  const [title, setTitle] = useState<string>("New session");
  const [streaming, setStreaming] = useState(false);
  // Single-slot send queue. While a turn is in flight, one more user
  // message can sit here; it fires automatically when the turn ends.
  // Held in a ref + state so doSend's finally can read it synchronously
  // without re-rendering the world.
  const [queuedMessage, setQueuedMessage] = useState<{
    text: string;
    files?: import("@/api/client").UploadedFile[];
  } | null>(null);
  const queuedRef = useRef<{
    text: string;
    files?: import("@/api/client").UploadedFile[];
  } | null>(null);
  const setQueued = (q: typeof queuedRef.current) => {
    queuedRef.current = q;
    setQueuedMessage(q);
  };
  const [streamBuffer, setStreamBuffer] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [contextPct, setContextPct] = useState(0);
  const [estimatedContext, setEstimatedContext] = useState(false);
  const [toolCalls, setToolCalls] = useState<{ callId: string; name: string; input: string; state?: "running" | "done" | "rejected" | "error" }[]>([]);
  const [pendingApproval, setPendingApproval] = useState<{ requestId: string; title: string; toolInput: string } | null>(null);
  const [approvalMode, setApprovalMode] = useState<ApprovalMode>("normal");
  const [settings, setSettings] = useState<{ model: string } | null>(null);
  const [sessionProvider, setSessionProvider] = useState<string | null>(null);
  const [sessionModel, setSessionModel] = useState<string | null>(null);
  const [sessionAgent, setSessionAgent] = useState<string | null>(null);
  const [sessionColor, setSessionColor] = useState<number | null>(null);
  const [agents, setAgents] = useState<{ name: string; description?: string; provider?: string }[]>([]);
  const [workDir, setWorkDir] = useState("");
  const [compareTarget, setCompareTarget] = useState<{ prompt: string; baseline: string; baselineModel: string | null } | null>(null);
  const [autonudgeGoal, setAutonudgeGoal] = useState<string | null>(null);
  const [autonudgeIdleS, setAutonudgeIdleS] = useState<number>(0);
  const [goal, setGoal] = useState<string | null>(null);
  const [goalStatus, setGoalStatus] = useState<"active" | "done">("active");
  const [goalIterations, setGoalIterations] = useState<number>(0);
  const [goalMaxIterations, setGoalMaxIterations] = useState<number>(20);
  const [goalLastReason, setGoalLastReason] = useState<string>("");
  const firstUserMsgRef = useRef<string>("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    setMessages([]);
    setStreamBuffer("");
    setError(null);
    setTitle("New session");
    setWorkDir("");
    api.getSession(sessionId)
      .then((s: SessionDetail) => {
        setMessages(s.messages);
        setTitle(s.title);
        setWorkDir(s.work_dir ?? "");
        setSessionProvider(s.provider ?? null);
        setSessionModel(s.model ?? null);
        setSessionAgent(s.agent ?? null);
        setSessionColor(s.color ?? null);
        if (s.approval_mode) setApprovalMode(s.approval_mode);
        setAutonudgeGoal(s.autonudge_goal ?? null);
        setAutonudgeIdleS(s.autonudge_idle_s ?? 0);
        setGoal(s.goal ?? null);
        setGoalStatus((s.goal_status as "active" | "done") ?? "active");
        setGoalIterations(s.goal_iterations ?? 0);
        setGoalMaxIterations(s.goal_max_iterations ?? 20);
        setGoalLastReason(s.goal_last_reason ?? "");
        // If a turn is currently running for this session (e.g. the user
        // navigated away and came back), attach to its detached stream and
        // start showing live updates again.
        if (s.streaming) {
          reattachStream().catch(() => {});
        }
        // Seed file paths AND tool entries from message history so the Files
        // and Tools tabs are pre-populated even when the session was finished
        // before the user opened the activity rail.
        if (onSeedFiles || onSeedTools) {
          import("@/hooks/useTouchedFiles").then(({ extractPathFromToolInput }) => {
            const paths: string[] = [];
            const seen = new Set<string>();
            const tools: { callId: string; name: string; input: string; result?: string; time: string; done: boolean }[] = [];
            let i = 0;
            for (const msg of s.messages) {
              for (const tc of msg.tool_calls ?? []) {
                const p = extractPathFromToolInput(tc.name, tc.input);
                if (p && !seen.has(p)) { seen.add(p); paths.push(p); }
                tools.push({
                  callId: `seed-${i++}`,
                  name: tc.name,
                  input: tc.input ?? "",
                  result: (tc as { result?: string }).result,
                  time: new Date(msg.created_at).toLocaleTimeString(),
                  done: true,
                });
              }
            }
            if (paths.length > 0) onSeedFiles?.(paths);
            if (tools.length > 0) onSeedTools?.(tools);
          });
        }
      })
      .catch((e: Error) => setError(e.message));
  }, [sessionId]);

  useEffect(() => {
    api.getSettings().then((s) => setSettings({ model: s.model })).catch(() => {});
    api.listAgents().then((as) =>
      setAgents(as.map((a) => ({ name: a.name, description: a.description, provider: a.provider })))
    ).catch(() => {});
  }, []);

  // Auto-send a prompt stashed by "Open subagent task as new session"
  useEffect(() => {
    const stashed = sessionStorage.getItem(`arz:autosend:${sessionId}`);
    if (stashed) {
      sessionStorage.removeItem(`arz:autosend:${sessionId}`);
      // wait one tick so the session details have loaded
      const t = setTimeout(() => handleSend(stashed), 100);
      return () => clearTimeout(t);
    }
  }, [sessionId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamBuffer]);

  // While a turn is in flight (locally OR detached on the server), poll
  // the session every 3s to pull in messages saved by _run_turn's
  // background task. This is a defensive backstop to the SSE reattach —
  // if the SSE connection has any trouble, the user still sees the reply
  // get added once the server persists it.
  useEffect(() => {
    if (!streaming) return;
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      try {
        const s = await api.getSession(sessionId);
        if (cancelled) return;
        // Replace messages if the server has more than we do. Conservative:
        // only update if the server count is strictly greater, so we don't
        // wipe in-flight optimistic state.
        setMessages((prev) => (s.messages.length > prev.length ? s.messages : prev));
        if (!s.streaming) {
          // Server says the turn finished — let our local "streaming" flag
          // catch up so the UI clears the "..." indicator.
          setStreaming(false);
          setStreamBuffer("");
        }
      } catch {}
    };
    const id = setInterval(tick, 3000);
    return () => { cancelled = true; clearInterval(id); };
  }, [streaming, sessionId]);

  // Client-side context estimate when the provider doesn't report it.
  // Approximation: ~4 chars/token, default 200k token window.
  useEffect(() => {
    if (contextPct > 0 && !estimatedContext) return;
    const chars = messages.reduce((n, m) => n + (m.text?.length ?? 0), 0) + streamBuffer.length;
    const estTokens = chars / 4;
    const window = 200_000;
    const pct = Math.min(99, (estTokens / window) * 100);
    if (Math.abs(pct - contextPct) > 0.5) {
      setContextPct(pct);
      setEstimatedContext(true);
    }
  }, [messages, streamBuffer, contextPct, estimatedContext]);

  const handleApprovalModeChange = (mode: ApprovalMode) => {
    setApprovalMode(mode);
    api.setApprovalMode(sessionId, mode).catch(() => {});
  };

  const handleModelChange = (model: string) => {
    setSessionModel(model);
    api.setSessionModel(sessionId, model).catch(() => {});
  };

  const handleAgentChange = (agent: string | null) => {
    // Switching agent on an active session changes role only — system
    // prompt + approval mode + tool allowlist. The current LLM (provider +
    // model) stays put. Don't re-sync sessionProvider/sessionModel.
    setSessionAgent(agent);
    api.setSessionAgent(sessionId, agent)
      .then(() => api.getSession(sessionId))
      .then((s) => {
        if (s.approval_mode) setApprovalMode(s.approval_mode);
      })
      .catch(() => {});
  };

  const handleWorkDirChange = (path: string) => {
    setWorkDir(path);
    api.setWorkDir(sessionId, path).catch(() => {});
  };

  // Double-tap (within 1.5s) forces an immediate hard-kill instead of
  // waiting out the cooperative cancel budget.
  const lastStopAtRef = useRef<number>(0);
  const handleStop = async () => {
    const now = Date.now();
    const isDoubleTap = now - lastStopAtRef.current < 1500;
    lastStopAtRef.current = now;
    abortRef.current?.();
    try {
      await api.stopChat(sessionId);
      if (isDoubleTap) {
        // Already aborted client-side; backend got a second stop signal
        // which short-circuits the 10s budget.
        await api.stopChat(sessionId);
      }
    } catch {
      // Best-effort — if the server is gone the local abort is enough.
    }
  };

  const handleSend = async (message: string, files?: import("@/api/client").UploadedFile[]) => {
    // While a turn is streaming, hold the user's next message in a
    // single-slot queue rather than firing it and getting a 409 from
    // the gateway. Drop earlier queued messages — the most recent
    // intent wins.
    if (streaming) {
      setQueued({ text: message, files });
      return;
    }
    if (files && files.length > 0) {
      const refs = files
        .map((f) => {
          const isImage = ["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(f.ext);
          const url = `/api/files/read?path=${encodeURIComponent(f.path)}`;
          return isImage ? `![${f.name}](${url})` : `- \`${f.path}\``;
        })
        .join("\n");
      message = message ? `${message}\n\n${refs}` : refs;
    }
    return doSend(message);
  };

  // Drain the queue once the in-flight turn finishes. Earlier version
  // cleared queuedMessage *before* the setTimeout fired, which retriggered
  // the effect and its cleanup canceled the very timer that would have
  // sent the message. Now: read from the ref, schedule the send, then
  // clear once delivered. Re-entrancy guarded by `draining`.
  const drainingRef = useRef(false);
  useEffect(() => {
    if (streaming || !queuedRef.current || drainingRef.current) return;
    drainingRef.current = true;
    const q = queuedRef.current;
    const t = setTimeout(() => {
      // Clear *after* dispatching — handleSend reads streaming from the
      // current closure; by the time it runs the send, streaming flipped
      // to true and we don't want a stale queued chip lingering.
      void handleSend(q.text, q.files);
      setQueued(null);
      drainingRef.current = false;
    }, 50);
    return () => {
      clearTimeout(t);
      drainingRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streaming]);

  // Drain an SSE Response, updating UI state as events arrive. Used for
  // both fresh sends (POST /api/chat) and re-attaches (GET /api/chat/{id}/stream).
  const consumeStream = async (response: Response, sendStart: number, abortFlagRef: { aborted: boolean }) => {
    let fullText = "";
    let turnUsage: import("@/api/client").UsageRecord | undefined;
    const turnToolCalls: { name: string; input: string }[] = [];
    for await (const chunk of api.streamChat(response)) {
      if (abortFlagRef.aborted) break;
      if (chunk.type === "text_chunk" && chunk.text) {
        fullText += chunk.text;
        setStreamBuffer(fullText);
        onSseEvent?.("text_chunk");
      } else if (chunk.type === "tool_call" && chunk.tool_name) {
        const callId = chunk.request_id || chunk.tool_name! + Date.now();
        const tc = { callId, name: chunk.tool_name!, input: chunk.tool_input || "", time: new Date().toLocaleTimeString() };
        turnToolCalls.push({ name: tc.name, input: tc.input });
        setToolCalls((prev) => [...prev, { callId: tc.callId, name: tc.name, input: tc.input, state: "running" }]);
        onToolCall?.(tc);
        onSseEvent?.("tool_call", chunk.tool_name);
      } else if (chunk.type === "tool_result" && chunk.tool_call_id) {
        onToolResult?.(chunk.tool_call_id, chunk.content || "");
        setToolCalls((prev) => prev.map((t) =>
          t.callId === chunk.tool_call_id ? { ...t, state: "done" } : t,
        ));
        onSseEvent?.("tool_result", chunk.tool_call_id);
      } else if (chunk.type === "permission_request" && chunk.request_id) {
        setPendingApproval({
          requestId: chunk.request_id!,
          title: chunk.title || chunk.tool_name || "Permission",
          toolInput: chunk.tool_input || "",
        });
        onSseEvent?.("permission_request", chunk.title);
      } else if (chunk.type === "complete") {
        if (chunk.context_pct) { setContextPct(chunk.context_pct); setEstimatedContext(false); }
        if (chunk.usage) turnUsage = chunk.usage;
        if (messages.length === 0 && fullText && firstUserMsgRef.current) {
          api.generateTitle(sessionId, firstUserMsgRef.current, fullText).then((t) => {
            if (t) { setTitle(t); onTitleChange?.(t); }
          }).catch(() => {});
        }
        onSseEvent?.("complete");
        break;
      } else if (chunk.type === "error") {
        setError(chunk.message ?? "Unknown error");
        onSseEvent?.("error", chunk.message);
        break;
      }
    }
    if (fullText && !abortFlagRef.aborted) {
      const assistantMsg: MessageRecord = {
        role: "assistant",
        text: fullText,
        created_at: new Date().toISOString(),
        tool_calls: turnToolCalls.length > 0 ? turnToolCalls : undefined,
        elapsed_ms: Date.now() - sendStart,
        usage: turnUsage,
      };
      // De-dupe: if the server already saved this message (we'll see it on
      // next getSession), skip the optimistic add. Crude heuristic: if the
      // last message is already an assistant message with the same text,
      // don't double-add.
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.role === "assistant" && last.text === fullText) return prev;
        return [...prev, assistantMsg];
      });
    }
  };

  const doSend = async (message: string, opts: { replaceLastUser?: boolean; regenerate?: boolean } = {}) => {
    const userMsg: MessageRecord = {
      role: "user",
      text: message,
      created_at: new Date().toISOString(),
    };
    if (messages.length === 0) {
      setTitle(message.slice(0, 60));
      firstUserMsgRef.current = message;
    }
    if (opts.replaceLastUser || opts.regenerate) {
      // Optimistic: drop the trailing assistant + (for replace) edit user text.
      setMessages((prev) => {
        const next = [...prev];
        while (next.length && next[next.length - 1].role === "assistant") next.pop();
        if (opts.replaceLastUser && next.length && next[next.length - 1].role === "user") {
          next[next.length - 1] = { ...next[next.length - 1], text: message };
        } else if (!opts.regenerate) {
          next.push(userMsg);
        }
        return next;
      });
    } else {
      setMessages((prev) => [...prev, userMsg]);
    }
    setStreaming(true);
    setStreamBuffer("");
    setError(null);
    setToolCalls([]);
    setPendingApproval(null);

    const abortFlag = { aborted: false };
    const sendStart = Date.now();
    abortRef.current = () => { abortFlag.aborted = true; setStreaming(false); setStreamBuffer(""); };

    try {
      const response = await api.sendMessage(sessionId, message, {
        replaceLastUser: opts.replaceLastUser,
        regenerate: opts.regenerate,
      });
      if (!response.ok) {
        throw new Error(`${response.status}: ${await response.text()}`);
      }
      await consumeStream(response, sendStart, abortFlag);
    } catch (e) {
      if (!abortFlag.aborted) setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStreaming(false);
      setStreamBuffer("");
      setPendingApproval(null);
      abortRef.current = null;
    }
  };

  // Re-attach to an in-flight turn — the LLM is running detached on the
  // server, this just streams the buffered + live events into the UI.
  const reattachStream = async () => {
    setStreaming(true);
    setStreamBuffer("");
    setError(null);
    setToolCalls([]);
    setPendingApproval(null);
    const abortFlag = { aborted: false };
    abortRef.current = () => { abortFlag.aborted = true; setStreaming(false); setStreamBuffer(""); };
    try {
      const response = await api.reattachStream(sessionId);
      if (!response.ok) {
        throw new Error(`${response.status}: ${await response.text()}`);
      }
      await consumeStream(response, Date.now(), abortFlag);
    } catch (e) {
      if (!abortFlag.aborted) setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStreaming(false);
      setStreamBuffer("");
      setPendingApproval(null);
      abortRef.current = null;
    }
  };

  return (
    <div className="flex flex-col flex-1 min-w-0 h-full">
      {compareTarget && (
        <CompareModal
          prompt={compareTarget.prompt}
          baselineReply={compareTarget.baseline}
          baselineModel={compareTarget.baselineModel}
          provider="claude-code"
          onClose={() => setCompareTarget(null)}
        />
      )}
      {/* Session header */}
      <div className="shrink-0 px-4 md:px-6 py-3 border-b border-[var(--border)] bg-[var(--surface)] flex items-center gap-2">
        {onOpenSidebar && (
          <button
            onClick={onOpenSidebar}
            className="md:hidden text-[var(--muted)] hover:text-[var(--text)] -ml-1 p-1"
            aria-label="Open sidebar"
            title="Open sidebar"
          >
            ☰
          </button>
        )}
        <SessionTitle
          title={title}
          messageCount={messages.length}
          sessionId={sessionId}
          provider={sessionProvider}
          model={sessionModel}
          agent={sessionAgent}
          color={sessionColor}
          onColorChange={async (c) => {
            setSessionColor(c);
            try { await api.setSessionColor(sessionId, c); } catch {}
          }}
          onRename={async (next) => {
            try {
              await api.renameSession(sessionId, next);
              setTitle(next);
              onTitleChange?.(next);
            } catch (e) {
              console.error("rename failed", e);
            }
          }}
          onRegenerate={async () => {
            const generated = await api.generateTitle(sessionId);
            if (generated) {
              setTitle(generated);
              onTitleChange?.(generated);
            }
          }}
        />
        <SessionTotals messages={messages} />
        <div className="ml-auto flex items-center gap-1">
          {/* Theme dropdown lives in the global TopBar now — keeping a
              second one here is just clutter. */}
          <ExportMenu sessionId={sessionId} />
          <ArtifactsMenu messages={messages} onOpenFile={onFileOpen} />
          {onToggleActivity && (
            <button
              onClick={onToggleActivity}
              title="Toggle activity pane"
              className={[
                "flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[12px] transition-colors",
                activityOpen
                  ? "border-[var(--cedar-line)] bg-[var(--cedar-dim)] text-[var(--cedar-glow)]"
                  : "border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)] hover:border-[var(--cedar-line)] hover:bg-[var(--s2)]",
              ].join(" ")}
            >
              <ActivityIcon size={12} />
              Activity
            </button>
          )}
          <MoreMenu
            sessionId={sessionId}
            autonudgeGoal={autonudgeGoal}
            autonudgeIdleS={autonudgeIdleS}
            goal={goal}
            goalStatus={goalStatus}
            onForked={(id) => onSessionForked?.(id)}
            onAutonudgeChange={(g, idle_s) => {
              setAutonudgeGoal(g);
              setAutonudgeIdleS(idle_s);
            }}
            onGoalChange={(g, status) => {
              setGoal(g);
              setGoalStatus(status);
            }}
          />
        </div>
      </div>

      {/* Goal pill — persistent across restarts; visible reminder of what
          the model is keeping in mind every turn. */}
      {goal && (
        <div
          className={[
            "mx-6 mt-3 mb-1 flex flex-col gap-1 px-3 py-1.5 rounded-md border text-[12px]",
            goalStatus === "active"
              ? "border-emerald-500/40 bg-emerald-500/5 text-emerald-200"
              : "border-[var(--border)] bg-[var(--s2)] text-[var(--muted)]",
          ].join(" ")}
        >
          <div className="flex items-center gap-2">
            <Target size={12} className="shrink-0" />
            <span className="font-medium uppercase tracking-wider text-[10px] opacity-70">
              {goalStatus === "active" ? "goal" : "goal · done"}
            </span>
            {goalStatus === "active" && goalIterations > 0 && (
              <span
                className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15"
                title="Auto-iterations fired since this goal was set"
              >
                ◎ {goalIterations}/{goalMaxIterations}
              </span>
            )}
            <span className="truncate flex-1">{goal}</span>
            {goalStatus === "active" && (
              <button
                onClick={async () => {
                  await api.markGoalDone(sessionId);
                  setGoalStatus("done");
                }}
                title="Mark goal done"
                className="shrink-0 px-1.5 py-0.5 rounded hover:bg-emerald-500/10"
              >
                <Check size={11} />
              </button>
            )}
            <button
              onClick={async () => {
                await api.clearGoal(sessionId);
                setGoal(null);
                setGoalStatus("active");
                setGoalIterations(0);
                setGoalLastReason("");
              }}
              title="Clear goal"
              className="shrink-0 px-1.5 py-0.5 rounded hover:bg-[var(--s3)]"
            >
              <XIcon size={11} />
            </button>
          </div>
          {goalLastReason && (
            <div
              className="text-[11px] opacity-70 pl-5 truncate"
              title={goalLastReason}
            >
              evaluator: {goalLastReason}
            </div>
          )}
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        {messages.length === 0 && !streaming && (
          <WelcomeView
            model={sessionModel ?? settings?.model}
            onModelChange={handleModelChange}
            provider={sessionProvider ?? undefined}
            workDir={workDir}
            onWorkDirChange={handleWorkDirChange}
            agent={sessionAgent}
            agents={agents}
            onAgentChange={handleAgentChange}
            onPickSuggestion={(text) => {
              // Seed the composer draft + nudge focus. InputBar reads
              // arz:draft:<sessionId> on focusSignal change.
              try {
                if (sessionId) localStorage.setItem(`arz:draft:${sessionId}`, text);
              } catch { /* localStorage full / quota */ }
              bumpFocusSignal();
            }}
          />
        )}

        {messages.map((msg, i) => {
          const prevUser = msg.role === "assistant"
            ? [...messages.slice(0, i)].reverse().find((m) => m.role === "user")
            : null;
          // "Last user/assistant" = the trailing message of its role in the
          // visible list. Used to show edit & regenerate affordances.
          const lastUserIdx = messages.map((m, idx) => m.role === "user" ? idx : -1).filter((x) => x >= 0).pop() ?? -1;
          const lastAsstIdx = messages.map((m, idx) => m.role === "assistant" ? idx : -1).filter((x) => x >= 0).pop() ?? -1;
          const isLastUser = i === lastUserIdx && !streaming;
          const isLastAssistant = i === lastAsstIdx && !streaming;
          return (
            <MessageBubble
              key={i}
              message={msg}
              onFileOpen={onFileOpen}
              isLastUser={isLastUser}
              isLastAssistant={isLastAssistant}
              onEditResend={isLastUser ? (text) => doSend(text, { replaceLastUser: true }) : undefined}
              onRegenerate={
                isLastAssistant && prevUser
                  ? () => doSend(prevUser.text, { regenerate: true })
                  : undefined
              }
              onCycleVersion={
                msg.role === "assistant" && msg.versions && msg.versions.length > 1
                  ? async (next) => {
                      try {
                        await api.selectMessageVersion(sessionId, i, next);
                        setMessages((prev) => prev.map((m, idx) => idx === i
                          ? { ...m, text: m.versions![next], version_index: next }
                          : m));
                      } catch (e) {
                        console.error("version select failed", e);
                      }
                    }
                  : undefined
              }
              onCompare={
                msg.role === "assistant" && prevUser
                  ? () => setCompareTarget({
                      prompt: prevUser.text,
                      baseline: msg.text,
                      baselineModel: msg.model ?? settings?.model ?? null,
                    })
                  : undefined
              }
            />
          );
        })}

        {/* Live streaming bubble */}
        {streaming && (
          <div className="flex justify-start mb-4">
            <div className="w-7 h-7 rounded-full bg-[var(--cedar)] flex items-center justify-center text-[12px] mr-2 mt-0.5 shrink-0">
              🌲
            </div>
            <div className="max-w-[75%] px-4 py-2.5 rounded-2xl rounded-bl-sm bg-[var(--asst-bg)] border border-[var(--border)] text-[14px] whitespace-pre-wrap">
              {(toolCalls.length > 0 || pendingApproval) && (
                <div className="mb-2">
                  <CollapsibleToolGroup
                    toolCalls={toolCalls}
                    requestId={pendingApproval?.requestId}
                    permissionTitle={pendingApproval?.title}
                    permissionInput={pendingApproval?.toolInput}
                    isRunning={streaming}
                  />
                </div>
              )}
              {streamBuffer ? stripInlineTags(streamBuffer) : <ThinkingDots />}
            </div>
          </div>
        )}

        {error && (
          <div className="mx-auto max-w-sm text-center text-[13px] text-red-400 bg-red-900/20 rounded-xl px-4 py-2 mb-4">
            {error}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <InputBar
        onSend={handleSend}
        onStop={handleStop}
        onUpload={(files) => api.uploadFiles(sessionId, files)}
        disabled={false}
        isRunning={streaming}
        contextPct={contextPct}
        contextEstimated={estimatedContext}
        model={sessionModel ?? settings?.model}
        provider={sessionProvider ?? undefined}
        approvalMode={approvalMode}
        onApprovalModeChange={handleApprovalModeChange}
        onModelChange={handleModelChange}
        agent={sessionAgent}
        agents={agents}
        onAgentChange={handleAgentChange}
        focusSignal={effectiveFocusSignal}
        draftKey={sessionId}
        queuedPreview={queuedMessage?.text ?? null}
        onCancelQueued={() => setQueued(null)}
        sessionId={sessionId}
        goal={goal}
        goalStatus={goalStatus}
        onSetGoal={async (text) => {
          const res = await api.setGoal(sessionId, text);
          setGoal(text);
          setGoalStatus("active");
          setGoalIterations(0);
          setGoalLastReason("");
          // Server fires the first turn immediately (no separate user
          // POST). Poll up to 5s for streaming=true, then attach the
          // SSE — covers the race where the kickoff POST is still
          // being scheduled when we get back from setGoal.
          if (res?.kickoff_fired) {
            const tryAttach = async (attempt: number): Promise<void> => {
              if (attempt > 25) return; // ~5s total at 200ms intervals
              try {
                const s = await api.getSession(sessionId);
                if (s.streaming) {
                  await reattachStream().catch(() => {});
                  return;
                }
              } catch {
                /* ignore — retry */
              }
              setTimeout(() => void tryAttach(attempt + 1), 200);
            };
            void tryAttach(0);
          }
        }}
        onClearGoal={async () => {
          await api.clearGoal(sessionId);
          setGoal(null);
          setGoalStatus("active");
        }}
      />
    </div>
  );
}
