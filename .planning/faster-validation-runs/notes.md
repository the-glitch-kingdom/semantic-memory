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
