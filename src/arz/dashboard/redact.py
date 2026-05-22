"""Credential + exfiltration-URL redaction for outgoing chat text.

Stay-on-task #12. Two passes:

  redact_chunk(text)      — per-chunk regex sweep. Cheap; called before
                            broadcasting text_chunk / tool_call SSE
                            events. May miss patterns that span chunks.

  redact_full(text)       — same regex set applied to a fully-assembled
                            message at turn-end, so cross-chunk patterns
                            still get caught before the message is
                            persisted to session.messages.

Anything that looks like a credential or an unexpected outbound URL is
replaced with a placeholder (`[REDACTED:<kind>]`). The placeholder is
short on purpose so it doesn't bloat the bubble; if the user genuinely
needs to see a value, they can re-fetch via tool call.
"""

from __future__ import annotations

import re

# Common credential / token patterns. Tighter than catch-all entropy
# heuristics — we'd rather miss the occasional novel format than nuke
# unrelated identifiers.
_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    # AWS access keys
    ("aws-key", re.compile(r"AKIA[0-9A-Z]{16}")),
    ("aws-secret", re.compile(r"(?<![\w/+])[A-Za-z0-9/+]{40}(?![\w/+])")),
    # GitHub tokens (classic + fine-grained + OAuth)
    ("github-token", re.compile(r"gh[pousr]_[A-Za-z0-9]{30,255}")),
    # Slack tokens
    ("slack-token", re.compile(r"xox[abprs]-[A-Za-z0-9-]{10,}")),
    # OpenAI-style API keys
    ("openai-key", re.compile(r"sk-[A-Za-z0-9-_]{20,}")),
    # Anthropic API keys
    ("anthropic-key", re.compile(r"sk-ant-[A-Za-z0-9-_]{20,}")),
    # Google API keys
    ("google-key", re.compile(r"AIza[0-9A-Za-z\-_]{35}")),
    # Generic Bearer tokens in HTTP headers
    ("bearer", re.compile(r"(?i)Bearer\s+[A-Za-z0-9._\-]{16,}")),
    # Generic Authorization: Basic xxx
    ("basic-auth", re.compile(r"(?i)Authorization:\s*Basic\s+[A-Za-z0-9+/=]{16,}")),
    # Private key headers
    ("private-key", re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----")),
    # JWTs — three base64url segments separated by dots
    (
        "jwt",
        re.compile(r"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b"),
    ),
]

# Exfiltration: URLs to suspicious hosts (raw IP, ngrok, requestbin,
# pipedream, webhook.site, paste sites). The model could legitimately
# emit URLs to known docs — we only flag the catch-all-host patterns.
_EXFIL_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("exfil-ip", re.compile(r"https?://(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?(?:/\S*)?")),
    (
        "exfil-tunnel",
        re.compile(
            r"https?://[A-Za-z0-9.-]*"
            r"(?:ngrok\.io|ngrok-free\.app|trycloudflare\.com|requestbin\.com|"
            r"pipedream\.net|webhook\.site|tunnel\.dev|loca\.lt|serveo\.net)"
            r"(?:/\S*)?"
        ),
    ),
    (
        "exfil-paste",
        re.compile(
            r"https?://[A-Za-z0-9.-]*"
            r"(?:pastebin\.com|ix\.io|0bin\.net|gist\.githubusercontent\.com)"
            r"(?:/\S*)?"
        ),
    ),
]


def _sweep(text: str, patterns: list[tuple[str, re.Pattern[str]]]) -> str:
    out = text
    for kind, pat in patterns:
        out = pat.sub(f"[REDACTED:{kind}]", out)
    return out


def redact_chunk(text: str) -> str:
    """Per-chunk redaction. Called before each SSE broadcast."""
    if not text:
        return text
    out = _sweep(text, _PATTERNS)
    out = _sweep(out, _EXFIL_PATTERNS)
    return out


def redact_full(text: str) -> str:
    """Full-text redaction. Called at turn-end before persisting the
    assistant message. Catches cross-chunk patterns."""
    return redact_chunk(text)
