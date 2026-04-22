# Contributing to Arz

## Setup

Requires Python 3.12+ and [`uv`](https://docs.astral.sh/uv/).

```bash
git clone <repo>
cd arz
uv sync --all-extras
uv run pre-commit install
```

## Commands

| Command | Purpose |
|---|---|
| `uv run ruff check --fix` | Lint + auto-fix |
| `uv run ruff format` | Format |
| `uv run mypy src` | Type check (strict) |
| `uv run pytest` | Run tests |
| `uv run arz --help` | CLI help |

## Conventions

- Python 3.12+, async-first, fully typed (`mypy --strict`).
- `pydantic` v2 for request/response models.
- `structlog` for logging — no `print`, no raw `logging`.
- One module per concern; `surfaces/` and `providers/` are the two pluggable seams.
- No file exceeds 500 lines without a refactor plan.

## Commit style

- Conventional-ish: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`.
- Keep commits atomic and self-contained.
- Run `uv run ruff check && uv run mypy src && uv run pytest` before committing.
