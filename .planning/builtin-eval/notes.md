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
