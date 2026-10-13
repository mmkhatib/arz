import { describe, expect, it } from "vitest";
import type { SessionSummary } from "@/api/client";
import { parseRecovery } from "@/utils/recovery";
import { DAY_MS, isUnread, matchesFilter, shouldDrainFilter, splitStale } from "@/utils/sessionOrg";

const now = 100 * DAY_MS;

function sess(id: string, extra: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id,
    title: id,
    surface: "dashboard",
    message_count: 1,
    created_at: "",
    updated_at: "",
    active: true,
    ...extra,
  };
}

describe("splitStale", () => {
  const items = [
    { id: "new", ts: now - DAY_MS },
    { id: "old", ts: now - 10 * DAY_MS },
    { id: "oldPinned", ts: now - 10 * DAY_MS },
    { id: "noTs", ts: 0 },
  ];
  it("folds idle rows past the threshold, keeping exempt ones fresh", () => {
    const { fresh, stale } = splitStale(items, 7 * DAY_MS, now, (i) => i.ts, (i) => i.id === "oldPinned");
    expect(fresh.map((i) => i.id)).toEqual(["new", "oldPinned", "noTs"]);
    expect(stale.map((i) => i.id)).toEqual(["old"]);
  });
  it("threshold 0 disables collapse", () => {
    expect(splitStale(items, 0, now, (i) => i.ts, () => false).stale).toEqual([]);
  });
});

describe("filters", () => {
  const pinned = new Set(["p"]);
  it("active session is never unread", () => {
    expect(isUnread(sess("a", { unread: true }), "a")).toBe(false);
    expect(isUnread(sess("a", { unread: true }), "b")).toBe(true);
  });
  it("matches each filter", () => {
    expect(matchesFilter(sess("x", { streaming: true }), "running", null, pinned)).toBe(true);
    expect(matchesFilter(sess("x", { needs_input: true }), "attention", null, pinned)).toBe(true);
    expect(matchesFilter(sess("p"), "pinned", null, pinned)).toBe(true);
    expect(matchesFilter(sess("x"), "unread", null, pinned)).toBe(false);
    expect(matchesFilter(sess("x"), "all", null, pinned)).toBe(true);
  });
  it("drains status filters when empty", () => {
    expect(shouldDrainFilter("unread", 0)).toBe(true);
    expect(shouldDrainFilter("unread", 2)).toBe(false);
    expect(shouldDrainFilter("all", 0)).toBe(false);
    expect(shouldDrainFilter("pinned", 0)).toBe(false);
  });
});

describe("parseRecovery", () => {
  it("parses server recovery messages", () => {
    const n = parseRecovery("[Unfinished action — automatic recovery]\nCarry it out now.");
    expect(n).toEqual({ label: "Unfinished action", body: "Carry it out now." });
  });
  it("ignores normal user text", () => {
    expect(parseRecovery("[note] hello")).toBeNull();
    expect(parseRecovery("fix the bug")).toBeNull();
  });
});
