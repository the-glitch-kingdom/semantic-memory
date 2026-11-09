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

## Eval results: Phase 3 (candidate pool counts docs)

Change: `VectorIndex.search(q, k)` (`src/core/vector.ts`) returns up to k distinct docs: it doubles the HNSW neighbour fetch (cap 16 x k chunks or the live count) until k docs are found. Callers (`src/mcp/tools/search.ts` x3, `src/cli/search.ts`, graph seeds) are unchanged and all get it. BM25 already returns one result per doc (Phase 1). Unit test `test/unit/vector-doc-pool.test.ts`.

Same run, TRAIN sets only (real-corpus, real-hub, long-section, long-section-hard, multi-hub), `git clone --local`, no export, hybrid, CLI per set:

| set | 1.22.0 | local (phase 3) |
|---|---|---|
| multi-hub: multi @1/3/8 (n=19) | 3/11/13 | 3/11/13 |
| multi-hub: cov@1/3/8 | - (mcp arm .44/.80/.85) | .44/.79/.86 |
| multi-hub: exact @1 / paraphrase @1 | 3/4, 6/6 | 3/4, 6/6 |
| multi-hub: dominance | - | 4 |
| real-corpus: all@1, exact, para, multi 1/3/8 (of 9) | 20/27, 7/10, 6/8, 7/8/9 | same |
| real-hub: all@1, para, multi (of 4) | 6/12, 1/4, 2/4/4 | same |
| long-section: all@1 | 15/15 | 15/15 |
| long-section-hard: all@1, exact, para | 10/12, 3/4, 7/8 | same |
| pooled 5 sets: hyb@1 / hyb@3 / multi 1/3/8 (of 32) | 63 / 84 / 12/23/26 | 63 / 84 / 12/23/26 |
| pooled: neg flagged, #1+related | 15/22, 70 | 18/22, 70 |
| pooled dominance (mcp arm) | 13 | 20 |
| p95 ms (per set, noisy) | 27-352 | 33-327 |

multi-hub per question: mh-t26 missed -> rank 8, mh-t28 rank 8 -> missed; the rest identical. **The distinct-doc pool does not restore multi @8 on train (13 vs the 1.15.0 16).** The Phase 2 pool measurement showed expected docs missing from the 24-chunk pool on 10 of 38 questions, yet widening the pool to >= 24 docs does not bring them into the top 8: they are now candidates but lose to hubs and broad docs in fusion. Phase 4 (aggregation) is where the loss is. Held-out was not run. Dominance rose on the pooled sets (13 -> 20), for Phase 4 to look at. No 1.22.0 gain was lost.

Test run: lint, build, `npm run eval` (148 passed, 4 expected fail) green. `npm test`: freshness-scale warm start and hook-failure Jev-hang are the known load flakes (both pass alone). `single-source-snapshot` failed for real: with the wider pool a small vault returns more docs per query (the snapshot's lower-ranked scores/order for 5 of 10 queries changed; top results unchanged for the answerable ones), so its fixture `test/fixtures/federation/single-source-snapshot.json` was re-taken from this build (as for the 1.21.0 summary chunk).

## Eval results: Phase 4 (aggregation, short broad docs; train only, no code kept)

Method: one fixed index (`git clone --local` of HEAD + the three fixtures, one `--reindex`, so HNSW is identical for every row), `eval` CLI arm, hybrid, 5 TRAIN sets pooled (real-corpus, real-hub, long-section, long-section-hard, multi-hub; 95 answerable, 32 multi). Knobs were temporary env switches in `vector.ts` / `cli/search.ts`, all reverted. Held-out was not run. A run takes 6 s. Base reproduces Phase 3: @1 63/95, @3 84, exact 21/27, paraphrase 30/36, multi 12/23/26, cov .59/.84/.92, dominance 20 (troubleshooting.md), negatives flagged 18/22.

### Decomposition
| change | @1 | @3 | para | multi 1/3/8 | cov@1/3/8 | dom | neg |
|---|---|---|---|---|---|---|---|
| base | 63 | 84 | 30 | 12/23/26 | .59/.84/.92 | 20 | 18 |
| no summary chunk (`field: "doc"`) | 62 | 83 | 29 | 12/23/26 | same | 20 | 18 |
| no metadata chunks at all | 62 | 83 | 29 | same | same | 20 | 18 |
| no priority boost / no decay / no path-class (each, and all three) | 63 | 84 | 30 | same | same | 20 | 18 |
| chunk-count prior +0.01 x log2(chunks) | 61 | 84 | 29 | 11/23/27 | .55/.85/.93 | 26 | 16 |
| chunk-count prior -0.01 | 62 | 84 | 30 | 11/23/26 | .58/.84/.92 | 13 | 20 |
| chunk-count prior +0.03 | 61 | 81 | 29 | 10/22/27 | .52/.83/.93 | 35 | 16 |
| chunk-count prior -0.03 | 64 | 83 | 32 | 11/22/26 | .60/.83/.92 | 9 | 21 |

- The summary chunk is worth +1 @1 and +1 paraphrase on these sets (small, but the right sign); #73's "without metadata 51 vs 46" lead does not show here: the boosts (priority, decay, path class) change nothing at all on train (no doc carries load_priority, and the eval tree has no decayed or classed docs that compete). Fold was not toggled (it only merges copies).
- A length prior is a trade, not a fix. A penalty for many-chunk docs (-0.03) halves dominance (20 -> 9) and gains +1 @1 / +2 paraphrase, but costs multi @1 (12 -> 11) and @3, and on real-corpus alone multi@1 9 -> 8 and cov@1 .81 -> .73; a bonus does the opposite. It is not one of the plan's candidates and moves no multi @8, so it is not kept; recorded as a lead.

### Candidates (best chunk per doc is the current (a))
| variant | @1 | @3 | para | multi 1/3/8 | cov@1/3/8 | dom | neg |
|---|---|---|---|---|---|---|---|
| (a) best chunk, current | 63 | 84 | 30 | 12/23/26 | .59/.84/.92 | 20 | 18 |
| (b) +0.005 / .01 / .02 / .04 when a 2nd chunk is within 0.9 of the best | 62/63/63/62 | 84 | 30/31/31/31 | 11/23/26 (.04: 10) | .55 (.52) | 20-23 | 17/17/16/16 |
| (b) +0.02, strong = 0.8 / 0.95 | 63/63 | 84 | 31/30 | 11/23/26, 12/23/26 | .55, .58 | 23, 21 | 16, 18 |
| (b2) +0.02/.05/.1 x (2nd + 3rd chunk cosine) | 64/64/63 | 84/84/83 | 31 | 12/23/26 (.1: 11) | .58/.58/.55 | 20/21/23 | 17/16/16 |
| (b3) +0.01/.03 x chunks within 0.85 of best (max 3) | 63/62 | 84 | 31 | 11/23/26, 10/23/27 | .56, .52 | 22, 26 | 17, 16 |
| (c) single-chunk dampener x(1-0.02/.05/.1/.2) | 63 | 84 | 30 | 12/23/26 | .59/.84/.92 | 20/20/21/21 | 18 |

**None beats (a), so (a) stays and no code changes.** (b) never moves multi @8 and raises dominance and lowers negatives flagged (long docs gain); the best (b2, +0.02) is +1 @1 / +1 paraphrase against -1 negative flagged, inside the one-case noise. (c) is a no-op: dampening one-chunk docs changes nothing, so the short broad vocabulary docs are not what crowds the multi questions on this tree.

### Where the multi @8 loss is
The 4 lost train questions (mh-t05, t11, t26, t27) are vague, many-topic questions on a 141-doc tree with real-corpus noise. For t05 the CLI gives the expected hub at rank 8+, behind `operational/skill-loop.md`, `troubleshooting.md`, `long-section-hard/halloran-press.md`, `architecture-layers.md`; t27 ranks the expected hubs 1, 6, 8, with `drift-detection.md`, `release-process.md`, `indices-and-storage.md` between them. Per-doc score aggregation cannot restore them: the doc is not scored low, the 1000-char hub chunks are each narrow and no single one matches a question that spans 3-4 facets (a 1.15.0 hub was 4-5 big chunks whose embedding covered the whole doc), so unrelated real docs with one loosely matching chunk win. Semantic-only multi @8 is 11 against hybrid 13 on multi-hub: the lexical arm already recovers what it can. A real fix would need something other than a bigger bonus for the best chunks (for example a doc-level vector, or a facet-splitting query step), which is out of this plan's scope and Phase 5 (export path) does not target it.

### Dominance
| set | doc | slots (top 3, questions it does not answer) |
|---|---|---|
| multi-hub train | `architecture/indices-and-storage.md` | 4 (3 with the -0.03 prior) |
| real-corpus + real-hub train | `troubleshooting/troubleshooting.md` (38 KB real catch-all) | 18 (9 with the -0.03 prior) |
| 5 train sets pooled | `troubleshooting.md` | 20 |

The plan's "<= 3 on train and real-corpus" is missed: 4 on multi-hub, 18 on real-corpus. The real-corpus number is a real long doc that matches many operational questions; every release has it (31 on 1.15.0, 38 on 1.21.0, 34 on 1.22.0, all 8 sets). An absolute 3 cannot be gated on this tree, so Phase 6 should gate dominance on the multi-hub sets against the previous release (not above it by more than 1), not on an absolute 3 over the real corpus.


## Eval results: Phase 5 (export path)

Method: TRAIN sets only (real-corpus, real-hub, long-section, long-section-hard, multi-hub), `git clone --local`, hybrid, CLI per set, then `eval --via mcp`. Held-out not run.

Two separate indexes (HNSW random) differ by noise, so the cause was isolated on ONE index (export tree) with `.hewtd/graph.json` toggled:

| arm (same index) | all@1/@3/@8 | multi 1/3/8 (of 32) | exact @1 |
|---|---|---|---|
| export present | 63 / 80 / 89 | 10/20/27 | 23 |
| graph.json moved away | 63 / 84 / 88 | 12/23/26 | 21 |
| export, duplicates + points_to stripped (no fold) | = export present | | |
| export, symbols emptied | = export present | | |
| export, docs table emptied | = no export | | |
| export, `decay.code.enabled: false` / `dead_penalty` 1 / 0.99 | 64 / 84 / 88 | 12/23/26 | 22 |

Not fold, entity cards or `related`: only the grounding multiplier from export dead refs. With the export, 33 docs carry x0.857 (3+ dead refs) against 12 docs at x0.95 from the fallback, including the reference docs the questions answer from; the dead refs are runtime paths (`.claude/.semantic-memory/`, `.semantic-sidekick-index/`) and bare names (`manifest.json`, `docs.cache.json`), which the span fallback never flags. 1.15.0 has no grounding (export identical to no export); it dates from 1.16.0.

Fix (`src/core/code-graph.ts` `dropNonDead`, called from `loadCodeData`, so MCP and CLI share it): an export dead file ref counts only when it has a `/` under a top folder git tracks and is not git-ignored. Measured variants: ignored-only 62/80 (worse), shaped-only 64/82 multi 12/21/26, both 64/83 multi 12/22/26.

After the fix, script run, local build, train sets pooled:

| arm | hyb@1 / hyb@3 | multi 1/3/8 | cov@1/3/8 | dom | neg flagged | p95 |
|---|---|---|---|---|---|---|
| no export, CLI = MCP | 63 / 84 | 12/23/26 | .59/.84/.92 | 20 | 18/22 | 19-22 ms |
| export, CLI = MCP | 64 / 83 | 12/22/26 | .60/.83/.92 | 19 | 18/22 | 18-20 ms |

Export is within one case of no export on every count (was -4 @3, -2/-3 multi). CLI and MCP agree on every count. Missed: the export still differs by one case at @3 and multi @3 (real dead refs remain flagged; that is intended).

Side finding fixed: `save()` in `src/mcp/context.ts` cleared `dirty` after the commit, so a change landing during the write (grounding from the code graph) was never saved and the CLI, which reads the cache, missed it. Now cleared before the write. `graph-eval` waits for the debounced save (it was racing it).

## Eval results: Phase 6
`npm run gate:release` (local vs 1.23.0, 6 held-out sets incl. multi-hub-heldout, no export + slow git, then export). Runtime 3m17s (~6 min estimated in the script header). Result FAIL.

| arm | hyb@1 local/1.23.0 | multi @1/@3/@8 local | multi 1.23.0 | cov@3 | dominance |
|---|---|---|---|---|---|
| no export | 71/71 | 10/16/20 | 10/17/21 | .773/.776 | 34/32 |
| export | 70/75 | 10/17/20 | 10/17/21 | .784/.776 | 28/23 |

Export per set hyb@1 (local vs 1.23.0): real-corpus-heldout 14/17, real-hub-heldout 6/6, long-section 14/14, long-section-hard 10/10, absent-terms 15/16, multi-hub 11/12. Failures: export hyb@1 -5, dominance +2 (no export) and +5 (export). mcp = cli, titles complete. Dominance and cov of 1.23.0 come from its mcp arm only.
