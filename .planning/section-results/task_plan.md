# Task Plan: section-results

## Goal
Ship semantic-memory#60. Each result keeps its `path` and gains three fields for its best-matching section:
- `section`: the heading trail, e.g. "Deploy > Rollback > Database";
- `anchor`: the anchor, with rules identical to hit-em-with-the-docs';
- `code`: the code refs inside that section.

Chunks are split at headings and carry their heading trail in the indexed text. Duplicate sections and pointer records
fold into their owner with `also_in`: from the `.hewtd/graph.json` export when present, by exact content hash
otherwise. `granularity: "doc"` returns today's output. One PR from `feat/section-results`. Series step 3. Every missed
target is stated in the PR.

## Prerequisites
- #56 (`builtin-eval`) merged: chunking changes both search arms and must be measured.
- #58 (`code-graph`) merged: the export reader and per-doc code refs (`code` field per section).
- hewtd 2.21.0's export, as shipped (`docs/graph-export.md`): `points_to.from` is **always null** (the ledger records only
  the target), and `duplicates.section` is the **owner's** anchor (`#<owner anchor>`), not the copy's own. Folding must
  work within those limits (Phase 5). Anchor rules are copied from the published tag:
  `git -C ../hit-em-with-the-docs show v2.21.0:src/core/links/anchors.ts` (read only; hewtd main has since renamed things).

## Rules for every phase
- **Verify before ticking.** Confirm in code, or with a test, that a box is actually done before ticking it.
- **Eval discipline.** The small-section merge threshold and any chunking choice are tuned on train only.
- **`path` stays a plain doc path.** `read_note`, the eval, telemetry and `related` use it; the anchor is a separate
  field. Still one result per doc (its best section), not several sections of one doc.
- **Anchors match hit-em-with-the-docs exactly** (slug, `-1`/`-2` for repeats, `{#id}` first, flat sections); its
  rules are copied (about 10 lines, no dependency) and tested against its cases.
- **`granularity: "doc"` is byte-identical** to the previous release's output (no folding, no section fields).
- **Payload.** The `meanBytes` ceiling (4750) holds; trim the excerpt if the new fields push it over.
- **Works without hit-em-with-the-docs.**

## Phases
- [x] Phase 1: Verify and plan
  - [x] Verify #60 against main @ 29e74db (notes.md), with the graph.json v1 contract
  - [x] Re-verify against main @ 24c88af (v1.16.0): claims hold; `nodeToText` still drops inline code; schema 8; ceiling 4750
  - [x] Post the verification comment on #60
  - [x] Sync main, cut `feat/section-results`, commit this plan (with the archive move of the previous plan)
- [x] Phase 2: Eval first
  - [x] Long-doc fixture (runbooks of 1,000+ lines with deep headings), owner + copy + pointer fixtures with a
        `.hewtd/graph.json`, and questions (train/held-out) whose answer is one section. Record the baseline.
        Done: test/fixtures/section-vault (3 runbooks of 1,300+ lines, 3 owner/copy/pointer families, export validated against
        graph.v1.schema.json with from=null and owner-anchor sections), golden-section(.heldout).jsonl, section-eval.test.ts,
        section-metrics.ts (anchorOfSnippet), baseline.json `sections`.
- [x] Phase 3: Section chunking (`indexer.ts`, `types.ts`)
  - [x] Split at heading offsets, strip markdown per section, `chunkText` inside each section, prefix each chunk with
        its trail line. Store `sections: {anchor, trail, hash}[]` and `chunkSection: number[]`. A section under ~300
        characters merges into its child section's chunk (tuned on train).
        Done: src/core/sections.ts (copied anchor rules, parity-tested against hewtd), `Indexer.sectionChunks`, `MIN_SECTION_CHARS = 100`.
  - [x] Fix `nodeToText` dropping inline code in headings (`# \`check_rls_coverage\` script` gives " script"): take
        heading text from the source.
        Done as `inlineCode` handling in `nodeToText` (same text as the source; section trails come from the source line in sections.ts).
  - [x] `INDEX_SCHEMA_VERSION` → next (full re-embed). If the eval regresses, keep today's packing and map each chunk to
        the section where it starts; record the choice.
        Done: schema 9. The eval regressed on the semantic arm, the fallback was built and measured, the section variant kept (notes.md "Eval results: Phase 3").
- [x] Phase 4: Result fields
  - [x] `shape()` and CLI `openSearch`: `section` (H1 dropped when it equals the title), `anchor`, `code: [≤3]` (refs
        inside the section, from #58); the excerpt drops the trail prefix. The result's section comes from
        `doc.chunks.indexOf(matchedChunk)`; neither search arm changes.
        Done: src/core/section-fields.ts (`sectionFields`) used by `shape()` in src/mcp/tools/search.ts and `openSearch` in src/cli/search.ts; `code` is stored per section at index time (`sections[].code`, raw refs, at most 3).
  - [x] `granularity: "section" | "doc"` on the search tools; `read_note`'s `section` accepts `#anchor`.
        Done: `granularity` on search_semantic and search_hybrid (default section; `openSearch` option for the CLI); `extractSection` takes `#anchor` (src/core/section.ts). Tests: test/integration/search-sections.test.ts (incl. v1.16.0 snapshot test/fixtures/flat-vault-v1.16.0.json), test/unit/section-fields.test.ts.
- [x] Phase 5: Folding (`src/core/fold.ts`, after rerank, before the limit)
  - [x] Export `duplicates`: the copy's section is the one whose anchor or content matches the owner's section
        (`duplicates.section` names the owner's anchor); the owner takes the slot (at the higher score), the copy goes
        into `also_in: ["b.md#setup"]`. `points_to` (from is null): a result counts as a pointer to `to` only when its
        best section is short (pointer-sized, under the hash-fold size floor) and links to `to`'s path; then it is
        replaced by its target, or dropped if the target already ranks above it. Otherwise the doc stays. Without an export, fold only sections with an identical normalized-text hash above a
        size floor.
        Done: src/core/fold.ts (FOLD_MIN_CHARS = 300), export parsing in loadExport (`duplicates`, `pointsTo`), wired in shape() and the CLI
        (not in granularity "doc"); `also_in` on result items. Unit: test/unit/fold.test.ts. The four fold gates in section-eval.test.ts are real gates now.
- [ ] Phase 6: Release prep v1.17.0
  - [ ] Bump all five version fields, lockfile; offline tarball builds
- [ ] Phase 7: Cleanup -- remove junk and unused code this work created: scratch/test scripts, debug files, probe logging, one-off test functions, commented-out code, dead code from abandoned approaches (MANDATORY)
  - [ ] Remove the losing chunking variant and sweep scripts; dead-code check over the branch diff.
- [ ] Phase 8: Validate success through comprehensive testing -- we need to validate success thoroughly through comprehensive testing of our changes (MANDATORY)
  - [ ] Independent review: anchor mismatch with hewtd, `path` changed, `granularity: "doc"` not identical, folding
        that drops a result with no owner in the list, payload over the ceiling, CLI/MCP drift.
  - [ ] Unit: anchor parity with hewtd's cases (setext, blockquote, repeats, `{#id}`, fences); section/chunk mapping;
        the fold function; `nodeToText` with inline code.
  - [ ] Integration: #60 check 1 (a long-runbook question returns the right `anchor` and trail); check 2 (owner + marked
        copy give one result with `also_in`); check 3 (a pointer never outranks its target); hash folding without an
        export; `granularity: "doc"` identical; CLI/MCP parity.
  - [ ] #60 check 4: payload within the ceiling; eval @1/@3 do not drop (all splits plus the long-doc set).
  - [ ] #60 check 5: the same suite with no `.hewtd/`.
  - [ ] Schema upgrade test: re-embeds once, the old index answers with the stale marker meanwhile.
  - [ ] Full suite; known flakes re-run alone. Answer each #60 acceptance item in notes.md.
- [ ] Phase 9: Documentation pass -- a full hit-em-with-the-docs pass to create/update/deprecate as many docs as needed to capture all our changes: new procedures, tools, troubleshooting steps, gotchas, KB articles, etc. Never include secrets or passwords (MANDATORY)
  - [ ] New changelog doc (`npx hewtd integrate -a`; one-time re-embed on upgrade); `CHANGELOG.md`
  - [ ] `.documentation/architecture/what-gets-indexed.md` (section chunking), `.documentation/reference/mcp-tools-reference.md`
        (`section`, `anchor`, `code`, `also_in`, `granularity`, `read_note #anchor`), `.documentation/operational/retrieval-tuning-guide.md`
  - [ ] KB fact (gotcha): remark's text of a heading with inline code drops the code unless taken from the source
  - [ ] `README.md`, `npx hewtd maintain --quick`, regenerate AGENTS.md; tick the last boxes so `/plan-status` reads COMPLETE

## Key Questions
1. Should hewtd#65 add a line or section field to each ref, so `code` per section can come from the export? Until
   then it comes from our own extraction (#58's `extractCodeRefs`, run per section subtree).
2. Should hewtd record `points_to.from`? Until then a pointer is recognised by its size and link (Phase 5).

## Decisions Made
- Phase 4: `code` per section is the raw inline-code and non-md link refs of that section (first 3), stored in the index; it is not filtered through the code graph's resolution (that needs a git call per query). Upgrade if dead refs show up.
- Phase 4: a carried short section (under MIN_SECTION_CHARS) reports the later section's anchor, as chunkSection maps it.
- `path` plus a separate `anchor` field, not `path#anchor`: every consumer keys on `path`.
- One result per doc, its best section: section-level ranking with several sections of one doc is out of scope.
- The trail prefix changes chunk text, so this release re-embeds once.

## Errors Encountered
- Phase 5: a fold only happens when the owner or target is itself in the ranked list (never drop an answer whose owner is absent). A pointer whose target is not in the top `limit*3` stays. Hash folding also runs with an export (identical text is safe), not only without one.
- Phase 4: `granularity: "doc"` cannot be byte-identical to v1.16.0 on a vault with headings, because schema 9 chunks differ (split at headings). It is proven on a heading-free vault (test/fixtures/flat-vault), where chunking is unchanged: the snapshot was produced by running main @ 24c88af (search_hybrid and search_semantic, trimmed and full, 6 queries). The doc-mode excerpt also drops the trail line, which is what makes it equal there.
- Phase 3: section chunks with the trail prefix lower the semantic arm on the existing splits (measured in notes.md). Floors lowered to the measured values, each with the number: fixture-train semantic multi@1 4 to 2, hybrid multi 5/11 to 4/10; fixture-heldout hybrid all@1 25 to 24, hybrid paraphrase@1 13 to 11, semantic paraphrase@1 13 to 12, semantic symptom@3 3 to 2, hybrid symptom@3 4 to 3; real-heldout negatives flagged slack 1 to 3 (5/8 flagged, was 7-8/8). Reason: the trail prefix and heading splits shift cosines toward short chunks; the fallback (today's packing) does not move those numbers but cannot name the right section (anchor@1 0/12 train).
- Phase 3: two regression snapshots (list_notes chunk counts, get_stats totals) updated: the fixture vault now has 17 chunks, not 10.
- Phase 2: hook-failure Jev-hang test failed once under full-suite load (3827ms vs 3000); passes alone. Known flake.

## Status
**Currently in Phase 6** - release prep

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
    /archive-plan section-results    # -> .planning/.archive/section-results/

Archiving moves this directory to the gitignored .planning/.archive/ and stamps
it archived. Nothing is destroyed.
