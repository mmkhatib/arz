// Sandboxed inline interactive widget.
// Renders agent-authored HTML/CSS/JS inside a sandboxed iframe with srcdoc.
// The iframe runs at a NULL origin (no allow-same-origin) so it cannot
// touch cookies, localStorage of the parent, or fetch with the user's
// credentials. allow-scripts is on so Chart.js / D3 / Alpine can run.
//
// Auto-resize: we inject a tiny bootstrap script into the iframe that
// postMessages its content height to the parent. The parent matches the
// iframe height to that value (clamped to a sane min/max).
//
// Accepts:
//   - title  (string)         — header label
//   - html   (string)         — full innerHTML for the iframe body
//   - id     (string)         — used for postMessage routing when many
//                               widgets sit on the same page
//   - maxHeight (number, px)  — soft cap so a runaway widget can't take
//                               over the whole chat surface
//
// The iframe ships with Tailwind CDN preloaded so most "build me a
// dashboard" output just works. Agents can include their own <script
// src="…cdn…"> tags for Chart.js / D3 / Alpine / etc.

import { useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, Code, ChevronDown, ChevronRight, RefreshCw } from "lucide-react";

// Theme tokens are read from the host page at render time, so a plain-HTML
// widget sits in the chat like native content (light or dark) instead of
// a fixed dark box. Agent CSS still wins: it loads after these defaults.
interface WidgetTheme { bg: string; surface: string; text: string; text2: string; border: string; accent: string; font: string }

function readTheme(): WidgetTheme {
  const fallback: WidgetTheme = {
    bg: "#1c1a17", surface: "#26221d", text: "#d8d4cb", text2: "#a49c90", border: "#3a342e",
    accent: "#76c89c", font: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  };
  if (typeof document === "undefined") return fallback;
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string, fb: string) => cs.getPropertyValue(name).trim() || fb;
  return {
    bg: v("--bg", fallback.bg),
    surface: v("--s2", fallback.surface),
    text: v("--text", fallback.text),
    text2: v("--text2", fallback.text2),
    border: v("--border", fallback.border),
    accent: v("--cedar-glow", fallback.accent),
    font: v("--fn", fallback.font),
  };
}

function bootstrapStyles(t: WidgetTheme): string {
  return `
<script src="https://cdn.tailwindcss.com"></script>
<style>
  html, body {
    margin: 0;
    padding: 12px;
    font-family: ${t.font};
    font-size: 13.5px;
    line-height: 1.55;
    color: ${t.text};
    background: ${t.bg};
  }
  * { box-sizing: border-box; }
  a { color: ${t.accent}; }
  table { border-collapse: collapse; }
  th, td { padding: 6px 10px; border: 1px solid ${t.border}; }
  th { background: ${t.surface}; }
</style>`;
}

/** Defaults for unclassed buttons — placed at the top of <body> so they
 *  beat Tailwind's preflight reset (in <head>) but lose to agent CSS. */
function baseControls(t: WidgetTheme): string {
  return `<style>
  button:where(:not([class])) {
    font: inherit; color: ${t.text}; background: ${t.surface};
    border: 1px solid ${t.border}; border-radius: 8px; padding: 6px 12px; cursor: pointer;
  }
  button:where(:not([class])):hover { border-color: ${t.accent}; color: ${t.accent}; }
</style>`;
}

const BOOTSTRAP_SCRIPT = `
<script>
  (function () {
    function postHeight() {
      var h = Math.max(
        document.documentElement.scrollHeight,
        document.body ? document.body.scrollHeight : 0
      );
      parent.postMessage({ __arzwidget: true, id: ${JSON.stringify("__ID__")}, h: h }, "*");
    }
    // Talk back to the chat. A widget is otherwise a dead end: the agent
    // can draw a table of options and the user still has to retype their
    // choice. arz.send(text) — or any element carrying data-arz-send —
    // posts that text out, and the parent sends it as the user's next
    // message (steering it into the running turn when one is live).
    function postAction(text) {
      parent.postMessage(
        { __arzwidget: true, id: ${JSON.stringify("__ID__")}, action: String(text == null ? "" : text) },
        "*"
      );
    }
    window.arz = { send: postAction };
    document.addEventListener("click", function (e) {
      var el = e.target && e.target.closest ? e.target.closest("[data-arz-send]") : null;
      if (!el) return;
      e.preventDefault();
      postAction(el.getAttribute("data-arz-send"));
    });

    var ro = new ResizeObserver(postHeight);
    document.addEventListener("DOMContentLoaded", function () {
      ro.observe(document.documentElement);
      ro.observe(document.body);
      postHeight();
    });
    window.addEventListener("load", postHeight);
    // Catch dynamic content (Chart.js render etc.) that lands after load.
    setTimeout(postHeight, 200);
    setTimeout(postHeight, 800);
    setTimeout(postHeight, 2000);
  })();
</script>
`;

/** Full documents (`<!doctype html><html><head><style>…`) get flattened to
 *  head assets + body markup — keeping only <body> dropped the agent's
 *  <style> and rendered unstyled text. */
export function normalizeWidgetHtml(html: string): string {
  if (!html || !/<!doctype|<html\b/i.test(html)) return html;
  const head = html.match(/<head[^>]*>([\s\S]*?)<\/head>/i)?.[1] ?? "";
  const assets = (head.match(/<style[\s\S]*?<\/style>|<link\b[^>]*>|<script[\s\S]*?<\/script>/gi) ?? []).join("\n");
  const body = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1];
  if (body !== undefined) return assets + body;
  return (
    assets +
    html
      .replace(/<!doctype[^>]*>/gi, "")
      .replace(/<html[^>]*>|<\/html>/gi, "")
      .replace(/<head[\s\S]*?<\/head>/gi, "")
  );
}

export function buildSrcdoc(html: string, id: string, theme: WidgetTheme = readTheme()): string {
  const boot = bootstrapStyles(theme) + BOOTSTRAP_SCRIPT.split("__ID__").join(id);
  return `<!doctype html><html><head><meta charset="utf-8"/>${boot}</head><body>${baseControls(theme)}${normalizeWidgetHtml(html)}</body></html>`;
}

/* HtmlSandbox — the bare iframe + bootstrap + auto-resize.
 *
 * Exported so anything that needs to render HTML safely (Widget chrome
 * in chat, HtmlView in the Activity panel, future preview cards) lands
 * on one component. Two height modes:
 *
 *   - default: auto-grow from the iframe's postMessage'd height, clamped
 *     to [60, maxHeight]. Use this inline in chat.
 *   - fill=true: ignore postMessage height and fill the parent. Use this
 *     in a panel that already has its own height (FileViewer body).
 */
export function HtmlSandbox({
  html,
  id,
  maxHeight = 800,
  fill = false,
  reloadKey = 0,
  title,
  onAction,
}: {
  html: string;
  id?: string;
  maxHeight?: number;
  fill?: boolean;
  reloadKey?: number;
  title?: string;
  /** Text the embedded page asked to send back to the chat. */
  onAction?: (text: string) => void;
}) {
  const sandboxId = useMemo(() => id || `w_${Math.random().toString(36).slice(2, 10)}`, [id]);
  const [height, setHeight] = useState(120);

  const theme = useMemo(readTheme, [reloadKey]);
  const srcdoc = useMemo(() => buildSrcdoc(html, sandboxId, theme), [html, sandboxId, theme]);

  // Throttle: the page inside is agent-authored, so a scripted loop must
  // not be able to machine-gun the chat. One action per second is well
  // past what a human clicking can produce.
  const lastActionRef = useRef(0);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const d = e.data;
      if (!d || typeof d !== "object") return;
      if (d.__arzwidget !== true) return;
      if (d.id !== sandboxId) return;
      if (typeof d.action === "string") {
        const text = d.action.trim().slice(0, 2000);
        const now = Date.now();
        if (!text || !onAction || now - lastActionRef.current < 1000) return;
        lastActionRef.current = now;
        onAction(text);
        return;
      }
      if (fill) return; // fill mode ignores postMessage heights
      const h = Math.max(60, Math.min(maxHeight, Number(d.h) || 0));
      setHeight(h);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [sandboxId, maxHeight, fill, onAction]);

  return (
    <iframe
      key={reloadKey}
      title={title || "arz html"}
      // allow-scripts only — NO allow-same-origin, so the iframe runs at
      // a unique opaque origin and can't read parent cookies / LS.
      sandbox="allow-scripts allow-popups allow-forms"
      srcDoc={srcdoc}
      style={
        fill
          ? { width: "100%", height: "100%", border: "none", display: "block", background: theme.bg }
          : {
              width: "100%",
              height,
              border: "none",
              display: "block",
              background: theme.bg,
              transition: "height .12s",
            }
      }
    />
  );
}

interface WidgetProps {
  title?: string;
  html: string;
  id?: string;
  maxHeight?: number;
  /** Send text from inside the widget as the user's next message. */
  onAction?: (text: string) => void;
}

export default function Widget({ title, html, id, maxHeight = 800, onAction }: WidgetProps) {
  const widgetId = useMemo(() => id || `w_${Math.random().toString(36).slice(2, 10)}`, [id]);
  // maxHeight forwards into the embedded HtmlSandbox so callers can clamp
  // a runaway widget from blowing out the chat row.
  const _maxH = maxHeight;
  const [showSource, setShowSource] = useState(false);
  // Brief header confirmation — a click inside the iframe otherwise gives
  // no sign the message left the widget.
  const [sentText, setSentText] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const openInNewTab = () => {
    const blob = new Blob([buildSrcdoc(html, widgetId)], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener,noreferrer");
    // Revoke later so the new tab has time to fetch.
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  };

  return (
    <div
      style={{
        margin: "10px 0",
        border: "1px solid var(--cedar-line)",
        borderRadius: 10,
        overflow: "hidden",
        background: "var(--bg)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 10px",
          background: "var(--cedar-dim)",
          borderBottom: "1px solid var(--cedar-line)",
          fontFamily: "var(--fm)",
          fontSize: 11,
          color: "var(--cedar-glow)",
          textTransform: "uppercase",
          letterSpacing: ".08em",
        }}
      >
        <button
          onClick={() => setCollapsed((v) => !v)}
          title={collapsed ? "Expand" : "Collapse"}
          style={{
            background: "transparent",
            border: "none",
            cursor: "pointer",
            color: "var(--cedar-glow)",
            display: "flex",
            alignItems: "center",
            padding: 0,
          }}
        >
          {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
        </button>
        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {title || "widget"}
        </span>
        {sentText && (
          <span
            style={{ color: "var(--cedar-glow)", textTransform: "none", letterSpacing: 0 }}
            title={sentText}
          >
            sent ✓
          </span>
        )}
        <IconBtn title="Reload" onClick={() => setReloadKey((k) => k + 1)}>
          <RefreshCw size={11} />
        </IconBtn>
        <IconBtn title="View source" onClick={() => setShowSource((v) => !v)}>
          <Code size={11} />
        </IconBtn>
        <IconBtn title="Open in new tab" onClick={openInNewTab}>
          <ExternalLink size={11} />
        </IconBtn>
      </div>
      {!collapsed && !showSource && (
        <HtmlSandbox
          html={html}
          id={widgetId}
          maxHeight={_maxH}
          reloadKey={reloadKey}
          title={title}
          onAction={
            onAction
              ? (text) => {
                  setSentText(text);
                  setTimeout(() => setSentText(null), 2000);
                  onAction(text);
                }
              : undefined
          }
        />
      )}
      {!collapsed && showSource && (
        <pre
          style={{
            margin: 0,
            padding: 14,
            background: "var(--bg)",
            color: "var(--text2)",
            fontFamily: "var(--fm)",
            fontSize: 11.5,
            lineHeight: 1.55,
            maxHeight: 400,
            overflow: "auto",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {html}
        </pre>
      )}
    </div>
  );
}

function IconBtn({
  children,
  title,
  onClick,
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      style={{
        background: "transparent",
        border: "1px solid transparent",
        color: "var(--muted)",
        cursor: "pointer",
        padding: "3px 5px",
        borderRadius: 4,
        display: "flex",
        alignItems: "center",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = "var(--border)";
        e.currentTarget.style.color = "var(--cedar-glow)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = "transparent";
        e.currentTarget.style.color = "var(--muted)";
      }}
    >
      {children}
    </button>
  );
}
