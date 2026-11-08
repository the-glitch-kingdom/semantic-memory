# Notes: identifier-abstention

## Verification against main @ 29e74db (2026-11-08, read-only agent)
- **"`no_strong_match` uses the top confidence, cutoff 0.36": partly.** `isWeak` (`src/core/confidence.ts:185-190`) uses the best raw cosine, not `confidence`, AND requires the best BM25 to be under `bm25Min` (`BM25_FRACTION` 0.8 × self-query median, `bm25.ts:150-162`, `context.ts:673`). The issue leaves out the BM25 condition.
- **"BM25 vocabulary knows df at zero cost": confirmed, but not exposed.** `df` is a private Map (`bm25.ts:33`).
- **Code spans and table cells are indexed since 1.12.0** (`indexer.ts:275-293`, schema 7).
- **`tokenize` keeps underscores** (`bm25.ts:10-11`): it lowercases, splits outside `[\p{L}\p{N}_]`, and drops 1-char tokens and stopwords. Results:
  - `FOO_BAR` → `foo_bar`
  - `fooBar` → `foobar`
  - `check_rls_coverage.py` → `check_rls_coverage`, `py`
  - `a/b/c.ts` → `ts`
- **False-flag traps:**
  - BM25 path words replace `_` with spaces (`bm25.ts:27`), so a doc named after the identifier that never says it in the body would be flagged.
  - `__init__` outside code loses its underscores (`indexer.ts:277`).
- **External figures (2/7 tuning, 1-2/10 blind, ≤ 2 of 34) can't be checked here.** In-repo, real-train hybrid negatives are 9/12. All 40 in-repo negatives are off-topic plain English with no identifier-shaped tokens, so #57 changes none of them; new negatives are needed.
- **Simulation:** all 22 identifier-bearing answerable cases across the golden-docs, real-corpus and code sets are present, so 0 would be missing. This used raw text plus a regex, not the real `Bm25Index`.
- **No symbol table exists in src**, so `undocumented` depends on #58.
- **Response:** an array, with flags on the items (`search.ts:259`). A weak flag also suppresses `related` (`:259-261`). An empty result can't carry the flag.
- **Two code paths need it:** `shape()` (MCP) and `openSearch` in `src/cli/search.ts:139-159` (hooks). `test/integration/search-parity.test.ts` expects them to match.
- **The arXiv 2610.33732 AUROC figures were not checked.**

## Eval results: Phase 2
- 8 identifier negatives per split (ids i01-i08, `negative_kind: identifier`) appended to golden-docs, golden-docs-heldout, real-corpus, real-corpus-heldout. Planted terms (snake_case, ALL_CAPS, camelCase, paths, dotted names, one backticked) were grep-verified absent (case-insensitive, whole token and basename) from test/fixtures/docs-vault and .documentation; none appear in this plan's notes.
- Shipped baseline, search_hybrid, existing score rule only: fixture-train 3/8 flagged, fixture-heldout 3/8, real-train 2/8, real-heldout 1/8. Existing 40 topic negatives and all tier counts unchanged (run separately).
- Gates: `identifierGate` (test/retrieval-eval/gates.ts) is `it.fails` in docs-eval and real-corpus-eval until Phase 5.
- Phase 2 gate: lint, build clean; npm test 923 passed, 2 load flakes (freshness-scale, hook-failure) pass alone; npm run eval 72 passed, 9 expected fail (5 old + 4 identifier gates).
