/** Line-level diffing for chat diff cards.
 *
 * Two inputs feed the same renderer:
 *   - `diffLines(old, new)` — an LCS diff of two texts, used for Edit /
 *     MultiEdit tool calls where we hold `old_string` / `new_string`.
 *   - `parseUnifiedDiff(text)` — a ```diff fence or `git diff` output the
 *     agent pasted into its reply.
 *
 * Both return `DiffLine[]` so `DiffBlock` doesn't care where they came from.
 */

export type DiffKind = "add" | "del" | "ctx" | "hunk" | "meta";

export interface DiffLine {
  kind: DiffKind;
  text: string;
}

export interface DiffStats {
  added: number;
  removed: number;
}

/** Cells in the LCS table above which we stop diffing line-by-line and
 *  emit a whole-block replace. 2k × 2k lines is already far more than a
 *  chat card should hold; the cap keeps a pathological Write from
 *  freezing the tab. */
const MAX_LCS_CELLS = 4_000_000;

function splitLines(s: string): string[] {
  if (!s) return [];
  const lines = s.split("\n");
  // A trailing newline is a terminator, not an empty last line.
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

export function diffLines(oldText: string, newText: string): DiffLine[] {
  const a = splitLines(oldText);
  const b = splitLines(newText);

  // Trim the common prefix / suffix first — edits are usually local, so
  // this shrinks the LCS table to just the changed window.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  const head: DiffLine[] = a.slice(0, start).map((text) => ({ kind: "ctx", text }));
  const tail: DiffLine[] = a.slice(endA).map((text) => ({ kind: "ctx", text }));
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);

  const n = midA.length;
  const m = midB.length;
  if (n * m > MAX_LCS_CELLS) {
    return [
      ...head,
      ...midA.map((text): DiffLine => ({ kind: "del", text })),
      ...midB.map((text): DiffLine => ({ kind: "add", text })),
      ...tail,
    ];
  }

  // lcs[i][j] = LCS length of midA[i:] and midB[j:], flattened.
  const w = m + 1;
  const lcs = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * w + j] =
        midA[i] === midB[j]
          ? lcs[(i + 1) * w + j + 1] + 1
          : Math.max(lcs[(i + 1) * w + j], lcs[i * w + j + 1]);
    }
  }

  const mid: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (midA[i] === midB[j]) {
      mid.push({ kind: "ctx", text: midA[i] });
      i++;
      j++;
    } else if (lcs[(i + 1) * w + j] >= lcs[i * w + j + 1]) {
      mid.push({ kind: "del", text: midA[i++] });
    } else {
      mid.push({ kind: "add", text: midB[j++] });
    }
  }
  while (i < n) mid.push({ kind: "del", text: midA[i++] });
  while (j < m) mid.push({ kind: "add", text: midB[j++] });

  return [...head, ...mid, ...tail];
}

/** Collapse long runs of unchanged lines down to `context` lines either
 *  side of a change, replacing the gap with a `hunk` marker line. */
export function withContext(lines: DiffLine[], context = 3): DiffLine[] {
  const keep = new Array<boolean>(lines.length).fill(false);
  lines.forEach((l, idx) => {
    if (l.kind === "ctx") return;
    for (let k = Math.max(0, idx - context); k <= Math.min(lines.length - 1, idx + context); k++) {
      keep[k] = true;
    }
  });
  const out: DiffLine[] = [];
  let skipped = 0;
  lines.forEach((l, idx) => {
    if (keep[idx]) {
      if (skipped > 0) {
        out.push({ kind: "hunk", text: `⋯ ${skipped} unchanged line${skipped === 1 ? "" : "s"}` });
        skipped = 0;
      }
      out.push(l);
    } else {
      skipped++;
    }
  });
  if (skipped > 0 && out.length > 0) {
    out.push({ kind: "hunk", text: `⋯ ${skipped} unchanged line${skipped === 1 ? "" : "s"}` });
  }
  return out;
}

export function diffStats(lines: DiffLine[]): DiffStats {
  let added = 0;
  let removed = 0;
  for (const l of lines) {
    if (l.kind === "add") added++;
    else if (l.kind === "del") removed++;
  }
  return { added, removed };
}

/** Classify each line of unified-diff text by its leading character. */
export function parseUnifiedDiff(text: string): DiffLine[] {
  return splitLines(text).map((line): DiffLine => {
    if (
      line.startsWith("+++ ") ||
      line.startsWith("--- ") ||
      line.startsWith("diff --git") ||
      line.startsWith("index ") ||
      line.startsWith("new file mode") ||
      line.startsWith("deleted file mode")
    ) {
      return { kind: "meta", text: line };
    }
    if (line.startsWith("@@")) return { kind: "hunk", text: line };
    if (line.startsWith("+")) return { kind: "add", text: line.slice(1) };
    if (line.startsWith("-")) return { kind: "del", text: line.slice(1) };
    return { kind: "ctx", text: line.startsWith(" ") ? line.slice(1) : line };
  });
}

/** Best-effort file path for a unified diff: `+++ b/path`, then
 *  `diff --git a/x b/path`, then `--- a/path`. */
export function unifiedDiffPath(text: string): string | null {
  const plus = text.match(/^\+\+\+ (?:b\/)?(\S+)/m);
  if (plus && plus[1] !== "/dev/null") return plus[1];
  const git = text.match(/^diff --git a\/\S+ b\/(\S+)/m);
  if (git) return git[1];
  const minus = text.match(/^--- (?:a\/)?(\S+)/m);
  if (minus && minus[1] !== "/dev/null") return minus[1];
  return null;
}
