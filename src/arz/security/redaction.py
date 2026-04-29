"""Credential and token redaction for surface-bound text.

Run before persisting messages to disk and before sending to non-local
surfaces. Aggressive — false positives are preferable to a leaked key.
"""

from __future__ import annotations

import re

# Keep the substitution short; the original location stays intact.
_REDACTED = "[REDACTED]"

_PATTERNS: list[re.Pattern[str]] = [
    # AWS access keys
    re.compile(r"\b(AKIA|ASIA)[0-9A-Z]{16}\b"),
    # AWS secret keys (best-effort: assignment context)
    re.compile(r"(?i)(aws_secret_access_key|aws_secret)\s*[:=]\s*['\"]?([A-Za-z0-9/+=]{30,})"),
    # GitHub tokens (modern + legacy)
    re.compile(r"\bghp_[A-Za-z0-9]{30,}\b"),
    re.compile(r"\bgithub_pat_[A-Za-z0-9_]{60,}\b"),
    re.compile(r"\bgho_[A-Za-z0-9]{30,}\b"),
    # OpenAI keys
    re.compile(r"\bsk-(proj-)?[A-Za-z0-9_-]{20,}\b"),
    # Anthropic keys
    re.compile(r"\bsk-ant-[A-Za-z0-9_-]{30,}\b"),
    # Google API keys
    re.compile(r"\bAIza[0-9A-Za-z_-]{35}\b"),
    # Slack tokens
    re.compile(r"\bxox[abprs]-[0-9A-Za-z-]{20,}\b"),
    # Stripe
    re.compile(r"\b(sk|rk|pk)_(live|test)_[0-9A-Za-z]{20,}\b"),
    # Generic Bearer tokens in Authorization headers
    re.compile(r"(?i)(authorization\s*[:=]\s*)bearer\s+[A-Za-z0-9._\-]+"),
    # Generic JWT-shape tokens
    re.compile(r"\beyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\b"),
    # PEM private key blocks
    re.compile(r"-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]+?-----END [A-Z ]+PRIVATE KEY-----"),
]


def redact(text: str) -> str:
    if not text:
        return text
    out = text
    for pat in _PATTERNS:
        # For patterns with capture groups, preserve them and redact the secret bit.
        if pat.groups >= 2:
            out = pat.sub(lambda m: m.group(1) + _REDACTED, out)
        elif pat.groups == 1:
            out = pat.sub(_REDACTED, out)
        else:
            out = pat.sub(_REDACTED, out)
    return out


def has_secret(text: str) -> bool:
    if not text:
        return False
    for pat in _PATTERNS:
        if pat.search(text):
            return True
    return False
