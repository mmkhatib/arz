"""Whole-block admission under one character budget.

Before this, every memory block had its own cap and nothing bounded the sum,
so a turn's prefix could reach ~20k chars regardless of what else was in it.
Now:

* **Protected** blocks (runtime hint, intent, the user's preference files,
  pinned lessons) are always admitted — they are instructions, not
  background.
* Every other block competes for ``budget`` characters in the order given
  (callers order by priority). A block is admitted WHOLE or omitted — never
  sliced mid-entry — and omissions are reported by name with a pointer to
  ``<recall>`` so the model knows something exists.
"""

from __future__ import annotations

from dataclasses import dataclass

# Discretionary allowance for background memory, in characters (not tokens).
DEFAULT_BUDGET_CHARS = 16_000


@dataclass
class Block:
    name: str
    text: str
    protected: bool = False


def admit(
    blocks: list[Block], *, budget: int = DEFAULT_BUDGET_CHARS
) -> tuple[list[Block], list[str]]:
    """Return ``(admitted, omitted_names)``; admitted keeps input order."""
    remaining = budget
    admitted: list[Block] = []
    omitted: list[str] = []
    for b in blocks:
        if not b.text:
            continue
        if b.protected:
            admitted.append(b)
            continue
        size = len(b.text) + 2  # joining "\n\n"
        if size <= remaining:
            admitted.append(b)
            remaining -= size
        else:
            omitted.append(b.name)
    return admitted, omitted


def omission_note(omitted: list[str]) -> str:
    if not omitted:
        return ""
    return (
        "<memory-budget>Omitted for space: "
        + ", ".join(omitted)
        + ". Use <recall>query</recall> to fetch them if relevant.</memory-budget>"
    )
