"""Eval harness — exercise memory + recall + tool plumbing end-to-end.

Each scenario is a list of turns. After running, the harness scores each
turn against expected substrings in the assistant reply. Designed to be
cheap to extend: scenarios are plain Python dicts, no DSL.

Usage:
    arz eval                              # all scenarios, configured provider
    arz eval --scenarios memory-recall,multi-turn
    arz eval --cross-provider             # rerun every scenario against
                                          # every installed provider so you
                                          # can compare cross-LLM behaviour

The harness spins up a single fresh session per scenario via the
configured provider. It does NOT touch ~/.arz/sessions — sessions used
here are in-memory only.

Memory-specific scenarios (memory-write-recall, memory-restart-recall)
test the cross-session memory pipeline: write a `<semantic>` fact in
turn 1, restart the provider process between turns, then ask in turn 2
whether the model still has it via build_prefix injection.
"""

from __future__ import annotations

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
    # Memory tests need to simulate a gateway / provider restart between
    # turns. When True, the harness shuts down the current provider
    # process and spawns a fresh one before sending this turn — forcing
    # the runtime to rehydrate memory from disk via build_prefix.
    restart_provider_first: bool = False
    # Inject build_prefix output as the prompt prefix for this turn. This
    # is what mirrors the real chat hot path's behaviour for stateless
    # providers (codex / gemini / ollama) and for any provider after a
    # restart. Off by default for the legacy scenarios that just check
    # in-session continuity.
    use_memory_prefix: bool = False


@dataclass
class Scenario:
    id: str
    description: str
    turns: list[Turn]
    # Optional list of semantic facts to seed BEFORE the first turn fires.
    # `(key, value, confidence)` tuples written to the live semantic store
    # via the same `upsert` path the consolidator uses.
    seed_semantic: list[tuple[str, str, float]] = field(default_factory=list)
    # When True, the harness wipes the semantic store BEFORE seeding so
    # prior eval runs don't pollute the test. Off by default — most
    # scenarios don't touch semantic at all.
    reset_semantic: bool = False


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
    # ── Memory pipeline tests (Phase 1–4) ─────────────────────────────
    Scenario(
        id="memory-write-recall",
        description=(
            "Single-turn semantic write + same-session recall. Tests that the "
            "model both EMITS a `<semantic>` tag AND treats stored memory as "
            "real. No restart — just verifies the read path lands in the prefix."
        ),
        reset_semantic=True,
        turns=[
            Turn(
                user=(
                    "Remember: my preferred database is PostgreSQL 16. "
                    "Acknowledge with one sentence and write a `<semantic "
                    'key="pref.database">PostgreSQL 16</semantic>` tag.'
                ),
                expect_any=["semantic", "PostgreSQL", "Postgres"],
            ),
            Turn(
                user="What database did I say I prefer? One word.",
                use_memory_prefix=True,
                expect_any=["PostgreSQL", "Postgres", "postgres"],
            ),
        ],
    ),
    Scenario(
        id="memory-restart-recall",
        description=(
            "Cross-restart memory survival. Seeds the semantic store with a "
            "canonical fact, then restarts the provider before asking. Tests "
            "that build_prefix's <semantic-memory> block reaches a fresh "
            "process — the bug from session b7fba464."
        ),
        reset_semantic=True,
        seed_semantic=[
            ("project.canonical.repo", "github.com/mmkhatib/arz", 0.95),
            ("repo.default_branch", "main", 0.95),
        ],
        turns=[
            Turn(
                user=("What's the default branch of the canonical repo? Answer in one word."),
                restart_provider_first=True,
                use_memory_prefix=True,
                expect_any=["main", "Main"],
            ),
        ],
    ),
    Scenario(
        id="memory-forget",
        description=(
            "Contradiction path. Writes a fact, then `<forget>`s it, then asks. "
            "The forgotten key should NOT appear in the recall."
        ),
        reset_semantic=True,
        seed_semantic=[("project.deprecated.host", "old-db.internal", 0.9)],
        turns=[
            Turn(
                user=(
                    "I no longer use that host. Emit `<forget "
                    'key="project.deprecated.host">retired</forget>` and '
                    "acknowledge."
                ),
                use_memory_prefix=True,
                expect_any=["forget", "retire", "noted", "acknowledged"],
            ),
            Turn(
                user="What's the deprecated host? If you don't know, say 'unknown'.",
                restart_provider_first=True,
                use_memory_prefix=True,
                expect_any=["unknown", "don't know", "no longer", "not in"],
            ),
        ],
    ),
]


def _build_provider(
    cfg: ArzConfig,
    *,
    name_override: str | None = None,
    history_messages: list[dict] | None = None,
) -> LLMProvider:
    from arz.providers.claude_code import ClaudeCodeProvider
    from arz.providers.codex import CodexProvider
    from arz.providers.gemini import GeminiProvider
    from arz.providers.kiro_cli import KiroCliProvider
    from arz.providers.ollama import OllamaProvider

    name = name_override or cfg.provider.name
    model = cfg.provider.model
    if name == "claude-code":
        return ClaudeCodeProvider(model=model, history_messages=history_messages)
    if name == "kiro-cli":
        return KiroCliProvider(model=model, history_messages=history_messages)
    if name == "codex":
        return CodexProvider(model=model, history_messages=history_messages)
    if name == "gemini":
        return GeminiProvider(model=model, history_messages=history_messages)
    if name == "ollama":
        return OllamaProvider(model=model, history_messages=history_messages)
    raise ValueError(f"unsupported provider for eval: {name!r}")


def _detect_installed_providers() -> list[str]:
    """Probe each provider for an installed CLI / runtime. Cheap shutil
    lookups so the cross-provider eval can skip ones that aren't on this
    box."""
    import shutil

    out: list[str] = []
    if shutil.which("claude"):
        out.append("claude-code")
    if shutil.which("kiro"):
        out.append("kiro-cli")
    if shutil.which("codex"):
        out.append("codex")
    if shutil.which("gemini"):
        out.append("gemini")
    # Ollama is HTTP — assume installed if the server responds. Cheap
    # connect attempt, 200ms timeout.
    try:
        import socket

        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(0.2)
        if s.connect_ex(("127.0.0.1", 11434)) == 0:
            out.append("ollama")
        s.close()
    except Exception:
        pass
    return out


def _seed_semantic(scn: Scenario) -> None:
    """Wipe + seed the semantic store for memory scenarios. Uses the
    same upsert path the real consolidator uses so the test exercises
    the live guardrails."""
    if not scn.reset_semantic and not scn.seed_semantic:
        return
    from arz.memory import semantic

    if scn.reset_semantic:
        try:
            with semantic._connect() as conn:  # noqa: SLF001
                conn.execute("DELETE FROM semantic_memory")
                conn.execute("DELETE FROM memory_events")
        except Exception:
            log.exception("eval: semantic reset failed")
    for key, value, conf in scn.seed_semantic:
        try:
            semantic.upsert(key, value, source="eval-seed", confidence=conf)
        except Exception:
            log.exception("eval: semantic seed failed", extra={"key": key})


def _wrap_with_prefix(message: str) -> str:
    """Prepend build_prefix output the same way the chat hot path does
    when ``use_memory_prefix`` is set on the turn."""
    try:
        from arz.memory.context import build_prefix

        prefix = build_prefix(message)
    except Exception:
        log.exception("eval: build_prefix failed")
        return message
    if not prefix:
        return message
    return f"{prefix}\n\n{message}"


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


async def _run_single_scenario(
    cfg: ArzConfig, scn: Scenario, *, provider_name: str | None = None
) -> dict[str, Any]:
    """Run one scenario against one provider. Handles restart-between-turns
    and `use_memory_prefix` flags so memory tests actually exercise the
    cross-restart path."""
    _seed_semantic(scn)
    history: list[dict] = []
    provider = _build_provider(cfg, name_override=provider_name)
    try:
        await provider.start()
        t0 = time.monotonic()
        turns_passed = 0
        details: list[str] = []
        for i, turn in enumerate(scn.turns, 1):
            if turn.restart_provider_first:
                # Tear the persistent process down + spin a fresh one
                # with full prior history. Mirrors what the chat hot
                # path does after a gateway restart.
                try:
                    await provider.shutdown()
                except Exception:
                    pass
                provider = _build_provider(
                    cfg, name_override=provider_name, history_messages=history
                )
                await provider.start()
            message = _wrap_with_prefix(turn.user) if turn.use_memory_prefix else turn.user
            reply = await _drain(provider, message)
            history.append({"role": "user", "text": turn.user})
            history.append({"role": "assistant", "text": reply})
            ok, why = _score(turn, reply)
            if ok:
                turns_passed += 1
            details.append(f"    turn {i}: {'PASS' if ok else 'FAIL'} — {why}")
        elapsed = time.monotonic() - t0
        status = "PASS" if turns_passed == len(scn.turns) else "FAIL"
        provider_label = provider_name or cfg.provider.name
        print(
            f"  [{status}] {provider_label} · {scn.id}  ({turns_passed}/{len(scn.turns)} turns, {elapsed:.1f}s)"
        )
        for d in details:
            print(d)
        return {
            "id": scn.id,
            "provider": provider_label,
            "passed": turns_passed,
            "total": len(scn.turns),
            "elapsed_s": elapsed,
        }
    except Exception as e:
        log.exception("eval scenario %s crashed", scn.id)
        provider_label = provider_name or cfg.provider.name
        print(f"  [ERROR] {provider_label} · {scn.id}: {e}")
        return {"id": scn.id, "provider": provider_label, "error": str(e)}
    finally:
        try:
            await provider.shutdown()
        except Exception:
            pass


async def run_eval(
    cfg: ArzConfig,
    scenarios: list[str] | None = None,
    *,
    cross_provider: bool = False,
) -> dict[str, Any]:
    """Run the chosen scenarios. Prints a one-line summary per scenario.

    ``cross_provider=True`` re-runs every chosen scenario against every
    installed provider on this machine, so you can compare
    cross-LLM behaviour (memory, instruction-follow, etc.) side by side.
    """
    chosen = SCENARIOS if scenarios is None else [s for s in SCENARIOS if s.id in scenarios]
    if not chosen:
        print(f"No scenarios match {scenarios!r}. Available: {[s.id for s in SCENARIOS]}")
        return {"results": []}

    if cross_provider:
        providers = _detect_installed_providers()
        if not providers:
            print(
                "No installed providers detected. Install at least one CLI to run cross-provider eval."
            )
            return {"results": []}
        print(
            f"Cross-provider eval — {len(providers)} providers × {len(chosen)} scenarios\n"
            f"Providers: {', '.join(providers)}\n"
        )
    else:
        providers = [cfg.provider.name]
        print(
            f"Eval harness — {cfg.provider.name}/{cfg.provider.model} — {len(chosen)} scenarios\n"
        )

    results: list[dict[str, Any]] = []
    for provider_name in providers:
        if cross_provider:
            print(f"\n── {provider_name} ──")
        for scn in chosen:
            row = await _run_single_scenario(
                cfg, scn, provider_name=provider_name if cross_provider else None
            )
            results.append(row)

    total_pass = sum(r.get("passed", 0) for r in results)
    total_turns = sum(r.get("total", 0) for r in results)
    print(f"\n→ overall: {total_pass}/{total_turns} turns passed across {len(results)} runs")
    if cross_provider:
        # Per-provider summary table.
        print("\nProvider summary:")
        for p in providers:
            p_rows = [r for r in results if r.get("provider") == p]
            p_pass = sum(r.get("passed", 0) for r in p_rows)
            p_total = sum(r.get("total", 0) for r in p_rows)
            errs = sum(1 for r in p_rows if "error" in r)
            print(f"  {p}: {p_pass}/{p_total} pass · {errs} errors")
    return {
        "results": results,
        "total_passed": total_pass,
        "total_turns": total_turns,
        "providers": providers,
    }
