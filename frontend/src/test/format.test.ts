import { describe, expect, it } from "vitest";
import { ageSecs, fmtAge, plainExcerpt, shortModelLabel } from "@/utils/format";
import { serverTimeMs } from "@/utils/serverTime";
const parseServerTime = (t: string | number | null) => (t == null ? NaN : serverTimeMs(t));

describe("parseServerTime", () => {
  it("treats naive server timestamps as UTC", () => {
    expect(parseServerTime("2026-10-13T12:00:00")).toBe(Date.UTC(2026, 9, 13, 12));
    expect(parseServerTime("2026-10-13T12:00:00Z")).toBe(Date.UTC(2026, 9, 13, 12));
    expect(parseServerTime("2026-10-13T14:00:00+02:00")).toBe(Date.UTC(2026, 9, 13, 12));
    expect(parseServerTime(1_700_000_000)).toBe(1_700_000_000_000);
    expect(Number.isNaN(parseServerTime(null))).toBe(true);
  });
  it("never reports a negative age", () => {
    const now = Date.UTC(2026, 9, 13, 12);
    expect(ageSecs("2026-10-13T12:05:00", now)).toBe(0);
    expect(ageSecs("2026-10-13T11:00:00", now)).toBe(3600);
    expect(fmtAge(0)).toBe("just now");
    expect(fmtAge(7200)).toBe("2h");
  });
});

describe("shortModelLabel", () => {
  it("compresses model ids and aliases", () => {
    expect(shortModelLabel("claude-opus-4-8")).toBe("Opus 4.8");
    expect(shortModelLabel("claude-haiku-4-5-20251001")).toBe("Haiku 4.5");
    expect(shortModelLabel("opus")).toBe("Opus");
    expect(shortModelLabel("gpt-5.6-terra")).toBe("gpt-5.6-terra");
    expect(shortModelLabel(undefined)).toBe("");
  });
});

describe("plainExcerpt", () => {
  it("drops widgets, html and markdown", () => {
    const t = 'Here:\n<arzwidget title="x"><!DOCTYPE html><script>onerror()</script></arzwidget> **done** `code`';
    expect(plainExcerpt(t)).toBe("Here: [widget] done code");
    expect(plainExcerpt("a ".repeat(200), 20).length).toBeLessThanOrEqual(20);
  });
});
