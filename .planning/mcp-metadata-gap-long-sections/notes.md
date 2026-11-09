# Notes: mcp-metadata-gap-long-sections (#73)

## Phase 1: verification against main @ 0ec988d (v1.21.0)

### Claim 1: metadata lost without `.hewtd/graph.json`. Reproduced; the cause is timing.
- `loadFromDisk` in `src/mcp/context.ts` sets `vectorIndex = tempVector` and `resetBm25(docs)`, then runs `setDocuments(docs, await loadCode(docs))`.
  - The argument is evaluated first, so `docByPath`, `documents`, text search and the graph stay empty (on first load) or stale (on reload) until `loadCode` returns.
  - The reconcile path does the same: `vectorIndex = next; setDocuments(docs, await loadCode(docs))`.
- `search_hybrid` only checks `ctx.getVectorIndex()`, so it answers during the gap. In that window:
  - `enrichResult` misses, so the title is the path and `load_priority`, `status`, `tier` and `domains` are absent.
  - `applyPriorityBoost` and `applyDecay` do nothing.
  - `filterPathClass`'s `generated` check and the status/tier/domain filters pass everything through.
  - `relatedTo` has no graph.
- Without an export, `loadCode` runs `fallbackCode`, which calls:
  - `gitFiles`
  - `gitIgnored`
  - `gitLastChanged`: one `git log --name-only --no-renames` over full history per 500 pathspecs, with a 60 s timeout each.

  With an export covering every doc, `fallbackCode` has almost nothing to do, which is why d1b keeps titles.
- On this repo `loadCodeData` takes 85 ms (135 docs), so the gap is invisible here.
- Repro: a PATH shim makes `git log` sleep 20 s, then the stdio `--read-only` server is queried 2 s after start, with `full: true`:

  | | #1 | #3 | lp / status | related |
  |---|---|---|---|---|
  | in the gap | title = `deployment/release-process.md` (0.728) | `legacy/changelog.md` (should be excluded) | none | 0 |
  | after | Release Process (0.745) | KB fact | 6 / active | 1 |

- Scripts are in the session scratchpad (`r73/q.mjs`, `r73/shim/git`). Phase 2 turns them into a repo test.
- Paths key consistently: `docs.cache.json` paths equal the result paths. The reporter's "keys differ" guess is not the cause.

### Claim 2: long multi-topic sections. Plausible, not measured.
- `CHUNK_TARGET_CHARS = 2000` (src/core/indexer.ts).
- The embedder truncates at `max_length: 512` tokens (src/core/embedder.ts, embed-worker.ts), so the reporter's "back half never reaches the vector" is not literally true.
- MiniLM-L6-v2 was trained at 128–256 tokens and mean-pools, so a 2000-char chunk (about 450–500 tokens) dilutes any one fact.
- The 1.21 doc summary chunk is title + purpose + up to 40 headings + 500 chars, and can also exceed 256 tokens.
- To measure in Phase 2: rank against fact offset and chunk token count.

### Claim 3: eval cannot see claim 1. Confirmed.
- The CLI `eval` and `search` (src/cli/search.ts) build `docByPath` from the loaded docs before the first query. They never run while an MCP server is serving mid-load.
- `scripts/lib/eval-probe.mjs` (1.21) already drives stdio, but only after the index is ready, and it reports field counts, not ranking.

### Reporter's numbers (external kit, 919-doc tree), for reference
- d0 (no export), hybrid: set C @1 0.57 (1.15), 0.47 (1.20), 0.47 (1.21); A+B @1 0.79, 0.68, 0.65; A+B multi 0.85, 0.43, 0.43.
- d1b (export): 1.21 set C 0.46, A+B 0.68, multi 0.43.
- Built-in eval on d0: hybrid @1 32 → 27 → 26; multi 5 → 1 → 1; negatives 4/17 → 3/17 → 3/17.
  The built-in eval has no load gap, so this loss is separate from claim 1 and is likely claim 2 or the 1.16+ ranking changes.

## Eval results: Phase 2 (reproduce, no fixes)

Measured on `git clone --local` of this repo (main @ bb7d5c9 plus this phase's eval changes), published 1.15.0 and 1.21.0 against `local` in the same run, `scripts/eval-against-release.sh` (the driver is always this checkout's `eval`; `--server` picks the build under test). Nothing was tuned; all sets are reported as measured.

### Tooling added
- `eval --via mcp [--cwd <repo>] [--server <cli>] [--wait-for-ready]`: same facet eval, same client (`src/core/retrieval-eval/runner.ts`, `openEval(notes, via)`), but the server is the stdio process the plugin launches (`--notes <notes> --read-only`, cwd = repo). Default: no `--wait-for-ready`, queries start as soon as the server answers; "Indexing in progress" replies are retried, never scored. Report gains `mcp`: `firstAnswerMs`, `relatedPerTop`, `top1With` (titled, section, anchor, code, decay, grounding) and entity cards for 4 identifiers.
- `scripts/lib/eval-probe.mjs` removed (its client is now the one in runner.ts); `eval-against-release.sh` prints a `cli` and an `mcp` row per run, and copies `test/fixtures/long-section/` into the clone when a `long-section*` set is used.
- `test/e2e/stdio-load-gap.test.ts` (slow-`git log` PATH shim, `--read-only` server, query at once). Both tests FAIL on main, so they are `it.fails` until Phase 3 flips them:
  - first answer: `title` is `release-guide.md` (the path) instead of `Release Guide`, so no `loadPriority`/`status`;
  - `status: "active"` returns `[]` (nothing is filtered in, because no doc is known yet).
  - Not exercised yet because the first assertion fails first: the `generated`/`archive/` exclusion check in test 1.
- `test/fixtures/long-section/` (8 docs) and `test/retrieval-eval/long-section.jsonl` (15, train: kiln, apiary, telescope, cooperage) and `long-section-heldout.jsonl` (14: ferry, cheese, bells, lamp). Questions written and facet-checked (each facet occurs in exactly one fixture doc and nowhere in `.documentation`) before any measurement.

### Baseline: hybrid @1/@3/n per set (answerable questions only)

| run | real-corpus | real-corpus-heldout | real-hub | real-hub-heldout | long-section | long-section-heldout |
|---|---|---|---|---|---|---|
| 1.15.0 cli = mcp | 18/22/27 | 13/21/27 | 6/9/12 | 4/9/10 | 15/15/15 | 14/14/14 |
| 1.21.0 cli = mcp | 18/25/27 | 16/23/27 | 6/10/12 | 6/9/10 | 15/15/15 | 14/14/14 |
| local cli = mcp | 18/25/27 | 16/23/27 | 6/10/12 | 6/9/10 | 15/15/15 | 14/14/14 |
| 1.15.0 export cli = mcp | 18/22/27 | 13/21/27 | 6/9/12 | 4/9/10 | 15/15/15 | 14/14/14 |
| 1.21.0 export cli = mcp | 20/25/27 | 17/23/27 | 6/9/12 | 6/8/10 | 15/15/15 | 14/14/14 |
| local export cli = mcp | 20/25/27 | 17/23/27 | 6/9/12 | 6/8/10 | 15/15/15 | 14/14/14 |

Pooled (105 answerable, 39 negatives), no export, cli / mcp: 1.15.0 71 @1, 35/39 flagged; 1.21.0 75 @1, 33/39; local 75 @1, 33/39. With export: 1.15.0 71, 1.21.0 79, local 79. Cold index: 1.15.0 24 s, 1.21.0 66 s (export 42 s), local 44 s (export 41 s). 1.15.0 has no `section`/`anchor`/entity card (0/4 cards) and its `related` is 0 in the cli eval.
- 1.21.0 mcp, no export: `titled` 102 of 105 on #1. Three #1 answers came from inside the load gap on a clone of this repo, with no slowed git. (CLI and mcp @1/@3 are identical per set; the damage there is metadata, not rank.)

### Slow git (`git log` sleeps 20 s via PATH shim), local build, `eval --via mcp` at once, 4 real sets (76 answerable)
- The whole eval ran inside the gap: titled 0/76, `related` 0, section/anchor/code/decay/grounding all 0; entity cards still 4/4 (computed after the gap closed).
- hybrid @1 was 51, against 46 for the same sets and build with no gap (and `--wait-for-ready` gives the same 46 as at once). @3 68 and @8 75 equal. So with no doc metadata (no priority boost, no decay, no path-class or generated filter, no `related`) the vector+BM25 order was better at @1 by 5 questions on this corpus. That is a lead for Key Question 1, not a result: decompose it on the TRAIN sets in a later phase (priority boost, decay, path class, section fold) before any change.

### Claim 2: long sections (not reproduced on this fixture)
- Every fixture section is one chunk of 366-413 tokens (MiniLM tokenizer, trail not counted; short controls 60-64). None split into two chunks, and the paragraphs/bullets are 350-500 characters, not 1,000+: **deviation from the plan**, a section with a 1,000+ character bullet was not built.
- Hybrid @1 is 29/29 on every version (1.15.0, 1.21.0, local), with and without an export. Fact offsets span token 20-388; 9 facts sit past token 256 (MiniLM's trained length). The doc is #1 for every fact, so rank does not fall with offset or with chunk length here: the fixture saturates and cannot show a loss by rank.
- Margin (local, `search_semantic`, fact doc score minus best other doc), 29 questions:
  - short chunks (60-64 tokens) 0.274 mean, long chunks 0.175;
  - long chunks by fact offset in tokens: 0-99 0.190 (n=6), 100-199 0.218 (8), 200-299 0.129 (4), 300-419 0.138 (7); Pearson r = -0.32 (offset vs margin, long chunks, n=25).
  - So there is a weak dilution effect (smaller margin with a longer chunk and a later offset), but it never flips a rank on this corpus. A harder fixture (more near-duplicate distractor docs, same device name across docs, facts in 1,000+ character bullets, sections over 2,000 chars) is needed before Phase 5 can pick a variant on train; Phase 5 starts by making it.

### Key Question 1 (reporter's built-in eval loss on d0, 32 to 26)
- Not explained by the load gap: the built-in eval (`runSuite` -> `openEval`, in-process, `waitForReady: true`) never queries during the gap. The same is true of this repo's CLI eval, and on our sets cli == mcp.
- Not reproduced as a loss here: 1.15.0 to 1.21.0 is flat or up on every set (real-corpus 18 to 18 and 13 to 16 @1, hub 6 to 6 and 4 to 6, with export 20/17).
- Not explained by long sections on our fixture (above).
- Left open, needs their tree (919 docs, not in this repo): either corpus scale (many near-duplicates; our sets are 135 docs) or the 1.16+ ranking layers, which the in-gap result above points at (priority/decay/path class cost 5 @1 on this corpus). Phase 3 can run the reporter's tree after the metadata fix; this phase cannot answer it further.

## Eval results: Phase 3 (metadata never lags the index)
- Ranking is unchanged by construction (only the order of installing state moved): `npm run eval` 137 pass, 5 expected fail, as before. Floors untouched.
- Stdio slow-git test (30 s `git log` shim, query at once): first answer now has title "Release Guide", status active, load_priority 8, honours `status: active`, and returns no generated or archive doc. It failed on main (Phase 2).
- Behaviour change to know: the code graph (grounding, entity card, `related`) is applied in the background, so the first answers after a warm start or a reconcile carry `_meta.stale` and the STALE_NOTE until it lands. Previously they waited for it. Phase 2 lead (slow-git @1 51 vs 46) is a ranking question for later: with metadata installed at once, the in-gap arm no longer exists, so it needs a separate decomposition on train.
- The in-gap `related` is empty until step 2 (graph is doc-only meanwhile, not the old graph): `related` appears on the first answers only after the code graph lands, only if `buildFromDocuments` needs the code; doc-only edges are installed with the docs.

## Eval results: Phase 4 (cheaper code-graph fallback)

Measured read-only on `~/workspace/reinvestorhub/RE-InvestorHub` (3,920 commits, 3,795 tracked files, history 2026-01-05 to 2026-11-07), by calling `gitFiles` / `gitLastChanged` from `src/core/code-graph.ts` against it. `gitIgnored` is one `git check-ignore --stdin` over only the dead-candidate refs (not measured on this repo: no vault in it feeds it refs; it is bounded by the number of unresolved refs, 60 s timeout).

| Call | Before (path-limited `git log`, 500 pathspecs per batch) | After (one `git log --since=365.days`, filter in JS) |
|---|---|---|
| `gitFiles` (3,795) | 5 ms | 5-17 ms (same code) |
| `gitLastChanged` 100 files | 16 ms | ~140 ms |
| `gitLastChanged` 1,000 files | 443-455 ms | ~136 ms |
| `gitLastChanged` 3,795 files | 3,034-3,134 ms | ~135 ms (3,795 dated) |

The before cost grows with files asked about (each batch walks the history); the after cost follows commits in the window (28,753 name lines in 365 days, 80 ms raw). Small asks are a little slower (one fixed full-window log), large asks are 20x faster. Worst case for the old code on a 20k-file repo would have exceeded the 60 s timeout per batch set; the new one is a single bounded call. This repo is only 10 months old, so every file stayed inside the window; on an older repo untouched files are left undated.

Bound: `CODE_DATE_WINDOW_DAYS = 365`. A file not changed in the window has no date, so it is never reported as drifted (information only since 1.21; matters only to the opt-in `drift_penalty`). Docs' own dates are not bounded.

`get_stats` gains `codeGraph: { source: export|fallback|none, loadMs }` (absent until the first load). Verified: unit test (window, one log), integration assertion in `test/integration/code-load-order.test.ts`, golden snapshot test strips the volatile field.

Gates: lint, build green; npm test: flakes (real-corpus beforeAll timeout under load, freshness-scale, hook-failure) pass alone (real-corpus 16 pass + 1 expected fail, 308 s); `npm run eval` 137 pass, 5 expected fail.

## Eval results: Phase 5 (long sections)

### Harder fixture (built first, as Phase 2 required)
- `test/fixtures/long-section-hard/` (9 docs) and `test/retrieval-eval/long-section-hard.jsonl` (12 train: Vessel Rock lighthouse, Dunmore tannery, Halloran press) and `long-section-hard-heldout.jsonl` (12: Orrin windmill, Pennick brewery, Teasel lock). Each long doc is one 2.9-3.4 KB section of five bullets (450-800 chars, still under the plan's 1,000+; **deviation**) plus a short same-topic distractor doc about another station/works/press with a different value (and, for the lighthouse and the lock, a generic authority doc). Questions name the entity. Facets checked to occur in exactly one fixture doc and nowhere else in the corpus, before any variant was measured.
- It discriminates: hybrid @1, no export, same run, 1.15.0 11/12, 1.21.0 8/12 (7/12 via MCP inside the load gap), local main 8/12. So claim 2 is reproduced on this set (1.21's 2000-char chunks lose 4 of 12 to the focused distractors, 11 to 7); @3 is 12/12 everywhere.
- `scripts/eval-against-release.sh` copies `long-section-hard/` into the clone for a `long-section-hard*` set (and `long-section/` for the first fixture's sets).

### Variants, train only (66 answerable: real-corpus 27, real-hub 12, long-section 15, long-section-hard 12), no export, clone, cli = mcp
| variant | hybrid @1 | semantic @1 | multi @1 | #1+related | chunks | index size |
|---|---|---|---|---|---|---|
| 1.15.0 | 51 | 40 | 9/13 | 55 | | 7.7 MB |
| 1.21.0 = (a) 2000-char chunks | 46 | 41 | 7/13 | 55 | 1113 | 16.2 MB |
| (b) 1000-char windows | 51 | 42 | 9/13 | 57 | | 18.2 MB |
| (c) 1000 + one sentence overlap | 51 | 45 | 9/13 | 59 | 1326 | 18.3 MB |
| (d) 1000-char windows, stride half a window | 52 | 43 | 8/13 | 57 | | 19.5 MB |
- Per set, hybrid @1: real-corpus a 36, b 39, c 38, d 39 (1.15.0 37); hub 8 everywhere; long-section 15 everywhere; long-section-hard a 7, b 9, c 10, d 10 (1.15.0 11). @3 equal. A second build of each gave identical numbers (the index is deterministic at this size).
- Choice: (c). Hybrid @1 is within one case of the best (d 52, b = c 51), and one case is the run-to-run slack, so the tie goes to the best of the rest: (c) has the best semantic @1 (45) and #1+related (59), and it is the design #73 describes (window plus a sentence of overlap); (d) costs 7% more index than (c) for the one extra case. Held-out played no part.
- The measured window is `CHUNK_TARGET_CHARS = 1000` (~256 tokens at ~4 chars/token), from the model's `max_seq_length`, not tuned: 800 or 1200 were not tried. Characters stand in for tokens: after the change the chunks are p50 139 / p95 304 / max 411 tokens (231 of 1326 over 256, code and tables run dense); before, p95 461, max 689 (244 of 1113 over 256). Not read from the model config (the cached `config_sentence_transformers.json` has no `max_seq_length`; the 256 is a constant with a `shortcut:` comment).
- Overlap guard: the carried sentence is kept only if it fits with the next one, so no overlap-only chunk and no duplicate. The first prototype (c) lacked it; the final code was re-run on train and gave the same 51/45.
- The env knob first used for the trial did not reach the stdio server (the MCP SDK's stdio transport passes only a safe subset of the environment): the first mcp arms of b, c and d read as variant (a) and differed from their cli arms by 4-5 questions. Re-run as per-variant package copies; cli = mcp then. Trial knob removed.
- Doc summary chunk: 17 of 126 summary chunks are over 256 tokens (p95 365, max 923). Cutting the summary to the 1000-char window gave identical results on train (51/66, 45 semantic) so it was **not** changed (the plan: only if it shows a gain).

### Cold index, size, held-out (same tree: clone of this repo + both fixtures, 156 docs, this machine, run alone)
| | cold index no export | export | index size (train tree, dir) |
|---|---|---|---|
| 1.15.0 | 24.5 s | 29.0 s | 7.7 MB |
| 1.21.0 | 50.1 s | 45.4 s | 16.5 MB |
| local (1.22 dev) | 57.2 s | 46.8 s | 18.3 MB |
- 1326 chunks against 1113 for 2000-char chunks (+19%); cold index +14% over 1.21.0 without an export (noise between runs is a few seconds); 2.3x over 1.15.0 (the doc summary and field chunks of 1.21 and section splits of 1.9 account for 1.21's own doubling).

Hybrid @1 per set, answerable only, no export / export (cli = mcp on every run):
| set | 1.15.0 | 1.21.0 | local |
|---|---|---|---|
| real-corpus (train) | 18 / 18 | 18 / 20 | 20 / 20 of 27 |
| real-hub (train) | 6 / 6 | 6 / 6 | 6 / 6 of 12 |
| long-section (train) | 15 / 15 | 15 / 15 | 15 / 15 of 15 |
| long-section-hard (train) | 11 / 11 | 7 / 7 | 10 / 10 of 12 |
| **train total** | 50 / 50 | 46 / 48 | 51 / 51 of 66 |
| real-corpus-heldout | 14 / 14 | 16 / 17 | 16 / 18 of 27 |
| real-hub-heldout | 4 / 4 | 6 / 6 | 6 / 6 of 10 |
| long-section-heldout | 14 / 14 | 14 / 14 | 14 / 14 of 14 |
| long-section-hard-heldout | 12 / 12 | 8 / 8 | 10 / 10 of 12 |
| **held-out total** | 44 / 44 | 44 / 45 | 46 / 48 of 63 |
- Held-out, as measured: local is above both published versions in total (46/48 vs 44/45 and 44/44). On the hard long-section sets it recovers 2 of the 4 questions 1.21.0 lost against 1.15.0 on held-out (10 of 12 against 8 and 12) and 3 of 4 on train (10 against 7 and 11): **missed target, not fully back to 1.15.0 on long multi-topic sections with focused distractors.** @3 is 12/12 for the hard sets on all three, so the doc is found, just not first.
- Real-corpus held-out and train are flat or up against 1.21.0; no set fell.
- The remaining hard-set misses were not examined: held-out is not for tuning, and a train fix would be a ranking change, which this phase does not make.
- Key Question 2 (does chunk length or offset explain claim 2?): chunk length. On a fixture where focused distractors exist, 2000-char chunks lose rank (11 to 7 of 12 on train, 12 to 8 held-out) and 1000-char windows with overlap win most back; the first fixture (no distractors) showed no rank effect at all.

## Eval results: Phase 6 (gate against 1.21.0, held-out real-corpus + hub + long-section + long-section-hard, 63 answerable, 80 questions)
Runtime: `npm run gate:release -- 1.21.0` takes about 6 min (4 clone indexes, 8 evals) on this machine, 4.5 min on a quiet run. Result: PASS.

| run | hyb@1 | multi@1 | #1+rel | mcp titled #1 | 1st answer |
|---|---|---|---|---|---|
| 1.21.0 cli / mcp (no export) | 44 / 44 | 7 / 7 | 51 / 51 | 63/63 | 0.9 s |
| 1.21.0 mcp, slow git | 45 | 6 | 45 | **0/63** (rel/#1 0.00, no section, anchor, decay, grounding) | 0.9 s |
| local cli / mcp (no export) | 46 / 46 | 7 / 7 | 52 / 52 | 63/63 | 1.5 s |
| local mcp, slow git | 46 | 7 | 52 | 63/63 (grounding 0/63 until the code graph lands) | 1.1 s |
| 1.21.0 export cli / mcp | 45 / 45 | 7 / 7 | 51 / 51 | 63/63 | 1.5 s |
| local export cli / mcp | 48 / 48 | 7 / 7 | 53 / 53 | 63/63 | 1.5 s |

- The slow-git arm reproduces #73 on 1.21.0 (titled 0/63) and shows the fix (63/63). A gate with local in that row would have failed 1.21.0.
- Parity: 0 of 80 questions differ between local cli and local mcp, with and without export, after settling. Before settling, with export, 1-2 questions differed in top 3 (first run: 1, repeats: 1, 2, then another question in 2 more); cause is the in-process arm scoring the post-code-graph state and the stdio arm the first answers. Stale answers carried `_meta.stale` as designed.
- Held-out mixes four sets, so these are measurements, not tuning signals.

## Eval results: Phase 9 (independent review and #73 acceptance)

### Review findings (git diff main...HEAD, read adversarially)
- **Fixed, real bug (src/mcp/context.ts):** `loadCode` assigned `codeData` itself, so with two code loads in flight (a swap while the first `git log` is still running) the OLDER load finishing last overwrote the newer docs' code (`getCode()` stale until the next stamp change; entity cards and fold used the wrong code). `codeData` is now set in `applyCode`, only when `documents === docs`. Regression test in test/integration/code-load-order.test.ts (loads released out of order, tagged by call number); it fails on the Phase 3 code and passes now.
- **Fixed, flaky test:** the "adding or removing .hewtd/graph.json" test compared per-doc metadata in `getDocuments()` order, which follows parallel indexing order (failed about 1 run in 3). It now sorts by path; 8 runs in a row green.
- Fixed a comment in scripts/gate-release.sh ("~15 min", it is ~6 min).
- Audited, no change: the chunk overlap guard (no overlap-only or duplicate chunk, a sentence longer than the window stays whole); `--settle` retry window (60 s per call, only for `_meta.stale`); `isStale()` covers the upgrade window (index-upgrade.test.ts, unchanged and green); `content[0]` of every search tool is untouched; `codeLoad`/`get_stats` shape.
- Not changed, known limits: `setDocuments(docs)` in the reconcile path still leaves the previous `codeData` in place until the new load lands (marked `_meta.stale`); the gate does not check `related`/grounding inside the stale window, and the plain mcp arm settles; gate has no unit harness (the gate run against 1.21.0 is the test: its slow-git arm scores titled 0/63 on 1.21.0 and 63/63 on local).

### Checks run on the final tree
lint, build green. `npm test`: 1176 pass, 5 expected fail, 1 fail = hook-failure (known Jev-hang load flake, passes alone 14/14). `npm run eval`: 137 pass, 5 expected fail (section eval and parity tests included). `npm run gate:release -- 1.21.0`: PASS (output below).

### #73 acceptance, 1.15.0 / 1.21.0 / local in the same run (clone of this repo + both long-section fixtures, 156 docs)
All eight sets, 129 answerable questions (train + held-out pooled; per-set below). cli = in-process eval, mcp = `eval --via mcp --settle` on the same index, mcp-slow = stdio at once with `git log` sleeping 30 s.

| run (no export) | hyb@1 | hyb@3 | multi@1 | #1+rel | titled #1 (mcp) | grounding |
|---|---|---|---|---|---|---|
| 1.15.0 cli / mcp / mcp-slow | 95 / 95 / 95 | 115 | 14/23 | 105 | 129 / 129 | 0 |
| 1.21.0 cli / mcp | 90 / 90 | 121 | 14/23 | 106 | 129 | 59 |
| 1.21.0 mcp-slow | 95 | 121 | 15/23 | 95 (related 0.00) | **0 of 129** | 0 |
| local cli / mcp | 97 / 97 | 121 | 16/23 | 111 | 129 | 60 |
| local mcp-slow | 98 | 121 | 16/23 | 111 | 129 | 0 (until the code graph lands) |

| run (export) | hyb@1 | hyb@3 | multi@1 | #1+rel | titled |
|---|---|---|---|---|---|
| 1.15.0 cli / mcp | 95 / 95 | 115 | 14/23 | 105 | 129 |
| 1.21.0 cli / mcp | 94 / 94 | 119 | 16/23 | 106 | 129 |
| local cli / mcp | 99 / 99 | 119 | 14/23 | 110 | 129 |

Hybrid @1 per set (answerable), no export / export:
| set | 1.15.0 | 1.21.0 | local |
|---|---|---|---|
| real-corpus (train) | 18 / 18 of 27 | 18 / 20 | 20 / 20 |
| real-corpus-heldout | 14 / 14 of 27 | 16 / 17 | 16 / 18 |
| real-hub (train) | 6 / 6 of 12 | 6 / 6 | 6 / 6 |
| real-hub-heldout | 4 / 4 of 10 | 6 / 6 | 6 / 6 |
| long-section / -heldout | 15 and 14 (all) | 15 and 14 | 15 and 14 |
| long-section-hard (train) | 11 / 11 of 12 | 7 / 7 | 10 / 10 |
| long-section-hard-heldout | 12 / 12 of 12 | 8 / 8 | 10 / 10 |

Gate against 1.21.0 (held-out, 63 answerable, 80 questions): PASS. No export: hybrid @1 46 vs 44 (cli), 46 vs 45 (mcp), multi 7 vs 7; export: 48 vs 45 both; mcp vs cli 0 of 80 differ (both modes); local mcp titled 63/63 (also with slow git); first answer 0.9 to 1.7 s.

### Answers to each #73 item
1. **Metadata missing without the export / the first query (claim 1): met.** Reproduced on main by the stdio slow-git test (title = path, `status` filter returns []). Fixed: titles, `load_priority`, decay, filters and `related` come with the vector index. 1.21.0 in the same run, queried at once with slow git: titled 0/129, `related` 0.00, no section/anchor/decay; local: 129/129 titled, related 0.78. What is NOT immediate: grounding, code edges and the entity card, which wait for the code graph (0 of 129 grounded in the slow arm; answers carry `_meta.stale`). This is the design, but `related` that comes from code edges is also absent until then.
2. **Long multi-topic sections found at least as well as 1.15.0 (claim 2): partly met, not met on the hard sets.** Reproduced only on the hard fixture (1.21.0 loses 4 of 12 train and 4 of 12 held-out against 1.15.0). Local gets 3 of 4 back on train (10 vs 11) and 2 of 4 on held-out (10 vs 12). All versions are 12/12 at @3, so the doc is found but not always first. The first fixture saturates on every version. Pooled over all eight sets local is above both (97 vs 95 and 90; export 99 vs 95 and 94), but that is carried by real-corpus and hub, which gained in 1.16+. Bullets in both fixtures are 350-800 chars, not 1,000+, so a section with a 1,000+ character bullet was never tested.
3. **The eval and the gate see the MCP path (claim 3): met.** `eval --via mcp` (stdio server as the plugin launches it, at once) and `gate:release` (no export, export, slow git; cli vs mcp parity in top 3, related and entity; titles on first answers). The gate's slow arm fails 1.21.0 (0/63 titled) and passes local. Gaps: the gate does not check grounding or `related` inside the stale window; stale-window ranking differences (seen before settling, 1-2 of 80) are not gated; the gate takes ~6 min and needs the network.
4. **The reporter's built-in-eval loss on d0 (hybrid @1 32 to 26, multi 5 to 1): NOT reproduced, not explained.** On our 135-doc corpus 1.21.0 vs 1.15.0 is flat or up on real-corpus and hub, and the in-process eval never sees the load gap. Local is 97 vs 95 pooled. Their 919-doc tree is needed; this is the post-publish re-run on d0 and d1b.
5. **Slow-git @1 51 vs 46 lead:** re-seen on 1.21.0 here (mcp-slow 95 vs 90 pooled: with no doc metadata @1 is higher). Local with metadata scores 97, so the 1.22 build does not carry that cost on these sets, but the cause (priority boost, decay, path class or fold) was not decomposed. Open, and a ranking question for a later issue.
