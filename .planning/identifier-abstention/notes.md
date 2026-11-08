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

## Eval results: Phase 3
- Deterministic (real `Bm25Index` over `Indexer.indexAll`, no embedder), test/unit/identifiers.test.ts: 0 answerable questions get a missing term across golden-docs(+heldout), real-corpus(+heldout), golden-code(+heldout), golden-decay(+heldout), golden. Identifier-bearing answerable cases: docs 3/2, real 3/1, code 6/7 (train/held-out).
- Detector alone flags all 8/8 identifier negatives in each of the four splits (vs 3/8, 3/8, 2/8, 1/8 for the score rule), so the Phase 5 target of 5/8 is met by missingTerms; remaining risk is wiring. Held-out was measured, not used to choose rules.

## Eval results: Phase 4
- Wired: `shape()` (MCP), `openSearch` (CLI), hook line, tool description, server instructions, tool-surface snapshot.
- search_hybrid identifier negatives flagged: fixture 8/8 train and held-out, real 8/8 train and held-out (was 3/8, 3/8, 2/8, 1/8). Gates flipped from it.fails to real; target 5/8 met. Held-out measured, not tuned on.
- npm run eval: 76 passed, 5 expected fail (the old ones). Parity test: MCP and CLI agree on flag and missing_terms; plain English carries none. Load flakes (freshness-scale, hook-failure Jev-hang) pass alone.

## Eval results: Phase 5
Measured with `npm run eval` (2 runs); held-out never used to pick anything.
- Identifier negatives flagged (search_hybrid), before (shipped) -> after: fixture-train 3/8 -> 8/8, fixture-heldout 3/8 -> 8/8, real-train 2/8 -> 8/8, real-heldout 1/8 -> 8/8. Target 5/8 (ceil(8*4/7)) met in all four.
- Floor raised: identifierGate now requires every case (8/8) with no slack, since missingTerms is BM25-only and deterministic (no HNSW); it is a real gate (no `it.fails` left in the identifier gates).
- Main negatives (12 train / 8 held-out, identifier cases excluded from these arms): fixture hybrid 11/12 train, 8/8 held-out; real hybrid 9/12 train, 8/8 held-out; unchanged vs the pre-plan gates, which have no per-count floor beyond the existing slack.
- Answerable false flags: unchanged. Hybrid flagged-answerable counts from the eval output (answerable N): fixture-train 4, fixture-heldout 6, real-train 1, real-heldout 2; all within the existing gates, which pass. Plain-English: no missing_terms on any golden question (Phase 3 unit proof).
- Answer@1 floors unchanged (retrieval untouched): all split/tier floors in baseline.json still pass; none raised, none dropped.
- Remaining `5 expected fail` are older known-gap gates, not this plan's.

## Eval results: Phase 8 (independent review)
Review of `git diff main...HEAD` found two real false-flag paths, both fixed in `src/core/identifiers.ts` with regression tests (test/unit/identifiers.test.ts; verified failing on the Phase 7 code):
- `__init__.py`, `_helper_fn`: EDGE stripped leading/trailing `_` before the index lookup, but the index tokens keep them (`tokenize` keeps `_`), so a name present in a code span was flagged (`init__`, `py` vs `__init__`). EDGE now keeps `_`; the decision (is it an identifier) still ignores edge `_`, so `__init__` and `_italic_` alone stay prose.
- Slash prose: `TCP/IP`, `client/server`, `pass/fail`, `CI/CD` counted as paths and were flagged when the last word was absent from the docs. A path now needs an extension or 2+ slashes. All 32 identifier negatives with paths have extensions, so nothing regressed (8/8 in all four splits). Also: `key=FOO_BAR` is split at `=` so `missing_terms` lists `FOO_BAR`, not `key=FOO_BAR`.
- Not changed, recorded: (a) `retry_limit` in the query vs `retry-limit` or "retry limit" in a doc is flagged (the index has the parts, not the joined token): an exact-spelling claim, true as worded; (b) `paths.includes(token)` is a substring test, so it can only miss a flag, never add one; (c) the hook's "Not in the docs" line can fire on a prompt that pastes a code path absent from the docs, only past the existing score gate, and its Instructions line still says to ignore the block for non-lookup prompts; (d) `shape()` joins all doc paths per search (O(docs), fine at thousands, cache if a vault passes ~50k docs); (e) the issue's bare ALL_CAPS (no `_`) and `*.py` forms are not detected, by Decision (acronyms/PascalCase left out).
- No second detector: grep for `no_strong_match`/`isWeak` finds only shape(), openSearch, the hook and the eval runner. Wording: no "does not exist" anywhere (hook test asserts it). CLI/MCP parity: search-parity test with two missing-identifier queries plus `search_semantic`.

#57 acceptance:
1. PASS. A query naming an absent identifier gets `no_strong_match: true` and `missing_terms` (search-parity test, MCP and CLI, search_hybrid and search_semantic).
2. PASS. Deterministic unit proof over the real Bm25Index (no embedder): zero missing terms for every non-identifier question in golden-docs(+heldout), real-corpus(+heldout), golden-code(+heldout), golden-decay(+heldout), golden. Phase 8 widened it to include the plain-English negatives (previously excluded).
3. PASS in-repo, NOT RUN externally. Identifier negatives flagged: fixture-train 3/8 -> 8/8, fixture-heldout 3/8 -> 8/8, real-train 2/8 -> 8/8, real-heldout 1/8 -> 8/8 (target 5/8). False flags stay within the existing ceilings (eval gates pass). The external "4 of 7 / at most 2 of 34" blind set is not in this repo or on this machine: it is a release step with `semantic-memory eval`, still open.
4. PASS. missingTerms = [] for every plain-English golden question (check 2 proof), so its flag equals isWeak alone. Not diffed per case against the pre-plan run; the proof is that the OR term is empty.
5. PASS. Fixtures and CI have no `.hewtd` export or gaps file; new assertion that identifiers.ts and bm25.ts reference neither `graph.json`, `gaps.json` nor `.hewtd`.

Gates: lint, build clean; npm test 939 passed, 5 expected fail, 1 load flake (hook-failure Jev-hang) that passes alone (14/14); npm run eval 76 passed, 5 expected fail.

## Eval results: Phase 9 (documentation)
Docs only; code unchanged. Added v1-14-0-identifier-abstention.md (changelog), a KB fact (path words replace `_`), updated mcp-tools-reference, cli-reference, retrieval-tuning-guide, troubleshooting, README, CHANGELOG; AGENTS.md regenerated from branch code (only the timestamp changed). `npm run eval` after the docs: 76 passed, 5 expected fail, no floor moved. Planted identifier terms are absent from every new doc.
