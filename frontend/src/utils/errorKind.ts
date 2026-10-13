/** Classify a turn-level error string so the chat can show a card with
 *  a useful explanation instead of a bare red line. Ordered: the first
 *  matching rule wins, so the more specific ones go first. */

export type ErrorKind = "auth" | "usage_limit" | "timeout" | "start_failed" | "network" | "generic";

export interface ErrorInfo {
  kind: ErrorKind;
  title: string;
  hint: string;
}

const RULES: { kind: ErrorKind; re: RegExp; title: string; hint: string }[] = [
  {
    kind: "auth",
    re: /\b(401|unauthori[sz]ed|not (logged|signed) in|login required|auth(entication)? (required|failed)|invalid api key|expired token)\b/i,
    title: "Authentication needed",
    hint: "The provider rejected the credentials. Sign in again (or check the API key in Settings), then retry.",
  },
  {
    kind: "usage_limit",
    re: /\b(429|rate[- ]?limit(ed)?|usage limit|quota|too many requests|overloaded|credit balance)\b/i,
    title: "Usage limit reached",
    hint: "The provider is throttling requests. Wait a moment or switch model, then retry.",
  },
  {
    kind: "timeout",
    re: /\b(time[d]?[- ]?out|deadline exceeded|exceeded \d+s budget|504)\b/i,
    title: "Turn timed out",
    hint: "The model stopped responding before the turn finished. Retry, or break the request into smaller steps.",
  },
  {
    kind: "start_failed",
    re: /\b(failed to (start|spawn|launch)|no such file or directory|command not found|ENOENT|provider .* not (found|installed))\b/i,
    title: "Provider failed to start",
    hint: "The agent CLI couldn't be launched. Check it's installed and on PATH, then retry.",
  },
  {
    kind: "network",
    re: /\b(failed to fetch|network ?error|ECONNREFUSED|ECONNRESET|connection (refused|reset|closed)|502|503)\b/i,
    title: "Connection problem",
    hint: "Couldn't reach the Arz server or the provider. Check the gateway is running, then retry.",
  },
];

export function classifyError(message: string): ErrorInfo {
  for (const r of RULES) {
    if (r.re.test(message)) return { kind: r.kind, title: r.title, hint: r.hint };
  }
  return { kind: "generic", title: "Something went wrong", hint: "The turn ended with an error." };
}
