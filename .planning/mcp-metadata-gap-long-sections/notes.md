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
