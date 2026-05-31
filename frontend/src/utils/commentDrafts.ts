// Persistent inline-comment drafts.
//
// Pending comments survive file panel close, navigation, and page
// refresh. Capped at COMMENT_DRAFT_MAX_FILES files; oldest-by-insertion
// evicted first via the delete-then-reinsert idiom (refreshes JS object
// key order so most-recently-edited file is always at the tail).
//
// Quota-safe: on QuotaExceededError, we drop the LRU file from the
// in-memory blob, retry setItem, and ONLY back-sync the source-of-truth
// after a successful write. A failed write doesn't silently corrupt the
// caller's draft state.

export const COMMENT_DRAFTS_KEY = "arz:comment-drafts";
export const COMMENT_DRAFT_MAX_FILES = 20;
const MAX_EVICTIONS_PER_SAVE = 32;

export interface InlineComment {
  id: string;
  /** Text the user selected — used as a fallback anchor when line/column
   *  can't be resolved (e.g. mid-stream rendering, HTML entities). */
  anchor: string;
  /** User's comment text. */
  text: string;
  /** Source line (1-indexed) — undefined when DOM resolver bailed. */
  line?: number;
  /** Source column (1-indexed). */
  column?: number;
  /** Unix epoch ms when the user added it. Surfaces "added X minutes ago"
   *  in the rail and feeds tie-breaks during LRU eviction. */
  created_at: number;
}

type Drafts = Record<string, InlineComment[]>;

function isInlineComment(v: unknown): v is InlineComment {
  if (!v || typeof v !== "object") return false;
  const c = v as Record<string, unknown>;
  return typeof c.id === "string" && typeof c.anchor === "string" && typeof c.text === "string";
}

function isQuotaError(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  if (e.name === "QuotaExceededError" || e.name === "NS_ERROR_DOM_QUOTA_REACHED") return true;
  return /quota|storage/i.test(e.message || "");
}

export function loadCommentDrafts(): Drafts {
  try {
    const raw = localStorage.getItem(COMMENT_DRAFTS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const clean: Drafts = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (Array.isArray(v) && v.every(isInlineComment)) {
        clean[k] = v as InlineComment[];
      }
    }
    return clean;
  } catch {
    return {};
  }
}

/** Persist drafts. Mutates the in-memory `drafts` object only on
 *  successful setItem so callers can trust that if saveCommentDrafts
 *  returned without throwing, the on-disk state matches their memory. */
export function saveCommentDrafts(drafts: Drafts): "saved" | "failed" {
  let toSave: Drafts = { ...drafts };
  // Enforce file cap up-front (insertion-order LRU).
  const keys = Object.keys(toSave);
  if (keys.length > COMMENT_DRAFT_MAX_FILES) {
    for (const k of keys.slice(0, keys.length - COMMENT_DRAFT_MAX_FILES)) delete toSave[k];
  }

  // First attempt as-is.
  try {
    localStorage.setItem(COMMENT_DRAFTS_KEY, JSON.stringify(toSave));
    // Back-sync the in-memory blob to whatever we actually wrote.
    for (const k of Object.keys(drafts)) {
      if (!(k in toSave)) delete drafts[k];
    }
    return "saved";
  } catch (e) {
    if (!isQuotaError(e)) return "failed";
  }

  // Quota path: drop oldest file at a time, retry, until it fits or
  // we hit the eviction ceiling. We never auto-evict if only one file
  // remains (caller's draft is the offender — let them shrink it).
  let evictions = 0;
  while (evictions < MAX_EVICTIONS_PER_SAVE) {
    const orderedKeys = Object.keys(toSave);
    if (orderedKeys.length <= 1) break;
    delete toSave[orderedKeys[0]];
    evictions += 1;
    try {
      localStorage.setItem(COMMENT_DRAFTS_KEY, JSON.stringify(toSave));
      // Success — back-sync the caller's blob to drop the evicted keys.
      for (const k of Object.keys(drafts)) {
        if (!(k in toSave)) delete drafts[k];
      }
      try {
        console.warn(
          `[arz comment-drafts] storage quota hit — evicted ${evictions} oldest file(s)`,
        );
      } catch {
        /* ignore */
      }
      return "saved";
    } catch (e) {
      if (!isQuotaError(e)) return "failed";
    }
  }

  try {
    console.warn("[arz comment-drafts] storage quota hit — drafts not persisted (in-memory only)");
  } catch {
    /* ignore */
  }
  return "failed";
}

/** Replace the comment list for one file. Delete-then-reinsert refreshes
 *  the JS-object insertion order so this file becomes "most recently
 *  edited" and survives LRU eviction longest. */
export function setCommentsForFile(
  drafts: Drafts,
  filePath: string,
  comments: InlineComment[],
): void {
  delete drafts[filePath];
  if (comments.length > 0) drafts[filePath] = comments;
}
