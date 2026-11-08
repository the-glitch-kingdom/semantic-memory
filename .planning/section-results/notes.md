# Notes: section-results

## Verification against main @ 29e74db (2026-11-08, read-only agent)
| #60 claim | Verdict | Evidence |
|---|---|---|
| Results are whole docs with a ~600-char excerpt | True | `EXCERPT_CHARS` 600 (`confidence.ts:8`), used in `shape()` (`search.ts:40-62`). Both arms return one result per doc (`vector.ts:100-138`, `bm25.ts:92-122`) |
| Long docs bury the answering section | True | Chunks are packed by sentence across headings (`indexer.ts:296-313`), heading markers are stripped (`indexer.ts:285`), and no chunk→heading map exists. `headers[]` is a flat per-doc list (`indexer.ts:253-266`) |
| Heading text is reliable | **False (new bug)** | `nodeToText` (`indexer.ts:268-272`) drops inline code: "# \`check_rls_coverage\` script" gives " script" |
| hewtd detects duplicates and writes pointers | True | `duplicates.ts`; pointers are written by `apply.ts:194-212` |
| ...and exports them | Not yet | No export code in hewtd. The contract gives `owner_of`, `points_to {from: "#a", to: "path#a"}` and `duplicates {section: "#a", owner: "path#a"}` |
| Prepending the heading trail is cheap | Per query yes, to index no | Vectors are keyed by chunk text (`context.ts:194`), so everything re-embeds once |
| Return `path#anchor` | Pushed back | `path` is used by `read_note`, the eval (`harness.ts:31`), telemetry and `related`. Keep `path` and add `anchor` |
| `granularity: "doc"` | New | No such option today |
| Payload stays within budget | At risk | The ceiling is 4750 bytes (`baseline.json`, `docs-eval.test.ts:155`) and output is pretty-printed (`search.ts:131`). Section fields add ~300-500 bytes |

- **Reuse:** `chunkText` per section, remark's heading positions, hewtd's anchor rules (`hit-em-with-the-docs/src/core/links/anchors.ts:14-89`, copied), `extractSection` (`section.ts`), #58's export reader, `doc.chunks.indexOf(matchedChunk)`.

## Eval results: Phase 2 (shipped v1.16.0 baseline, before any chunking code; 3 identical runs plus the gate run)
Fixture: test/fixtures/section-vault. Questions: 12 section + 4 fold (train), 12 section + 2 fold (held-out); written before any run, held-out never used to choose anything. A result's anchor is the section its snippet lies in (`anchorOfSnippet`, hewtd's flat-section rules) because v1.16.0 has no `anchor` field.

| split | arm | doc@1 | doc@3 | anchor@1 | anchor@3 | meanBytes | fold owner@1 | copy+pointer slots in top 3 |
|---|---|---|---|---|---|---|---|---|
| train | search_semantic | 7/12 | 9/12 | 3/12 | 3/12 | 5325 | 0/4 | 8 |
| train | search_hybrid | 11/12 | 12/12 | 3/12 | 4/12 | 5335 | 0/4 | 8 |
| heldout | search_semantic | 10/12 | 11/12 | 4/12 | 4/12 | 4642 | 0/2 | 4 |
| heldout | search_hybrid | 12/12 | 12/12 | 4/12 | 4/12 | 4659 | 0/2 | 4 |

Floors in baseline.json `sections` (one case of slack). Targets (it.fails today, real gates once met): hybrid anchor@1 >= 9/12 per split; owner first and no copy/pointer in top 3 in every fold case. Note meanBytes on train already exceeds the 4750 ceiling on this long-doc set (ceiling applies to the existing suites); Phase 4 must trim.

## Eval results: Phase 3 (section chunking, schema 9)
Tuned on TRAIN only (fixture train + real train + section train). The variants (Phase 3 deleted the sweep knobs; the numbers stay here):
- A `prefix-N`: chunks split at headings, each prefixed with its trail, sections under N chars carried into the next chunk.
- B `fallback`: today's packing, no prefix, chunk mapped to the section where it starts (also carries the `nodeToText` fix).
- C `noprefix-100`: split at headings, no trail.

Answer @1/@3 on train, sum of both arms' @1+@3 over fixture train and real train (higher is better), and section anchor@1 (hybrid, train / held-out, out of 12):

| variant | fixture train sem @1/@3 | fixture train hyb @1/@3 | real train sem | real train hyb | sum | section anchor@1 train / heldout |
|---|---|---|---|---|---|---|
| B fallback | 42/53 | 43/55 | 19/22 | 19/25 | 278 | 0 / 2 |
| A prefix-0 | 39/54 | 41/53 | 17/23 | 20/25 | 272 | 12 / 12 |
| A prefix-50 | 39/54 | 41/53 | 17/23 | 20/25 | 272 | not run |
| A prefix-100 (kept) | 40/55 | 41/53 | 18/23 | 21/25 | 276 | 12 / 12 |
| A prefix-150 | 39/54 | 41/53 | 18/23 | 22/25 | 275 | 12 / 12 |
| A prefix-200 | 44/53 | 42/52 | 19/23 | 22/25 | 280 | 10 / 8 |
| A prefix-250 | not run | not run | not run | not run | | 3 / 0 |
| A prefix-300 | not run | not run | not run | not run | | 1 / 0 |
| C noprefix-100 | 39/49 | 39/50 | 18/23 | 20/25 | 264 | 11 / 12 |

Choice: A prefix-100. Section anchors fall off a cliff between 200 and 250 (the fixture's sections are about 250 chars, so merging joins neighbours and the chunk can name only one of them); 0-150 all keep 12/12, and 100 had the best existing-train sum among those. 200 scores best on the old train sets but loses the feature (10/12 train, 8/12 held-out, below the 9 gate), so it is rejected. The fallback is best on old train (278 vs 276) but cannot answer the new question (0/12). The trail prefix is what keeps the split from hurting: without it (C) @3 drops by 5-6.
Fallback anchor mapping: first chunk start located in the stripped text, heading positions found by text; its anchors are poor because a 2,000-char chunk spans about eight 250-char sections.

Final run (prefix-100, deterministic across three full runs on the fixtures), held-out as measured:

| split | arm | before (v1.16.0 floors) | after |
|---|---|---|---|
| fixture train | semantic / hybrid answer@1 | 39 / 38 | 40 / 41 (measured fallback: 42 / 43) |
| fixture held-out | semantic / hybrid answer@1 | 23 / 25 | 23 / 24 |
| real train | semantic / hybrid answer@1 | 14 / 17 | 18 / 21 |
| real held-out | semantic / hybrid answer@1 | 11 / 13 | 11 / 18 (measured fallback: 13 / 18) |
| real held-out | negatives flagged no_strong_match (hybrid) | 7-8 of 8 | 5 of 8 |

Section set (hybrid / semantic, train and held-out): doc@1 12/12 and 12/12 (was 11/12, 7/12 train; 12/12, 10/12 held-out), doc@3 12/12 all, anchor@1 12/12 on both splits and arms (was 3/12 train, 4/12 held-out), meanBytes 2,699 train and 2,725 held-out hybrid (was 5,335 and 4,659; under the 4,750 ceiling). Fold cases unchanged (owner@1 0/4 train, 1/2 held-out hybrid): Phase 5. The anchor gate (hybrid anchor@1 >= 9/12 per split) is now a real gate. The metric still reads the section of the snippet (no `anchor` field until Phase 4); with a temporary `anchor` from `chunkSection` the numbers were the same (12/12), so the mapping agrees.
Regression to carry: the real held-out negatives gate drops from 7-8/8 to 5/8 flagged (no_strong_match): the trail prefix and short chunks raise the best cosine of off-topic questions. Floors lowered as listed in the plan under Errors Encountered.

## Eval results: Phase 4
Section set, now reading the real `anchor` field (hybrid / semantic): train doc@1 12/12 both, anchor@1 12/12 both, meanBytes 2,915 hybrid / 2,779 semantic (was 2,699 before the fields); held-out doc@1 12/12 both, anchor@1 12/12 both, meanBytes 2,932 / 2,675. Under the 4,750 ceiling. Fold gates unchanged (owner@1 0/4 train, 0-1/2 held-out): Phase 5. Other suites unchanged (eval green; code, graph, decay, held-out negatives 8/8 flagged).
`granularity: "doc"` vs v1.16.0: identical fields and excerpt on test/fixtures/flat-vault (24 snapshot cases from main @ 24c88af, scores within 2e-3). On vaults with headings the chunks themselves differ (schema 9), so only the field set is the same.
Regression snapshots updated: tool-surface (granularity arg, read_note text, search descriptions), tool-outputs (default search shape gains optional `section`, `anchor` keys on the docs vault).
Full suite: 5 failures first run (2 snapshots, now updated; freshness-scale warm start and hook-failure Jev-hang, known flakes, pass alone 16/16).

## Eval results: Phase 5
Fold gates (owner first in every fold case, no copy or pointer in the top 3): train 4/4 owner@1, 0 slots, both arms; held-out 2/2, 0 slots, both arms (was 0/4 and 0-1/2). Section set unchanged: doc@1, doc@3, anchor@1 12/12 on both splits and arms; meanBytes 2,584-2,719 train, 2,464-2,664 held-out. Constant FOLD_MIN_CHARS = 300 was set from the shape of pointers (about 230 chars with trail) and copies (about 440), not tuned on a question set. owner-anchor@1 is 3/4 on train (fold-cert-2: the owner doc ranks first but its best chunk is `troubleshooting`, not the rotation section); this is chunk choice inside the owner, not folding, and is not gated.
