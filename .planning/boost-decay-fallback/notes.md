# Notes: boost-decay-fallback (#48, #49)

## Verification (main @ 0c2b445, v1.10.0)

Posted: #48 https://github.com/the-glitch-kingdom/semantic-memory/issues/48#issuecomment-6710960326,
#49 https://github.com/the-glitch-kingdom/semantic-memory/issues/49#issuecomment-6710960536

### #48
| Finding | Verdict | Where |
|---|---|---|
| `GRAPH_BOOST` 1.3 before fusion | Confirmed. MCP and CLI share the helper. Never tuned: the #43 train sweep gave fixture 23/23/23 and real 18/18/17 for off / 1.1 / 1.3, and 1.3 was kept | `src/core/graph-boost.ts:3`, `src/mcp/tools/search.ts:183`, `src/cli/search.ts:135` |
| `meta_weight` 0.8 | Confirmed. Chosen as the highest value that kept every real-train negative flagged at the 0.36 cutoff | `src/core/fields.ts:25` |
| `NO_STRONG_MATCH_BELOW` 0.36 | Confirmed | `src/core/confidence.ts:5` |
| No stale marker | Partly. `_meta.stale: true` is set (`src/mcp/server.ts:43`), but `_meta` is not shown to the model in Claude Code | |

### #49
| Finding | Verdict | Where |
|---|---|---|
| Missing `last_verified` fails open (×1.0) | Confirmed. Unparseable and future dates fail open too | `src/core/decay.ts:100-105` |
| Fail-open case invisible to the agent | Confirmed. The `decay` block is attached only when the multiplier is below 1 | `src/mcp/context.ts:569-581` |
| Lint `stale` skips notes with no `last_verified` | Confirmed | `src/core/schema.ts:141` |

This repo's `.documentation/` (146 live docs): `last_verified` 18, `last_validated` 17 (stamped by hewtd for
frontmatter validation; not verification), `last_updated` on all of them.

Existing pieces to reuse:
- `Indexer.resolveMtime` (`src/core/indexer.ts:180`): `last_updated` → `updated` → `date` → `lastmod` → file mtime,
  stored as `doc.mtime`.
- `spawnSync` is already used for git in `src/core/skill-land.ts:46`.

## #48 constant sweep (v1.10.0, hybrid, one run each)

Files: `/tmp/claude-1000/.../scratchpad/sweep48/`. Config is boost / meta_weight / no-strong-match cutoff. "neg" is
negatives flagged; "ff" is answerable false flags.

| config | fx train @1 (57) | fx held @1 (36) | real train @1 (27) | real held @1 (27) |
|---|---|---|---|---|
| 1.3 / 0.8 / 0.36 (shipped) | 39 · neg 11/12 · ff 5 | 22 · neg 7/8 · ff 7 | 21 · 12/12 · 0 | 13 · 7/8 · 2 |
| 1.0 / 0.8 / 0.36 | 38 · 11/12 · 5 | **25** · 7/8 · 7 | 22 · 12/12 · 0 | 14 · 7/8 · 2 |
| 1.0 / 1.0 / 0.36 | 38 · 9/12 · 4 | 23 · 6/8 · 5 | 23 · 11/12 · 0 | 14 · 6/8 · 2 |
| 1.1 / 1.0 / 0.36 | 38 · 9/12 · 4 | 22 · 6/8 · 5 | 23 · 11/12 · 0 | 14 · 6/8 · 2 |
| 1.0 / 1.0 / 0.45 | 38 · 12/12 · 11 | 23 · 8/8 · 9 | 23 · 12/12 · 3 | 14 · 7/8 · 2 |
| 1.1 / 1.0 / 0.45 | 38 · 12/12 · 11 | 22 · 8/8 · 9 | 23 · 12/12 · 3 | 14 · 7/8 · 2 |

Tier detail for boost 1.0 vs shipped:
- Fixture held-out: paraphrase 12 → 13 (= semantic 13), symptom 3 → 4, nofield 1 → 2, multi @3 6 → 5.
- Fixture train: exact 12 → 11.
- Gates that fail at boost 1.0:
  - fixture train all @1 floor (39)
  - fixture held-out multi @3 floor (6)
  - per-arm baseline
  - the `it.fails` "fixture held-out hybrid paraphrase ≥ semantic", which now passes (good)

## Eval results
(per phase)

### Phase 2: Eval first (shipped v1.10.0 ranking, no ranking or decay change)
Existing splits with the temp-vault git history added (all docs committed 10 days ago): unchanged, hybrid @1 =
fixture train 39/57, fixture held-out 22/36, real train 21/27, real held-out 13/27 (semantic 39 / 23 / 15 / 13).
Reference sweep (#48 table, shipped row) still stands; baseline.json floors untouched.

Decay fixture (`npm run eval`, `decay-eval.test.ts`; answer doc ranked first; 12 questions written before any run):
| split | arm | all | unverified twin | 400-day-verified twin (control) |
|---|---|---|---|---|
| train | semantic | 4/6 | 2/4 | 2/2 |
| train | hybrid | 4/6 | 2/4 | 2/2 |
| held-out | semantic | 5/6 | 3/4 | 2/2 |
| held-out | hybrid | 6/6 | 4/4 | 2/2 |

Reading: the control always passes (400-day `last_verified` decays today). The unverified twin wins about half the time on
train (fail-open, coin flip between near-identical docs). Held-out hybrid happened to win 4/4 at baseline by chance, so it
is a real gate from the start (it will catch a regression); only train carries the `it.fails` gate that Phase 4 flips.
Age source per result: `decay` blocks are absent at baseline (no `source` yet; none attached at multiplier 1), the eval
records `decay.{multiplier,source}` per result path (`ArmResponse.decay`) and prints the sources seen (`sources=[]` now).
Full suite: lint, build, eval green; one known flake (hook-failure Jev-hang timing) passed alone 14/14.

### Phase 3: GRAPH_BOOST 1.0 (hybrid @1 / @3, one run each)
| split | shipped 1.3 | 1.0 | 1.1 |
|---|---|---|---|
| fixture train (57) | 39 / 51 | 38 / 52 | 38 / 52 |
| fixture held-out (36) | 22 / 29 | 25 / 29 | 24 / 28 |
| real train (27) | 21 / 26 | 22 / 27 | 23 / 27 |
| real held-out (27) | 13 / 22 | 14 / 23 | 14 / 22 |

Train re-check (the only choice input): 1.0 = 1.1 on fixture train, 1.1 is +1 on real train (noise). 1.0 kept; held-out
reported as measured (not used). Semantic arm unchanged everywhere. Hybrid held-out paraphrase 13 = semantic 13.
Negatives flagged: fixture train 11/12, held-out 7/8, real train 12/12, held-out 7/8 (unchanged). Answerable false
flags (fixture train / held-out): 5 / 7 at 1.3, 5 / 7 at 1.0 per the eval's `answerable` column.
Decay fixture: unchanged from Phase 2 (train hybrid 4/6, held-out 6/6).

### Phase 4: decay fallback `git` (default), hybrid @1 / @3, one run each
| split | Phase 3 (fail open) | Phase 4 `git` |
|---|---|---|
| fixture train (57) | 38 / 52 | 38 / 52 |
| fixture held-out (36) | 25 / 29 | 25 / 29 |
| real train (27) | 22 / 27 | 22 / 27 |
| real held-out (27) | 14 / 23 | 15 / 23 |
Semantic arm unchanged (39 / 23 / 15 / 13). Negatives flagged unchanged: 11/12, 7/8, 12/12, 7/8. No split dropped. The eval docs all share one
10-day-old commit, so they all take the same ~0.98 multiplier (that is what the history was built for); real held-out +1 is inside the
1-case HNSW noise. docs-vault `meanBytes` 3831 -> 4575 (ceiling raised, see Errors).

Decay fixture (answer ranked first), unverified twin is 800 days old in git:
| split | arm | all | unverified twin | 400-day-verified twin | Phase 2 baseline (all) |
|---|---|---|---|---|---|
| train | semantic | 6/6 | 4/4 | 2/2 | 4/6 |
| train | hybrid | 6/6 | 4/4 | 2/2 | 4/6 |
| held-out | semantic | 6/6 | 4/4 | 2/2 | 5/6 |
| held-out | hybrid | 6/6 | 4/4 | 2/2 | 6/6 |
Sources seen: `last_verified`, `git`. The train `it.fails` is now a real gate; a new gate asserts the twin's block names `git`.
Not measured: `mtime` and `penalty` on the splits (the fixture history is built for git; both covered by unit and integration tests).

### Phase 5: `meta_weight` and abstention (train chose; held-out reported as measured; shipped code, boost 1.0, decay `git`)
Method: scratch dump of per-query top cosines, BM25 and the weak flag from `search_hybrid` (reverted, nothing kept), then offline analysis. `meta_weight` run
twice (0.8, 1.0). "Metadata-rich" = every doc that matches any facet of the case carries `purpose` or `symptoms` in its frontmatter
(fixture train 11 of 57 answerable cases, real train 18 of 27).

`meta_weight` (hybrid, train only):
| split | subset | 0.8 @1 / @3 | 1.0 @1 / @3 | negatives flagged 0.8 / 1.0 | answerable false flags 0.8 / 1.0 |
|---|---|---|---|---|---|
| fixture train | all 57 | 38 / 52 | 38 / 51 | 11/12 / 9/12 | 5 / 4 |
| fixture train | metadata-rich 11 | 11 / 11 | 11 / 11 | | |
| real train | all 27 | 22 / 27 | 23 / 27 | 12/12 / 11/12 | 0 / 0 |
| real train | metadata-rich 18 | 14 / 18 | 15 / 18 | | |
Reading: 1.0 gains 1 case @1 on real train (inside the 1-case noise) and nothing on the fixture's rich subset, and loses 1 and 2 negatives (the
abstention cost seen in the #48 sweep). 0.8 stays. Held-out as measured (not used): @1 0.8 vs 1.0 = fixture 25 vs 23 of 36, real 15 vs 15 of 27;
negatives 7/8 vs 6/8 on both. Doc guidance to write: 0.8 was best or equal on every split here; raising it is only worth trying on a corpus
whose notes carry good `purpose`/`symptoms` and where missed answers cost more than a missed "no match"; re-measure with the abstention eval.

Abstention (train only; ceiling: answerable false flags <= 10%, i.e. <= 5 of 57 and <= 2 of 27). Baseline: negatives 11/12 and 12/12, false flags 5/57 and 0/27.
Only one more negative can be won (fixture train 11 -> 12; real train is already 12/12).
| rule | fixture train neg / ff | real train neg / ff |
|---|---|---|
| shipped: cos < 0.36 and BM25 weak | 11 / 5 | 12 / 0 |
| single cutoff 0.45 | 12 / 14 (25%) | 12 / 3 (11%) |
| A gap: also weak if cos < T and top1-top2 cosine gap < g (T 0.40-0.55, g 0.01-0.05, 16 pairs) | 11 in every pair; ff 5-12 | 12; ff 0-1 |
| B lexical: also weak if cos < T and best BM25 < f x bm25Min (T 0.40-0.50, f 0.25-0.75, 9 pairs) | 11 in 8 of 9; 12 only at T 0.45 f 0.75 (ff 12) and T 0.50 f 0.75 (ff 19) | 12; ff 0-2 |
Result: negative. No rule flags the missing negative while keeping fixture-train false flags <= 5; the closest (B, T 0.45, f 0.75) reaches 12/12 with
12/57 false flags (21%). Rule A never adds a negative. Shipped 0.36 kept. Held-out as measured for the shipped rule: fixture 7/8 negatives, 7 false flags
of 36 answerable; real 7/8, 2 of 27 (the existing KNOWN held-out gates); single 0.45 would give fixture 8/8 with 10 false flags, real 7/8 with 2.

### Phase 8: review and validation
Review of `git diff main...HEAD` (adversarial). Findings:
- Per-query git: none. `gitCommitDates` is only called from `sync()` in context.ts, once per build or per reconcile that has changes (gated on docs that need a date). Test spies a `git` on PATH: 1 log at build, 2 after a changing reconcile, 2 after a no-op reconcile, unchanged over 5 queries.
- Git date across a content change: no leak (bytes are compared by blob id; a changed doc is re-parsed so it carries no old date). Was only tested for an edit made before the first index; added a regression for edit after index then reconcile -> penalty (passes, no code change needed).
- `last_validated`: not read anywhere in `src` (grep: comments only); test uses `penalty` mode and checks source.
- CLI vs MCP: both go through `decayForDoc`, so the block shape is identical (checked by `decay-fallback.test.ts` CLI case and search-parity). Stale marker differs by design: MCP prefixes `[stale: ...]` on `search_hybrid`, `search_semantic`, `search_text`, `search_graph` (name prefix); the CLI sets `stale: true` on hits while a live process holds `index.lock`.
- Fresh mode vs v1.10.0: the MCP ranking and the `computeDecay` results are the same (multiplier, age_days, reason strings, now pinned by a new unit test), BUT two deliberate differences exist: (1) decayed blocks gain a `source` field; (2) the CLI search used to skip decay entirely and now applies it, so in `fresh` mode CLI order can differ from v1.10.0 for notes with an old `last_verified` (it now matches `search_hybrid`; search-parity requires it). Not byte-identical for the CLI. Recorded, not changed.
- Floors: every drop is in Errors Encountered with measurements (Phase 3 boost; meanBytes ceiling raised in Phase 4). No unrecorded drop.
- Not covered: the stale marker on `search_graph` has no test; `mtime` and `penalty` not measured on the eval splits.

Gate-failure proofs (scratch edits, reverted, `git status` clean): default `missing_last_verified: fresh` -> decay-eval train twin gate, the git-source gate and the loadDecayConfig unit test fail. `NO_STRONG_MATCH_BELOW` 0.36 -> 0.20 -> 2 eval gates fail (held-out false-flag ceiling, real-train negatives).

Full suite after review (lint, build, test, eval): eval 46 pass + 5 expected fail; test 869 pass with 3 load flakes (freshness-scale warm start, hook-multi-source SessionStart, skill-eval concurrency), all 31 pass alone.
Offline tarball (built from 908672c, before the boost-removal refactor; rebuilt from the merge commit before publishing): extracted, `install-offline.sh --prefix` installs 1.11.0, `--verify` OK (9986 files match).

#### Acceptance, #48
- GRAPH_BOOST 1.3 -> 1.0: done, and then removed outright (no-op). Fixture held-out hybrid @1 22 -> 25, real held-out 13 -> 14; fixture-train 39 -> 38 and real train 21 -> 22 (hybrid @1). Cost: one fixture-train exact, one held-out multi @3.
- Held-out paraphrase hybrid >= semantic: met (13 = 13), now a real gate.
- Stale marker in response text: met for search_hybrid/semantic/text (integration test) and the CLI (hits + hook line). search_graph has the marker but no test.
- `meta_weight` default: kept 0.8 (train did not support 1.0); docs guidance is Phase 9. Missed ask: none, it was "measure and document".
- Abstention 0.45: not adopted (22% / 31% / 11% false flags); no two-feature rule beat 0.36 on train. Negative result, as planned.
- Ranking (#45) stays off.
#### Acceptance, #49
- Check 1 (400-day git age = 400-day last_verified): met, unit test (toBeCloseTo 10 digits) and integration (git date 400d).
- Check 2 (`fresh` restores v1.10.0): met for MCP ranking and scores; NOT exact for the CLI search (now applies decay) and the block gains `source`. Stated above.
- Check 3 (decay block names the source, also at multiplier 1): met for MCP and CLI.
- Check 4 (no query spawns git; one pass per build): met (spy test).
- Non-git vault and untracked file take the penalty: met. Verified doc beats its unverified twin on the fixture: 6/6 train and held-out, hybrid and semantic.
- Lint reports notes without `last_verified` (count `noLastVerified`), severity unchanged: met; it is a count, not per-note findings.
- Limits that remain (documented in Decisions): `git` needs a --reindex when switched to; a no-byte-change commit dates an edited doc only at the next reconcile with changes; shallow clones.
