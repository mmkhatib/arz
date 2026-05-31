import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import {
  loadCommentDrafts,
  saveCommentDrafts,
  setCommentsForFile,
  COMMENT_DRAFTS_KEY,
  COMMENT_DRAFT_MAX_FILES,
  type InlineComment,
} from "@/utils/commentDrafts";

// happy-dom (in vitest 2.1) leaves `localStorage` as a bare object
// with no Storage methods, so we install a tiny Map-backed shim that
// honours the same interface. Tests can swap in a quota-throwing
// stub by replacing `localStorage.setItem` directly.
beforeAll(() => {
  const store = new Map<string, string>();
  const shim: Storage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    removeItem: (k: string) => {
      store.delete(k);
    },
    setItem: (k: string, v: string) => {
      store.set(k, v);
    },
  };
  Object.defineProperty(globalThis, "localStorage", {
    value: shim,
    writable: true,
    configurable: true,
  });
});

function mkComment(text: string, anchor = "sel"): InlineComment {
  return {
    id: `c_${Math.random()}`,
    anchor,
    text,
    created_at: Date.now(),
  };
}

describe("loadCommentDrafts", () => {
  beforeEach(() => {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k) localStorage.removeItem(k);
    }
  });

  it("returns {} when storage empty", () => {
    expect(loadCommentDrafts()).toEqual({});
  });

  it("returns {} on corrupt JSON", () => {
    localStorage.setItem(COMMENT_DRAFTS_KEY, "{not json");
    expect(loadCommentDrafts()).toEqual({});
  });

  it("returns {} when payload is an array", () => {
    localStorage.setItem(COMMENT_DRAFTS_KEY, JSON.stringify([]));
    expect(loadCommentDrafts()).toEqual({});
  });

  it("filters out files whose entries fail shape validation", () => {
    localStorage.setItem(
      COMMENT_DRAFTS_KEY,
      JSON.stringify({
        "/good": [{ id: "1", anchor: "a", text: "t" }],
        "/bad": [{ id: 1, anchor: "a", text: "t" }], // id wrong type
      }),
    );
    const out = loadCommentDrafts();
    expect(Object.keys(out)).toEqual(["/good"]);
  });
});

describe("saveCommentDrafts", () => {
  beforeEach(() => {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k) localStorage.removeItem(k);
    }
  });

  it("round-trips simple drafts", () => {
    const drafts = { "/a.md": [mkComment("hi")] };
    expect(saveCommentDrafts(drafts)).toBe("saved");
    const reloaded = loadCommentDrafts();
    expect(reloaded["/a.md"][0].text).toBe("hi");
  });

  it("evicts oldest insertion when file cap is exceeded", () => {
    const drafts: Record<string, InlineComment[]> = {};
    // Insert MAX + 3 in order; first 3 should be evicted.
    for (let i = 0; i < COMMENT_DRAFT_MAX_FILES + 3; i++) {
      drafts[`/f${i}.md`] = [mkComment(`c${i}`)];
    }
    const result = saveCommentDrafts(drafts);
    expect(result).toBe("saved");
    const raw = localStorage.getItem("arz:comment-drafts");
    expect(raw, "raw localStorage payload after save").not.toBeNull();
    const reloaded = loadCommentDrafts();
    expect(Object.keys(reloaded).length).toBe(COMMENT_DRAFT_MAX_FILES);
    expect(reloaded["/f0.md"]).toBeUndefined();
    expect(reloaded["/f2.md"]).toBeUndefined();
    expect(reloaded[`/f${COMMENT_DRAFT_MAX_FILES + 2}.md`]).toBeDefined();
  });

  it("back-syncs caller blob after eviction (drops evicted keys in place)", () => {
    const drafts: Record<string, InlineComment[]> = {};
    for (let i = 0; i < COMMENT_DRAFT_MAX_FILES + 2; i++) {
      drafts[`/f${i}.md`] = [mkComment(`c${i}`)];
    }
    saveCommentDrafts(drafts);
    expect(drafts["/f0.md"]).toBeUndefined();
    expect(drafts["/f1.md"]).toBeUndefined();
    expect(Object.keys(drafts).length).toBe(COMMENT_DRAFT_MAX_FILES);
  });

  it("evicts oldest until setItem succeeds when quota throws", () => {
    // Stub localStorage.setItem to throw QuotaExceededError until <=3
    // keys remain in the payload. Verify saveCommentDrafts back-syncs
    // ONLY after the successful write.
    const drafts: Record<string, InlineComment[]> = {};
    for (let i = 0; i < 6; i++) drafts[`/f${i}.md`] = [mkComment(`c${i}`)];

    const orig = localStorage.setItem.bind(localStorage);
    let allow = false;
    let calls = 0;
    localStorage.setItem = (k: string, v: string) => {
      calls += 1;
      if (!allow) {
        // Count file entries in payload; allow once <= 3.
        const parsed = JSON.parse(v);
        if (Object.keys(parsed).length <= 3) allow = true;
        else {
          const err = new Error("quota");
          err.name = "QuotaExceededError";
          throw err;
        }
      }
      return orig(k, v);
    };

    try {
      const result = saveCommentDrafts(drafts);
      expect(result).toBe("saved");
      expect(calls).toBeGreaterThan(1);
      // Caller blob was back-synced to match what got persisted.
      expect(Object.keys(drafts).length).toBe(3);
      // Oldest were evicted, newest preserved.
      expect(drafts["/f0.md"]).toBeUndefined();
      expect(drafts["/f5.md"]).toBeDefined();
    } finally {
      localStorage.setItem = orig;
    }
  });
});

describe("setCommentsForFile", () => {
  it("delete-then-reinsert refreshes insertion-order", () => {
    const drafts: Record<string, InlineComment[]> = {};
    drafts["/a"] = [mkComment("a1")];
    drafts["/b"] = [mkComment("b1")];
    drafts["/c"] = [mkComment("c1")];
    // Update /a — should now be last in insertion order.
    setCommentsForFile(drafts, "/a", [mkComment("a2")]);
    expect(Object.keys(drafts)).toEqual(["/b", "/c", "/a"]);
  });

  it("removes the key entirely when comments is empty", () => {
    const drafts: Record<string, InlineComment[]> = { "/a": [mkComment("x")] };
    setCommentsForFile(drafts, "/a", []);
    expect(drafts["/a"]).toBeUndefined();
  });
});
