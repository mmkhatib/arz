/** Path references in chat prose: `src/app.py`, `/abs/file.ts:42`,
 *  `lib/x.rs:10-20`. Shared by the remark plugin (bare paths in text)
 *  and the inline-code renderer (backticked paths). */

export interface PathRef {
  path: string;
  line?: number;
  endLine?: number;
}

/** Split a trailing `:12` / `:12-20` / `#L12` line reference off a path. */
export function splitLineRef(raw: string): PathRef {
  const m = raw.match(/^(.*?)(?::(\d+)(?:[-:](\d+))?|#L(\d+)(?:-L?(\d+))?)$/);
  if (!m || !m[1]) return { path: raw };
  const line = Number(m[2] ?? m[4]);
  const end = m[3] ?? m[5];
  return { path: m[1], line, endLine: end ? Number(end) : undefined };
}

/** Is a backticked token plausibly a file path? Must contain a slash or
 *  look like `name.ext`, carry no whitespace, and not be a URL. */
export function isPathCandidate(text: string): boolean {
  const t = text.trim();
  if (t.length < 3 || t.length > 300) return false;
  if (/\s/.test(t)) return false;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) return false;
  const { path } = splitLineRef(t);
  // Needs an extension on the last segment — `src/` or `a/b` alone are
  // too often prose (and/or, I/O) to link.
  const last = path.split(/[\\/]/).pop() || "";
  if (!/^[\w.\-~@]+\.[A-Za-z0-9]{1,8}$/.test(last)) return false;
  // Version numbers and decimals: 1.2.3, v0.8, 3.14
  if (/^v?\d+(\.\d+)+$/.test(path)) return false;
  return true;
}

export function formatPathRef(ref: PathRef): string {
  if (ref.line == null) return ref.path;
  return ref.endLine != null ? `${ref.path}:${ref.line}-${ref.endLine}` : `${ref.path}:${ref.line}`;
}
