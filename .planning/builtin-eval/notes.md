# Notes: builtin-eval

## Verification against main @ 29e74db (2026-11-08, read-only agent)
- **"Every 1.9-1.12 change was judged on the fixture plus an external kit": partly.**
  - In-repo judging also used `.documentation/` as a real corpus (`test/retrieval-eval/real-corpus-eval.test.ts:17-18`, train/held-out, floors in `baseline.json`).
  - The external kit's figures (+0.14 tune vs 0.00 blind, -0.06 from a frontmatter commit) are not in the repo, so they couldn't be checked.
- **"Users have no way to see either": confirmed.** The eval is test-only: `package.json:41` runs `"eval": "vitest run test/retrieval-eval"`, and the `files` list (`package.json:16-28`) ships neither `scripts/retrieval-eval` nor `test/`.
- **The live search path can be reused.** `harness.ts:12-35` drives `createServer` in process through `InMemoryTransport` (`search_hybrid`, `search_semantic`), and the grep arm is at `docs-eval.test.ts:56-60`. `openSearch` (`src/cli/search.ts:57`) is a different path: it skips the usage boost and the reranker (`:129`).
- **Most metrics exist in `eval.ts`.**
  - `runFacetEval` (`:169-200`): answer @1/@3/@8 per tier, negatives flagged, `answerableFlagged`, "#1+related" (`expandedAt1`).
  - `runEval` (`:59-96`): found@k and MRR. It needs `expected` paths, which facet cases lack.
  - p50/p95 is new.
- **The selection log already exists.** It records search and selection events (`src/core/telemetry.ts:22-35`), and `scripts/retrieval-eval/mine-selection.mjs` mines query→read pairs; the labels are noisy.
- **The eval folder is gitignored.** `.claude/.semantic-memory/eval/` comes from `deriveSessionDir` (`session.ts:264-274`), and `.claude/.semantic-memory` is gitignored (`.gitignore:44`, `schema-default.ts:179`). For a vault not at `.claude/.vault`, it resolves to `<notes>/.claude/.semantic-memory`, which glob does not index (dot dirs, `indexer.ts:30`).
- **Host-agent generation has its infrastructure.** `runClaude` (`src/core/claude-run.ts:165`) is fenced, has 5 slots, defaults to Sonnet and can be overridden with `SEMANTIC_MEMORY_CLAUDE_BIN`. `test/bin/claude` is a rule-driven fake.
- **A model mismatch re-embeds.** `context.ts:253` forces a full re-embed on a model, pooling or prompt mismatch, so the eval must open the index with the meta's settings.
- **A read-only server still logs** into the index dir (`context.ts:662`), and `readSelectionLog` reads both locations. That is why the eval needs `telemetry: false`.
- **The BM25-drop check needs a corpus that separates the arms.** `search_semantic` = `search_hybrid` without fusion. They differ on `.documentation` (real held-out @1 17 vs 12) but barely on docs-vault (43 vs 42).

## Eval results: Phase 2
- Engine moved to `src/core/retrieval-eval/metrics.ts` (all of the old `test/retrieval-eval/eval.ts` except `hnswRecall`; `eval.ts` now re-exports it). The docs-eval grep arm's pattern builder is `grepPattern` in metrics.ts.
- `npm run eval` before vs after: every answered@k, tier count, flagged count, negative-top score, link precision/recall and hnsw recall identical. Only differences: mean-payload on three arms is 1 byte lower after (4828->4827, 7415->7414, 7271->7270), run-to-run noise (HNSW is random per build), not from this change (metrics code does not touch payloads). Tests 57 -> 59 (two new unit tests: expected/found@k/MRR/latency, grepPattern).
- Full `npm test`: only the known load flakes failed (freshness-scale, hook-failure, skill-eval concurrency); all pass alone with `--no-file-parallelism`.

## Eval results: Phase 3
- No numbers change (runner is new; `npm run eval` 61 passed, 5 expected fail). Tests 914 passed. `ServerOptions.telemetry: false` skips search logging and the read_note selection event. runner.test.ts: no index -> refuses and creates no index dir; cls-pooled index with a prompt keeps hnsw.bin/docs.cache.json/meta.json hashes and writes no selection.jsonl.

## Eval results: Phase 4
- `semantic-memory eval` (src/cli/retrieval-eval.ts, src/core/retrieval-eval/suite.ts). On the docs-vault fixture with golden-docs.jsonl (69 questions, 57 answerable, 12 negatives): search_hybrid all @1=43/57 @3=55/57 @8=57/57, negatives flagged 11/12; search_semantic @1=42/57 @3=53/57; same as `npm run eval`. Wall time 1.3 s including model load; latency p50 4 ms / p95 10 ms (hybrid). "clean" prints only when a set marks `split: tune`.
- Arms: search_hybrid, search_semantic, search_text (raw question), grep (search_text with grepPattern).
- Gate: lint, build, `npm test` 915 passed; freshness-scale warm start and hook-failure Jev-hang failed under load, both pass alone (16 tests, --no-file-parallelism). `npm run eval` 64 passed, 5 expected fail.
