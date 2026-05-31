// Format pending inline comments as a structured LLM message.
//
// Output looks like:
//   [Document feedback on /path/to/notes.md — 2 comments]
//
//   1. (line 12, col 5, "the quick brown fox" in "…fox jumped over…"): "is this still relevant?"
//   2. (line 30, col 1, "TODO" in "…TODO: rewrite this section…"): "let's flesh this out"
//
// Each comment includes anchor text, line/col, and a 20-char window of
// surrounding source so the LLM can disambiguate repeating anchors and
// confirm what region the user actually meant.

import type { InlineComment } from "./commentDrafts";

const ANCHOR_PREVIEW_MAX = 80;
const SOURCE_WINDOW = 20;

function esc(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function formatCommentsMessage(
  filePath: string,
  comments: InlineComment[],
  content?: string,
): string {
  if (comments.length === 0) return "";
  const srcLines = content?.split("\n");
  const out: string[] = [
    `[Document feedback on ${filePath} — ${comments.length} comment${comments.length > 1 ? "s" : ""}]`,
    "",
  ];

  comments.forEach((c, i) => {
    const anchor =
      c.anchor.length > ANCHOR_PREVIEW_MAX ? c.anchor.slice(0, ANCHOR_PREVIEW_MAX) + "…" : c.anchor;
    const loc =
      c.line != null
        ? c.column != null
          ? `line ${c.line}, col ${c.column}, `
          : `line ${c.line}, `
        : "";

    let ctx = "";
    if (srcLines && c.line != null && c.column != null && c.line >= 1 && c.line <= srcLines.length) {
      const src = srcLines[c.line - 1] || "";
      const start = Math.max(0, c.column - 1 - SOURCE_WINDOW);
      const end = Math.min(src.length, c.column - 1 + c.anchor.length + SOURCE_WINDOW);
      const head = start > 0 ? "…" : "";
      const tail = end < src.length ? "…" : "";
      ctx = ` in "${head}${esc(src.slice(start, end))}${tail}"`;
    }

    out.push(`${i + 1}. (${loc}"${esc(anchor)}"${ctx}): "${esc(c.text)}"`);
  });

  return out.join("\n");
}
