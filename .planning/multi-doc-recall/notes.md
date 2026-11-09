# Notes: multi-doc-recall (#76)

## Phase 1: verification (main @ 066c730, v1.22.0)

### Same-run measurement on this repo
`scripts/eval-against-release.sh`, `git clone --local` trees, all 8 in-repo sets (real-corpus, real-hub, long-section and long-section-hard, each train and held-out; 129 answerable, 23 multi). Hybrid; CLI and MCP agree on every row.

| version | all @1 | multi @1 | multi @3 | multi @8 |
|---|---|---|---|---|
| 1.15.0, no export | 94 | 14 | 18 | 22 |
| 1.21.0, no export | 90 | 14 | 20 | 23 |
| 1.22.0, no export | 97 | 16 | 21 | 22 |
| 1.15.0, export | 94 | 14 | 18 | 22 |
| 1.21.0, export | 94 | 16 | 20 | 23 |
| 1.22.0, export | 99 | 14 | 19 | 22 |

**The multi-doc regression did not reproduce here.** 1.22.0 is at or above 1.15.0 at every depth. These multi questions have 2 facets each, and this repo has no long "operator notes" hub docs or short broad vocabulary docs. That shape is what the reporter describes, so Phase 2 must build it.

### Mechanism confirmed in code (matches the reporter's hypothesis 1)
- `src/core/vector.ts` `search(q, k)` asks HNSW for k nearest **chunks**, then groups them by doc (best body chunk, best metadata chunk). The number of distinct docs returned is therefore at most k, and is smaller whenever one doc owns several of the k chunks.
- Callers pass `limit * 3`: `src/mcp/tools/search.ts:119` and `:172`, `src/cli/search.ts:156`. Graph seeds pass `GRAPH_SEARCH_SEEDS * 3`.
- Chunk counts rose twice since 1.15.0:
  - schema 9 (`d677a76`, 1.16): chunks split at headings;
  - schema 11 (`d5ff988`, 1.22.0): 1000-character windows. On this repo, 1113 chunks became 1326.
  A long hub doc with many sections near the query now fills more of the 24 neighbour slots. That leaves fewer distinct docs for fusion and the top 8, which is the multi @8 loss.
- BM25 (`src/core/bm25.ts`) already returns one result per doc (its best chunk), so the shrink is semantic-arm only.

### Other candidates (unmeasured, for Phase 4/5)
- Summary chunk (`5b7d7a9`): a doc scores max(best section, summary). A short doc is one chunk and its summary, so both match broadly. This may explain the reporter's "vocabulary doc in the top 3 of 4-5 questions".
- #73's open lead: without doc metadata, hybrid @1 was 51 against 46. Priority, decay, path class or fold costs about 5 @1 on real-corpus, and this has not been decomposed.
- Export path: grounding, `related`, duplicates or fold may push exact-term hub docs down (the d1b-only C14 and C22).

### Raw logs
Scratchpad only: `r76-noexp.log` and `r76-exp.log`, with per-question JSON under `g76n/` and `g76e/`.

## Eval results: Phase 2 (reproduce, no fix)

Same run: `scripts/eval-against-release.sh` with `GATE_TMP` kept, `git clone --local` per version, 8 sets (the 6 in-repo real-corpus/real-hub sets plus `long-section-hard*` and the new `multi-hub*`), CLI and `eval --via mcp --settle`, no export and `--export`. The per-set numbers below come from `eval` re-run per set on the same kept trees (multi-hub train, held-out, long-section-hard, all 8 together). Hybrid arm. HNSW is random per build, so one case of noise per row is normal.

### The fixture and the sets
- `test/fixtures/multi-hub/`: 20 docs, 141 docs in the whole eval tree. 5 operator-notes hubs (ingest, billing, identity, release, storage; 8.0-8.4 KB, 7.96 KB for storage; 10-12 H2 sections each; 21-27 chunks each at schema 11, 4-5 at schema 7), 10 one-facet narrow docs (1.4-2.2 KB), 5 short broad vocabulary docs (glossary, service picklist, on-call contacts, checklists index, environment names; one chunk each). Exact env-var names (`INGEST_SHARD_FANOUT_LIMIT`, `BILLING_DUNNING_MAX_ATTEMPTS`, `SESSION_IDLE_REAPER_SECONDS`, `CANARY_HOLD_MINUTES`, `COMPACTION_WINDOW_UTC`) appear only in a hub. Hubs are 8 KB, at the bottom of the plan's 8-15 KB band.
- `multi-hub.jsonl` (train) and `multi-hub-heldout.jsonl`: each 29 questions: 19 multi (3-5 facets; 12-14 first written, 5 more added after a first measurement, see below), 4 exact-term-in-hub, 6 paraphrase controls. Own wording and ids (`mh-*`); none from the reporter. All facets were checked by `test/retrieval-eval/multi-hub-fixture.test.ts` before and after measuring: each facet regex matches only the docs listed as `expected`, no non-exact question contains a facet.
- First version had 14 multi per set. It reproduced a loss (train multi@8 13 vs 11, held 12 vs 11) but only by 1-2 cases, too near the noise band to gate on. Before any change to search I added 5 hub-heavy multi questions per set (cross-hub, 4 facets, 4 docs, shared vocabulary: limits, keys, retention, quiet windows, owners; held-out: slowdowns, clocks, restart habits, dashboards, sign-offs). They were written and facet-checked before they were run, and the 5 train ones do not steer any constant (nothing is tuned in this phase).

### Metrics added
`cov@k` (mean fraction of a multi question's facets found in the top 1/3/8, and of its `expected` docs) and `dominance` (most top-3 slots any one doc takes on questions it does not answer, meaning it matches none of the question's facets) are in `ArmMetrics` (`src/core/retrieval-eval/metrics.ts`), `eval --json`, the text report and the `eval-against-release.sh` table (`multi@1/3/8`, `cov@1/3/8`, `dom`). A release before 1.24.0 has no `cov`/`dom` in its own CLI arm (shown `-`); its `mcp` arm is driven by this checkout, so it has them. The first dominance definition counted every top-3 slot, and so counted a hub on the questions it answers; it was replaced before the final numbers.

### Candidate pool (limit 8 -> the 24 nearest chunks), multi-hub sets, no export
`scratchpad/pool.mjs` reads each version's `hnsw.bin` and embeds the questions with the index's own model; HNSW at ef 100.

| version | schema | chunks | hub chunks (5 hubs) | distinct docs in the 24-chunk pool, multi mean / min | hub slots of 24 (mean) |
|---|---|---|---|---|---|
| 1.15.0 | 7 | 543 | 5,5,5,4,5 | 15.4 / 11 | 10.2 |
| 1.21.0 | 10 | 1514 | 27,21,25,26,25 | 9.3 / 3 (first 14 multi) | 12.5 |
| 1.22.0 | 11 | 1724 | 27,21,25,26,25 | 10.3 / 3 | 11.3 |
| 1.23.0 | 11 | 1724 | same | same as 1.22.0 | |

The pool shrinks from about 15 docs to about 10, with one question left at 3 docs. In 1.22.0 and 1.23.0 the expected docs of 10 of the 38 multi questions are not all in the pool, against 5 in 1.15.0 (e.g. mh-t27 4/4 -> 2/4 and mh-h27 4/4 -> 1/4). Chunks per doc are in the table (hubs: 4-5 -> 21-27).

### Multi-hub sets: multi @1/@3/@8 (n=19), cov facets @1/@3/@8, no export (CLI and MCP agree on every count; export differs only by one case, noted)

| version | train multi | train cov | held multi | held cov | train/held exact @1 | train/held paraphrase @1 |
|---|---|---|---|---|---|---|
| 1.15.0 | 3/11/16 | .46/.83/.94 | 3/9/13 | .40/.76/.90 | 4/4, 3/4 | 5/6, 5/6 |
| 1.21.0 | 3/11/16 | .44/.81/.92 | 3/9/12 | .39/.71/.86 | 3/4, 4/4 | 6/6, 4/6 |
| 1.22.0 | 3/11/13 | .44/.80/.85 | 3/9/12 | .39/.71/.85 | 3/4, 4/4 | 6/6, 4/6 |
| 1.23.0 | 3/11/13 | .44/.80/.85 | 3/9/12 | .39/.71/.85 | 3/4, 4/4 | 6/6, 4/6 |
| local | 3/11/13 | .44/.80/.85 | 3/9/12 | .39/.71/.85 | 3/4, 4/4 | 6/6, 4/6 |

With export: train 3/11/16 (1.15.0, 1.21.0) then 3/11/13 (1.22.0, 1.23.0, local); held 3/9/13 then 3/9/12. Same.

**The multi @8 loss reproduces.** 1.15.0 -> 1.22.0: train -3 of 19 (16 -> 13), held-out -1 (13 -> 12), cov@8 -.09 (train) and -.05 (held-out). The lost questions on train are mh-t05, t11, t26 and t27 (all at @8 in 1.15.0, none in the top 8 now); on held-out mh-h01. Across all 8 sets (61 multi): multi @8 is 51 (1.15.0) -> 51 (1.21.0) -> 47 (1.22.0, 1.23.0 and local), with and without export. The held-out loss of 1 is within the noise band and cannot gate alone; the train loss and the aggregate (-4 of 61) can. It is smaller than the reporter's, who gave no number for 1.15.0 on their tree beyond the >= 12/14 target.
**Not reproduced: multi @1.** It is 3/19 on every version, so the reporter's "@1 >= 5/14" target gives nothing to restore here; multi @1 asks one doc to hold every facet, which only the single-hub questions can do.
**Multi @3 does not move** (11 train, 9 held-out, every version). Phase 3's measure is therefore @8 and `cov@8`.
- `dominance` (doc with the most top-3 slots on questions it does not answer), multi-hub train / held-out: 1.15.0 5 (ingest-operator-notes) / 4; 1.21.0 3 / 6; 1.22.0-local 4 / 5 (a real-corpus doc such as indices-and-storage.md or capture-workflows.md, not a fixture doc). The plan's target (<= 3) is exceeded by every version on the full real tree: on all 8 sets it is 31 (1.15.0), 38 (1.21.0), 34 (1.22.0 and later) top-3 slots for `troubleshooting.md`, a doc this repo's own sets answer often, so this number is dominated by the real corpus, not by a vocabulary doc. The fixture's own short broad docs (glossary, picklist, contacts, checklists index, environment names) are not the dominant doc on either multi-hub set. This part of the reporter's report does not reproduce here.
- Exact-term-in-hub questions: @1 is 4/4 on train in 1.15.0 and 3/4 from 1.21.0 (mh-t18 `CANARY_HOLD_MINUTES` 1 -> 3), held-out 3/4 in 1.15.0 and 4/4 after. At @3 all are answered. So the exact-term loss (H14, C22) does not reproduce either.
- Paraphrase controls @1: 1.22.0 is at or above 1.15.0 on train (6 vs 5); held-out 4 vs 5 (mh-h23).

### Long-section-hard and all sets (hybrid, mcp arm; no export, export identical)
| version | long-section-hard all@1 | exact@1 | paraphrase@1 (n=17) | all 8 sets: hyb@1 / multi 1,3,8 / exact@1 / paraphrase@1 |
|---|---|---|---|---|
| 1.15.0 | 23/24 | 6/7 | 17 | 90 / 20,38,51 / 28 / 42 |
| 1.21.0 | 15/24 | 3/7 | 12 | 83 / 21,40,51 / 24 / 38 |
| 1.22.0 | 20/24 | 6/7 | 14 | 90 / 22,40,47 / 26 / 42 |
| 1.23.0, local | 20/24 | 6/7 | 14 | 90 / 22,40,47 / 26 / 42 |

(export, all 8: 1.22.0, 1.23.0, local 93 / 20,39,47 / 28 / 45; 1.15.0 90 / 20,38,51 / 28 / 42; 1.21.0 88 / 22,40,51 / 25 / 41.) These sets' numbers on 1.22.0 are the ones to hold in Phases 3-6: all@1 90 (no export) and 93 (export), multi @8 47 and long-section-hard paraphrase @1 14. On the long-section-hard set alone 1.15.0 is above 1.22.0 (23 vs 20 @1): the 1.22.0 gains show on the real-corpus sets and the paraphrase total, not here; recorded as measured, not investigated in this phase.

### p95 (ms, hybrid, per-run, single laptop, runs overlapped): 17-329 ms across all runs (the 329 is one cold 1.21.0 run); typically 25-90. No cost signal to compare yet.

### Honest answers to the Phase 2 checklist
- Fixture shaped like the reporter's tree: built, with the multi-section hubs, narrow docs, short broad docs and hub-only env-var names. Hubs are 8 KB (the low end of the band).
- Pool measured for 1.15.0, 1.21.0, 1.22.0 (and 1.23.0): 15.4 -> 10.3 distinct docs, hub chunk counts 5 -> 21-27.
- Baseline: 1.15.0, 1.21.0, 1.22.0, 1.23.0 and local, same run, CLI and MCP, with and without export: done. The stdio (MCP) arm shows the same @8 loss as the CLI arm in every row.
- The multi @8 loss reproduces on train (-3) and in aggregate (-4 of 61), and only marginally (-1) on held-out. @1, exact-term and dominance claims of the report do not reproduce on this fixture.
- Raw logs and per-question JSON: scratchpad only (`r76p2-*.log`, `p2n/`, `p2e/`, `split/`).
