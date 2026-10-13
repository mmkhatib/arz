/** Small pure helpers for the chat markdown renderer. */

/** Table rows (header first) → RFC-4180 CSV. */
export function rowsToCsv(rows: string[][]): string {
  const cell = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return rows.map((r) => r.map(cell).join(",")).join("\n");
}

/** Table rows (header first) → GitHub-flavoured markdown table. */
export function rowsToMarkdown(rows: string[][]): string {
  if (rows.length === 0) return "";
  const width = Math.max(...rows.map((r) => r.length));
  const pad = (r: string[]) => Array.from({ length: width }, (_, i) => (r[i] ?? "").replace(/\|/g, "\\|").replace(/\n/g, " "));
  const line = (r: string[]) => `| ${pad(r).join(" | ")} |`;
  const [head, ...body] = rows;
  return [line(head), `| ${Array(width).fill("---").join(" | ")} |`, ...body.map(line)].join("\n");
}

/** While streaming, a fenced block whose closing ``` hasn't arrived
 *  yet. Returns its language and the char offset of its opening line,
 *  or null when every fence is closed. */
export function openFence(text: string): { lang: string; offset: number } | null {
  let open: { lang: string; offset: number } | null = null;
  let offset = 0;
  for (const line of text.split("\n")) {
    const m = line.match(/^\s{0,3}(`{3,}|~{3,})\s*([\w+-]*)/);
    if (m) {
      if (open === null) open = { lang: m[2] || "", offset };
      else if (!m[2]) open = null;
    }
    offset += line.length + 1;
  }
  return open;
}

/** Hold back an unterminated mermaid fence while streaming — rendering
 *  half a diagram throws parse errors on every chunk. Returns the text
 *  to render plus whether a diagram is pending. */
export function holdOpenMermaid(text: string): { text: string; pendingDiagram: boolean } {
  const open = openFence(text);
  if (!open || open.lang !== "mermaid") return { text, pendingDiagram: false };
  return { text: text.slice(0, open.offset), pendingDiagram: true };
}
