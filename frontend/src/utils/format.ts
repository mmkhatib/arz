// Small display formatters shared by the overview-style pages
// (Operations board, Overview, Schedule, Projects).

import { stripInlineTags } from "./stripInline";
import { parseServerTime } from "./serverTime";

export { parseServerTime, serverTimeMs } from "./serverTime";

/** Seconds since a server timestamp, never negative. */
export function ageSecs(ts: string | number | null | undefined, now = Date.now()): number {
  const t = parseServerTime(ts).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.round((now - t) / 1000));
}

/** Compact age: 45s · 12m · 3h · 22d. */
export function fmtAge(secs: number): string {
  if (!secs || secs < 0) return "just now";
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.round(secs / 60)}m`;
  if (secs < 86400) return `${Math.round(secs / 3600)}h`;
  return `${Math.round(secs / 86400)}d`;
}

/** "claude-opus-4-8" → "Opus 4.8", "claude-haiku-4-5-20251001" → "Haiku 4.5",
 *  CLI aliases ("opus", "flash-lite") capitalised, anything else kept. */
export function shortModelLabel(model: string | null | undefined): string {
  if (!model) return "";
  const m = model.match(/^claude-(opus|sonnet|haiku|fable)-(\d+)(?:[-.](\d{1,2}))?(?:-\d{8})?$/i);
  if (m) return `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] ? `.${m[3]}` : ""}`;
  if (/^[a-z][a-z-]*$/.test(model)) return model[0].toUpperCase() + model.slice(1);
  return model;
}

/** Plain-text one-liner from assistant markdown: drops inline arz tags,
 *  widgets/HTML, code fences and markdown punctuation so card previews
 *  don't show `<arzwidget …><!DOCTYPE html>`. */
export function plainExcerpt(text: string | null | undefined, max = 160): string {
  if (!text) return "";
  let s = stripInlineTags(text);
  s = s.replace(/<arzwidget[\s\S]*?(<\/arzwidget>|$)/gi, " [widget] ");
  s = s.replace(/```[\s\S]*?(```|$)/g, " ");
  s = s.replace(/<[^>]+>/g, " ");
  s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, "");
  s = s.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  s = s.replace(/[*_`#>]+/g, "");
  s = s.replace(/\s+/g, " ").trim();
  return s.length > max ? s.slice(0, max - 1).trimEnd() + "…" : s;
}
