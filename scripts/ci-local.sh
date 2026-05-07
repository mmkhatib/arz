#!/usr/bin/env bash
# Run the same gates CI runs, in the same order, in the same project.
# Usage:
#   ./scripts/ci-local.sh        # full run
#   ./scripts/ci-local.sh fast   # skip pytest (lint+format only, ~2s)
#
# Exits non-zero on the first failing gate. Designed to wrap a git push:
#   ./scripts/ci-local.sh && git push

set -euo pipefail

cd "$(dirname "$0")/.."

mode="${1:-full}"

red()   { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
blue()  { printf '\033[34m%s\033[0m\n' "$*"; }

step() { blue "▸ $*"; }
ok()   { green "✓ $*"; }
fail() { red "✗ $*"; exit 1; }

step "ruff check (lint)"
uv run ruff check || fail "ruff check failed — run \`uv run ruff check --fix\`"
ok "lint clean"

step "ruff format --check"
uv run ruff format --check || fail "format drift — run \`uv run ruff format\`"
ok "format clean"

if [ "$mode" = "fast" ]; then
  green "fast mode — skipping pytest"
  exit 0
fi

step "pytest"
uv run pytest -q || fail "tests failed"
ok "tests pass"

green "==> all CI gates pass locally"
