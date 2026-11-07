---
title: v1.11.0 — graph boost removed, decay age fallback, stale marker
tier: reference
domains:
  - changelog
audience:
  - developers
  - admin
tags:
  - v1.11.0
  - decay
  - last_verified
  - graph-boost
  - stale
  - issue-48
  - issue-49
status: active
last_updated: '2026-11-07'
version: 1.11.0
purpose: What v1.11.0 changed (issues 48 and 49) with measured before/after per
  split, the decay default change and how to opt out, and the targets that were
  missed.
load_priority: 5
estimated_read_time: 4 minutes
word_count: 633
last_validated: '2026-11-07'
backlinks: []
---

# v1.11.0 — graph boost removed, decay age fallback, stale marker

Issues #48 (graph boost, stale marker, `meta_weight`, abstention) and #49 (notes with no `last_verified` never aged). Tuning detail: [retrieval tuning guide](../operational/retrieval-tuning-guide.md). Decay: [decay guide](../operational/decay-guide.md).

## What changed

- **Graph boost removed.** The x1.3 boost for link neighbours of the top 5 semantic hits was never tuned. At 1.0 it did lookups for no effect, so the helper is deleted. Link neighbours still appear in `related` and `search_graph`.
- **Decay age fallback (default changed).** A note with no usable `last_verified` (missing, unparseable or in the future) used to rank at full weight. It is now aged by `decay.missing_last_verified`, default `git` (date of the note's last commit). Other values: `mtime`, `penalty` (flat `decay.missing_penalty`, default 0.85), `fresh`.
- **`source` in the `decay` block** (`last_verified`, `git`, `mtime`, `penalty`, `fresh`), attached whenever a fallback was used, even at multiplier 1. MCP and CLI search match.
- **Stale marker in the response text.** While an older index answers, `search_hybrid`, `search_semantic` and `search_text` start with a `[stale: ...]` line, and `search_graph` carries the same marker in its response. The CLI sets `stale: true` on hits while another process holds `index.lock`, and the vault-context hook adds a "Stale:" line. `_meta.stale` stays, but Claude Code does not show `_meta` to the model ([KB fact](../knowledge-base/facts/mcp-meta-is-not-shown-to-the-model.md)).
- **Lint** `stale` counts notes with no `last_verified` (`counts.noLastVerified`); severity unchanged.
- **Index schema 6.** One re-parse after upgrade, vectors kept; git dates are read without re-embedding.

## Upgrade note and opt-out

Existing vaults rank differently after upgrading: notes without `last_verified` now decay by their git age. To restore v1.10.0 ranking:

```yaml
decay:
  missing_last_verified: fresh
```

One difference remains even then: the CLI `search` used to skip decay and now applies it (as `search_hybrid` does), and decayed blocks gain `source`. Switching a vault to `git` needs a `--reindex`. A shallow clone dates old files at its boundary commit.

## Measured (hybrid answer @1 / @3, one run each)

| split | v1.10.0 | v1.11.0 |
|---|---|---|
| fixture train (57) | 39 / 51 | 38 / 52 |
| fixture held-out (36) | 22 / 29 | 25 / 29 |
| real train (27) | 21 / 26 | 22 / 27 |
| real held-out (27) | 13 / 22 | 15 / 23 |

Semantic arm unchanged (39 / 23 / 15 / 13). Negatives flagged unchanged: 11/12, 7/8, 12/12, 7/8. Hybrid held-out paraphrase now equals semantic (13 = 13) and is a real gate. Real-corpus differences of one case are inside HNSW noise. The 1.0 boost was chosen on train (equal to 1.1 on fixture train, 1.1 one case better on real train, noise); held-out is reported, not used.

Decay fixture (24 docs, 12 pairs; verified doc ranked first):

| split | arm | v1.10.0 | v1.11.0 |
|---|---|---|---|
| train | hybrid | 4/6 | 6/6 |
| held-out | hybrid | 6/6 | 6/6 |

`search_hybrid` mean payload on the fixture rose 3,831 to 4,575 B (the compact `decay` block on every result of a vault without `last_verified`).

## Missed targets and negative results

- **`meta_weight` stays 0.8.** 1.0 gained one case on real train (noise) and lost 1 to 2 negatives.
- **Abstention stays a single 0.36 cutoff.** 0.45 flags more negatives but falsely flags 22% / 31% / 11% of answerable questions. Two extra rules (top-1/top-2 gap, stricter BM25) added no negative within the 10% ceiling.
- **Floors lowered, each measured:** fixture-train hybrid all @1 39 to 38, exact @1 12 to 11, fixture held-out multi @3 6 to 5. Others rose.
- **Not measured on the splits:** `mtime` and `penalty` modes (unit and integration tests only). No test for the stale marker on `search_graph`.
- **Limits:** a commit that changes no bytes dates an edited note only at the next reconcile with changes.
- Answer @1 on the real corpus is still under the 0.80 goal set in v1.9.0.
