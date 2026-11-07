# Task Plan: v191-ranking-regression

## Goal
Fix every finding in issue #43 so `search_hybrid` is never worse than `search_semantic` at @1, answer@1
>= 0.75 on both the fixture and a real-corpus held-out set, HNSW recall@k >= 0.97 against exact cosine,
excluded paths are never indexed, `no_strong_match` false-flags answerable queries <= 10% with every
negative flagged, and an upgrade from v1.7.2/v1.8.x keeps its vectors and keeps answering. Ships as
v1.9.1 in one PR from `fix/v191-ranking-regression`.

Source: https://github.com/the-glitch-kingdom/semantic-memory/issues/43 (verified against `main` at
448c518 on 2026-11-06; see notes.md "Verification").

## Phases
- [x] Phase 1: Plan and verify root causes
  - [x] Read issue #43 and verify every root cause and tool bug in `src/`
  - [x] Measure HNSW recall at default vs raised `ef` on real vectors (test vault, 2,764 vectors)
  - [x] Find why the v1.9.0 eval missed the regression (notes.md "Why the eval missed it")
  - [x] Commit the archive move of `.planning/retrieval-graph-quality/` carried over from main
- [ ] Phase 2: Eval that catches this class of regression
  - [ ] Held-out split: a NEW question set written before any ranking change in this plan, our own
        questions (none from the #41/#43 benchmarks), symptom-heavy like real usage: >= 20 answerable
        (>= 10 symptom/paraphrase, keyword, multi-doc) + >= 8 negatives on `test/fixtures/docs-vault/`,
        in `test/retrieval-eval/golden-docs-heldout.jsonl`. Tuning in later phases uses ONLY the
        existing `golden-docs.jsonl` (train); held-out is reported, never tuned on
  - [ ] Real-corpus held-out set against this repo's `.documentation/` (>= 20 answerable, symptom-heavy,
        >= 8 negatives) in `test/retrieval-eval/real-corpus-heldout.jsonl`, written now, same rule
  - [ ] More negatives on the train split too (total >= 12) so abstention thresholds are not thin
  - [ ] Gates in `test/retrieval-eval/docs-eval.test.ts` + `baseline.json`: hybrid @1 >= semantic @1 - 1
        on every split; paraphrase-tier hybrid @1 >= semantic paraphrase @1; held-out @1 floor
  - [ ] HNSW recall check: exact cosine top-k vs `VectorIndex.search` on the eval queries, in the eval
        (gate >= 0.97) and in `scripts/retrieval-eval/stale-audit.mjs`
  - [ ] Record the v1.9.0 baseline for every split and arm in notes.md (expect hybrid < semantic on
        symptom questions; if the fixture does not reproduce it, add fixture docs whose incidental
        words collide with symptom queries until it does, and say so)
  - [ ] Wire the new tests into `npm run eval`
- [ ] Phase 3: Index hygiene, HNSW accuracy and upgrade migration
  - [ ] `setEf(Math.max(100, k))` after `initIndex` and after `readIndexSync` (`src/core/vector.ts:42,79,123`);
        unit test that a search after load and after incremental `addChunks` uses the raised ef
  - [ ] Excluded paths are not indexed: `path_class.exclude` (default `**/archive/**`) joins
        `IGNORE_GLOBS` (`src/core/indexer.ts:19`) for chunks, vectors and BM25 -- this is the item the
        v1.9.0 plan ticked but never did. Excluded docs stay graph nodes only (frontmatter + links, no
        chunks) so `supersedes` edges still resolve. Config hash feeds `meta.ignoreGlobs`
  - [ ] `results.exclude` globs (default: the `graph.exclude_hubs` list plus generated reports such as
        `**/reports/link-check-*.md`) removed from search results
  - [ ] Bump `INDEX_SCHEMA_VERSION`
  - [ ] Vector migration on upgrade: read old `hnsw-meta.json` (label -> docPath, chunkIndex, text) plus
        positional `embeddings.json` (`path:chunkIndex`), and re-key each vector to
        `sha256(model \0 text)` when the text equals a current chunk; re-embed only the rest
  - [ ] Serve the old index during the upgrade with `_meta.stale: true` instead of "Indexing in progress"
  - [ ] Re-run eval, record numbers
- [ ] Phase 4: Ranking -- score fusion and field-aware BM25
  - [ ] Replace rank-only RRF in `search_hybrid` with doc-level score fusion:
        `0.7 * cosine + 0.3 * bm25 / max(bm25 over candidates)` (best chunk per doc), then the existing
        boosts; pure cosine order when BM25 returns nothing. Keep `fuseRrf` only if still used
  - [ ] Field-aware BM25: each chunk indexed with its doc's frontmatter `title`, `purpose` and path tokens
        (split on `/ . - _`) prepended
  - [ ] Result `title` is the doc's frontmatter/parsed title, not the path (`src/core/vector.ts:92`,
        `src/core/bm25.ts:98`)
  - [ ] Tune weights only on the train split; report held-out without changing weights after looking
  - [ ] CLI/hook path (`src/cli/search.ts`) uses the same fusion helper
  - [ ] Re-run eval, record numbers, raise floors
- [ ] Phase 5: Abstention
  - [ ] Drop the margin term from `withConfidence` (`src/core/confidence.ts`)
  - [ ] `no_strong_match` only when top cosine < T_cos AND top BM25 < T_bm25; T_bm25 calibrated per
        index (no constant: derive it from the corpus, e.g. a percentile of top BM25 scores for
        self-queries built from doc titles at index time, stored in `meta.json`), T_cos calibrated on train
  - [ ] Soft wording in tool descriptions and `serverInstructions` (`src/mcp/server.ts:97`):
        "weak match, verify before citing", not "not documented"
  - [ ] Re-run eval: every negative flagged, answerable false-flags <= 10% on each split; record
- [ ] Phase 6: Tool fixes
  - [ ] `search_text` ranks by relevance (match count, then BM25), not path order (`src/core/search-text.ts`)
  - [ ] `graph_path` `direction: "out" | "in" | "any"` (default `any`) (`src/core/graph.ts:176`)
  - [ ] `backlinks` / `forwardlinks` honour `path_class.exclude` by default; opt-in to include
        (`src/mcp/tools/graph.ts:14,25`), `supersedes` still reachable
  - [ ] `--read-only` never writes into the notes tree: the selection log (and any other session file a
        read-only server writes) goes under the index dir or a per-user state dir; usage-boost reads the
        new location and falls back to the old one (`src/core/telemetry.ts:40`, `src/core/session.ts:264-274`)
  - [ ] Tests for each
- [ ] Phase 7: Release prep v1.9.1
  - [ ] Correct the v1.9.0 changelog's false "vectors are kept" upgrade claim (lines 40, 87)
  - [ ] Bump all five version fields to 1.9.1, then `npm install --package-lock-only --ignore-scripts`
  - [ ] Offline tarball builds near the expected size
- [ ] Phase 8: Cleanup -- remove junk and unused code this work created: scratch/test scripts, debug files, probe logging, one-off test functions, commented-out code, dead code from abandoned approaches (MANDATORY)
  - [ ] Remove `fuseRrf`/RRF constants if score fusion fully replaces them
  - [ ] Remove tuning knobs and trial code that did not ship
  - [ ] No stray eval output committed
- [ ] Phase 9: Validate success through comprehensive testing -- we need to validate success thoroughly through comprehensive testing of our changes (MANDATORY)
  - [ ] Independent review of `git diff main...HEAD`; fix real bugs with regression tests
  - [ ] Check every ticked box in this plan against the code (the v1.9.0 plan ticked an undone item)
  - [ ] Unit: score fusion (pure-cosine fallback, doc-level best chunk), field BM25, title from frontmatter,
        confidence without margin, per-index T_bm25, `setEf`, exclude-before-index, migration re-keying,
        `search_text` ranking, `graph_path` directions, links exclusion, read-only writes nothing in notes
  - [ ] Integration -- the issue's acceptance checks:
    - [ ] hybrid @1 >= 0.75 on fixture held-out and real-corpus held-out; paraphrase @1 >= semantic's
    - [ ] hybrid never below semantic at @1 by more than one case on any split
    - [ ] HNSW recall@k >= 0.97 vs exact cosine on the eval queries
    - [ ] indexed chunk count excludes `path_class.exclude` matches
    - [ ] `no_strong_match`: all negatives flagged, answerable false-flag <= 10% after calibration
    - [ ] upgrade from a v1.7.2-format and a v1.9.0-format index re-embeds only changed chunks and answers
          (stale) during the upgrade
    - [ ] `search_text` top result has the most matches; `graph_path` finds B->A when A->B exists
    - [ ] a `--read-only` server leaves `git status` of the notes tree clean
  - [ ] Real-corpus before (v1.9.0) / after on both real-corpus sets through the production `.mcp.json` launch
  - [ ] `npm run lint && npm run build && npm test && npm run eval`; `scripts/smoke-install.sh`;
        offline tarball install + `--verify`
- [ ] Phase 10: Documentation pass -- a full hit-em-with-the-docs pass to create/update/deprecate as many docs as needed to capture all our changes: new procedures, tools, troubleshooting steps, gotchas, KB articles, etc. Never include secrets or passwords (MANDATORY)
  - [ ] New `.documentation/changelog/v1-9-1-ranking-regression.md` with before/after tables per split
  - [ ] Update `.documentation/operational/retrieval-tuning-guide.md` (score fusion, field BM25, `ef`,
        exclude-before-index, `results.exclude`, abstention rule and calibration, eval splits and gates)
  - [ ] Update `.documentation/reference/mcp-tools-reference.md` (graph_path direction, links exclusion,
        search_text ranking, title, soft no_strong_match wording)
  - [ ] Update `.documentation/reference/configuration-reference.md` (`results.exclude`, exclusion now
        applies at index time)
  - [ ] Update `.documentation/architecture/indices-and-storage.md` and `what-gets-indexed.md`
        (excluded docs as graph-only nodes, migration, `meta.json` BM25 threshold, state-dir location)
  - [ ] Update `.documentation/testing/tests-and-validation.md` (held-out splits, hybrid-vs-semantic gate,
        HNSW recall gate)
  - [ ] New KB fact (gotcha): hnswlib `ef` defaults to 10, so `searchKnn` recall drops without `setEf`;
        `## Instead` + `verify_command`
  - [ ] New KB fact (gotcha): rank-only RRF at k=60 lets a weak second arm displace a strong #1
  - [ ] Update `.documentation/troubleshooting/troubleshooting.md` (dirty tree from a read-only server,
        upgrade re-embed)
  - [ ] Regenerate `AGENTS.md` with `regenerate_contract` passing `projectRoot` = this repo
  - [ ] `npx hewtd maintain --quick`; never hand-edit INDEX.md/REGISTRY.md

## Key Questions
1. Does score fusion beat RRF on our own held-out sets, not just on the issue's replica?
2. Can T_bm25 be derived per index without labelled data (title self-queries), and does it hold on
   both corpora?
3. Are excluded docs needed as graph nodes beyond `supersedes`? (Default: graph-only, no chunks.)
4. Does `ef = max(100, k)` reach recall >= 0.97 on our indexes, or is exact brute force simpler at
   this size? (Prefer `setEf`: one line; brute force only if recall misses.)

## Decisions Made
- One branch, one PR, one release (v1.9.1), as the user asked (2026-11-06).
- Held-out sets are written in Phase 2, before any ranking change, and never used for tuning; all
  questions are our own (user rule from #41).
- Every phase verifies a box in code before ticking it: the v1.9.0 plan ticked the shared-exclude item
  without doing it, which caused root cause 3 here.
- `setEf` over brute-force exact search unless recall misses: smallest change.
- Plans are force-added (`git add -f`); `.planning/` is gitignored but tracked.

## Errors Encountered
- (none yet)

## Status
**Currently in Phase 2** - building the held-out eval.

---

## Notes
- This file persists across sessions
- Update status after each phase
- Mark completed phases with [x]
- Save research to notes.md instead of stuffing context

## On Completion
This plan is complete when every checkbox above is checked. That IS the
completion signal -- there is no separate status to remember to flip.

When complete, archive it instead of deleting it:

    /plan-status                  # confirm this plan reads COMPLETE
    /archive-plan v191-ranking-regression    # -> .planning/.archive/v191-ranking-regression/

Archiving moves this directory to the gitignored .planning/.archive/ and stamps
it archived. Nothing is destroyed.
