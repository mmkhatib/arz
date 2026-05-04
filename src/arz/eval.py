"""Eval harness — exercise memory + recall + tool plumbing end-to-end.

Each scenario is a list of turns. After running, the harness scores each
turn against expected substrings in the assistant reply. Designed to be
cheap to extend: scenarios are plain Python dicts, no DSL.

Usage:
    arz eval                  # run all
    arz eval --scenarios memory-recall,multi-turn

The harness spins up a single fresh session per scenario via the
configured provider. It does NOT touch ~/.arz/sessions — sessions used
here are in-memory only.
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from typing import Any

from arz.acp.types import EVENT_COMPLETE, EVENT_TEXT_CHUNK
from arz.config.schema import ArzConfig
from arz.providers.base import LLMProvider

log = logging.getLogger(__name__)


@dataclass
class Turn:
    user: str
    expect_any: list[str] = field(default_factory=list)  # any substring counts as pass
    expect_all: list[str] = field(default_factory=list)  # every substring must be present


@dataclass
class Scenario:
    id: str
    description: str
    turns: list[Turn]


SCENARIOS: list[Scenario] = [
    Scenario(
        id="basic-math",
        description="Sanity — model returns a numeric answer to a basic arithmetic prompt.",
        turns=[Turn(user="What is 17 * 23? Reply with just the number.", expect_any=["391"])],
    ),
    Scenario(
        id="multi-turn",
        description="Memory within a session — the assistant should recall a name set in turn 1.",
        turns=[
            Turn(user="My favourite tree is the cedar. Acknowledge with a single word."),
            Turn(
                user="What did I just say my favourite tree was? One word.",
                expect_any=["cedar", "Cedar"],
            ),
        ],
    ),
    Scenario(
        id="instruction-follow",
        description="Format adherence — assistant must produce a JSON object with one key.",
        turns=[
            Turn(
                user='Reply with exactly `{"ok": true}` and nothing else.',
                expect_all=['"ok"', "true"],
            ),
        ],
    ),
]


def _build_provider(cfg: ArzConfig) -> LLMProvider:
    from arz.providers.claude_code import ClaudeCodeProvider
    from arz.providers.codex import CodexProvider
    from arz.providers.gemini import GeminiProvider
    from arz.providers.kiro_cli import KiroCliProvider
    from arz.providers.ollama import OllamaProvider

    name = cfg.provider.name
    model = cfg.provider.model
    if name == "claude-code":
        return ClaudeCodeProvider(model=model)
    if name == "kiro-cli":
        return KiroCliProvider(model=model)
    if name == "codex":
        return CodexProvider(model=model)
    if name == "gemini":
        return GeminiProvider(model=model)
    if name == "ollama":
        return OllamaProvider(model=model)
    raise ValueError(f"unsupported provider for eval: {name!r}")


async def _drain(provider: LLMProvider, message: str) -> str:
    text = ""
    async for ev in provider.stream(message):
        if ev.kind == EVENT_TEXT_CHUNK and ev.text:
            text += ev.text
        elif ev.kind == EVENT_COMPLETE:
            break
    return text


def _score(turn: Turn, reply: str) -> tuple[bool, str]:
    if turn.expect_any:
        for s in turn.expect_any:
            if s in reply:
                return True, f"matched any:{s!r}"
        return False, f"no expect_any matched: {turn.expect_any!r}"
    if turn.expect_all:
        missing = [s for s in turn.expect_all if s not in reply]
        if missing:
            return False, f"missing: {missing!r}"
        return True, "all matched"
    return True, "no assertions"


async def run_eval(cfg: ArzConfig, scenarios: list[str] | None = None) -> dict[str, Any]:
    """Run the chosen scenarios. Prints a one-line summary per scenario."""
    chosen = SCENARIOS if scenarios is None else [s for s in SCENARIOS if s.id in scenarios]
    if not chosen:
        print(f"No scenarios match {scenarios!r}. Available: {[s.id for s in SCENARIOS]}")
        return {"results": []}

    print(f"Eval harness — {cfg.provider.name}/{cfg.provider.model} — {len(chosen)} scenarios\n")
    results: list[dict[str, Any]] = []
    for scn in chosen:
        provider = _build_provider(cfg)
        try:
            await provider.start()
            t0 = time.monotonic()
            turns_passed = 0
            details: list[str] = []
            for i, turn in enumerate(scn.turns, 1):
                reply = await _drain(provider, turn.user)
                ok, why = _score(turn, reply)
                if ok:
                    turns_passed += 1
                details.append(f"  turn {i}: {'PASS' if ok else 'FAIL'} — {why}")
            elapsed = time.monotonic() - t0
            status = "PASS" if turns_passed == len(scn.turns) else "FAIL"
            print(f"[{status}] {scn.id}  ({turns_passed}/{len(scn.turns)} turns, {elapsed:.1f}s)")
            for d in details:
                print(d)
            results.append({"id": scn.id, "passed": turns_passed, "total": len(scn.turns), "elapsed_s": elapsed})
        except Exception as e:
            log.exception("eval scenario %s crashed", scn.id)
            print(f"[ERROR] {scn.id}: {e}")
            results.append({"id": scn.id, "error": str(e)})
        finally:
            try:
                await provider.shutdown()
            except Exception:
                pass

    total_pass = sum(r.get("passed", 0) for r in results)
    total_turns = sum(r.get("total", 0) for r in results)
    print(f"\n→ overall: {total_pass}/{total_turns} turns passed across {len(results)} scenarios")
    return {"results": results, "total_passed": total_pass, "total_turns": total_turns}
