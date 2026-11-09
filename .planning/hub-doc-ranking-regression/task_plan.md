# Task Plan: hub-doc-ranking-regression

## Goal
Ship semantic-memory#71 as v1.21.0: undo the #1 loss that 1.16 (grounding penalty) and 1.17 (section-only doc scoring)
caused on a real 919-doc tree, without losing section anchors, and fix the bugs the field test found:
- `related` missing on #1;
- the entity card missing over MCP;
- fields missing without the export;
- noisy grounding inputs;
- PascalCase identifiers not detected;
- `negative: true` eval rows scored as answerable.

Add a release gate so a release can't lower #1 against the previous release again. One PR from
`feat/hub-doc-ranking-regression`. Every missed target is stated in the PR and on #71; another agent re-runs the reporter's
tree after publish.

## Prerequisites
- v1.20.0 on main (3e50e14). Published 1.15.0 to 1.20.0 packages are on npm for same-run comparisons.

## Rules for every phase
- **Verify before ticking.** Confirm in code, or with a test, that a box is actually done before ticking it.
- **Eval discipline.** Every constant and variant is chosen on train only; held-out is reported as measured. Compare
  against the published 1.15.0 and 1.20.0 measured **in the same run** (`scripts/eval-against-release.sh`, Phase 2),
  never against floors.
- **Code must be present to measure grounding.** The existing real-corpus eval copies only `.documentation`, so
  grounding never runs there. Measure ranking on a `git clone --local` of this repo (code and history present).
- **Section results stay.** `section` / `anchor` must still point at the matching section (the section eval stays green).
- **Response shape.** `content[0]` stays a bare JSON array; MCP and CLI agree (parity tests).
- **Works without hit-em-with-the-docs.** Every fix is measured with and without `.hewtd/graph.json`.

## Phases
- [x] Phase 1: Verify and plan
  - [x] Verify #71 against main @ 3e50e14 (notes.md): same-run bisect of published 1.15/1.16/1.17/1.20 on clones of
        this repo, related per #1, entity card in-process MCP vs CLI
  - [x] Post the verification comment on #71
  - [x] Sync main, cut `feat/hub-doc-ranking-regression`, commit this plan (with the archive move of `user-help`)
- [ ] Phase 2: Reproduce first (eval before any fix)
  - [ ] `scripts/eval-against-release.sh <version>...`: for each published version, `npm pack` into a temp dir, link
        node_modules, `git clone --local` this repo, `--reindex`, run `eval --json` on the given sets, and print one
        table (hybrid/semantic @1, @3, multi @1, #1+related, negatives flagged, p95). This is the release gate's
        engine (Phase 6). Never writes into the repo.
  - [ ] A **hub question set** on this repo (`test/retrieval-eval/real-hub.jsonl`, train / `-heldout`): questions whose
        answer is a long doc citing many code files (operator notes, runbook-style references), plus broad
        multi-doc questions. Written before measuring; facets grep-verified in the doc.
  - [ ] Eval reports `related` per #1 (mean count) next to `#1+related`, and prints the settings it ran with
        (`decay.code` on/off, granularity).
  - [ ] Reproduce the MCP-only bugs through the real launch: the stdio server as the plugin starts it
        (`--notes .documentation --read-only`, cwd = repo), an identifier query (entity card), `related` per #1, and
        the result fields with and without `.hewtd/graph.json`. Record what fails, or that it does not reproduce.
  - [ ] Baseline table in notes.md: 1.15.0, 1.20.0 and main on real-corpus (copied as today), real-corpus on a clone,
        and the hub set on a clone; with and without an export (`npx hewtd index` in the clone).
- [ ] Phase 3: Bugs
  - [ ] Eval rows with `negative: true` are scored as negatives (normalized at load); a row with neither a tier
        nor facets is refused with a message naming its id. Unit test.
  - [ ] Identifier detection: a PascalCase token with 2+ capitals counts as an identifier when the code graph knows
        it (symbol or file name), in `classifyQuery` and the entity card; it is still prose otherwise
        (`SessionEnd`-style words). Through #57's detector, never a second one.
  - [ ] Grounding inputs:
        - drop export `file` refs that are not path-shaped (no `/` and no file extension, or containing spaces,
          `(` or `=`): `import.meta.env`;
        - de-duplicate `code_drift` and `dead_refs` by resolved file, so a bare filename next to its full path
          counts once;
        - a doc never counts itself.
  - [ ] `cited_by[].stale` reflects dead refs or a stale verdict, not drift alone (drift is shown, not judged).
  - [ ] Fix whatever Phase 2 reproduced for the entity card, `related` and missing fields on the stdio
        `--read-only` server, each with a regression test through that entry point. If it did not reproduce, record
        that and add the test anyway.
- [ ] Phase 4: Grounding off the hot path
  - [ ] Default: **dead refs only.** Drift no longer multiplies the score (`decay.code.drift_penalty` defaults to 1);
        drift stays in the `grounding` block as information.
  - [ ] Dead-ref penalty: keep it damped (0.95 each, at most 3, floor 0.8). Tune on train only, between keeping it
        and halving its effect.
  - [ ] Opt-in drift, if kept: scaled by the **share** of cited files that drifted, not the count, and capped.
  - [ ] `decay.code: false` accepted as shorthand for `decay.code.enabled: false`.
  - [ ] Measure the hub set and real-corpus on a clone against 1.15.0 and 1.20.0 in the same run.
- [ ] Phase 5: Doc score from more than one section
  - [ ] A doc-level summary chunk per doc (title + `purpose` + heading list + first paragraph), embedded and indexed
        with the doc; its hits map to the doc's best section for `section`/`anchor`.
  - [ ] Variants measured on train:
        (a) best section only (today);
        (b) max(best section, doc chunk);
        (c) best section + α × doc chunk;
        (d) title and `purpose` prepended to every section's embedded text.
        Keep the best on train. Report held-out as measured.
  - [ ] Section eval stays green (anchors). Bump `INDEX_SCHEMA_VERSION` if chunk text changes; measure cold index
        time against 1.15 and 1.20 on the same tree.
- [ ] Phase 6: Release gate
  - [ ] `npm run gate:release`: `scripts/eval-against-release.sh` against the previous published version on the
        real-corpus held-out set and the hub held-out set (on a clone), failing when hybrid @1 or multi @1 drops by
        more than the band (one question).
  - [ ] Wire it into `.documentation/deployment/release-process.md` as a required step before `npm publish`.
- [ ] Phase 7: Release prep v1.21.0
  - [ ] Bump all five version fields, lockfile. Offline tarball deferred to release (built from the merge commit).
- [ ] Phase 8: Cleanup -- remove junk and unused code this work created: scratch/test scripts, debug files, probe logging, one-off test functions, commented-out code, dead code from abandoned approaches (MANDATORY)
  - [ ] Remove the losing scoring variants and trial knobs; dead-code check over the branch diff.
- [ ] Phase 9: Validate success through comprehensive testing -- we need to validate success thoroughly through comprehensive testing of our changes (MANDATORY)
  - [ ] Independent review of `git diff main...HEAD`:
        - constants tuned on held-out;
        - a second identifier detector;
        - anchors broken;
        - MCP/CLI drift;
        - `content[0]` changes;
        - writes into the repo by the gate script.
  - [ ] #71 checks, each against 1.15.0 measured in the same run:
        - real-corpus held-out hybrid @1 and multi @1 at or above 1.15 within the band;
        - the hub set too;
        - anchors still point at the matching section (section eval);
        - `related` on #1 averages >= 1 without the export;
        - `search_hybrid` over the stdio server returns the CLI's entity card;
        - `decay.code` can be switched off and `eval` prints it;
        - `TaskResponse`-style identifiers are classified `identifier` when the graph knows them;
        - `negative: true` rows are scored as negatives;
        - negatives flagged at the 1.15 level with no new false flags.
  - [ ] The reporter's tree is private: state in the PR that their set C / A+B numbers are re-run by them after
        publish.
  - [ ] Full suite: lint, build, `npm test` (known flakes re-run alone), `npm run eval`, and the release gate itself.
        Answer each #71 item in notes.md.
- [ ] Phase 10: Documentation pass -- a full hit-em-with-the-docs pass to create/update/deprecate as many docs as needed to capture all our changes: new procedures, tools, troubleshooting steps, gotchas, KB articles, etc. Never include secrets or passwords (MANDATORY)
  - [ ] New changelog doc `.documentation/changelog/v1-21-0-hub-doc-ranking.md` (`npx hewtd integrate -a`) and a
        `CHANGELOG.md` entry with measured numbers against 1.15.0 and 1.20.0 from the same run, and every missed target
  - [ ] `.documentation/architecture/code-graph.md` (grounding default: dead refs only), `.documentation/operational/decay-guide.md`,
        `.documentation/operational/retrieval-eval-guide.md` (`negative: true`, printed settings, related per #1),
        `.documentation/deployment/release-process.md` (release gate), `.documentation/operational/retrieval-tuning-guide.md`
  - [ ] Help topics in `src/core/help/topics.ts` that mention grounding or eval stay true (the drift test passes)
  - [ ] KB fact (gotcha): the real-corpus eval copies only `.documentation`, so code-dependent ranking is never
        exercised; measure on a clone
  - [ ] Keep hub-page edits tight (the real-corpus eval reads the live `.documentation`); re-run `npm run eval` after
        the docs; `README.md`, `npx hewtd maintain --quick`, regenerate AGENTS.md; tick the last boxes so
        `/plan-status` reads COMPLETE

## Key Questions
1. If drift helps on train for some questions, keep it as opt-in (share-scaled), or drop it entirely? Decided on train
   in Phase 4.
2. Can the doc chunk avoid a second full re-embed? Only if chunk text stays the same (variant b/c add chunks; d
   changes them). Measured in Phase 5.

## Decisions Made
- One plan for #71: the ranking fixes share the same eval and must be measured together against 1.15.
- Measure on a clone with code, because the in-repo real-corpus eval never exercises grounding.
- The gate compares against the previous **published** package, so it catches what floors did not (1.16 and 1.17
  each passed their floors).

## Errors Encountered
- (none yet)

## Status
**Currently in Phase 2** - reproduce first

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
    /archive-plan hub-doc-ranking-regression    # -> .planning/.archive/hub-doc-ranking-regression/

Archiving moves this directory to the gitignored .planning/.archive/ and stamps
it archived. Nothing is destroyed.
