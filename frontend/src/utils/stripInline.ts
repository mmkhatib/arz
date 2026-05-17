// Strip arz inline tags from streamed/displayed assistant text so the
// raw `<recall>...</recall>`, `<learn>...</learn>` etc. don't show in
// the chat bubble. Mirrors the server-side parser in
// src/arz/inline_learn.py (kept in lockstep — when a new tag lands
// there, add it here).

const TAG_RE =
  /<(learn|memory|note|recall|todo|semantic|forget|episodic)(?:\s+[a-z_]+="[^"]*")*\s*>[\s\S]*?<\/\1>/gi;

// Self-closing recall: `<recall query="…" />` or `<recall query="…"/>`.
const SELF_CLOSING_RE = /<recall(?:\s+[a-z_]+="[^"]*")*\s*\/>/gi;

export function stripInlineTags(text: string): string {
  if (!text || text.indexOf("<") === -1) return text;
  let out = text.replace(TAG_RE, "");
  out = out.replace(SELF_CLOSING_RE, "");
  // Collapse runs of 3+ newlines left behind by stripping inline tags.
  out = out.replace(/\n{3,}/g, "\n\n");
  return out.trim();
}
