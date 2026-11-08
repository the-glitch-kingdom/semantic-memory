---
title: Usage-Feedback Ranking & Decoys — Operating Guide
tier: guide
domains: [operational]
audience: [developers, admin]
tags: [usage-feedback, usage_boost, decoys, lint_vault, selection-log, ranking]
status: active
last_updated: '2026-07-11'
version: '1.5.0'
purpose: How to operate v1.5.0 usage-feedback ranking day to day — how citations become a bounded rank boost, how it composes with decay and path-class, reading the usage block, running the decoys lint, and disabling the feature.
load_priority: 6
---

# Usage-Feedback Ranking & Decoys — Operating Guide

Usage-feedback ranking (v1.5+) closes the loop the v1.3.1 selection log opened: notes that actually get cited after being retrieved earn a bounded rank boost, so load-bearing knowledge floats up over time. It's a purely observational signal turned into a small, capped nudge — never a rewrite of the ranking, never an override of decay or path-class. This guide covers day-to-day operation; for the model and rationale see the [v1.5.0 changelog](../changelog/v1-5-0-expert-character.md).

## The one thing to know

Usage-feedback ranking only ever **boosts** (never auto-down-ranks). The complementary case — a note retrieved often but never cited — is surfaced by a lint check, `decoys`, for a **human** to judge. It is never used to silently push a note down in results. If you want a decoy note to actually rank lower, that's a manual call: revise it, archive it (which picks up the `path_class` down-weight), or just leave it — the system won't make that call for you.

## How citations become boosts

Every note's boost multiplier is:

```
multiplier = min(cap, 1 + citations × per_citation)
```

Defaults (from `vault.schema.yml`'s `usage_boost` block): `cap: 1.5`, `per_citation: 0.1`. So a note cited once is 1.1×, cited five times is 1.5× (capped — the 6th citation adds nothing further). Zero citations is an exact 1.0× no-op.

"Citations" here means every `read_note` call the server logs as a `selection` event (the code does not check that a search preceded it) — the same `selection`-kind events the v1.3.1 telemetry log (`.claude/.semantic-memory/selection.jsonl`) already records. Usage-feedback ranking doesn't add new instrumentation; it just reads that log back.

The citation snapshot is cached for 15 seconds and refreshed before each search batch, so a citation you make mid-session takes effect on your next search in the same session — you don't need to wait for a new process.

## Composition with decay and path-class

The boost is applied at the same shared rank site (`src/mcp/context.ts`) as confidence decay (v1.3) and path-class down-weighting (v1.4), and all of them compose **multiplicatively**:

```
final_score = base_score × decay_multiplier × path_class_multiplier × usage_multiplier × load_priority_boost
```

None of these signals override another. A note that's heavily cited but also stale still decays — citations don't exempt it from re-verification pressure. A note that's cited but sits under `archive/**` still gets the path-class down-weight. This is deliberate: usage feedback is one more vote, not a trump card.

`search_text` and `search_graph` are unaffected by all four of these signals — they're keyword/graph tools, not ranked-relevance tools.

## Reading the usage block

A boosted result carries a `usage` block, the same shape convention as `decay`:

```json
{
  "path": "gotchas/flaky-indexer.md",
  "score": 0.81,
  "usage": { "citations": 4, "multiplier": 1.4 }
}
```

No `usage` block means the note has zero citations (or `usage_boost` is disabled) — same convention as `decay` omitting its block for a fresh, undecayed note.

## Running the decoys lint

```
lint_vault({ checks: ["decoys"] })
```

Flags any note retrieved 3+ times (per the selection log) that was **never** subsequently read. A finding looks like:

```
retrieved 5× but never cited — decoy noise, or a note answers wrongly skip? (surfaced, not auto-down-ranked)
```

This is an opt-in check — it never appears in the default (no-`checks`) `lint_vault` report, same as `decay_candidates` and `alias_conflicts`. It's a no-op with an empty result on a fresh vault or with no selection log yet.

**What to do with a decoy finding** is a judgment call, not an automated action:
- The note might be genuine noise that keeps matching on keywords without actually answering anything — consider revising its content, retitling it, or archiving it.
- Or the retrievals that skipped it might have been *wrong* to skip it — worth reading it yourself and confirming it's actually still useful.

Either way, the system stops at "surfaced" — you decide, and if you decide to act, you act through the normal tools (`update_note`, `move_note` to archive, etc.), not through anything usage-feedback-specific.

## Disabling

```yaml
# vault.schema.yml
usage_boost:
  enabled: false
```

Reproduces byte-identical pre-v1.5 ranking. The `decoys` lint check keeps working independently of this flag — it reads the same selection log regardless of whether boosting is enabled, since it's a pure read/surface operation, not a ranking change.

## Two logs (v1.15)

`selection.jsonl` (written by the server) feeds `usage_boost`. A `--read-only` server writes it under `<vault>/.semantic-sidekick-index/` instead of `.claude/.semantic-memory/` (see the [fact](../knowledge-base/facts/read-only-server-selection-log-location.md)). `usage.jsonl` (written by the PostToolUse hook) feeds `gaps` and `usage-set` and never touches ranking. The two report different numbers; see the [search gaps guide](./search-gaps-guide.md).

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| A frequently-cited note isn't showing a `usage` block | `usage_boost.enabled: false`, or the citation snapshot hasn't refreshed yet (15s TTL) | Check the config block; re-run the search a few seconds later |
| A note I expect to be boosted has 0 citations logged | Showing up in search results ≠ being cited — only a subsequent `read_note` counts | `semantic-memory selection-stats --notes <path>` to check actual selection counts |
| The boost seems capped lower than expected | `cap` in `usage_boost` is lower than your citation count would otherwise earn | This is intentional — the cap exists to stop a feedback-runaway loop (cited → ranks higher → cited more) |
| `lint_vault({checks:["decoys"]})` returns nothing | No selection log yet, or nothing crosses the 3-retrieval threshold (`DECOY_MIN_RETRIEVALS`) | Confirm `telemetry.enabled: true` and that the vault has had real search+read activity |
| A note I think is a decoy still ranks the same | Correct — decoys are surfaced-only by design (decision Q5), never auto-down-ranked | Act on it manually if warranted: revise, retitle, or archive |

## See also

- [v1.5.0 changelog](../changelog/v1-5-0-expert-character.md) — full list of what shipped and where it lives
- [decay-guide.md](./decay-guide.md) — the other multiplicative ranking signal this composes with
- [mcp-tools-reference.md](../reference/mcp-tools-reference.md) — `search_semantic`/`search_hybrid` `usage` block, `lint_vault` `decoys` check
- [configuration-reference.md](../reference/configuration-reference.md) — the `usage_boost` schema block
- [`REGISTRY.md`](./REGISTRY.md) — tabular metadata view
