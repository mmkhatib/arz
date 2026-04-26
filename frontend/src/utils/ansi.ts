/** Minimal ANSI SGR parser → segments of styled text.
 *
 * Handles: foreground/background colors (30-37, 40-47, 90-97, 100-107),
 * bold (1), dim (2), italic (3), underline (4), reset (0). Ignores 256-color
 * and truecolor sequences for simplicity — they pass through visually as
 * unstyled text rather than as garbage in the DOM. */

export interface AnsiSegment {
  text: string;
  fg?: string;
  bg?: string;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
}

const FG_COLORS: Record<number, string> = {
  30: "#000000", 31: "#cd3131", 32: "#0dbc79", 33: "#e5e510",
  34: "#2472c8", 35: "#bc3fbc", 36: "#11a8cd", 37: "#e5e5e5",
  90: "#666666", 91: "#f14c4c", 92: "#23d18b", 93: "#f5f543",
  94: "#3b8eea", 95: "#d670d6", 96: "#29b8db", 97: "#ffffff",
};

const BG_COLORS: Record<number, string> = {
  40: "#000000", 41: "#cd3131", 42: "#0dbc79", 43: "#e5e510",
  44: "#2472c8", 45: "#bc3fbc", 46: "#11a8cd", 47: "#e5e5e5",
  100: "#666666", 101: "#f14c4c", 102: "#23d18b", 103: "#f5f543",
  104: "#3b8eea", 105: "#d670d6", 106: "#29b8db", 107: "#ffffff",
};

/* eslint-disable no-control-regex */
const SGR_RE = /\x1b\[([0-9;]*)m/g;

export function hasAnsi(text: string): boolean {
  return /\x1b\[/.test(text);
}

export function parseAnsi(text: string): AnsiSegment[] {
  if (!hasAnsi(text)) return [{ text }];

  const segments: AnsiSegment[] = [];
  let cursor = 0;
  let state: AnsiSegment = { text: "" };

  const push = (s: string) => {
    if (!s) return;
    segments.push({ ...state, text: s });
  };

  for (const match of text.matchAll(SGR_RE)) {
    const idx = match.index ?? 0;
    push(text.slice(cursor, idx));
    cursor = idx + match[0].length;

    const codes = (match[1] || "0").split(";").map((c) => parseInt(c, 10));
    state = applyCodes(state, codes);
  }
  push(text.slice(cursor));
  return segments;
}

function applyCodes(state: AnsiSegment, codes: number[]): AnsiSegment {
  const next: AnsiSegment = { ...state, text: "" };
  let i = 0;
  while (i < codes.length) {
    const c = codes[i];
    if (c === 0) {
      // reset
      i++;
      return { text: "" };
    } else if (c === 1) next.bold = true;
    else if (c === 2) next.dim = true;
    else if (c === 3) next.italic = true;
    else if (c === 4) next.underline = true;
    else if (c === 22) {
      next.bold = false;
      next.dim = false;
    } else if (c === 23) next.italic = false;
    else if (c === 24) next.underline = false;
    else if (c === 39) next.fg = undefined;
    else if (c === 49) next.bg = undefined;
    else if (FG_COLORS[c]) next.fg = FG_COLORS[c];
    else if (BG_COLORS[c]) next.bg = BG_COLORS[c];
    else if ((c === 38 || c === 48) && codes[i + 1] === 5) {
      // 256-color: skip 3 codes total
      i += 2;
    } else if ((c === 38 || c === 48) && codes[i + 1] === 2) {
      // truecolor: skip 5 codes total
      i += 4;
    }
    i++;
  }
  return next;
}

/** Strip all ANSI sequences for plain-text copy-to-clipboard. */
export function stripAnsi(text: string): string {
  return text.replace(SGR_RE, "");
}
