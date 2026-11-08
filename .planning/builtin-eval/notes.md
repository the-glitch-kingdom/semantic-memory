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

## Eval results: Phase 5
- `eval --baseline` writes `<evaldir>/baseline.json` (version, setHash, corpus {docs, hash of paths+mtimes}, per-arm a1/a3/a8/negFlagged with n, per-case outcome). `--check --band <n>` (default 1) exits 1 when a count drops by more than the band, prints the binomial SD per metric and flipped questions; a changed corpus or set hash only warns.
- Tests: checkBaseline unit (one-question drop passes, two fail with flipped list, corpus change warns), CLI round trip (check without baseline exits 1, baseline, check passes, inflated baseline fails). Gate: lint, build, npm test 918 passed (hook-failure Jev-hang flaked under load, passes alone), npm run eval 66 passed, 5 expected fail.

## Eval results: Phase 6
- No retrieval numbers change. `eval generate` (src/core/retrieval-eval/generate.ts, prompts/generate.ts, GENERATOR_VERSION "1") samples docs evenly (non-generated, non-archive), one `runClaude({tools: [], maxTurns: 1})` per doc, validates (regex compiles and matches source, facet matches <= 20% of docs, paraphrase shares <= 1 rare term (df <= max(2, 10% of docs)), negative `absent_terms` absent from every raw doc case-insensitively, multi covers both docs). Cases carry doc, doc_sha256, generator {version, model}, split (parity of first hex digit of sha256(q): 50/50), expected (so found@k/MRR work), negative_kind. Tests: test/retrieval-eval/generate.test.ts with the fake claude (no real claude).
- Not measured on a real vault (no real claude in tests); the generation quality numbers wait for the Phase 9 release step.
- Gate: lint, build, npm test 923 passed (freshness-scale and hook-failure flaked under load, pass alone), npm run eval 72 passed, 5 expected fail.

## Eval results: Phase 9 (review and #56 acceptance)
Review of `git diff main...HEAD`:
- Engine drift: none; `test/retrieval-eval/eval.ts` re-exports `src/core/retrieval-eval/metrics.ts`, docs-eval, real-corpus-eval and the CLI share `armsOf`/`runFacetEval`.
- Writes: searches and `read_note` log nothing (`telemetry:false`); the server is readOnly; no `selection.jsonl` appears (checked on the real-corpus copy and in suite.test.ts). One caveat: if the notes tree changed since the last index, opening the server reconciles and updates the index incrementally (only changed files embedded). A model/pooling/prompt mismatch cannot trigger a re-embed because `openEval` opens with meta's settings.
- Held-out use: none for constants. Generator thresholds (facet share 20%, rare-term df) are untuned guesses fixed in code; held-out files are only read by the eval tests.
- Generated cases: every kept case passes `rejectReason`; nothing is kept unvalidated.
- Bug fixed: `eval --baseline --check` in one run overwrote the floor before reading it, so the check could never fail. It now refuses ("separate runs"); regression assert in suite.test.ts.

#56 acceptance:
1. Fixture, 40-case set (golden-docs.jsonl first 40 plus one stale case): `eval --json` asserted < 120 s in suite.test.ts (measured ~1-2 s warm), prints every metric (all/clean, found@k, MRR, p50/p95, negatives per kind), `selection.jsonl` absent after. PASS.
2. Real corpus (.documentation copy, 567 chunks, git history seeded as real-corpus-eval does), held-out set (27 answerable): hybrid @1/@3/@8 = 17/24/26, semantic 12/16/24. `--baseline` on hybrid, `--check` with the search_semantic floor set to hybrid's counts: exit 1, "FAIL, a1, a3 dropped", 10 flipped questions listed (h03, h09, h11, ...). Control `--check` unchanged: exit 0. PASS. (Without seeded git history semantic is 14/19/25, since decay applies; the issue's "17 vs 12" matches the seeded run.)
3. Generated cases carry doc, doc_sha256, generator {version, model}; two runs with the fake claude give the same set and split (generate.test.ts). PASS in CI. Quality with a real model not measured (no real claude in tests).
4. CI part: CLI counts equal real-corpus-eval.test.ts on the same sets. Train hybrid 21/25/27, semantic 18/25/26 in the CLI vs hybrid 21/25/27 and semantic 18/24/26 in the test (the test run also showed one @3 differing by one: HNSW is random per build); held-out hybrid 17/24/26 vs 17/25/26, semantic 12/16/24 vs 12/16/24 once git history is seeded. All within one question. External blind-kit run: NOT RUN (no external set available); release step, record in the changelog if available. PARTIAL.

Gate: lint, build clean; npm test 924 passed, 1 failure (hook-failure Jev-hang, load flake) passes alone (14 tests); npm run eval 72 passed, 5 expected fail.
