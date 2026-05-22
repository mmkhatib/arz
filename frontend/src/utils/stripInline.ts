// Strip arz inline tags from streamed/displayed assistant text so the
// raw `<recall>...</recall>`, `<learn>...</learn>` etc. don't show in
// the chat bubble. Mirrors the server-side parser in
// src/arz/inline_learn.py (kept in lockstep — when a new tag lands
// there, add it here).

const TAG_RE =
  /<(learn|memory|note|recall|todo|semantic|forget|episodic)(?:\s+[a-z_]+="[^"]*")*\s*>[\s\S]*?<\/\1>/gi;

// Self-closing recall: `<recall query="…" />` or `<recall query="…"/>`.
const SELF_CLOSING_RE = /<recall(?:\s+[a-z_]+="[^"]*")*\s*\/>/gi;

// `goal:done` is a signal token the writer emits at the end of a turn
// when it thinks the goal is satisfied. The evaluator (not the writer)
// is the authority on done-state; the token has no value to the user
// once the goal-marker chip has rendered. Strip it so it doesn't show
// as plain text trailing every goal turn.
const _GOAL_DONE_RE = /(^|\s)goal:done\s*$/gim;

export function stripInlineTags(text: string): string {
  if (!text) return text;
  let out = text;
  if (text.indexOf("<") !== -1) {
    out = out.replace(TAG_RE, "");
    out = out.replace(SELF_CLOSING_RE, "");
  }
  out = out.replace(_GOAL_DONE_RE, "");
  // Collapse runs of 3+ newlines left behind by stripping inline tags.
  out = out.replace(/\n{3,}/g, "\n\n");
  return out.trim();
}

// ── Goal tags — live-stream-only friendly rendering ────────────────────
//
// MessageBubble splits these into chip components from the saved
// message. But during live streaming we render plaintext, and the
// raw `<goal-marker variant="pending" reason="judge running…" />` would
// flash before the message is committed and chips render. Replace them
// with short friendly text inline for the streaming-bubble view.
//
// DO NOT call this from MessageBubble — segmenter needs the tags
// intact.

const _GOAL_ATTR_RE = /([a-zA-Z_][\w-]*)\s*=\s*"([^"]*)"/g;
function _parse(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  let m: RegExpExecArray | null;
  while ((m = _GOAL_ATTR_RE.exec(raw)) !== null) out[m[1].toLowerCase()] = m[2];
  return out;
}

export function renderGoalTagsForLive(text: string): string {
  if (!text || (!text.includes("<goal-marker") && !text.includes("<goal-auto"))) {
    return text;
  }

  // <goal-auto …>body</goal-auto> — strip wrapper, keep body so the
  // user can still see the writer's instruction during stream.
  let out = text.replace(
    /<goal-auto\b([^>]*)>([\s\S]*?)<\/goal-auto\s*>/gi,
    (_full, _attrs, body) => String(body || "").trim(),
  );

  // <goal-marker variant=… …/> — render as a one-liner inline.
  out = out.replace(/<goal-marker\b([^>]*?)\/>/gi, (_full, attrsRaw) => {
    const attrs = _parse(String(attrsRaw));
    const variant = attrs.variant || "evaluator";
    const judge = attrs.judge || "";
    const verdict = attrs.verdict || "";
    const reason = attrs.reason || "";
    let icon = "⟳";
    let label = "evaluator";
    if (variant === "pending") {
      icon = "⏳";
      label = "evaluator · running";
    } else if (variant === "reset") {
      icon = "⚠";
      label = `frustration · hard reset (${attrs.streak || "3"}× same complaint)`;
    } else if (variant === "done") {
      icon = "◎";
      label = "goal · done";
    } else if (variant === "cap") {
      icon = "⨯";
      label = `goal · cap reached ${attrs.iter || ""}/${attrs.cap || ""}`;
    } else if (verdict === "met") {
      icon = "✓";
      label = "evaluator · met";
    } else {
      icon = "⟳";
      label = "evaluator · not met";
    }
    const judgePart = judge ? ` (${judge})` : "";
    const reasonPart = reason ? ` — ${reason}` : "";
    return `\n\n${icon} ${label}${judgePart}${reasonPart}\n\n`;
  });

  out = out.replace(/\n{3,}/g, "\n\n");
  return out.trim();
}
