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
