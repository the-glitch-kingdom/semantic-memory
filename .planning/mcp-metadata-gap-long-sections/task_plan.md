# Task Plan: mcp-metadata-gap-long-sections

## Goal
Ship semantic-memory#73 as v1.22.0:
- MCP results always carry their doc metadata (title, `load_priority`, decay, `generated`/`status`/`tier`/`domain` filters, `related`), with or without `.hewtd/graph.json`, from the first query on.
- A fact inside a long multi-topic section is found at least as well as on 1.15.0.
- The eval and the release gate measure the path agents call (the stdio MCP server), so neither problem can ship unseen again.

One PR from `feat/mcp-metadata-gap-long-sections`. Every missed target is stated in the PR and on #73. Another agent re-runs the reporter's tree (d0 and d1b) after publish.

## Prerequisites
- v1.21.0 on main (0ec988d). Published 1.15.0, 1.20.0 and 1.21.0 are on npm for same-run comparisons (`scripts/eval-against-release.sh`).

## Rules for every phase
- **Verify before ticking.** Confirm in code, or with a test, that a box is actually done before ticking it.
- **Eval discipline.**
  - Every constant and variant is chosen on train only; held-out is reported as measured.
  - Compare against published 1.15.0 and 1.21.0 measured **in the same run**, never against floors.
  - Measure on a `git clone --local` of this repo, so code and history are present, both with and without an export (`npx hewtd index` in the clone).
- **Measure the MCP path.** Ranking numbers come from the stdio server as the plugin launches it (`--notes .documentation --read-only`, cwd = repo), as well as from the CLI `eval`.
- **Section results stay.** `section`/`anchor` still point at the matching section, and the section eval stays green.
- **Response shape.** `content[0]` stays a bare JSON array, and MCP and CLI agree (parity tests).
- **Works without hit-em-with-the-docs.** Every fix is measured with and without `.hewtd/graph.json`.

## Phases
- [x] Phase 1: Verify and plan
  - [x] Verify #73 against main @ 0ec988d (notes.md): claim 1 reproduced with a slow-`git log` shim; claim 2 checked in code; claim 3 confirmed
  - [x] Post the verification comment on #73
  - [x] Sync main, cut `feat/mcp-metadata-gap-long-sections`, commit this plan (with the archive move of `hub-doc-ranking-regression`)
- [x] Phase 2: Reproduce first (tests and eval before any fix)
  - [x] Stdio regression test (`test/e2e/`):
        - Start the `--read-only` server on a git repo whose `git log` is slowed by a PATH shim.
        - Query at once, and assert the first answer carries real titles, `load_priority`/`status` (with `full`), honours the `status` filter, and never returns a `generated`/excluded doc.
        - Must fail on main. Record that it does.
        - Done: fails on main (title = path, `status` filter returns []); kept as `it.fails` so the suite is green until Phase 3 flips it. The `generated`/`archive/` assertion is not reached yet.
  - [x] `eval --via mcp`: run the question sets through the stdio server as the plugin launches it.
        - Default: query as soon as the server answers, not after waiting for ready.
        - Report the same metrics as the CLI eval, plus `related` per #1 and entity cards.
        - Reuse `scripts/lib/eval-probe.mjs` or move its client into `src/core/retrieval-eval/`; one client, not two.
        - Done: one client in `runner.ts` (`openEval(notes, via)`); `eval-probe.mjs` removed; `--server`/`--cwd`/`--wait-for-ready` added.
  - [x] Long-section fixture and questions:
        - Fixture: a few docs with few headings, bullets/paragraphs of 1,000+ characters, several facts each, placed early, middle and late in the section.
        - Questions in train and held-out (`test/retrieval-eval/long-section*.jsonl`), written and facet-checked before measuring.
        - Done, with a deviation: every section is one chunk of 366-413 tokens and the bullets are 350-500 chars, not 1,000+. The fixture saturates (29/29), see notes.md.
  - [x] Measure claim 2. For each fact, record its offset in its chunk, the chunk's token count (the model's tokenizer), and whether the doc is #1. Does the rank fall with offset or with chunk length? Record in notes.md.
  - [x] Baseline table in notes.md:
        - Versions: 1.15.0, 1.21.0 and local.
        - Sets: real-corpus, hub and long-section.
        - Arms: CLI eval and `eval --via mcp`, each with and without an export, on clones.
- [x] Phase 3: Doc metadata never lags the index
  - [x] Two steps in `loadFromDisk` and the reconcile path (src/mcp/context.ts):
        - **Step 1, atomic with the vector index:** docs, `docByPath`, text search, BM25 and the doc-only graph are installed together. No query can see a new vector index with old or missing docs.
        - **Step 2, when ready:** the code graph is applied (grounding, code edges, entity cards) and the graph is rebuilt.
        - Done (src/mcp/context.ts): `setDocuments(docs)` runs synchronously with the vector swap, in `loadFromDisk` and `sync`; `applyCode` then loads the code graph in the background and rebuilds the graph (skipped when a later swap replaced the docs). Not awaited, so `tryLoadCachedIndex`, reconcile and tool calls no longer wait on `git log`.
  - [x] Until step 2 lands, responses carry `_meta.stale`, and the note names grounding and the entity card as pending.
        - Done: `isStale()` is `stale || codePending > 0`, so the existing `_meta.stale` and STALE_NOTE (already names section, anchor, grounding and the entity card) cover the window. `content[0]` untouched.
  - [x] Audit every other `await` between a state swap and `setDocuments` (save, reconcile, federation sources) for the same gap.
        - Done: save only reads `documents` inside `serial`; fullIndex goes through `sync(true)` (same swap); the code-stamp path in `sync` now uses `applyCode` too (old graph stays until the new one lands); federation sources only call `isStale`. No other await sits between a swap and `setDocuments`.
  - [x] The Phase 2 stdio test passes. Add a unit test for the reconcile path's swap.
        - Done: the two `it.fails` in test/e2e/stdio-load-gap.test.ts are plain `it` and pass; test/integration/code-load-order.test.ts covers warm load and the reconcile swap with a held `loadCodeData`.
  - [x] Removing or adding `.hewtd/graph.json` and restarting changes only grounding: titles, filters and non-grounding ranking stay the same. Add a test.
        - Done: second test in code-load-order.test.ts (code-graph fixture with and without the export: per-doc metadata and vector order equal).
- [x] Phase 4: Cheaper code-graph fallback
  - [x] Measure the fallback on a large local git repo (pick one under ~/workspace with long history; never modify it), timing `gitFiles`, `gitIgnored` and `gitLastChanged` separately. Record in notes.md.
  - [x] Bound `gitLastChanged`. Options:
        - one `git log` with `--since` or `-n`, with files older than that treated as unchanged;
        - or the dates `git ls-files`/`git log -1` give per file.
        Drift is information only since 1.21, so precision matters only for the opt-in `drift_penalty`. Document the bound.
  - [x] `get_stats` reports code-graph load time and source (export, fallback, none).
        (Chose the `--since` option: one `git log --since=365.days`, no pathspec; old files left undated. `gitIgnored` unchanged, one call, bounded by dead-candidate refs.)
- [x] Phase 5: Long sections
  - [x] Embedding windows sized to the model's window: `max_seq_length` from the model's sentence-transformers config (256 for MiniLM), minus the heading trail, with a sentence of overlap. A section scores by its best window, and `section`/`anchor` stay on the section.
        - Done (src/core/indexer.ts): `CHUNK_TARGET_CHARS = 1000` (~256 tokens) plus a sentence of overlap; each chunk keeps `chunkSection`, so `section`/`anchor` are unchanged and the doc scores by its best chunk. 256 is a constant, not read from the config (the cached config has no `max_seq_length`); characters stand in for tokens (shortcut comment).
  - [x] Variants measured on TRAIN only (long-section + hub + real-corpus, on a clone, via MCP): (a) 1.21 chunks; (b) model-window chunks; (c) (b) plus overlap; (d) sentence windows inside a section, best window wins. Keep the best; remove the others.
        - Done: train hybrid @1 a 46, b 51, c 51, d 52 of 66 (1.15.0 51); kept (c), see notes.md. Built a harder fixture first (long-section-hard) because the Phase 2 one saturated. The trial knob and variants (a), (b), (d) are removed.
  - [x] Cold index time and index size against 1.15.0 and 1.21.0 on the same tree. Bump `INDEX_SCHEMA_VERSION` if chunk text changes.
        - Done: cold index 24.5 s / 50.1 s / 57.2 s (1.15.0 / 1.21.0 / local), index 7.7 / 16.5 / 18.3 MB; `INDEX_SCHEMA_VERSION` 10 to 11. Held-out reported in notes.md, same run.
  - [x] The doc summary chunk (1.21) is cut to the window too, if (b)-(d) show it truncates.
        - Done: 17 of 126 summary chunks exceed 256 tokens, but cutting it to the window changed nothing on train (51/66 both), so it is unchanged.
- [x] Phase 6: Release gate sees the MCP path
  - [x] `npm run gate:release` runs `eval --via mcp` as well as the CLI eval, on the held-out sets (real-corpus, hub, long-section). Done: all four held-out sets (long-section and long-section-hard too), cli and mcp arms.
  - [x] Clones run without an export, with an export, and with `git log` slowed for the first-query check.
  - [x] The gate fails when MCP and CLI differ in top 3, `related` or `entity` on any question, or when the first MCP answer lacks titles.
  - [x] Run it against 1.21.0 and record the result. `release-process.md` stays the place that makes it required.
- [x] Phase 7: Release prep
  - [x] Bump all five version fields to 1.22.0 and update the lockfile
  - [x] Offline tarball deferred to release (built from the merge commit)
- [x] Phase 8: Cleanup
  - [x] Remove what this branch created or made dead: losing variants, trial knobs, scratch scripts, debug output  (checked: trial knob and losing variants already gone in Phase 5, eval-probe.mjs removed in Phase 2, no stray debug output, no dead exports; nothing left to remove)
- [x] Phase 9: Validation (independent review)
  - [x] Review `git diff main...HEAD` adversarially against this plan, fix real bugs with regression tests, audit every ticked box
  - [x] Unit: load order and reconcile swap, fallback bound, chunk windows, eval `--via mcp`, gate parity check
  - [x] Integration/e2e: stdio first-query test with slow git; export added or removed then restart; upgrade window (old index) still marked
  - [x] Regression: lint, build, full `npm test` (known load flakes re-run alone), `npm run eval`, section eval green, MCP/CLI parity tests
  - [x] Every #73 acceptance check, against 1.15.0 and 1.21.0 in the same run, via MCP and CLI, with and without export; answered honestly in notes.md (met: 1 and 3; partly met: 2, hard sets not back at 1.15.0; not reproduced: reporter's d0 loss)
  - [x] `npm run gate:release` passes against 1.21.0
- [x] Phase 10: Documentation (full hit-em-with-the-docs pass, no secrets)
  - [x] `.documentation/changelog/v1-22-0-*.md` and the CHANGELOG.md entry: numbers against 1.15.0 and 1.21.0 in the same run, missed targets stated
  - [x] `architecture/code-graph.md` (load order, fallback bound, load time in stats), `architecture/indices-and-storage.md` or the indexing doc (chunk windows, schema version)
  - [x] `retrieval-eval-guide.md` (`--via mcp`, long-section set), `retrieval-tuning-guide.md` (chunk windows), `deployment/release-process.md` (what the gate now checks)
  - [x] Help topics in `src/core/help/topics.ts` that describe chunking, eval or the gate; README version row; AGENTS.md regenerated
  - [x] KB fact (gotcha): an MCP server can serve a new vector index before doc metadata is installed; the CLI eval cannot see it. Include an `## Instead` section and a verify command
  - [x] Final `npm run eval`; floors move only with a measured reason

## Key Questions
1. Is the reporter's persistent loss entirely the load gap, or is there a second miss? Phase 2 runs the MCP eval at once and again after ready, and compares the two.
2. Does chunk length or fact offset explain claim 2? This is measured in Phase 2 before any chunking change.

## Decisions Made
- Phase 6: `gate:release` runs two clone sets per version (no export plus a slow-git arm on the same index; export), each measured cli and mcp, on the four held-out sets. The old awk parse is replaced by a node check of the JSON reports. Parity compares `probes` (hybrid top 3, related paths, entity flag per question) of local cli vs local mcp; the titles check applies to local mcp and mcp-slow. The previous version is only compared on hybrid/multi @1 (band 1) since it has the load gap by design.
- Phase 5: variant (c), 1000-char windows plus a sentence of overlap, chosen on train over (b) and (d) (hybrid @1 within one case; best semantic @1 and #1+related; (d) costs 7% more index). Snapshot scores in test/fixtures/federation/single-source-snapshot.json re-taken for the new chunks (paths, order, fields unchanged).
- One plan for #73: all three claims meet in the MCP load path and the eval that cannot see it.
- Phase 2: the `--via mcp` arm shares the in-process eval's client and arm code; only the transport differs. `eval-against-release.sh` drives every version with this checkout's `eval --server <pkg cli>`.
- Phase 2 lead for Phase 3 and Key Question 1: with `git log` slowed, all four real sets scored @1 51 versus 46 with metadata. Decompose priority/decay/path-class/fold on TRAIN before touching ranking.
- Fix order: metadata first (Phase 3), because every ranking number the reporter took on d0 was measured inside the gap.

## Errors Encountered
- Phase 9: review found `codeData` overwritten by an older code load finishing last (fixed, regression test); the Phase 3 export on/off test was flaky on doc order (fixed, sorted). Full suite: only the hook-failure Jev-hang flake, passes alone.
- Phase 6: the first gate run failed parity with export: the in-process arm scored answers after the code graph landed, the stdio arm scored the first ones (`_meta.stale`), so top 3 differed on 1-2 of 80 questions. The eval now retries stale answers (in-process always; stdio with the new `--settle`, used by the gate's plain mcp arm). The `mcp-slow` arm does not settle: it is the one that checks the first answers.
- Phase 5: the stdio client passes only a safe subset of the environment, so an env var trial knob never reached the server: the first mcp arms of b, c, d silently ran variant (a). Caught by cli != mcp; re-run as per-variant package copies.
- Phase 5 missed target: on long-section-hard the fix recovers 3 of the 4 questions 1.21.0 lost on train (10/12 vs 7 and 1.15.0's 11) and 2 of 4 held-out (10/12 vs 8 and 12). Not back at 1.15.0.
- Phase 5: bullets of the hard fixture are 450-800 chars, not 1,000+. Load flakes of the full suite (stdin-eof, freshness-scale, hook-failure) pass alone.
- Phase 2: the long-section fixture does not discriminate (29/29 @1 on 1.15.0, 1.21.0 and local), so claim 2 is not reproduced by rank. Only a weak margin effect (r = -0.32 offset vs margin). Phase 5 must build a harder fixture first (near-duplicate distractors, 1,000+ char bullets, sections over 2,000 chars) before choosing a chunking variant on train.
- Phase 6: full-suite load flakes freshness-scale, hook-failure, links-exclude pass alone.
- Phase 3: freshness-scale warm start (1487 ms) and hook-failure Jev-hang (4134 ms) failed under full-suite load; both pass alone.
- Phase 2: `eval --via mcp` first hung 300 s per call on tools whose reply is not a JSON array (`search_text` with no match): the wait now applies only to "Indexing in progress".

## Status
**COMPLETE** (all phases done; Phase 10 docs written, AGENTS.md regenerated from branch code: only a timestamp changed, so left as is)

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
    /archive-plan mcp-metadata-gap-long-sections    # -> .planning/.archive/mcp-metadata-gap-long-sections/

Archiving moves this directory to the gitignored .planning/.archive/ and stamps
it archived. Nothing is destroyed.
