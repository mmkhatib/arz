// Shared chat-message segmenter. MessageBubble uses this for saved
// turns; ChatPanel uses it on the live streamBuffer so widgets +
// goal chips render mid-stream instead of as raw XML.

export type GoalAttrs = Record<string, string>;

// Suggested-next-actions extractor. Every assistant reply is asked to
// end with `[OPTIONS: A | B | C]` — the next moves it recommends, best
// first — and that line is lifted out of the prose and rendered as a
// ranked button row instead of being read as literal text.
//
// Three tics the model reliably produces, all of which used to break the
// match and leak the raw marker into the bubble:
//   - markdown wrappers: `` `[OPTIONS: …]` `` / `**[OPTIONS: …]**`
//   - `[OPTION:` singular (it reads the plural as "pick several")
//   - a repeated tic after the closer: `[OPTIONS: A | B](OPTIONS)`
//   - full-width brackets from a CJK keyboard: `】` `］` `〕`
// Goal chips (`<goal-marker …/>`, `<goal-auto>…</goal-auto>`) are appended
// AFTER the options line by the goal loop, so they are peeled off first and
// put back on the cleaned text — otherwise a goal turn never shows its
// suggestions.
//
// Anchored at the end on purpose: with `m`, a bracketed line anywhere in
// the reply matched, and `cleanedText` — which cuts at the match —
// silently dropped everything after it.
const _TRAILING_GOAL_TAGS_RE =
  /(?:\s*(?:<goal-marker\b(?:"[^"]*"|'[^']*'|[^>])*?\/>|<goal-auto\b[^>]*>[\s\S]*?<\/goal-auto\s*>))+\s*$/i;

/** Every closer a marker may end on — ASCII plus the full-width forms. */
const _CLOSERS = "\\]\\u3011\\uFF3D\\u3015";
/** Wrapper run a model may put around the line. 3 is the longest CommonMark
 *  emphasis run; past that it isn't a wrapper. */
const _WRAP = "[`*_]{0,3}";
// Body is TEMPERED — any char that is not an opener/closer/newline, or a `[`
// that does not start another marker. Linear, no backtracking blowup on a
// line full of `[OPTIONS:` prefixes.
const _OPTIONS_BODY = `((?:[^[\\n${_CLOSERS}]|\\[(?!OPTIONS?:))*)`;
const _OPTIONS_RE = new RegExp(
  `(?:^|\\n)[ \\t>]*${_WRAP}\\[OPTIONS?:${_OPTIONS_BODY}[${_CLOSERS}](?:\\([^\\s()]*\\))?${_WRAP}[ \\t]*$`,
  "i",
);

/** Longest a single suggestion may be. Past this it stops reading as a
 *  button and starts wrapping over the whole bubble. */
const _MAX_CHOICE_LEN = 120;

export interface ExtractedOptions {
  cleanedText: string;
  /** Suggested next actions, most-recommended first — the model's order. */
  choices: string[];
}

function _splitChoices(raw: string): string[] {
  // `|` is the documented separator; a model that used commas instead still
  // meant a list, and a label containing a comma is likelier than a label
  // containing a pipe — so commas are the fallback, never the primary.
  const sep = raw.includes("|") ? "|" : ",";
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(sep)) {
    // Models like to decorate a choice with its own markdown; strip it so
    // the button label is the words the user would have typed.
    const choice = part.trim().replace(/^[*_`]+|[*_`]+$/g, "").trim().slice(0, _MAX_CHOICE_LEN);
    const key = choice.toLowerCase();
    if (!choice || seen.has(key)) continue;
    seen.add(key);
    out.push(choice);
    if (out.length === 10) break;
  }
  return out;
}

export function extractOptions(text: string): ExtractedOptions {
  if (!text) return { cleanedText: text, choices: [] };
  const tail = text.match(_TRAILING_GOAL_TAGS_RE)?.[0] ?? "";
  const head = tail ? text.slice(0, text.length - tail.length) : text;
  const m = head.match(_OPTIONS_RE);
  if (!m) return { cleanedText: text, choices: [] };

  const choices = _splitChoices(m[1] || "");
  if (choices.length === 0) return { cleanedText: text, choices: [] };

  const cleanedHead = head.slice(0, m.index ?? 0).trimEnd();
  const cleanedText = tail.trim() ? `${cleanedHead}\n\n${tail.trim()}` : cleanedHead;
  return { cleanedText: cleanedText.trim(), choices };
}

// ── Streaming counterpart ──────────────────────────────────────────────
//
// `extractOptions` anchors on a closer at the end of the line, so it cannot
// see a marker whose `]` has not streamed yet. That left a window the width
// of the marker line where the raw `[OPTIONS: Commit it | Show me the d…`
// typed itself out as prose and then vanished into buttons at turn end.
// This hides the growing tail so the marker is never visible in either form.
//
// Call it ONLY while a message is streaming: on a finished message an
// unterminated marker is real content — prose discussing the syntax, or a
// truncated turn — and has to render as written.

/** Only the tail can hold an unterminated marker; bound the probe so a
 *  newline-free megabyte buffer doesn't get rescanned every frame. */
const _TAIL_SCAN = 2000;
const _HEAD_RE = /\[OPTIONS?:/gi;
const _CLOSER_RE = new RegExp(`[${_CLOSERS}]`, "g");
/** The label list resumes after that closer, so the closer was inside a
 *  label and the marker is still being written. */
const _CONTINUES_RE = /^[ \t]*[|,]/;
// A half-typed head (`[`, `[OPT`, `[OPTIONS`) is ambiguous with prose, so
// casing must be consistent — mixed case is prose, not a marker forming.
const _PARTIAL_UPPER_RE = /^\[(?:O(?:P(?:T(?:I(?:O(?:N(?:S?:?)?)?)?)?)?)?)?$/;
const _PARTIAL_LOWER_RE = /^\[(?:o(?:p(?:t(?:i(?:o(?:n(?:s?:?)?)?)?)?)?)?)?$/;
const _WRAP_CHAR_RE = /[`*_]/;

export function stripPartialOptions(text: string): string {
  if (!text) return text;
  const from = Math.max(0, text.length - _TAIL_SCAN);
  const windowText = text.slice(from);
  if (!windowText.includes("[")) return text;
  const nl = windowText.lastIndexOf("\n");
  const lineStart = from + nl + 1;
  const line = windowText.slice(nl + 1);
  if (!line.includes("[")) return text;

  const cut = (at: number) => text.slice(0, at).trimEnd();

  // 1. A complete head — cut unless its marker already closed and ordinary
  //    prose followed, which is a sentence that merely mentions the syntax.
  let head = -1;
  for (const m of line.matchAll(_HEAD_RE)) head = m.index ?? head;
  if (head >= 0) {
    const body = line.slice(head);
    let closer = -1;
    for (const m of body.matchAll(_CLOSER_RE)) closer = m.index ?? closer;
    const rest = closer < 0 ? "" : body.slice(closer + 1);
    const forming = closer < 0 || rest.trim() === "" || _CONTINUES_RE.test(rest);
    if (!forming) return text;
    // Take any wrapper run glued to the head with it — the completed regex
    // strips it too, so the two paths cut at the same column.
    let at = head;
    while (at > 0 && head - at < 3 && _WRAP_CHAR_RE.test(line[at - 1])) at--;
    return cut(lineStart + at);
  }

  // 2. Mid-head — the tail is still a prefix of `[OPTIONS:`. The `[` must
  //    open the line or follow whitespace, so `arr[0` is never touched.
  const open = line.lastIndexOf("[");
  let run = open;
  while (run > 0 && open - run < 3 && _WRAP_CHAR_RE.test(line[run - 1])) run--;
  const lineLeading = /^[ \t>]*$/.test(line.slice(0, run));
  if (!lineLeading && !/\s/.test(line[run - 1] ?? "")) return text;
  const frag = line.slice(open);
  const partial = _PARTIAL_UPPER_RE.test(frag) || _PARTIAL_LOWER_RE.test(frag);
  return partial ? cut(lineStart + (lineLeading ? run : open)) : text;
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
