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

# Frontend: rebuild only if any frontend source is newer than the bundled
# index.html. Vite writes straight to src/arz/static/ so the gateway picks
# up the new bundle on next start. Caught us multiple times — UI changes
# that "shipped" but weren't visible because the static bundle was stale.
if [ -d "frontend/src" ] && [ -f "src/arz/static/index.html" ]; then
  bundle_mtime=$(stat -f "%m" "src/arz/static/index.html" 2>/dev/null || stat -c "%Y" "src/arz/static/index.html" 2>/dev/null || echo 0)
  newest_src=$(find frontend/src -type f \( -name "*.ts" -o -name "*.tsx" -o -name "*.css" \) -newer "src/arz/static/index.html" -print -quit 2>/dev/null || true)
  if [ -n "$newest_src" ]; then
    step "frontend bundle is stale ($newest_src newer than bundle) — rebuilding"
    (cd frontend && ./node_modules/.bin/vite build > /dev/null 2>&1) || fail "vite build failed"
    ok "frontend rebuilt — restart gateway to serve it"
  fi
elif [ -d "frontend/src" ]; then
  step "no bundle present — building frontend"
  (cd frontend && ./node_modules/.bin/vite build > /dev/null 2>&1) || fail "vite build failed"
  ok "frontend built"
fi

green "==> all CI gates pass locally"
