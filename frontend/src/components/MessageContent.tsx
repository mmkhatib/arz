// MessageContent — render assistant text with inline widget tags.
//
// Splits on `<arzwidget …>…</arzwidget>` (and the legacy `<mcwidget>`
// MeshClaw alias for portability). Anything outside a widget block renders
// through CedarMarkdown; widget bodies render as sandboxed iframes via
// the Widget component.
//
// Why split at the chat-render layer instead of inside the markdown
// pipeline: the widget body is intentionally raw HTML and we do NOT want
// markdown / sanitisation to mangle Chart.js scripts or Tailwind class
// strings. The split is plain string scanning — no regex catastrophic
// backtracking risk.

import { useMemo } from "react";
import { CedarMarkdown } from "./CedarMarkdown";
import Widget from "./Widget";

type Segment =
  | { kind: "text"; value: string }
  | { kind: "widget"; title: string; html: string };

const TAG_OPEN_RE = /<(arzwidget|mcwidget)(\s+[^>]*)?>/i;

function parseSegments(text: string): Segment[] {
  if (!text || (!text.includes("<arzwidget") && !text.includes("<mcwidget"))) {
    return [{ kind: "text", value: text }];
  }
  const out: Segment[] = [];
  let rest = text;
  while (rest.length > 0) {
    const open = rest.match(TAG_OPEN_RE);
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
      // Unterminated widget — treat the rest as text so we don't drop content.
      out.push({ kind: "text", value: rest });
      break;
    }
    const body = rest.slice(tagEnd, tagEnd + closeMatch.index);
    const titleMatch = attrs.match(/title\s*=\s*"([^"]*)"/i) || attrs.match(/title\s*=\s*'([^']*)'/i);
    out.push({
      kind: "widget",
      title: (titleMatch?.[1] || "Widget").slice(0, 120),
      html: body.trim(),
    });
    rest = rest.slice(tagEnd + closeMatch.index + closeMatch[0].length);
  }
  return out;
}

export default function MessageContent({
  text,
  mentions,
  onTaskToggle,
}: {
  text: string;
  mentions?: string[];
  onTaskToggle?: (lineIdx: number, checked: boolean) => void;
}) {
  const segments = useMemo(() => parseSegments(text), [text]);
  return (
    <>
      {segments.map((seg, i) =>
        seg.kind === "text" ? (
          seg.value.trim() ? (
            <CedarMarkdown key={i} text={seg.value} mentions={mentions} onTaskToggle={onTaskToggle} />
          ) : null
        ) : (
          <Widget key={i} title={seg.title} html={seg.html} />
        ),
      )}
    </>
  );
}

// Exposed for callers that want a quick "does this message embed a
// widget?" check (e.g. activity log, message export decisions).
export function hasWidget(text: string): boolean {
  return /<\s*(arzwidget|mcwidget)\b/i.test(text);
}
