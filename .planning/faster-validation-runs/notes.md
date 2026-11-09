# Notes: Faster validation runs

## Phase 1: Where the time went (measured 2026-11-09)

### #76's workflow
Plan-runner run wf_5b1c1ce6-539: 8 phase agents, 175 agent-minutes.

| Where | Minutes | Calls |
|---|---|---|
| Full test suite | 56.5 | 17 |
| Waiting on background jobs (mostly those suites) | 38.2 | 17 |
| eval-against-release (old versions) | 18.7 | 27 |
| gate:release | 13.8 | 9 |
| Targeted vitest | 12.7 | 35 |
| Model reasoning and writing | ~23 | |

The repetition comes from three sources:
- the full suite re-run to confirm load flakes;
- jobs overlapping, which also caused the flakes and noisy p95;
- old releases rebuilt and re-indexed on every measurement.

### CI
PR #79's run (42637505899), on a 4-vCPU ubuntu-latest runner.

| Job and step | Time |
|---|---|
| test: `npm test` | 453 s |
| test: `npm run eval` | 214 s |
| test: `npm ci`, lint, build | ~42 s |
| smoke (parallel) | 71 s |

- `npm test` runs 15 of the 16 `test/retrieval-eval/*.test.ts` files, which `npm run eval` then runs again. That's the eval suite twice.
- Slowest files in `npm test`:

  | File | Time |
  |---|---|
  | search-sections | 82 s |
  | freshness-scale | 70 s |
  | freshness | 42 s |
  | section-eval | 40 s |
  | suite | 34 s |
  | hook-failure | 34 s |
  | federation-eval | 27 s |

  These are kept: they're real end-to-end coverage.
- The offline tarball is not in CI; it is built locally at release.

### Load flakes seen (all pass alone)
- freshness-scale warm start: CI failed at 1085 ms against the 1000 ms limit on PR #80 (run 42671792977).
- hook-failure Jev-hang.
- stdin-eof "exits on SIGTERM" (#78 release validation).
- skill-queue SessionEnd timing (#78 Phase 2).
- links-exclude (#78 Phase 4).
- abstention-parity: a real timeout bug, not a flake. `initialize` needed a timeout; fixed in 9c0301b.

### Design constraint for the cache
- In `eval-against-release.sh`, the MCP arm runs this checkout's `dist/` as the client against the release's server. So that arm depends on local code; only the release's index and CLI arm are independent of the checkout.
- `gate-release.sh` checks "mcp vs cli differ on any question" with zero slack. HNSW noise failed it once (1 of 166, #78 Phase 9).

## Eval results: Phase 2 (2026-11-09, this machine, 8 cores, one job at a time)

### Baseline wall times

| Command | Time | Notes |
|---|---|---|
| `npm test` | 390 s | 2 load flakes: hook-failure Jev-hang and skill-queue SessionEnd, each passes alone |
| `npm run eval` | 118 s | |
| `eval-against-release.sh 1.25.0`, default sets, one version | 40–42 s plain, 47–50 s export | of which the cold index is 32–34 s |
| `gate:release` | 3m24s | recorded in #78 Phase 6, not re-run here |

### Determinism
1.25.0 was measured twice (runs A and B), each from a fresh clone and a fresh index, on the 6 default sets (144 questions).
- Per-question `probes` differ: 0 of 144 on each of the four arms (plain cli, plain mcp, export cli, export mcp).
- Hybrid aggregates (tiers, negatives flagged, false flags, dominance, cov) are identical.
- **Decision:** the cache may reuse results for a published release, not only its build. p95 and the cold-index time are still not same-run, and are marked as cached.

### Cache payoff, re-estimated
- About 45 s per old version per call (32 s of it the cold index), less any MCP arm that has to re-run (about 10 s).
- #76 made 27 eval-against-release calls (18.7 min). Expected saving: about 10 min per plan.

## Eval results: Phases 5-6 (2026-11-09)

### Cache scenarios
`EVAL_CACHE` was set to a scratch dir; set `real-hub-heldout`; `1.25.0` and `local`.

| Run | Time | Result |
|---|---|---|
| cold | 74 s | |
| warm, same key | 34 s | 1.25.0 rows read "(cached)", counts identical to cold; the remaining time is `local`, never cached |
| set file changed (one negative added) | 38 s | miss: new key, no "(cached)" label, 2/2 negatives flagged |
| `dist/cli/index.js` changed | ~1.5 s | CLI arm reused (eval.json mtime unchanged), MCP arm re-run on the warm index (new eval-mcp.json mtime), `mcp.client` updated |
| `dist/` restored | ~1.5 s | MCP arm re-run again; hash is content-based, so a rebuild with identical output does not invalidate |
| without `--cache` | 45 s | temp dir removed, nothing left behind |

- The cache dir holds only `1.25.0-<key>` entries and `pkg-1.25.0`, never `local`.
- A new commit changes `HEAD^{tree}`, so it is a miss by construction (checked again in Phase 9 after committing).
- Bug found and fixed while writing it: a GATE_TMP reused without `--cache` would have silently reused leftover results. The rebuild path now removes leftovers unless the run is a keyed `--cache` hit.

### Gate band (Phase 6)
The gate's own comparison code, run on synthetic results:

| Differing questions | Result |
|---|---|
| 0 | PASS |
| 1 | PASS, question printed |
| 2 | FAIL, both printed |

## Eval results: Phase 9 (2026-11-09, one job at a time)

| | Before (Phase 2) | After |
|---|---|---|
| `npm test` | 390 s, 2 load flakes | 244 s (first run: hook-failure failed all 3 retries) and 294 s (final run: all green, 1125 passed) |
| `npm run eval` | 118 s | 138 s and 192 s. The same 16 files run, so this is run-to-run noise, not a change |
| Full validation (lint, build, test, eval) | 508 s, plus a re-run of each flake | 382 s and 486 s, with no re-runs needed in the final run |
| `gate:release` | 3m24s (#78) | 223 s, PASS; `EVAL_CACHE` dir never created, so the gate did not use the cache |
| `--cache` after a new commit | | Miss, as expected: new key `ca43a434…`, no "(cached)" label |

**hook-failure:**
- It failed all 3 retries in the first run: the hung run took 3772, 4358 and 3896 ms against a fixed 3000 ms. Node start-up under full load exceeds the bound itself, and an immediate retry runs under the same load.
- **Fix:** the bound is relative to an error run made just before it, plus 3 s. In a throwaway check, a hook that waits out the hang still fails: 19989 ms against a 3702 ms bound.

CI step times are recorded on the PR once the run finishes.
