import { describe, expect, it } from "vitest";
import { normalizeWidgetHtml } from "@/components/Widget";
import { parseServerTime, serverTimeMs } from "@/utils/serverTime";

describe("normalizeWidgetHtml", () => {
  it("keeps head styles when flattening a full document", () => {
    const out = normalizeWidgetHtml(
      "<!DOCTYPE html><html><head><title>x</title><style>.a{color:red}</style></head><body><b class=a>hi</b></body></html>",
    );
    expect(out).toContain("<style>.a{color:red}</style>");
    expect(out).toContain("<b class=a>hi</b>");
    expect(out).not.toContain("<title>");
  });
  it("passes fragments through", () => {
    expect(normalizeWidgetHtml("<div>x</div>")).toBe("<div>x</div>");
  });
});

describe("parseServerTime", () => {
  it("reads offset-less server timestamps as UTC", () => {
    expect(parseServerTime("2026-10-14T01:45:13.687070").toISOString()).toBe("2026-10-14T01:45:13.687Z");
    expect(parseServerTime("2026-10-14T01:45:00+02:00").toISOString()).toBe("2026-10-13T23:45:00.000Z");
    expect(serverTimeMs("")).toBe(0);
  });
});
