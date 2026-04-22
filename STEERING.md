# Arz — AI Steering Rules

Project-wide rules for AI assistants (and humans) working on this codebase.

## Architecture principles

1. **Surfaces are thin.** Slack, Telegram, WhatsApp, dashboard, TUI — all adapt to a single `SessionManager`. Do NOT embed session logic inside surface adapters.
2. **Providers are pluggable.** LLM backends implement `LLMProvider` in `src/arz/providers/`. No provider-specific types leak into core.
3. **Messaging surfaces are pluggable.** Platforms implement `MessagingSurface` in `src/arz/surfaces/<name>/`. Owner-lock is enforced per-surface via `is_authorized()` on every incoming event — never optional.
4. **Async-first.** All I/O goes through `asyncio`. No blocking calls in request paths.
5. **Deny-by-default security.** Path reads and command execution must reject unless explicitly allowed.

## Code rules

- Python 3.12+, strict type annotations (`mypy --strict`).
- Formatting + linting via `ruff` (line length 100).
- No hardcoded secrets — use `~/.arz/.env` with `chmod 600`, or environment variables.
- Sanitize all LLM / user output before posting to messaging surfaces (credential redaction, XSS safety for rendered HTML).
- Dashboard binds `127.0.0.1` by default. `0.0.0.0` binding requires explicit opt-in AND active token auth middleware.
- Never use `.innerHTML =` in the frontend; never `dangerouslySetInnerHTML` without DOMPurify.

## Never do

- Never bind the dashboard to `0.0.0.0` without token auth.
- Never skip the owner-lock check on incoming messages.
- Never trust raw LLM output in a browser or messaging surface.
- Never commit `.env` or credential files.

## Testing

- Unit tests: `pytest` with `asyncio_mode = strict`.
- Integration tests: real SQLite, fake `MessagingSurface`, fake `LLMProvider`.
- Every new ABC method MUST ship with a conformance test applied to every concrete implementation.

## Module boundaries

- `core/` (not yet created) will hold `SessionManager`, `MessageRouter`, and the event loop — no imports from surfaces or providers.
- `providers/`, `surfaces/`, `tools/` depend INWARD on `core/`, never on each other.
- Surface adapters translate platform events into the shared `IncomingMessage` shape defined in `surfaces/base.py`.
