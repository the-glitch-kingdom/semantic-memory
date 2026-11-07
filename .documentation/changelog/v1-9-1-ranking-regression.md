---
title: v1.9.1 — ranking regression fix
tier: reference
domains:
  - changelog
audience:
  - developers
  - admin
tags:
  - v1.9.1
  - retrieval
  - search_hybrid
  - score-fusion
  - hnsw
  - abstention
  - issue-43
status: active
last_updated: '2026-11-06'
version: 1.9.1
purpose: "What v1.9.1 fixed after issue 43 (hybrid worse than semantic at @1), with measured before/after tables per split and the targets that were missed."
load_priority: 5
estimated_read_time: 5 minutes
---

# v1.9.1 — ranking regression fix

Fixes issue #43, a follow-up to v1.9.0 (issue #41): on a large corpus with an archive, `search_hybrid` answered worse than `search_semantic` at @1. Every root cause was verified in the code first; the retrieval guide is [here](../operational/retrieval-tuning-guide.md).

## What changed

- **Score fusion replaces rank-only RRF.** Doc-level `0.7 * cosine + 0.3 * bm25 / max(bm25)` (best chunk per doc), then the boosts; pure cosine order when BM25 returns nothing. `fuseRrf` is gone.
- **Field-aware BM25.** Each chunk is indexed with its doc's `title`, `purpose` and path tokens prepended (the returned text is unchanged). Result `title` is the doc's title, not its path.
- **HNSW `ef` raised.** `setEf(max(100, k))` on every search; hnswlib's default of 10 gave recall@24 of 0.929 on this repo's docs, now 0.999 (see the [KB fact](../knowledge-base/facts/hnswlib-ef-defaults-to-10.md)).
- **Excluded paths are not indexed.** `path_class.exclude` (default `**/archive/**`) now keeps a doc out of chunks, vectors and BM25 (v1.9.0 claimed this and did not do it). Excluded docs stay graph-only nodes so `supersedes` edges resolve. New `results.exclude` (hub files and `**/reports/link-check-*.md`) drops generated pages from results.
- **Abstention rule.** The margin term is gone from `confidence`. `no_strong_match` fires only when the best cosine is under 0.36 AND the best BM25 is under 0.8 x a per-index threshold (`bm25SelfTop` in `meta.json`, the median top score of each doc's title used as a query). `search_semantic` has no BM25 arm, so cosine alone decides. Wording is now "weak match, verify before citing", not "not documented".
- **Upgrade keeps vectors.** Old `path:chunkIndex` vectors are re-keyed to `sha256(model \0 text)` through `hnsw-meta.json`; only changed chunks are re-embedded, and the old index answers meanwhile with `_meta.stale: true`, which Claude Code does not show to the model (v1.11.0 adds a `[stale: ...]` line to the response text) (v1.7.2 and v1.9.0 formats tested).
- **Tool fixes.** `search_text` ranks by match count then density (it was alphabetical). `graph_path` takes `direction: out | in | any` (default `any`). `backlinks`/`forwardlinks` skip excluded paths unless `include_excluded: true` or `supersedes` is asked for; `graph_path` and `search_graph` also skip archived notes. `--read-only` writes nothing in the notes tree: the selection log goes to `.semantic-sidekick-index/selection.jsonl`.
- **Eval that catches this.** Held-out question sets for the fixture and the real corpus (never used for tuning), more negatives on train, a hybrid-vs-semantic gate on every split and an HNSW recall gate.

## Retrieval, before and after

Answer @1 over answerable questions; "before" is v1.9.0. Fixture is `test/fixtures/docs-vault`; real is this repo's `.documentation/` (through the production launch for the "now" real rows).

| Split | semantic @1 | hybrid @1 before | hybrid @1 now | paraphrase hybrid @1 before / now | hybrid @3 now |
|---|---|---|---|---|---|
| fixture train (35) | 22 | 23 | 23 | 9 / 9 | 31 |
| fixture held-out (23) | 17 | 13 (0.57) | 13 (0.57) | 8 / 8 (semantic 12) | 20 |
| real train (24) | 12 | 13 | 17 (0.71) | 4 / 5 | 22 |
| real held-out (24) | 10 | 13 | 11 (0.46) | 11 / 9 | 22 |

Abstention (`no_strong_match`), v1.9.0 rule -> v1.9.1 rule:

| Split | negatives flagged | answerable flagged (any rank) |
|---|---|---|
| fixture train | 12/12 -> 12/12 | 2 of 35 at @1 -> 3/35 (8.6%) |
| fixture held-out | 8/8 -> 8/8 | 4 at @1 -> 6/23 (26.1%) |
| real train | 12/12 -> 12/12 | 4 at @1 -> 0/24 |
| real held-out | 8/8 -> 7/8 | 3-4 at @1 -> 2/24 (8.3%) |

HNSW recall@24 vs exact cosine: real corpus 0.929 -> 0.999, fixture 1.000.

## Targets missed

Stated plainly, as measured:

- **answer@1 >= 0.75 not met** on the fixture held-out (0.57) or the real held-out (0.46); real train reached 0.71.
- **Hybrid is still 4 below semantic at @1 on the fixture held-out** (13 vs 17), and its paraphrase @1 is below semantic's (8 vs 12). The lexical arm is the remaining driver; fusion did not close it. Both gates run as expected failures (`it.fails`).
- **Real held-out hybrid @1 is 2 below v1.9.0** (13 -> 11), though above semantic (10) and better at @3 and @8.
- **Abstention on held-out:** fixture false flags 26% (target <= 10%), real held-out flags 7 of 8 negatives. Train meets both. Held-out was measured once after the rule was fixed on train and not tuned.
- Real-corpus numbers wobble by about one case between builds (hnswlib builds a random graph).

## Upgrading

Nothing to do. The first start after upgrade serves the old index (stale), re-parses once and re-embeds only chunks whose text changed. Offline tarball: 532 MiB.
