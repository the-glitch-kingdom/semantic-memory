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
