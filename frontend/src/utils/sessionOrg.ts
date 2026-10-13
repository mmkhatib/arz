// Sidebar organization helpers — pure so they're unit-testable.
//
// Stale collapse: rows idle longer than a threshold fold into an
// "N older" group so the list stays scannable. Pinned, active,
// streaming, unread and needs-input rows are exempt — they always
// stay visible because they want attention.

import type { SessionSummary } from "@/api/client";

export const DAY_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_STALE_COLLAPSE_MS = 7 * DAY_MS;
export const STALE_COLLAPSE_PRESETS_MS: readonly number[] = [0, DAY_MS, 2 * DAY_MS, 7 * DAY_MS, 14 * DAY_MS];

export interface StaleSplit<T> {
  fresh: T[];
  stale: T[];
}

export function splitStale<T>(
  list: readonly T[],
  thresholdMs: number,
  now: number,
  lastActivityMsOf: (item: T) => number,
  isExempt: (item: T) => boolean,
): StaleSplit<T> {
  if (thresholdMs <= 0) return { fresh: [...list], stale: [] };
  const fresh: T[] = [];
  const stale: T[] = [];
  for (const item of list) {
    const ts = lastActivityMsOf(item);
    if (ts > 0 && now - ts > thresholdMs && !isExempt(item)) stale.push(item);
    else fresh.push(item);
  }
  return { fresh, stale };
}

export function staleLabel(ms: number): string {
  if (ms <= 0) return "Never";
  const days = Math.round(ms / DAY_MS);
  return days === 1 ? "1 day" : `${days} days`;
}

export type SessionFilter = "all" | "unread" | "running" | "pinned" | "attention";

export const SESSION_FILTERS: readonly { id: SessionFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "unread", label: "Unread" },
  { id: "running", label: "Running" },
  { id: "attention", label: "Needs you" },
  { id: "pinned", label: "Pinned" },
];

/** Unread as the sidebar shows it: the session you're looking at is never unread. */
export function isUnread(s: SessionSummary, activeId: string | null): boolean {
  return !!s.unread && s.id !== activeId;
}

export function matchesFilter(
  s: SessionSummary,
  filter: SessionFilter,
  activeId: string | null,
  pinnedIds: Set<string>,
): boolean {
  switch (filter) {
    case "all": return true;
    case "unread": return isUnread(s, activeId);
    case "running": return !!s.streaming;
    case "attention": return !!s.needs_input;
    case "pinned": return pinnedIds.has(s.id);
  }
}

/** Status filters drain back to "all" once nothing matches — otherwise the
 * user reads their last unread session and is left staring at an empty list. */
export function shouldDrainFilter(filter: SessionFilter, matchCount: number): boolean {
  return filter !== "all" && filter !== "pinned" && matchCount === 0;
}
