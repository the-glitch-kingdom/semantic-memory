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
- [ ] Phase 2: Reproduce first (tests and eval before any fix)
  - [ ] Stdio regression test (`test/e2e/`):
        - Start the `--read-only` server on a git repo whose `git log` is slowed by a PATH shim.
        - Query at once, and assert the first answer carries real titles, `load_priority`/`status` (with `full`), honours the `status` filter, and never returns a `generated`/excluded doc.
        - Must fail on main. Record that it does.
  - [ ] `eval --via mcp`: run the question sets through the stdio server as the plugin launches it.
        - Default: query as soon as the server answers, not after waiting for ready.
        - Report the same metrics as the CLI eval, plus `related` per #1 and entity cards.
        - Reuse `scripts/lib/eval-probe.mjs` or move its client into `src/core/retrieval-eval/`; one client, not two.
  - [ ] Long-section fixture and questions:
        - Fixture: a few docs with few headings, bullets/paragraphs of 1,000+ characters, several facts each, placed early, middle and late in the section.
        - Questions in train and held-out (`test/retrieval-eval/long-section*.jsonl`), written and facet-checked before measuring.
  - [ ] Measure claim 2. For each fact, record its offset in its chunk, the chunk's token count (the model's tokenizer), and whether the doc is #1. Does the rank fall with offset or with chunk length? Record in notes.md.
  - [ ] Baseline table in notes.md:
        - Versions: 1.15.0, 1.21.0 and local.
        - Sets: real-corpus, hub and long-section.
        - Arms: CLI eval and `eval --via mcp`, each with and without an export, on clones.
- [ ] Phase 3: Doc metadata never lags the index
  - [ ] Two steps in `loadFromDisk` and the reconcile path (src/mcp/context.ts):
        - **Step 1, atomic with the vector index:** docs, `docByPath`, text search, BM25 and the doc-only graph are installed together. No query can see a new vector index with old or missing docs.
        - **Step 2, when ready:** the code graph is applied (grounding, code edges, entity cards) and the graph is rebuilt.
  - [ ] Until step 2 lands, responses carry `_meta.stale`, and the note names grounding and the entity card as pending.
  - [ ] Audit every other `await` between a state swap and `setDocuments` (save, reconcile, federation sources) for the same gap.
  - [ ] The Phase 2 stdio test passes. Add a unit test for the reconcile path's swap.
  - [ ] Removing or adding `.hewtd/graph.json` and restarting changes only grounding: titles, filters and non-grounding ranking stay the same. Add a test.
- [ ] Phase 4: Cheaper code-graph fallback
  - [ ] Measure the fallback on a large local git repo (pick one under ~/workspace with long history; never modify it), timing `gitFiles`, `gitIgnored` and `gitLastChanged` separately. Record in notes.md.
  - [ ] Bound `gitLastChanged`. Options:
        - one `git log` with `--since` or `-n`, with files older than that treated as unchanged;
        - or the dates `git ls-files`/`git log -1` give per file.
        Drift is information only since 1.21, so precision matters only for the opt-in `drift_penalty`. Document the bound.
  - [ ] `get_stats` reports code-graph load time and source (export, fallback, none).
- [ ] Phase 5: Long sections
  - [ ] Embedding windows sized to the model's window: `max_seq_length` from the model's sentence-transformers config (256 for MiniLM), minus the heading trail, with a sentence of overlap. A section scores by its best window, and `section`/`anchor` stay on the section.
  - [ ] Variants measured on TRAIN only (long-section + hub + real-corpus, on a clone, via MCP):
        - (a) 1.21 chunks;
        - (b) model-window chunks;
        - (c) (b) plus overlap;
        - (d) sentence windows inside a section, best window wins.
        Keep the best; remove the others.
  - [ ] Cold index time and index size against 1.15.0 and 1.21.0 on the same tree. Bump `INDEX_SCHEMA_VERSION` if chunk text changes.
  - [ ] The doc summary chunk (1.21) is cut to the window too, if (b)–(d) show it truncates.
- [ ] Phase 6: Release gate sees the MCP path
  - [ ] `npm run gate:release` runs `eval --via mcp` as well as the CLI eval, on the held-out sets (real-corpus, hub, long-section).
  - [ ] Clones run without an export, with an export, and with `git log` slowed for the first-query check.
  - [ ] The gate fails when MCP and CLI differ in top 3, `related` or `entity` on any question, or when the first MCP answer lacks titles.
  - [ ] Run it against 1.21.0 and record the result. `release-process.md` stays the place that makes it required.
- [ ] Phase 7: Release prep
  - [ ] Bump all five version fields to 1.22.0 and update the lockfile
  - [ ] Offline tarball deferred to release (built from the merge commit)
- [ ] Phase 8: Cleanup
  - [ ] Remove what this branch created or made dead: losing variants, trial knobs, scratch scripts, debug output
- [ ] Phase 9: Validation (independent review)
  - [ ] Review `git diff main...HEAD` adversarially against this plan, fix real bugs with regression tests, audit every ticked box
  - [ ] Unit: load order and reconcile swap, fallback bound, chunk windows, eval `--via mcp`, gate parity check
  - [ ] Integration/e2e: stdio first-query test with slow git; export added or removed then restart; upgrade window (old index) still marked
  - [ ] Regression: lint, build, full `npm test` (known load flakes re-run alone), `npm run eval`, section eval green, MCP/CLI parity tests
  - [ ] Every #73 acceptance check, against 1.15.0 and 1.21.0 in the same run, via MCP and CLI, with and without export; answered honestly in notes.md
  - [ ] `npm run gate:release` passes against 1.21.0
- [ ] Phase 10: Documentation (full hit-em-with-the-docs pass, no secrets)
  - [ ] `.documentation/changelog/v1-22-0-*.md` and the CHANGELOG.md entry: numbers against 1.15.0 and 1.21.0 in the same run, missed targets stated
  - [ ] `architecture/code-graph.md` (load order, fallback bound, load time in stats), `architecture/indices-and-storage.md` or the indexing doc (chunk windows, schema version)
  - [ ] `retrieval-eval-guide.md` (`--via mcp`, long-section set), `retrieval-tuning-guide.md` (chunk windows), `deployment/release-process.md` (what the gate now checks)
  - [ ] Help topics in `src/core/help/topics.ts` that describe chunking, eval or the gate; README version row; AGENTS.md regenerated
  - [ ] KB fact (gotcha): an MCP server can serve a new vector index before doc metadata is installed; the CLI eval cannot see it. Include an `## Instead` section and a verify command
  - [ ] Final `npm run eval`; floors move only with a measured reason

## Key Questions
1. Is the reporter's persistent loss entirely the load gap, or is there a second miss? Phase 2 runs the MCP eval at once and again after ready, and compares the two.
2. Does chunk length or fact offset explain claim 2? This is measured in Phase 2 before any chunking change.

## Decisions Made
- One plan for #73: all three claims meet in the MCP load path and the eval that cannot see it.
- Fix order: metadata first (Phase 3), because every ranking number the reporter took on d0 was measured inside the gap.

## Errors Encountered
- (none yet)

## Status
**Currently in Phase 2**

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
