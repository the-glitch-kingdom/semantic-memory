# Task Plan: retrieval-graph-quality

## Goal
Fix every finding in issue #41 (the original report and the 2026-11-07 index-freshness comment) so
the correct answer is the first search result, from an index that always matches the files on disk:
answer@1 >= 0.80 on the eval set, both negatives report `no_strong_match`, backlink precision >= 95%,
zero `archive/` results by default, 0% stale vectors, zero inotify watches, and under 1 s to the first
answer from a warm cache. Ships as v1.9.0 in one PR from `fix/retrieval-graph-quality`.

Source: https://github.com/the-glitch-kingdom/semantic-memory/issues/41 (root causes verified
against `src/` on 2026-11-06; see notes.md "Verification" and "Verification: index freshness").

## Phases
- [x] Phase 1: Plan and verify root causes
  - [x] Read issue #41, verify each root cause in `src/` (not `dist/`)
  - [x] Find the extra archive-glob bug (`archive/**` misses nested and dot-dir archives)
  - [x] Inventory what already exists (eval harness, symptoms chunks, per-doc dedup, selection log)
  - [x] Verify the index-freshness comment in `src/` and on live server processes
  - [x] Comment on #41 with the verification summary and the plan link (posted 2026-11-06:
        https://github.com/the-glitch-kingdom/semantic-memory/issues/41#issuecomment-6700867183)
- [x] Phase 2: Make retrieval measurable (issue Phase 0)
  - [x] Add a hewtd-shaped fixture vault `test/fixtures/docs-vault/`: nested `.documentation/<domain>/`,
        a `.documentation/archive/` with a byte-identical copy of a live doc, generated `INDEX.md` /
        `REGISTRY.md` hubs, markdown `](x.md)` links (with `#anchors` and `../` paths), a few
        wikilinks, `symptoms:` frontmatter, tags shared by < 15 docs
  - [x] Extend `test/retrieval-eval/eval.ts`: answer-facet scoring (`facets: [regex]` per case,
        a hit = a returned doc's text matches), `negative: true` cases, archive-hit count, payload bytes
  - [x] Golden set for the new fixture: our own questions, written fresh for the fixture's content
        (none taken from the issue's benchmark), across exact / paraphrase / multi-doc / negative
        tiers, ~40 cases; paraphrase cases share no key terms with their answer doc
  - [x] Arm runner: same cases through `search_semantic`, `search_hybrid`, `search_text`, so each
        phase reports a per-arm @1/@3/@8 table
  - [x] Graph eval: backlink/forwardlink precision+recall against the links written in the fixture
  - [x] Freshness audit `scripts/retrieval-eval/stale-audit.mjs`: re-embed a chunk sample, report the
        share with cosine < 0.99 to the stored vector, orphan vector count, cold-start ms
  - [x] `scripts/retrieval-eval/mine-selection.mjs`: build labelled queries from `selection.jsonl`
        (search followed by `read_note` of a result = implicit label); output reviewed by hand before
        it enters golden.jsonl, never auto-merged
  - [x] Record the baseline numbers in notes.md (retrieval + freshness)
  - [x] CI gate: `npm run eval` in `.github/workflows/ci.yml`, failing if @1 drops below the recorded
        baseline (floor raised at the end of each phase)
- [x] Phase 3: Index freshness: pull-based reconcile replaces the watcher (issue comment)
  - [x] Embeddings keyed by chunk content hash (sha256 of the chunk text), not `path:chunkIndex`
        (`src/mcp/context.ts:199-208,224`); old positional `embeddings.json` read once and discarded
        (key = sha256(model NUL text): a model change misses by key; legacy keys are orphans, pruned on next save)
  - [x] Orphan pruning: vectors no current chunk references are dropped on save
  - [x] Manifest `path -> { mtimeMs, size, ino, contentHash }` from `fs.stat` (never the frontmatter
        `mtime`, which stays for decay/date filters only), persisted with the index
  - [x] `meta.json` gains `schemaVersion`, `chunker` params, `ignoreGlobs` hash, `generation` (+ `files`: size/mtime of each
        commit file, which is how a mixed commit is detected; files keep their old formats);
        mismatched `schemaVersion`/`chunker`/`ignoreGlobs` discards parsed docs but keeps vectors;
        mismatched `model`/`dimensions` discards vectors too
  - [x] `reconcile()` in `src/core/reconcile.ts`: walk + stat with the shared ignore globs (one config
        with Phase 4's `path_class.exclude`), diff against the manifest: stat same -> skip; stat
        changed + hash same -> manifest only; hash changed -> re-parse that file; new -> parse;
        gone -> drop doc, chunks, vectors, edges
  - [x] Incremental apply: text search per doc, graph edges for changed docs and affected tags only,
        HNSW `markDelete`/`addPoint` (or rebuild from cached vectors, no re-embedding), embed only
        unseen chunk hashes (graph is rebuilt whole: 11 ms at 1k docs; HNSW is incremental: rebuild is 1020 ms at 5k vectors,
        compacted by rebuild past 30% deleted)
  - [x] Startup: load + validate the cache (all files same `generation`), serve immediately with
        `stale: true` on responses until the first reconcile finishes; no `indexAll()` on a warm cache
        (`tryLoadCachedIndex`, `src/mcp/context.ts:130-171`)
  - [x] Lazy reconcile before every search/read/graph tool, throttled to once per 2 s; serialized,
        a call arriving mid-reconcile awaits it; a change arriving mid-reconcile is caught by the
        next call (fixes the dropped-edit bug at `backgroundIndex`, `src/mcp/context.ts:270`)
  - [x] Atomic, debounced persistence: every file written to a temp name under a new `generation`,
        renamed into place, `meta.json` last as the commit marker; one writer per index dir via a
        lockfile (stale-lock takeover by pid check), other processes reload when `meta.json` changes
  - [x] Remove the resident watcher from `src/mcp/server.ts:66-71`; `--no-watch` stays accepted as a
        deprecated no-op; `Watcher` stays exported from `src/core/index.ts` (public API) marked
        deprecated, for removal in v2.0.0
  - [x] CLI/hook search path (`src/cli/search.ts`) checks `generation` + `schemaVersion` before
        answering from `docs.cache.json`; read-only, never writes the index
  - [x] `reindex` tool and `--reindex` keep forcing a full rebuild
  - [x] Re-run eval + freshness audit, record numbers
- [x] Phase 4: Graph and ranking bug fixes (issue Phase 1)
  - [x] Markdown links: `extractMarkdownLinks` in `src/core/indexer.ts` (resolve relative to the
        source file, strip `#anchor` and `?query`, skip `http(s):`/`mailto:`/images, decode `%20`);
        new `IndexedDocument.mdLinks`; `link` edges (weight 1.0) in `GraphBuilder.buildFromDocuments`
  - [x] Typed edges: `backlinks` / `forwardlinks` / `findPath` default to `link|wikilink|related`;
        optional `types` filter on the MCP tools and CLI; tag edges kept for `search_graph` only
  - [x] Hub exclusion: configurable `graph.exclude_hubs` globs (default `**/INDEX.md`,
        `**/REGISTRY.md`) skipped as traversal nodes and in degree ranking
  - [x] Hybrid boost seeded from semantic hits: 1-hop `link|wikilink|related` neighbours of the top 5
        semantic results get the boost (not the query string); same fix in `src/cli/search.ts`
        (share one helper in `src/core/` so the two paths cannot drift again)
  - [x] Archive glob: default `path_class` rule `**/archive/**` matched with `{ dot: true }`; update
        `src/core/path-class.ts` default + `src/core/schema-default.ts`
  - [x] `path_class.exclude` globs (default `**/archive/**`) dropping matches from search results
        entirely; down-weight stays for vaults that opt out of exclusion
  - [x] Content-hash dedup: identical chunk text across docs keeps only the live (non-excluded) copy
        (compares the matched chunk text itself, which is what the hash is of; only bites when exclusion is opted out)
  - [x] Bump `schemaVersion` (parsing and edges changed) so caches re-parse without re-embedding
  - [x] Re-run eval, record numbers, raise CI floor
- [x] Phase 5: Lexical arm and fusion (issue Phase 2, part 1)
  - [x] BM25 over chunks in `src/core/bm25.ts` (no new dependency; tokenizer, k1=1.2, b=0.75),
        updated per doc by `reconcile()`
        (stoplist added, and a chunk must match >= min(2, query terms) terms: see notes.md "Phase 5")
  - [x] Reciprocal-rank fusion (k=60) of BM25 + vector in `search_hybrid` (graph boost, priority, decay and path-class act on each arm before fusion,
        since RRF scores are flat); `search_semantic` stays
        vector-only so the two arms remain comparable
  - [x] Confirm `symptoms:` chunks are indexed for hewtd playbooks/facts (v1.4 already adds them);
        add a fixture case proving a symptom-phrased query hits its fact @1
  - [x] Doc-level aggregation check: one result per doc with its best chunk across both arms
  - [x] Re-run eval, record numbers, raise CI floor
- [x] Phase 6: Rerank and embedder evaluation (issue Phase 2, part 2)
  - [x] Cross-encoder rerank of the fused top ~30 (`Xenova/ms-marco-MiniLM-L-6-v2` through the
        existing transformers/ONNX stack in `src/core/embedder.ts`); config `rerank.enabled`
        (`src/core/reranker.ts`, wired in `search_hybrid`; tested in `test/unit/reranker.test.ts`)
  - [x] Measure p50/p95 latency and cold start; keep it on by default only if @1 rises and p95
        stays under 150 ms warm (measured: @1 +1 but p50 675 / p95 775 ms: stays OFF, see notes.md "Phase 6")
  - [x] If default on: bundle the reranker in `scripts/build-offline-tarball.sh` model cache and
        update the expected tarball size (not applicable: rerank is off by default)
  - [x] Embedder trial: `bge-small-en-v1.5` and `gte-small` (384-d, same index shape) vs
        `all-MiniLM-L6-v2`; switch the default only if the eval improves (a switch re-embeds through
        Phase 3's `model` stamp) (neither won: gte-small hybrid @1 19, bge-small 21 vs 23; default unchanged)
  - [x] Record every trial's numbers in notes.md, including the losers
- [x] Phase 7: Confidence, abstention and payload size (issue Phase 2, part 3)
  - [x] `confidence` on each result from rerank score, rare-term lexical overlap and top-1/top-2 margin
        (`src/core/confidence.ts`: cosine + margin over the best other result + 0.1 when BM25 also returned the doc; the rerank score is not folded in: off by default, no calibration data)
  - [x] `no_strong_match: true` on the response when confidence is under a threshold calibrated on
        the eval (negatives must trip it, correct @1 hits must not)
  - [x] Trimmed payload: best chunk cut to ~600 chars around the match + path/title/score/confidence;
        `full: true` option keeps the old shape; update `enrichResult` callers
        (`src/mcp/context.ts`, `src/cli/search.ts`, `hooks/vault-context.js`, `hooks/doc-search-redirect.js`)
  - [x] Server instructions (`serverInstructions` in `src/mcp/server.ts`): tell the model to say
        "not documented" on `no_strong_match`
  - [x] Re-run eval, record numbers (payload bytes too), raise CI floor
        (`baseline.json`: hybrid `answeredFlagged` <= 2, `meanBytes` <= 4112; answered@1 floors unchanged)
- [ ] Phase 8: Graph as knowledge (issue Phase 3)
  - [ ] Edge types `cites` (hewtd fact ids in playbook `symptoms[].cites`), `supersedes`
        (`archived_from` frontmatter), `same-incident` (files under one `incidents/<id>/` folder)
  - [ ] Context expansion: after rerank, attach the #1 doc's direct link neighbours that also pass
        the confidence bar (as `related` on the #1 result, not as extra ranked hits)
  - [ ] `search_graph` reworked: semantic seeding + directed link edges, hub exclusion, no degree
        tiebreak; `graph_path` over link edges only by default
  - [ ] Bump `schemaVersion`; re-run eval (multi-doc tier especially), record numbers, raise CI floor
- [ ] Phase 9: Release prep v1.9.0
  - [ ] Bump all five version fields (package.json, both in `.claude-plugin/marketplace.json`,
        `.claude-plugin/plugin.json`, AGENTS.md frontmatter), then
        `npm install --package-lock-only --ignore-scripts`
  - [ ] Offline tarball builds and lands near the expected size (with reranker if bundled)
- [ ] Phase 10: Cleanup -- remove junk and unused code this work created: scratch/test scripts, debug files, probe logging, one-off test functions, commented-out code, dead code from abandoned approaches (MANDATORY)
  - [ ] Remove the query-string `searchGraph` call paths in hybrid (replaced in Phase 4)
  - [ ] Remove `fullIndex`/`backgroundIndex` code paths that reconcile replaced (keep `reindex`)
  - [ ] Remove losing embedder/reranker trial code and config knobs nobody uses
  - [ ] No stray eval output files committed; scratch stays in the session scratchpad
- [ ] Phase 11: Validate success through comprehensive testing -- we need to validate success thoroughly through comprehensive testing of our changes (MANDATORY)
  - [ ] Unit `test/unit/indexer.test.ts`: markdown link extraction (relative, `../`, `#anchor`,
        external URLs skipped, images skipped, `%20`, links in code blocks ignored)
  - [ ] Unit `test/unit/graph.test.ts`: `link` edges; backlinks != forwardlinks for a one-way link;
        tag neighbours excluded by default and included with `types`; hub files excluded;
        `findPath` finds a markdown-link path; incremental edge update for one changed doc
  - [ ] Unit `test/unit/path-class.test.ts`: `**/archive/**` matches `archive/a.md`,
        `security/archive/a.md`, `.documentation/archive/a.md`; exclude drops them; opt-out restores
  - [ ] Unit `test/unit/reconcile.test.ts`: every diff branch (skip / manifest-only / re-parse / new /
        gone), ignore globs, throttle, serialization
  - [ ] Unit `test/unit/bm25.test.ts`: scoring, empty query, unknown terms, incremental update
  - [ ] Unit: RRF fusion order, content-hash dedup prefers live copy, confidence/no_strong_match
        thresholds, payload trimming keeps the match span
  - [ ] Freshness acceptance checks (the issue comment's list), each an integration test:
    - [ ] Edit a doc mid-session: next search reflects the new text; assert re-embedded chunk count
    - [ ] Stale-vector audit reports 0% below 0.99 after a reconcile
    - [ ] Cold start to first answer < 1 s on a ~1k-doc generated tree with a warm cache; zero files
          re-parsed when nothing changed
    - [ ] Edit while no server runs (no `last_updated` bump): next startup re-parses/re-embeds exactly it
    - [ ] Bump `schemaVersion`: re-parse all, re-embed none whose chunk text is unchanged
    - [ ] Kill mid-save: next startup detects the mixed `generation` and recovers
    - [ ] Zero inotify watches held by default (count `/proc/<pid>/fdinfo` inotify lines)
    - [ ] `git checkout`/`touch` of every file without content change re-embeds nothing
    - [ ] Two server processes on one tree never leave a corrupted or half-written index
    - [ ] An edit made during a reconcile is picked up by the next call
  - [ ] Rewrite `test/integration/watcher.test.ts` and `test/integration/stale-index-startup.test.ts`
        for the reconcile model; keep `--no-watch` accepted (`test/regression/tool-surface.test.ts`)
  - [ ] Regression (`test/regression/`): hybrid ranking differs from semantic when a top hit has a
        linked neighbour (the issue's "20/20 identical" bug); CLI `search` and MCP `search_hybrid`
        return the same order for the same query
  - [ ] Integration: MCP stdio client against the docs fixture through every search/graph tool
  - [ ] Hooks: `hooks/vault-context.js` and `hooks/doc-search-redirect.js` still inject correctly
        with the trimmed payload (`test/integration/doc-search-redirect-hook.test.ts`)
  - [ ] Failure paths: reranker model missing offline (falls back to fused order, logs once);
        embedder model mismatch re-embeds; malformed `path_class`/`graph` config falls back;
        unreadable file during reconcile skipped, not fatal; stale lockfile taken over
  - [ ] Eval: targets met (@1 >= 0.80, negatives abstain, backlink precision >= 95%, 0 archive hits)
  - [ ] Benchmark on a real hewtd corpus (this repo's `.documentation/`) through the production
        `.mcp.json` launch, with our own question set written against those docs (~30 questions,
        same four tiers, kept in `test/retrieval-eval/real-corpus.jsonl`); before (v1.8.0) vs after
  - [ ] `npm run lint && npm run build && npm test && npm run eval` all green; `scripts/smoke-install.sh`
  - [ ] Offline tarball install + `--verify` on the built tarball
- [ ] Phase 12: Documentation pass -- a full hit-em-with-the-docs pass to create/update/deprecate as many docs as needed to capture all our changes: new procedures, tools, troubleshooting steps, gotchas, KB articles, etc. Never include secrets or passwords (MANDATORY)
  - [ ] New `.documentation/operational/retrieval-tuning-guide.md` (fusion, rerank, confidence,
        `no_strong_match`, path_class exclude, hub globs, how to run the eval) via `npx hewtd integrate -a`
  - [ ] New `.documentation/changelog/v1-9-0-retrieval-graph-quality.md` with the before/after tables
        (retrieval and freshness)
  - [ ] New KB fact (gotcha): minimatch `**` skips dot-dirs, so `**/archive/**` misses
        `.documentation/archive/` without `{ dot: true }`; `## Instead` + `verify_command`
  - [ ] New KB fact (gotcha): chokidar holds one inotify watch per file plus one per directory
        (measured 629 = 537 files + 92 dirs), and counts differ between processes on the same tree;
        `## Instead`: pull-based reconcile; `verify_command` counting `/proc/<pid>/fdinfo` inotify lines
  - [ ] Update `.documentation/architecture/indices-and-storage.md` (manifest, content-hash vectors,
        `generation`/`schemaVersion`, atomic save, lockfile, BM25 index)
  - [ ] Update `.documentation/architecture/mcp-internals.md` (reconcile lifecycle, no watcher,
        `stale: true`) and `what-gets-indexed.md` (markdown links, edge types, ignore globs)
  - [ ] Update `.documentation/reference/mcp-tools-reference.md` (search_hybrid, backlinks,
        forwardlinks, graph_path, search_graph: types filter, confidence, no_strong_match, payload, stale)
  - [ ] Update `.documentation/reference/configuration-reference.md` (path_class.exclude, graph.exclude_hubs,
        rerank, embedder, reconcile throttle)
  - [ ] Update `.documentation/reference/cli-reference.md` (search, backlinks options; `--no-watch` deprecated)
  - [ ] Update `.documentation/testing/tests-and-validation.md` (eval harness, CI gate, stale audit,
        mining script)
  - [ ] Update `.documentation/troubleshooting/troubleshooting.md` (archive results, "not documented",
        stale results after edits, lockfile left behind)
  - [ ] Update `.documentation/deployment/release-process.md` / runbook if the tarball size changes
  - [ ] Update `README.md`; regenerate `AGENTS.md` via `regenerate_contract`
  - [ ] `npx hewtd maintain --quick`; never hand-edit INDEX.md/REGISTRY.md
  - [ ] Close #41 from the PR body (`Fixes #41`)

## Key Questions
1. Does the archive leak in the issue come from the nested/dot-dir glob miss, or did the 0.3 down-weight
   simply not push them out? (Answer in Phase 2 with the fixture; the fix covers both.)
2. Is the reranker worth its latency and the ~90 MB offline-tarball growth? (Phase 6 measurement decides.)
3. Does a 384-d embedder beat MiniLM on this eval? (Phase 6; default unchanged unless it wins.)
4. Where should the `no_strong_match` threshold sit so both negatives trip and no correct @1 hit does?
5. Is HNSW `markDelete`/`addPoint` stable enough over many edits, or is rebuild-from-cached-vectors
   simpler and fast enough? (Phase 3: measure rebuild time on ~5k vectors; prefer rebuild if < 200 ms.)

## Decisions Made
- Test questions are our own (user, 2026-11-06): none of the issue's 20 benchmark questions are
  reused; the issue's numbers are a reference point only, not a target set.
- Index freshness (Phase 3) goes before the retrieval fixes: they change parsing and edges, which
  needs `schemaVersion` invalidation, and BM25/dedup reuse the reconcile and chunk-hash machinery.
- No resident watcher, and no optional per-directory `fs.watch` either: pull-based reconcile covers
  freshness; add the per-directory dirty flag only if lazy reconcile proves too slow.
- `Watcher` stays exported (deprecated) and `--no-watch` stays accepted until v2.0.0: removing a public
  export or flag is a breaking change.
- The CLI/hook search path stays read-only: validates `generation`/`schemaVersion`, never writes, so
  the server remains the only writer.
- One branch, one PR, one release (v1.9.0): the repo's plan rule, confirmed by the user 2026-11-06. Phases commit separately so the
  PR can be reviewed commit by commit.
- BM25 in-house, no dependency: no BM25 library is installed; the scorer is ~60 lines.
- `search_semantic` stays vector-only; fusion, rerank and the graph boost live in `search_hybrid`, so
  the eval can still separate the arms.
- Abstention is a numeric threshold, not a Jev call: it is arithmetic on scores, which Jev does not do.
- Rerank and embedder changes are hypotheses gated by the eval; nothing becomes default without a
  measured @1 gain.
- Phase 2 fixture root is the `.documentation/` content itself (`test/fixtures/docs-vault/` mirrors what
  hewtd writes inside `.documentation/`), not a vault containing a `.documentation/` dir: the indexer's
  `glob("**/*.md")` has no `dot: true`, so a dot-dir under the notes path is never indexed. The archive
  cases are the top-level `archive/` plus the nested `security/archive/`.
- Phase 2 gate lives in `test/retrieval-eval/baseline.json` (answered@1 count per arm, archive hits, link
  precision/recall), enforced by `docs-eval.test.ts`; `npm run eval` is also its own CI step. Text arm =
  every content word of the question as one regex alternation, in `search_text`'s own order (it has no ranking).
- Plans are in `.gitignore` (`.planning/`) but tracked plans are force-added (`git add -f`), as the
  existing plans are.

- Phase 3 measured Key Question 5: HNSW rebuild from cached vectors is 87 ms / 1,020 ms / 3,004 ms at 1k / 5k / 10k
  vectors (384-d), over the 200 ms bar, while 50 markDelete+addPoint edits cost 6 / 17 / 26 ms. So the index updates
  in place (`VectorIndex.addChunks` / `removeDoc`) and is rebuilt from cached vectors only when more than 30% of nodes are deleted.
- Phase 3 commit consistency: `meta.json.files` holds size + mtime of the five commit files (hnsw.bin, hnsw-meta.json, graph.json,
  docs.cache.json, manifest.json) and a reader accepts the index only if all match; `embeddings.json` is outside the commit set
  (content-addressed, any version is valid). This keeps every file in its old format (judge-pack, stale-audit and the e2e test read them)
  instead of stamping a generation into each file.
- Phase 3 unified full index and reconcile: `fullIndex` is `reconcile` against an empty manifest, so one code path parses,
  embeds unseen chunk hashes, and updates the index. `--reindex` passes `forceReindex`; `createServer({waitForReady})` on a warm cache now reconciles.
- Phase 3 `stale: true` is `_meta.stale` on tool results (search results are arrays, so a body field would change their shape) and `stale` in `get_stats`.
- Phase 3 tools that write notes (write, patch, log, metadata, contract, session groups) lift the 2 s reconcile throttle so a search right after a write sees it.
- Phase 3 `**/node_modules/**` is now an ignore glob for the full index too (only the watcher ignored it before); the list is one constant (`IGNORE_GLOBS`) shared by `indexAll` and `reconcile`, hashed into `meta.ignoreGlobs`.
- Several Phase 11 acceptance tests were written with Phase 3 in `test/integration/freshness.test.ts` (edit mid-session, touch-all, warm start, edit while down, schemaVersion bump, mixed commit, zero inotify, two processes, edit during reconcile); Phase 11 should re-check and tick them, not rewrite them.

- Phase 4: hub files (`graph.exclude_hubs`) are left out of the graph as nodes, not just as traversal hops: one rule covers
  traversal, degree ranking and statistics. `search_text` also honours `path_class.exclude` unless the call passes an explicit `pathGlob`.
- Phase 4: `types` filter exists on the MCP tools `backlinks`/`forwardlinks`/`graph_path`; the CLI has no such subcommands (the tool help in `cli/index.ts` documents it). `findPath` is now a small BFS over the typed edges, so `graphology-shortest-path` is unused (dependency left in package.json; drop it in Phase 10).
- Phase 4: the boost seeds are the top 5 semantic docs; two linked seeds boost each other. Graph config (hub globs) is read at server start, so a change needs a restart.

- Phase 5: the CLI `search` (hooks path) stays vector + graph boost: it reads `docs.cache.json` with no BM25 index, so its order can differ from
  `search_hybrid` until Phase 11's CLI/MCP same-order regression decides whether to build BM25 there too.
- Phase 5: fused scores are scaled so a doc ranked first by both arms is 1.0; they are not cosine, so Phase 7 calibrates confidence on its own signals.

- Phase 6: the reranker is shipped as an opt-in code path (config + tests + fallback), not default, because no variant met both @1 up and p95 < 150 ms; `rerank` block added to the default `vault.schema.yml` template (`enabled: false`). `EVAL_RERANK` / `EVAL_MODEL` / `EVAL_RERANK_MODEL` env knobs in `docs-eval.test.ts` reproduce the trials.

- Phase 7: `no_strong_match` rides on every returned item (the tool response is an array, so a body field would change its shape); `confidence` and the flag exist on `search_semantic` and the CLI too, calibrated on `search_hybrid` only (the CLI has no BM25 arm, so its confidence reads lower). `search_text` keeps its old shape. Trimmed payload fields: path/title/score/confidence/snippet (600-char excerpt) plus `decay`/`usage` when present.

## Errors Encountered
- Phase 7: full-suite runs failed `skill-eval` concurrency and `hook-failure` Jev-hang timing under load average 16-19; both pass alone (skill-eval confirmed on a clean stash too). Unrelated.
- Phase 6: full-suite runs failed `skill-eval` concurrency, `hook-failure` Jev-hang timing and `profile-mcp` in turn under load average 12-16; each passes alone or on rerun (same flakes as Phases 2-5). Unrelated.
- Phase 2: `test/unit/skill-eval.test.ts` concurrency case ("never exceed 5 live claude processes") and one other timing test failed in 2 of 3 full runs under load, passed alone and on the 3rd full run. Unrelated to this work (process-timing based); not touched.
- Phase 3: `hook-failure.test.ts` "Jev error or hang" (3209 ms vs a 3000 ms budget) failed once under the full-suite load, passed alone. Unrelated (hook process timing).
- Phase 3: sorting the file listing changed which of two equal-length graph paths wins, so the `graph_path` golden snapshot (project-overview -> user-service) now goes via api-gateway instead of microservices; both are shortest paths. Snapshot updated.
- Phase 3: reconcile parsed files in completion order, so HNSW insertion order varied and one `docs-eval` run failed once (approximate-NN tie flips); fixed by keeping `plan.parse` order. 6 consecutive eval runs green after.
- Phase 5: full-suite runs under load failed profile-mcp, e2e meta.json and skill-eval concurrency in turn; each passes alone or on rerun (skill-eval concurrency fails alone too under load); the 3rd full run was 749/749. Unrelated timing.
- Phase 4: one full run failed `e2e/new-features.test.ts` "should write meta.json with model info" and the skill-eval concurrency case; both pass alone and in the next two full runs (load timing, unrelated).

## Status
**Currently in Phase 8** (graph as knowledge). Phase 7 (confidence, abstention and payload size) done: threshold 0.50, 6/6 negatives flagged, 2 of 23 correct @1 hits flagged; numbers in notes.md "Phase 7".

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
    /archive-plan retrieval-graph-quality    # -> .planning/.archive/retrieval-graph-quality/

Archiving moves this directory to the gitignored .planning/.archive/ and stamps
it archived. Nothing is destroyed.
