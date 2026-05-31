// Quota-safe localStorage wrapper for chat drafts.
//
// Before: setItem inside a bare try/catch — a QuotaExceededError would
// silently drop the persist, the in-memory draft would survive until
// the next page load, then vanish. Users who keep dozens of long
// half-typed sessions ran into this regularly.
//
// Now: on quota failure we evict the oldest drafts (by lastTouched
// sidecar) and retry. The lastTouched sidecar is only updated AFTER a
// successful setItem so a failed save can't poison the LRU order with
// fake-recent timestamps.
//
// API mirrors the bare three calls: saveDraft / loadDraft / clearDraft.

const PREFIX = "arz:draft:";
const TOUCH_KEY = "arz:draft:_touched"; // sidecar: { [sessionId]: epoch_ms }
const MAX_EVICTIONS_PER_SAVE = 32;

type TouchMap = Record<string, number>;

function readTouched(): TouchMap {
  try {
    const raw = localStorage.getItem(TOUCH_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed as TouchMap;
  } catch {
    // corrupt JSON — drop the sidecar
  }
  return {};
}

function writeTouched(t: TouchMap): void {
  try {
    localStorage.setItem(TOUCH_KEY, JSON.stringify(t));
  } catch {
    // best-effort; sidecar tracking is a hint, not a hard requirement
  }
}

function isQuotaError(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  // Spec name, Firefox legacy code, Chrome / Safari variants.
  if (e.name === "QuotaExceededError") return true;
  if (e.name === "NS_ERROR_DOM_QUOTA_REACHED") return true;
  const msg = e.message || "";
  return /quota|storage/i.test(msg);
}

function listDraftKeys(): string[] {
  const out: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(PREFIX) && k !== TOUCH_KEY) out.push(k);
  }
  return out;
}

/* Save a draft. On quota failure, evicts oldest drafts (excluding the
 * one we're trying to save) and retries. Returns the final outcome so
 * callers can warn the user if even after eviction nothing fit. */
export function saveDraft(sessionId: string, value: string): "saved" | "cleared" | "failed" {
  if (!sessionId) return "failed";
  const key = PREFIX + sessionId;

  // Empty value = explicit clear.
  if (!value) {
    try {
      localStorage.removeItem(key);
    } catch {
      // can't remove? nothing to do
    }
    const t = readTouched();
    delete t[sessionId];
    writeTouched(t);
    return "cleared";
  }

  // Try direct write first.
  try {
    localStorage.setItem(key, value);
    const t = readTouched();
    t[sessionId] = Date.now();
    writeTouched(t);
    return "saved";
  } catch (e) {
    if (!isQuotaError(e)) return "failed";
  }

  // Quota path — evict oldest drafts (NEVER the current one) and retry.
  const t = readTouched();
  const draftKeys = listDraftKeys().filter((k) => k !== key);
  const ordered = draftKeys
    .map((k) => {
      const sid = k.slice(PREFIX.length);
      return { key: k, sid, touched: t[sid] ?? 0 };
    })
    .sort((a, b) => a.touched - b.touched);

  let evictions = 0;
  for (const entry of ordered) {
    if (evictions >= MAX_EVICTIONS_PER_SAVE) break;
    try {
      localStorage.removeItem(entry.key);
    } catch {
      continue;
    }
    evictions += 1;
    try {
      localStorage.setItem(key, value);
      // Success — NOW back-sync the sidecar: drop evicted entries +
      // touch this one. Doing this only after the retry succeeds
      // prevents the in-memory draft from being silently dropped if
      // every retry still failed.
      const nextTouched = readTouched();
      for (let i = 0; i <= ordered.indexOf(entry); i++) {
        delete nextTouched[ordered[i].sid];
      }
      nextTouched[sessionId] = Date.now();
      writeTouched(nextTouched);
      // Soft signal to anyone watching dev tools.
      try {
        console.warn(
          `[arz draft] storage quota hit — evicted ${evictions} older draft(s) to save current`,
        );
      } catch {
        /* ignore */
      }
      return "saved";
    } catch (e) {
      if (!isQuotaError(e)) return "failed";
      // still tight — keep evicting
    }
  }

  // Even after MAX_EVICTIONS the value won't fit. Don't touch sidecar
  // (so other entries keep their LRU order). Caller's in-memory state
  // stays authoritative until they retry or shrink the draft.
  try {
    console.warn("[arz draft] storage quota hit — draft not persisted (in-memory only)");
  } catch {
    /* ignore */
  }
  return "failed";
}

export function loadDraft(sessionId: string): string {
  if (!sessionId) return "";
  try {
    return localStorage.getItem(PREFIX + sessionId) ?? "";
  } catch {
    return "";
  }
}

export function clearDraft(sessionId: string): void {
  saveDraft(sessionId, "");
}
