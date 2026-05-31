import { describe, it, expect } from "vitest";
import { formatCommentsMessage } from "@/utils/formatCommentsMessage";
import type { InlineComment } from "@/utils/commentDrafts";

function mk(partial: Partial<InlineComment>): InlineComment {
  return {
    id: "c1",
    anchor: "x",
    text: "y",
    created_at: 0,
    ...partial,
  };
}

describe("formatCommentsMessage", () => {
  it("returns empty string for no comments", () => {
    expect(formatCommentsMessage("/a.md", [])).toBe("");
  });

  it("renders single-comment header without coord when missing", () => {
    const out = formatCommentsMessage("/a.md", [mk({ anchor: "foo", text: "bar" })]);
    expect(out).toContain("[Document feedback on /a.md — 1 comment]");
    expect(out).toContain('1. ("foo"): "bar"');
  });

  it("pluralizes header for multi-comment", () => {
    const out = formatCommentsMessage("/a.md", [mk({}), mk({ id: "c2" })]);
    expect(out).toContain("2 comments]");
  });

  it("includes line/col and 20-char source window when content provided", () => {
    const content = "the quick brown fox jumped over the lazy dog\nnext line";
    const cs = [
      mk({ anchor: "brown fox", text: "is this right?", line: 1, column: 11 }),
    ];
    const out = formatCommentsMessage("/notes.md", cs, content);
    // Anchor + coords present.
    expect(out).toContain('line 1, col 11, "brown fox"');
    // Context window includes 20 chars before/after.
    expect(out).toMatch(/in "[^"]*brown fox[^"]*"/);
  });

  it("truncates anchors longer than 80 chars", () => {
    const longAnchor = "a".repeat(100);
    const out = formatCommentsMessage("/x.md", [mk({ anchor: longAnchor, text: "t" })]);
    expect(out).toContain("a".repeat(80) + "…");
    expect(out).not.toContain("a".repeat(81));
  });

  it("escapes embedded double quotes in anchor and text", () => {
    const out = formatCommentsMessage(
      "/x.md",
      [mk({ anchor: 'has "quote" inside', text: 'said "hi"' })],
    );
    expect(out).toContain('has \\"quote\\" inside');
    expect(out).toContain('said \\"hi\\"');
  });

  it("emits leading ellipsis when window starts mid-line", () => {
    const content = "X".repeat(40) + "TARGET" + "Y".repeat(40);
    const cs = [mk({ anchor: "TARGET", text: "t", line: 1, column: 41 })];
    const out = formatCommentsMessage("/x.md", cs, content);
    expect(out).toContain('in "…');
    expect(out).toContain("TARGET");
    expect(out).toMatch(/Y+…/);
  });

  it("handles line-only coord without column", () => {
    const out = formatCommentsMessage("/x.md", [mk({ anchor: "a", text: "t", line: 5 })]);
    expect(out).toContain("line 5, ");
    expect(out).not.toContain("col ");
  });
});
