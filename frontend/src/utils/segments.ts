// Shared chat-message segmenter. MessageBubble uses this for saved
// turns; ChatPanel uses it on the live streamBuffer so widgets +
// goal chips render mid-stream instead of as raw XML.

export type GoalAttrs = Record<string, string>;

// Stay-on-task #13-14 — OPTIONS extractor. When the assistant ends a
// reply with `[OPTIONS: A | B | C]`, surface a checkbox+Send block
// instead of leaving the bracketed text inline. Up to 10 choices.
const _OPTIONS_RE = /\[OPTIONS:\s*([^\]]+?)\]\s*$/im;

export interface ExtractedOptions {
  cleanedText: string;
  choices: string[];
}

export function extractOptions(text: string): ExtractedOptions {
  const m = text.match(_OPTIONS_RE);
  if (!m) return { cleanedText: text, choices: [] };
  const raw = m[1] || "";
  const choices = raw
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 10);
  return { cleanedText: text.slice(0, m.index ?? 0).trimEnd(), choices };
}

export type MsgSegment =
  | { kind: "text"; value: string }
  | { kind: "widget"; title: string; html: string }
  | { kind: "goal-marker"; attrs: GoalAttrs }
  | { kind: "goal-auto"; attrs: GoalAttrs; body: string };

const _WIDGET_OPEN = /<(arzwidget|mcwidget)(\s+[^>]*)?>/i;
// Match `<goal-marker ... />` allowing quoted attribute values to
// contain `>` chars. Without this, a `reason="…<arzwidget>"` mention
// inside the chip breaks the regex on the first nested `>` and the
// chip falls through to plaintext render.
const _GOAL_MARKER_RE = /<goal-marker\b((?:"[^"]*"|'[^']*'|[^>])*?)\/>/gi;
const _GOAL_AUTO_RE = /<goal-auto\b([^>]*)>([\s\S]*?)<\/goal-auto>/gi;
const _ATTR_RE = /([a-zA-Z_][\w-]*)\s*=\s*"([^"]*)"/g;

export function parseAttrs(raw: string): GoalAttrs {
  const out: GoalAttrs = {};
  _ATTR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = _ATTR_RE.exec(raw)) !== null) out[m[1].toLowerCase()] = m[2];
  return out;
}

// Split on goal-auto (wrapping) + goal-marker (self-closing) tags.
// Called AFTER splitWidgets so widget bodies are never re-scanned.
export function splitGoalTags(text: string): MsgSegment[] {
  if (!text || (!text.includes("<goal-marker") && !text.includes("<goal-auto"))) {
    return [{ kind: "text", value: text }];
  }
  const placeholders: MsgSegment[] = [];
  let working = text;

  working = working.replace(_GOAL_AUTO_RE, (_full, attrsRaw, body) => {
    const idx = placeholders.length;
    placeholders.push({
      kind: "goal-auto",
      attrs: parseAttrs(String(attrsRaw)),
      body: String(body || "").trim(),
    });
    return `\x00GA${idx}\x00`;
  });

  working = working.replace(_GOAL_MARKER_RE, (_full, attrsRaw) => {
    const idx = placeholders.length;
    placeholders.push({
      kind: "goal-marker",
      attrs: parseAttrs(String(attrsRaw)),
    });
    return `\x00GM${idx}\x00`;
  });

  const out: MsgSegment[] = [];
  const re = /\x00(GA|GM)(\d+)\x00/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(working)) !== null) {
    if (m.index > last) {
      const slice = working.slice(last, m.index);
      if (slice.trim().length > 0) out.push({ kind: "text", value: slice });
    }
    out.push(placeholders[parseInt(m[2], 10)]);
    last = m.index + m[0].length;
  }
  if (last < working.length) {
    const tail = working.slice(last);
    if (tail.trim().length > 0) out.push({ kind: "text", value: tail });
  }
  return out;
}

// Split a message into text + widget chunks. Widget bodies bypass
// markdown / sanitisation entirely and render via the <Widget> iframe.
export function splitWidgets(text: string): MsgSegment[] {
  if (!text || (!text.includes("<arzwidget") && !text.includes("<mcwidget"))) {
    return [{ kind: "text", value: text }];
  }
  const out: MsgSegment[] = [];
  let rest = text;
  while (rest.length > 0) {
    const open = rest.match(_WIDGET_OPEN);
    if (!open || open.index === undefined) {
      out.push({ kind: "text", value: rest });
      break;
    }
    if (open.index > 0) {
      out.push({ kind: "text", value: rest.slice(0, open.index) });
    }
    const tag = open[1];
    const attrs = open[2] || "";
    const tagEnd = open.index + open[0].length;
    const closeRe = new RegExp(`</${tag}\\s*>`, "i");
    const closeMatch = rest.slice(tagEnd).match(closeRe);
    if (!closeMatch || closeMatch.index === undefined) {
      // Open tag without a close — likely mid-stream. Stash the rest
      // as a "pending widget" placeholder so the live view still
      // shows something useful instead of dumping raw HTML.
      const titleMatch =
        attrs.match(/title\s*=\s*"([^"]*)"/i) || attrs.match(/title\s*=\s*'([^']*)'/i);
      out.push({
        kind: "widget",
        title: (titleMatch?.[1] || "Widget").slice(0, 120),
        html: "", // empty body — Widget renders the title-only placeholder
      });
      break;
    }
    const body = rest.slice(tagEnd, tagEnd + closeMatch.index);
    const titleMatch =
      attrs.match(/title\s*=\s*"([^"]*)"/i) || attrs.match(/title\s*=\s*'([^']*)'/i);
    out.push({
      kind: "widget",
      title: (titleMatch?.[1] || "Widget").slice(0, 120),
      html: body.trim(),
    });
    rest = rest.slice(tagEnd + closeMatch.index + closeMatch[0].length);
  }
  return out;
}

// Run both passes in the order MessageBubble uses: widgets first
// (preserves their raw HTML body), then goal tags on the resulting
// text segments.
export function segmentMessage(text: string): MsgSegment[] {
  const widgetSplit = splitWidgets(text);
  const out: MsgSegment[] = [];
  for (const seg of widgetSplit) {
    if (seg.kind === "text") out.push(...splitGoalTags(seg.value));
    else out.push(seg);
  }
  return out;
}
