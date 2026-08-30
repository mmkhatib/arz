# arz ⇄ KiroCrew — gap specs

Successor to [`../MESHCLAW_PARITY_PLAN.md`](../MESHCLAW_PARITY_PLAN.md), which is
complete (all 10 phases shipped). MeshClaw was released publicly by AWS as
[KiroCrew](https://github.com/kirodotdev/KiroCrew) (Apache 2.0); these specs
compare arz against that public release.

| Spec | Priority | Thesis |
|---|---|---|
| [Tier 1 — Security](TIER1_SECURITY.md) | **highest** | The only tier where arz is genuinely *weaker*, not just smaller. No OS sandbox at all; ~15 deny patterns vs 137; unsigned audit log. |
| [Tier 2 — Operations](TIER2_OPERATIONS.md) | medium | No `doctor`, `logs`, or `service install`. In-flight turns don't survive restart, which contradicts a product claim. |
| [Tier 3 — Extensibility](TIER3_EXTENSIBILITY.md) | lowest | Mostly a trap — AWS wins on breadth. Build App Kit and webhooks; skip the channel treadmill. |
| [Tier 4 — Memory & Render](TIER4_MEMORY_AND_RENDER.md) | **high** | arz's memory *architecture* leads; its default *retrieval quality* trails because the default embedder is a hash fingerprint. Files panel uses heuristic detection that silently drops files. |

## The strategic point

KiroCrew drives `kiro-cli` only — fixed provider `"acp"`, model access gated on
Kiro account credentials. It is an AWS funnel product and **structurally cannot
go multi-provider.**

arz runs five providers plus local Ollama. That asymmetry is the moat: Compare
view, LLM Installer, offline operation, and cross-provider eval are all things
KiroCrew cannot ship without undermining its own reason to exist.

Close Tier 1 because "no sandbox" is a real objection. Do Tier 4 §4.1 because
it is the cheapest large quality win available. Then spend everything else on
the multi-provider story rather than chasing breadth.
