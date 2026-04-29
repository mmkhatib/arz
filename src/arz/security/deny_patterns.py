"""Generic deny patterns for shell/tool calls.

NO Amazon, AWS, Kiro, or any vendor-specific patterns. These are operator
safety nets — destructive shell commands, secret exfiltration, and
pipe-to-shell anti-patterns.
"""

from __future__ import annotations

import re
from dataclasses import dataclass


@dataclass(frozen=True)
class DenyRule:
    pattern: re.Pattern[str]
    reason: str
    severity: str = "block"  # "block" | "warn"


def _r(p: str, flags: int = re.IGNORECASE) -> re.Pattern[str]:
    return re.compile(p, flags)


# Severity:
#   block — never run, even with confirmation. The runtime hard-fails.
#   warn  — surface a confirmation prompt before running.
DEFAULT_DENY_RULES: list[DenyRule] = [
    # Filesystem destruction
    DenyRule(_r(r"\brm\s+-rf?\s+/(\s|$)"), "rm -rf / would wipe the root filesystem"),
    DenyRule(_r(r"\brm\s+-rf?\s+~(\s|$)"), "rm -rf ~ would wipe the home directory"),
    DenyRule(_r(r"\bchmod\s+-R\s+777\s+/"), "chmod -R 777 / opens up the entire filesystem"),
    DenyRule(_r(r"\bdd\s+if=.*\s+of=/dev/(sda|nvme|disk)"), "dd to a raw disk would overwrite the device"),
    DenyRule(_r(r"\bmkfs\."), "mkfs would format a filesystem", "warn"),
    DenyRule(_r(r":\s*\(\s*\)\s*\{.*:\s*\|\s*:\s*&\s*\}\s*;"), "fork bomb pattern"),

    # Pipe-to-shell
    DenyRule(_r(r"\bcurl\b[^\n|]*\|\s*(sudo\s+)?(sh|bash|zsh|fish|python\b|node\b)"),
             "piping curl output into a shell is unsafe — download, inspect, then run", "warn"),
    DenyRule(_r(r"\bwget\b[^\n|]*\|\s*(sudo\s+)?(sh|bash|zsh|fish|python\b|node\b)"),
             "piping wget output into a shell is unsafe — download, inspect, then run", "warn"),
    DenyRule(_r(r"\beval\s+\$\(\s*curl\b"), "eval $(curl …) is remote code execution", ),

    # Secrets / credentials
    DenyRule(_r(r"\bcat\s+\.env(\s|$|\.)"), ".env files often contain secrets — confirm before exfil", "warn"),
    DenyRule(_r(r"\bcat\s+~?/\.aws/credentials"), "AWS credentials should not be read into context", "warn"),
    DenyRule(_r(r"\bcat\s+~?/\.ssh/id_(rsa|ed25519|ecdsa|dsa)"), "private SSH keys should not be read into context"),
    DenyRule(_r(r"\bcat\s+~?/\.config/gcloud"), "gcloud config may contain credentials", "warn"),
    DenyRule(_r(r"\bprintenv\b"), "printenv dumps every env var (often secret-bearing)", "warn"),
    DenyRule(_r(r"^env(\s|$)"), "env dumps every env var (often secret-bearing)", "warn"),

    # Source control / hard-to-reverse
    DenyRule(_r(r"\bgit\s+push\s+.*--force(?!-with-lease)\b"),
             "git push --force can overwrite teammates' work — use --force-with-lease or confirm", "warn"),
    DenyRule(_r(r"\bgit\s+reset\s+--hard(\s|$)"), "git reset --hard discards local changes", "warn"),
    DenyRule(_r(r"\bgit\s+clean\s+-[fdx]+(\s|$)"), "git clean -fdx deletes untracked files", "warn"),
    DenyRule(_r(r"\bgit\s+branch\s+-D\s"), "git branch -D force-deletes a branch", "warn"),
    DenyRule(_r(r"\bgit\s+checkout\s+\.(\s|$)"), "git checkout . discards working-tree changes", "warn"),

    # Database
    DenyRule(_r(r"\bDROP\s+(TABLE|DATABASE|SCHEMA)\b"), "DROP statements are destructive", "warn"),
    DenyRule(_r(r"\bTRUNCATE\b"), "TRUNCATE is destructive", "warn"),
    DenyRule(_r(r"\bDELETE\s+FROM\b(?!.*\bWHERE\b)"), "DELETE without WHERE removes every row", "warn"),

    # Cluster / orchestration
    DenyRule(_r(r"\bkubectl\s+delete\b.*--all\b"), "kubectl delete --all wipes resources", "warn"),
    DenyRule(_r(r"\bdocker\s+system\s+prune\s+-a"), "docker system prune -a removes all images and containers", "warn"),

    # Process / system
    DenyRule(_r(r"\bshutdown\b.*-h"), "shutdown -h halts the host", "warn"),
    DenyRule(_r(r"\breboot\b"), "reboot restarts the host", "warn"),
    DenyRule(_r(r"\bkillall\s+-9"), "killall -9 SIGKILLs every matching process", "warn"),
]


def evaluate(command: str, rules: list[DenyRule] | None = None) -> DenyRule | None:
    """Return the first matching rule, or None if the command is clean."""
    if not command:
        return None
    for rule in (rules or DEFAULT_DENY_RULES):
        if rule.pattern.search(command):
            return rule
    return None
