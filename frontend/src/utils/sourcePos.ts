// DOM-to-source coordinate resolver for rendered markdown.
//
// The trick: react-markdown's HAST nodes carry a `position` object with
// {start: {line, col}, end: {line, col}} pointing back into the source.
// A custom rehype plugin (rehypeSourcepos, see CedarMarkdown) copies
// that onto a `data-sourcepos="L:C-L:C"` HTML attribute on each rendered
// element. This util consumes those attributes to map a user-selected
// DOM Range back to source coordinates so an inline comment can carry
// a real line/column anchor the LLM can use.
//
// Char-by-char alignment of rendered text to source span:
//   anything in the source span that's not in the rendered text is
//   markdown syntax (`**`, backticks, `#`, list markers, `>`, etc.) and
//   gets skipped. Returns undefined on HTML-entity-rendered chars
//   (`&amp;` -> `&`) so the caller can fall back to substring search.

export interface SourceCoord {
  line: number;
  column: number;
}

/** Walk up the DOM from a selection start until we hit the nearest
 *  ancestor with `data-sourcepos`, then align rendered text to source
 *  text to find the precise (line, column) the user clicked into. */
export function resolveSourcePos(
  range: Range,
  root: HTMLElement,
  content: string,
): SourceCoord | undefined {
  let el: HTMLElement | null =
    range.startContainer.nodeType === Node.ELEMENT_NODE
      ? (range.startContainer as HTMLElement)
      : range.startContainer.parentElement;
  while (el && el !== root && !el.hasAttribute("data-sourcepos")) {
    el = el.parentElement;
  }
  if (!el || !el.hasAttribute("data-sourcepos")) return undefined;

  const m = /^(\d+):(\d+)-(\d+):(\d+)$/.exec(el.getAttribute("data-sourcepos") || "");
  if (!m) return undefined;

  // Block-relative offset support: streaming markdown splits content
  // into per-code-fence chunks; wrapper carries `data-block-start` so
  // we can re-base-line back to whole-file numbering.
  let blockEl: HTMLElement | null = el;
  while (blockEl && blockEl !== root && !blockEl.hasAttribute("data-block-start")) {
    blockEl = blockEl.parentElement;
  }
  const blockStart = blockEl?.hasAttribute("data-block-start")
    ? parseInt(blockEl.getAttribute("data-block-start") || "1", 10)
    : 1;
  const lineOffset = blockStart - 1;

  const sLine = parseInt(m[1], 10) + lineOffset;
  const sCol = parseInt(m[2], 10);
  const eLine = parseInt(m[3], 10) + lineOffset;
  const eCol = parseInt(m[4], 10);

  // Rendered-text offset from element start to selection start. Use a
  // Range that spans [el start, selection start] and read its
  // .toString().length — more reliable than walking descendant text
  // nodes (happy-dom's TreeWalker, for instance, skips nested text
  // under inline elements like <strong>).
  let offset = 0;
  try {
    const r = el.ownerDocument!.createRange();
    r.setStart(el, 0);
    r.setEnd(range.startContainer, range.startOffset);
    offset = r.toString().length;
  } catch {
    // Range API failure (cross-document or detached node) — keep
    // offset at 0 and let the caller align to the span start.
  }

  // Extract the source span this element covers.
  const lines = content.split("\n");
  if (sLine < 1 || sLine > lines.length) return undefined;
  let span: string;
  if (sLine === eLine) {
    span = (lines[sLine - 1] || "").slice(sCol - 1, eCol - 1);
  } else {
    const parts: string[] = [(lines[sLine - 1] || "").slice(sCol - 1)];
    for (let i = sLine; i < eLine - 1; i++) parts.push(lines[i] || "");
    parts.push((lines[eLine - 1] || "").slice(0, eCol - 1));
    span = parts.join("\n");
  }

  const rendered = el.textContent || "";
  if (offset >= rendered.length) return { line: sLine, column: sCol };

  // Char-by-char align: walk both cursors; advance rendered cursor only
  // on match; skip span-only chars (markdown syntax).
  let spanIdx = 0;
  let renderedIdx = 0;
  while (spanIdx < span.length && renderedIdx < offset) {
    if (span[spanIdx] === rendered[renderedIdx]) renderedIdx++;
    spanIdx++;
  }
  while (spanIdx < span.length && span[spanIdx] !== rendered[offset]) {
    spanIdx++;
  }
  if (spanIdx >= span.length) return undefined;

  let ln = sLine;
  let cl = sCol;
  for (let i = 0; i < spanIdx; i++) {
    if (span[i] === "\n") {
      ln++;
      cl = 1;
    } else {
      cl++;
    }
  }
  return { line: ln, column: cl };
}

/** Source-text substring fallback. Used for code files (rendered ===
 *  source) and as a last-chance fallback when resolveSourcePos returns
 *  undefined (HTML entities, raw HTML, mid-stream nodes without
 *  data-sourcepos yet). */
export function findCoords(content: string, selected: string): SourceCoord | undefined {
  if (!selected) return undefined;
  const idx = content.indexOf(selected);
  if (idx < 0) return undefined;
  const before = content.slice(0, idx);
  const nl = before.lastIndexOf("\n");
  const line = (before.match(/\n/g)?.length ?? 0) + 1;
  const column = (nl < 0 ? idx : idx - nl - 1) + 1;
  return { line, column };
}
