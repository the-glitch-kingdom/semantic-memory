# Notes: retrieval-ready-fields

## Sources
- semantic-memory#44 + correction comment (2026-11-07T05:00Z): string `symptoms` already indexed as chunks since v1.4;
  remaining: title, summary fields, object-form symptoms, frontmatter title in results. Its re-measure: +0.03 @1 from
  `purpose` on top of #43 fusion + string symptoms (0.81 -> 0.84).
- hit-em-with-the-docs#50: retrieval-field standard, templates, audits, generated artifacts.

## Verification: semantic-memory#44 (v1.9.0 main @ 448c518; #43 branch at a821dfb)
| Claim | Verdict | Where |
|---|---|---|
| No frontmatter field indexed | Partly wrong: string `symptoms` are extra chunks (vectors + BM25) since v1.4; object-form filtered out; `title`, `purpose`, `summary`, `description`, `keywords`, `tags` not indexed | `src/core/indexer.ts:107-115` |
| Result title repeats path | Confirmed (in #43 Phase 4 scope) | `src/core/vector.ts:92`, `src/core/bm25.ts:98` |
| Object symptoms shape | Issue example differs from the template: `user_phrase` is a LIST, `error_pattern` a regex, `alert_name` exact, plus `severity` | hewtd `templates/knowledge-base/playbook-symptoms.template.md` |
| Frontmatter-only edit re-embeds only that | Already true by construction (content-hash vector keys since v1.9.0); needs a test | `src/mcp/context.ts:179` |
| Body excerpt when a field matches | Gap: a winning symptom chunk becomes the snippet itself | `src/mcp/tools/search.ts` `shape()` |
- In hewtd trees, string symptoms on non-facts fail `hewtd audit`; `.documentation/operational/failure-lookup-guide.md`
  calls object-symptom indexing "a planned follow-up" and suggests tags as a workaround (tags are not indexed either).
- Short meta chunks vs BM25's min(2, query terms) rule (v1.9.0): single-term matches on short chunks are dropped.
- Overlap with #43 Phase 4: title + purpose + path tokens in BM25, frontmatter title in results.

## Verification: hit-em-with-the-docs#50 (main @ 4d9f6dd, 2.11.0)
| # | Verdict | Where |
|---|---|---|
| 1 two vocabularies | Confirmed: only optional `purpose` in schema | `src/core/metadata/schema.ts:85` |
| 2 `Documentation for <title>` fallback | Confirmed | `src/core/metadata/generator.ts:279-280` |
| 3 fact template lacks purpose/symptoms | Confirmed | `templates/knowledge-base/fact.template.md` |
| 4 string symptoms fact-only | Confirmed (#46) | `src/core/metadata/schema.ts:144-145,327` |
| 5 no retrievability audit | Confirmed; rules: naming-convention, placement, metadata-*, missing-tags, stale-content, index-drift, deprecated-not-archived | `src/core/audit/` |
| 6 generated files in tree, look like docs | Confirmed; reports hard-coded x3; indexes `tier: reference` + stock purpose | `orchestrator.ts:467`, `audit-report.ts:165`, `health-report.ts:188`; `index-generator.ts:23,28,97,102`, `incidents-index.ts:43,50`, `symptoms-index.ts:61,69` |
| 7 INDEX rows lack description | Confirmed: Document / Tier / Status / Updated | `index-generator.ts:62,134` |
Extra: placement rule reserves `reports` (`src/core/audit/rules.ts:119`); scaffold creates `reports/` (`scaffold.ts:183,197`).
hewtd release pattern: separate PR touching package.json, plugin.json, marketplace.json (2 fields), CHANGELOG.md (1e808db).

## Verification: semantic-memory#45 (main @ 448c518; #43 branch @ 9c0dfca, Phases 2-4 committed)
| Claim | Verdict | Where |
|---|---|---|
| Docs scored by best single chunk | Confirmed: vector search dedups to each doc's best chunk; #43's BM25 keeps the best chunk per doc and `fuseScores` fuses per doc | `src/core/vector.ts` (search), #43 `src/core/bm25.ts:72-99,115` |
| Doc term set and link counts are cheap | Confirmed: BM25 already tokenizes every chunk; the v1.9.0 typed graph holds outgoing link edges | `src/core/bm25.ts`, `src/core/graph.ts` |
| Guidance belongs in tool description, server instructions, skills | Skills live in this repo: `skills/semantic-first/SKILL.md` (with evals), `skills/vault-first/SKILL.md`; instructions in `serverInstructions` (`src/mcp/server.ts`) | |
| `generated: true` exclusion | Not implemented anywhere yet; already in this plan's Phase 3, extended to graph hubs/degree | |
| Per-tier CI gate | Partly exists: #43 Phase 2 added `test/retrieval-eval/real-corpus-eval.test.ts` + `real-corpus-heldout.jsonl` with per-SPLIT @1 floors in `baseline.json`; no per-tier floors, no @3 floors | #43 branch |
- The issue's constants (coverage 0.3, link prior 1.1 at >= 5 links) were chosen on its own 41 questions (7 multi-doc);
  tune ours on train, confirm on held-out.
- Field contract (comment on #44, 2026-11-07T05:18Z): title, purpose (summary/description fallbacks), symptoms
  (string | object with user_phrase string-or-list / error_pattern / alert_name; target + severity not indexed; cites as
  graph edges), tags (keywords folded in), `kind: overview` (optional, not needed for #45), `generated: true`
  (excluded from results and graph hubs), archived (excluded since v1.9.0).

## Coverage: semantic-memory `.documentation/` (139 live docs, 2026-11-06)
title 139, purpose 86, tags 78, summary 3, description 1, keywords 0, symptoms 1 (string), object symptoms 0.
Facts 17: purpose 0, symptoms 0. Generated: 25 INDEX/REGISTRY + 36 reports = 44% of the tree. Fallback purposes 0.
Duplicate titles mostly generated reports (Documentation Audit Report x9, Link Check Report x8).

## Eval results

### Phase 2 baseline (v1.9.1 code + the new field fixture and questions; nothing tuned)
Fixture additions: 14 docs (2 object-symptom playbooks, 5 purpose/summary/description/keywords docs, 2 no-field docs
each paired with a purpose-carrying competitor, 2 more no-field/competitor pairs for held-out, 1 overview doc, 2
`generated: true` files). Questions added: train 14 (4 symptom, 4 paraphrase, 2 nofield, 4 multi), held-out 13 (4
symptom, 4 paraphrase, 2 nofield, 3 multi); real corpus +3 train / +3 held-out broad multi-section questions.
Held-out questions were written with the docs, before any ranking run.

answer@1 / @3 (n) per tier, v1.9.1 ranking:

| split | arm | all | exact | paraphrase | symptom | nofield | multi |
|---|---|---|---|---|---|---|---|
| fixture train | semantic | 27/40 (49) | 10/13 (15) | 11/15 (16) | 1/1 (4) | 2/2 (2) | 3/9 (12) |
| fixture train | hybrid | 25/38 (49) | 12/13 | 7/13 | 0/1 | 2/2 | 4/9 |
| fixture held-out | semantic | 21/28 (36) | 4/5 (6) | 13/15 (17) | 1/1 (4) | 2/2 (2) | 1/5 (7) |
| fixture held-out | hybrid | 20/26 (36) | 4/5 | 12/13 | 0/1 | 2/2 | 2/5 |
| real train | semantic | 14/23 (27) | 7/9 (10) | 3/7 (8) | - | - | 4/7 (9) |
| real train | hybrid | 20/25 (27) | 9/10 | 5/7 | - | - | 6/8 |
| real held-out | semantic | 13/19 (27) | 1/2 (4) | 9/13 (17) | - | - | 3/4 (6) |
| real held-out | hybrid | 14/23 (27) | 1/4 | 10/15 | - | - | 3/4 |

Reading: the symptom tier is where fields matter (hybrid 0/4 @1 on both fixture splits; semantic 1/4); the hybrid arm
already loses to semantic on fixture paraphrase (train 7 vs 11, held-out 12 vs 13). Multi-doc @1 is 4/12 and 2/7
(hybrid) on the fixture, 6/9 and 3/6 on the real corpus. Abstention on the fixture: negatives flagged 11/12 train, 7/8
held-out; false flags 6/49 train (12%), 8/36 held-out. Fixture `search_text` (grep arm) @1 16/49. HNSW recall 1.000.
Graph: forwardlinks 1.0/1.0, backlinks 1.0/1.0 after adding the playbooks to the truth file.

Gates: `baseline.json` `tiers` floors (every tier, both arms, @1 and @3) enforced by `splitGates`; `npm run eval`
37 passed, 8 expected-fail (fixture train atOne / paraphrase / negatives / falseFlags; fixture held-out paraphrase /
falseFlags / negatives; real held-out negatives). Full `npm test` 822 passed, 8 expected-fail, 1 skipped.

### Phase 3 (index the fields): choices measured on TRAIN only
Sweeps ran `docs-eval` + `real-corpus-eval` per setting; only the train blocks were read to choose.

`meta_weight` (hybrid, train; fixture n=49, real n=27; nofield = coverage-bias check, n=2):

| meta_weight | fixture @1 / @3 | paraphrase @1 | symptom @1 | nofield @1 | negatives flagged (fixture / real) | answerable flagged (fixture) |
|---|---|---|---|---|---|---|
| 0.7 | 35 / 43 | 12 | 4/4 | 2/2 | 11/12 / 12/12 | 6 |
| 0.8 | 34 / 43 | 11 | 4/4 | 2/2 | 11/12 / 12/12 | 5 |
| 0.9 | 34 / 42 | 11 | 4/4 | 2/2 | 10/12 / 11/12 | 4 |
| 1.0 | 34 / 42 | 11 | 4/4 | 2/2 | 9/12 / 11/12 | 4 |
| 1.1 | 34 / 42 | 11 | 4/4 | 2/2 | 7/12 / 11/12 | 4 |

Accuracy is flat within one case from 0.7 to 1.1; the weight mostly moves abstention (metadata chunks of unrelated notes
raise the best cosine of a negative). Default **0.8**: the highest weight that keeps the real-train gate "every negative is
flagged" (12/12) green. Real train @1 21/27 at 0.7-1.0 (22 at 1.1). The nofield tier is 2/2 at every weight, so the
train split cannot see coverage bias; the held-out nofield tier can (below).

`error_pattern` embedded vs BM25-only (0.8): identical tables on both train splits (34/43, 21/27, same tiers), so it stays
BM25-only (regex text). `alert_name` (an exact identifier) embedded vs not: dropping it loses one symptom case (hybrid
train @1 34 -> 33, symptom 4 -> 3) and restores semantic exact @3 (12 -> 13): kept embedded.

After Phase 3 (v1.9.1 ranking + field channels, meta_weight 0.8). answer@1 / @3 (n):

| split | arm | all | exact | paraphrase | symptom | nofield | multi |
|---|---|---|---|---|---|---|---|
| fixture train | semantic | 32/42 (49) | 10/12 (15) | 12/15 (16) | 4/4 (4) | 2/2 (2) | 4/9 (12) |
| fixture train | hybrid | 34/43 | 12/13 | 11/14 | 4/4 | 2/2 | 5/10 |
| fixture held-out | semantic | 23/31 (36) | 4/5 (6) | 13/16 (17) | 3/3 (4) | 2/2 (2) | 1/5 (7) |
| fixture held-out | hybrid | 22/29 | 4/5 | 12/13 | 3/3 | 1/2 | 2/6 |
| real train | semantic | 15/22 (27) | 7/9 (10) | 3/6 (8) | - | - | 5/7 (9) |
| real train | hybrid | 21/27 | 9/10 | 5/8 | - | - | 7/9 |
| real held-out | semantic | 13/19 (27) | 1/2 (4) | 9/13 (17) | - | - | 3/4 (6) |
| real held-out | hybrid | 14/23 | 1/4 | 10/15 | - | - | 3/4 |

Versus the Phase 2 baseline (hybrid @1): fixture train 25 -> 34 (symptom 0 -> 4, paraphrase 7 -> 11), fixture held-out
20 -> 22 (symptom 0 -> 3), real train 20 -> 21, real held-out 14 -> 14. Misses, as measured:
- fixture held-out hybrid nofield @1 2 -> 1 (one no-field answer outranked by a purpose-carrying neighbour: coverage bias
  visible only on held-out; not tuned. Phase 4 tests whether the coverage boost offsets it.)
- fixture held-out hybrid @1 22 still below semantic 23 on paraphrase (12 vs 13), same gap as #43's.
- Abstention (hybrid): fixture train negatives 11/12 flagged (was 11/12), answerable false flags 5/49 = 10.2% (was 6);
  fixture held-out negatives 7/8, false flags 7/36 (was 8/36); real train 12/12 and 0 false flags; real held-out 7/8, 2/27.
  The rule (all negatives flagged, false flags <= 10%) is NOT met on fixture train/held-out and real held-out: left as
  expected-fail gates for Phase 4. Fixture-train `hybrid @1 within 1 of semantic` now passes (34 vs 32): converted to a real gate.
- `answeredFlagged` (correct @1 but flagged weak) 0 -> 3 because 9 more cases are now answered at @1, 3 of them weakly.
- Semantic fixture-train exact @3 13 -> 12 (alert_name, above).
HNSW recall 1.000. `npm run eval`: 38 passed, 7 expected-fail. Full `npm test` 834 passed, 7 expected-fail, 1 skipped; the
hook-failure Jev-hang timing test failed once under load and passed alone.
Upgrade: INDEX_SCHEMA_VERSION 4 -> 5 and the field-list hash re-parse the corpus; vectors are keyed by text, so only
metadata chunks (and string symptoms, same text, reused) embed.

### Phase 4 (coverage ranking and agent guidance): sweeps on TRAIN only, held-out read afterwards
New train questions (written for this phase, shaped like symptom / paraphrase queries; none copied from an issue): 8 on the
fixture (`q01`-`q08`: 6 paraphrase, 2 symptom). Fixture train is now 57 cases (51 answerable). Held-out untouched.

Hybrid train @1/@3 before the sweep (coverage off): fixture 39/51 (exact 12/13, paraphrase 14/20, symptom 6/6, multi 5/10,
nofield 2/2); real 21/27 (@3 27/27). Semantic arm on fixture train: 39/50, paraphrase 18/22.

Coverage and link prior (starting point: the issue's 0.3 / 1.1 / 5), hybrid, train:

| coverage_weight / link_prior / min links | fixture @1/@3 | fixture multi @1 | real @1 | real multi @1 | real paraphrase @1 |
|---|---|---|---|---|---|
| 0 / 1 / - (off) | 39/51 | 5/10 | 21 | 7/9 | 5/8 |
| 0.1 / 1 | 39/50 | 5/10 | 20 | 7/9 | 4/8 |
| 0.2 / 1 | 39/50 | 5/10 | 20 | 7/9 | 4/8 |
| 0.3 / 1 | 39/50 | 5/10 | 20 | 7/9 | 4/8 |
| 0.45 / 1 (before the new questions) | 34/44 vs 34/43 | 5/10 | 19 | 6/9 | 4/7 |
| 0.6 / 1 | 33/44 (exact 11/13) | 5/10 | 19 | 6/9 | 4/7 |
| 0.3 / 1.1 / 5 | 39/50 | 5/10 | 17 | 6/9 | 4/7 |
| 0 / 1.1 / 5 | 34/43 | 5/10 | 20 | 7/9 | 5/8 |
| 0 / 1.1 / 10 | 34/43 | 5/10 | 20 | 7/9 | 5/8 |
| 0 / 1.1 / 20 | 34/43 | 5/10 | 21 | 7/9 | 5/8 |

Reading: the issue's gain does not reproduce on our train. (1) The fixture's broad overview questions (`o01`-`o04`) are
already answered at #1 by fusion alone, and its other multi-doc cases split their facets across docs, so no single-doc
ranker can raise multi @1; the real corpus' broad questions (`x20`-`x22`) are also at #1 already. (2) Coverage costs one
real-train paraphrase @1 (`p04` flips on a 0.01 margin) and one fixture @3 at every weight 0.1-0.6, and gains nothing.
(3) The link prior is a net loss on the real corpus: link-heavy reference docs (`troubleshooting.md`, `hooks-reference.md`,
`configuration-reference.md`, `mcp-tools-reference.md`) displace the specific doc (`x05`, `x10`, `m06` fall). The issue's
warning that 0.6 over-weights checklists reproduces (exact 12 -> 11 on the fixture). Chosen defaults, by train: **coverage_weight 0,
link_prior 1, link_prior_min_links 5**: the helper (`src/core/rank.ts`, `Bm25Index.cover`) ships wired into MCP and CLI and is
a no-op until a vault opts in under `ranking:`. A unit test builds the issue's shape (an overview whose sections each match one
aspect vs a narrow doc) and shows coverage 0.3 ranks the overview first.
Held-out, read after choosing (hybrid @1/@3): fixture off 22/29, 0.3/1 22/29, 0.3/1.1 22/29 (multi 2/6 in all three); real off
14/23, 0.3/1 14/22, 0.3/1.1 13/20. Same direction as train; nothing was tuned on it.

Closing #43's held-out gaps (lexical arm, tuned on train incl. the 8 new questions):
- `COSINE_WEIGHT` 0.7 / 0.8 / 0.9: fixture train @1 39 / 41 / 42, real train @1 21 / 19 / 18. Sums equal (60), the arms pull in
  opposite directions: kept 0.7.
- BM25 field-term weight (doc-level field text scored at 0.5 and 0.25 of a body term, via a separate field tf): fixture train
  @1 39 at both (no change), real train 20 (down one); reverted, not shipped.
- `BM25_FRACTION` 0.9 / 1.0 / 1.2 and `NO_STRONG_MATCH_BELOW` 0.38 / 0.40: train negatives flagged stay 11/12 (fixture, the
  unflagged one has a high cosine) and 12/12 (real); only the answerable false flags rise (5 -> 7 -> 9). No train gain: unchanged.
  (BM25_FRACTION 0.9 would flag real held-out 8/8, but that is a held-out-only gain and is not used.)
- Result: the 8 new questions raised the answerable base, so fixture-train false flags are 5/51 = 9.8%: the gate passes and is a
  real gate now (`KNOWN["fixture-train"].falseFlags` removed). Still failing, left as expected failures: fixture train
  paraphrase (hybrid 14 vs semantic 18) and negatives (11/12); fixture held-out paraphrase / false flags / negatives; real
  held-out negatives (7/8). The lexical paraphrase gap is path-token and title matches (`ingest-pipeline` for "pipeline",
  `clock-drift-reorders-positions` for "positions") beating the body answer; no train-only knob closed it.

Negative result recorded, not built: the "answer packet" (issue #45 section 2: top-3 coverage 0.92 with and without), and the
`broad_query` flag (the read-top-3 and split-by-step guidance covers it; no measured need).
Guidance added to the `search_hybrid` description, `serverInstructions`, `skills/semantic-first/SKILL.md` and
`skills/vault-first/SKILL.md`; `test/unit/search-guidance.test.ts` pins all four; skill evals unchanged and green.
Floors raised in `baseline.json` for fixture train (hybrid all 34/43 -> 39/51, paraphrase 11/14 -> 14/20, symptom 4/4 -> 6/6;
semantic paraphrase 12/15 -> 18/21). `npm run eval`: 39 passed, 6 expected-fail.

### Phase 5 (release prep)
Offline tarball semantic-sidekick-offline-1.10.0-c8327aff08-x64.tgz: 531 MiB (556,711,236 bytes), sha256 3649d5b03e6f1cccea353694fd1ab711a08f4ce6e1ae11538f02840159948b30. Built with --allow-dirty (version bump uncommitted at build time, so manifest gitSha is c8327af). Rebuild after final commit before publishing.
Phase 5 gate: skill-eval concurrency flake under load, passed alone (22/22); lint, build, eval green.

### Phase 7 (review and validate)
Review of `git diff main...HEAD` (no defect found, so no code fix): fields feed BM25 (field text appended to every chunk, #43's design), meta vectors and the coverage term; coverage ships off (`coverage_weight` 0), so there is no active triple count, and with it on the term set is the one BM25 tokens already produced. Meta chunks never reach excerpts (the excerpt is the best body chunk; only a body-less doc excerpts its metadata). `generated: true` docs have no chunks/meta/field text and are not graph nodes (every edge type needs `hasNode`), so backlinks, forwardlinks, related, cites, tag edges, hub degree and the link prior cannot reach them (tested). Field-list change re-parses via `parserInputs`, vectors reuse by text key, so only changed metadata embeds (tested). CLI and MCP share Indexer/fields/VectorIndex/bm25Fields/applyCoverage. Known limits, not bugs: a doc with many symptoms can take several of the k nearest-neighbour slots (k = limit x 3), crowding other docs; coverage at 0.6 over-weights checklists (reproduced Phase 4).
Acceptance (integration, `test/integration/retrieval-fields.test.ts`, 5 tests): symptom-only doc top 3 with `matched.field = symptoms` and body excerpt; frontmatter title; object symptoms indexed (user_phrase string and list, alert_name; error_pattern BM25 only), target/cites/severity absent; generated never returned by search_hybrid/search_text and absent from backlinks/forwardlinks/coverage; symptom edit embeds exactly the new phrase; v1.9.1-shaped index (schema 4, old parser hash, no metadata vectors) embeds only the metadata texts and answers.
Floor gate proof: COSINE_WEIGHT 0.7 -> 0.1 in a scratch run failed 7 fixture gates, including per-tier floors; reverted.
Real corpus, before (Phase 2, #43 ranking on the same questions) -> after, hybrid @1/@3: train 20/25 -> 21/27, held-out 14/23 -> 14/23. Fixture hybrid @1: train 25 -> 39 (of 57 now; paraphrase 14/22 vs semantic 18/22, still behind), held-out 20 -> 22 (paraphrase 12, nofield 1/2).
Offline tarball (built --allow-dirty): 556,706,881 bytes; install with --prefix and `--verify`: 9987 files match. `scripts/smoke-install.sh`: PASS v1.10.0.
