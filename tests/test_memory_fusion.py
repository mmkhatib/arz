"""Step 3a: rank fusion, MMR, episodic decay × importance."""

from __future__ import annotations

import time

from arz.memory import episodic
from arz.memory.fusion import mmr, rrf, token_jaccard


def test_rrf_rewards_agreement_between_retrievers() -> None:
    fused = [k for k, _ in rrf([["a", "b", "c"], ["c", "d"]])]
    # "c" is 3rd in one list and 1st in the other → beats "a" (1st in one only)
    assert fused[0] == "c"
    assert set(fused) == {"a", "b", "c", "d"}


def test_mmr_skips_near_duplicates() -> None:
    items = [
        "deployed the gateway to staging",
        "deployed the gateway to staging again",
        "rotated the slack bot token",
    ]
    rel = {items[0]: 1.0, items[1]: 0.95, items[2]: 0.6}
    picked = mmr(items, relevance=rel.__getitem__, similarity=token_jaccard, limit=2)
    assert picked == [items[0], items[2]]


def test_episode_score_importance_and_decay() -> None:
    now = time.time()
    day = 86400.0
    fresh = episodic.episode_score(0.8, 0.5, now, [], now)
    old = episodic.episode_score(0.8, 0.5, now - 60 * day, [], now)
    assert old < fresh * 0.25  # default rate 0.03/day → e^-1.8
    # Decisions barely decay; debugging notes decay fast.
    assert episodic.episode_score(0.8, 0.5, now - 60 * day, ["decision"], now) > 0.6 * fresh
    assert episodic.episode_score(0.8, 0.5, now - 30 * day, ["debug"], now) < 0.1 * fresh
    # Importance lifts score by up to 30%.
    assert episodic.episode_score(0.8, 1.0, now, [], now) > episodic.episode_score(
        0.8, 0.0, now, [], now
    )
