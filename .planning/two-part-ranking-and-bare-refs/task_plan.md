# Task Plan: hybrid stops demoting the whole-answer doc on two-part questions (#91 part 2), and the stale-graph re-check covers bare-filename refs (#98); one PR

## Goal
Close the two open issues in one PR (user, 2026-11-14).

1. **#91 part 2.** On two-part paraphrase questions, hybrid ranks a doc that matches the *wording* of one part above the doc that holds the whole answer. Repro from the reporter (blind questions, anonymised docs), measured on 1.31.0:
   - hybrid @1 0/2 vs semantic @1 1/2;
   - both misses are labelled `ranking` by 1.31.0's diagnosis.
   - **R91-A, the clean case:**
     - `marketing/seo-surface-implementation.md` holds all 3 facets in one chunk ("The CI allowlist guard"). It is semantic #1 and hybrid #2 (0.4791).
     - Hybrid #1 is `knowledge-base/facts/cookie-custody-e2e-gate-self-skipped-on-wrong-probe-path.md` (0.5074, section "Lesson"). It has 0 of 3 facets and is semantic #6. It matches part 2's wording ("actually block a merge").
     - Mechanism: `fuseScores` (`src/core/bm25.ts:221`) is `0.7·cosine + 0.3·bm25/max(bm25)`. The BM25 #1 always gets the full 0.3, so a doc that is lexically strongest on one clause can pass the semantic #1.
   - **R91-B, read with a caveat:** a three-part question. The two docs carrying the literal commands (3 of 4 facets) rank hybrid #7 and >10, semantic #4 and #8. Hybrid's #1 is a short operator summary that answers all three parts in prose, without the commands. It is useful as a shape, but it is not a required fix.
2. **#98.** 1.30.0's stale-graph re-check (#95) catches a deleted cited file only when the ref names its repo path. `patchStale` (`src/core/code-graph.ts`) builds `fileOf(r) = clean(r.file ?? r.target)` and tests it against the set of changed repo paths. A bare-filename ref (`{"kind":"file","resolved":true,"target":"test_x.py"}`; hewtd resolves bare names by basename) is never in that set. So after `git rm backend/tests/unit/test_x.py && git commit`, a doc citing `test_x.py` keeps "resolved", with no `dead_refs` and no `stale`.

Release as **1.32.0** if #91's ranking default changes (minor), or **1.31.1** if #91 ships only as an opt-in or as measurement. Decide in Phase 5 and record it.

**Out of scope.**
- Making R91-B a hard target. The summary doc arguably answers; it is measured and reported, not required.
- A larger candidate pool (#87, closed).
- Graph-edge resolution of bare names.
- Changing the hit-em-with-the-docs repo.

## Phases
- [x] Phase 1: Verify and plan (notes.md)
- [x] Phase 2: Acceptance as failing tests first (`it.fails` until fixed)
  - [x] **#91 fixture.**
    - Copy the reporter's repro (`~/workspace/the-glitch-kingdom/plugin-benchmarks/semantic-retrieval/repros/sm-91-two-part/`: 18 anonymised docs, `questions.jsonl`, `README.md`) into `test/fixtures/two-part/`, as `test/fixtures/multi-hub` was done for #76.
    - Before committing, re-check it is anonymised: grep for real org, product, person and domain names, emails and IPs. Keep the README, minus any absolute paths.
    - Done: docs in `test/fixtures/two-part/docs/` (the `.documentation` folder renamed so hewtd tooling does not treat it as a live tree), `questions.jsonl`, README. Grep for emails, IPs, URLs, UUIDs, absolute paths found only placeholders (`acme.example`, `example.com`, `user@example.com`, `10.0.0.x`, fake UUIDs) and third-party vendor names.
  - [x] **#91 test** (`test/retrieval-eval/`, cold build of the fixture):
    - `it.fails`: hybrid ranks `marketing/seo-surface-implementation.md` #1 for R91-A;
    - guard (plain `it`): semantic ranks it #1 today;
    - R91-B: record hybrid's rank of each 3-of-4-facet doc, with no assertion beyond "not worse than today".
  - [x] **#98 test** (`test/integration/stale-code-graph.test.ts`, the #95 fixture style: a temp git repo, a hewtd v1 export at HEAD):
    - two docs cite the same file, one by path, one by bare name (`resolved: true`, no `file`);
    - commit a deletion: both docs get `dead_refs`, `stale: true` and `source: "export+live"` (`it.fails` for the bare one);
    - an edit instead of a delete: both get `code_drift`;
    - guards: a bare name whose basename still exists elsewhere in the tree stays resolved (hewtd's basename semantics); a bare name matching no changed path keeps the export's data, byte-identical.
- [x] Phase 3: Fix #98
  - [x] In `patchStale`, a bare file ref (target with no `/`) also counts as dirty when any changed path has that basename. One basename map built from the changed set, so no extra git spawn.
  - [x] When re-checked:
    - `resolved` = some file with that basename exists in the working tree (candidates: the export's `files` plus the changed paths with that basename, each checked with `existsSync` under the git root);
    - `changed` = the newest `gitLastChanged` date among the existing candidates (same single call).
    - Keep the `..` and absolute-path guards.
  - [x] An unknown or null `source_commit` (every ref re-checked live) applies the same basename semantics to bare refs.
  - [x] Phase 2 #98 cases become plain `it`.
- [ ] Phase 4: #91 candidates (train only)
  - [ ] Measure 1.31.0 on the fixture and every train split; record hybrid and semantic per question in notes.md.
  - [ ] Try, one at a time, each as a small change to fusion. Never touch the held-out sets while choosing.
    1. **Lexical share needs agreement:** scale a doc's BM25 share by how close its cosine is to the vector #1. A lexical-only winner with a weak cosine can't take the full 0.3.
    2. **BM25 normalised against the corpus reference** (`bm25SelfTop`, already computed), instead of `max(bm25)` of this query. A query whose best BM25 hit is weak in absolute terms then moves less.
    3. **Clause-aware lexical cover:** split the question with `splitClauses`. A doc's BM25 share is weighted by the share of clauses whose content terms it matches, so a doc matching one clause's wording gets less than one matching both.
    4. **Existing knobs** (`coverage_weight`, `clause_weight`, `COSINE_WEIGHT`) as baselines, so a new mechanism has to beat them.
    For each candidate record: R91-A rank, R91-B ranks, train hyb@1/@3, multi @1/@3/@8, dominance, and the identifier-tier and whole-answer train sets.
  - [ ] Pick at most one. It must fix R91-A, lose nothing on train beyond 1/n, and not raise dominance. If none qualifies, record why and go to Phase 5 with "no default change".
- [ ] Phase 5: Gate and decide
  - [ ] Implement the chosen candidate behind a `ranking` setting in `vault.schema.yml` (like `clause_weight`).
  - [ ] Fresh `BAND=1 bash scripts/gate-release.sh 1.31.0` with it **on** as the default. If the gate passes (no held-out loss beyond the band, MCP vs CLI parity), ship it on, and the version is 1.32.0. If it fails, ship it **off** (opt-in), and the version is 1.31.1.
    - Ask the reporter, in the release comment, to measure it on their full tree and blind set. They offered.
    - Record the gate numbers either way.
  - [ ] The #91 Phase 2 test is plain `it` only when the candidate is on by default. Otherwise the test runs with the setting on, and a default-off test records the shipped state.
- [ ] Phase 6: Measure
  - [ ] Gate numbers (from Phase 5) in notes.md, and the fixture's hybrid/semantic @1/@3/@8 before and after.
  - [ ] #98 by hand: in a temp copy of this repo with hewtd 3.4.1's export (read-only, its built dist), delete a file a doc cites by bare name, commit, and check `dead_refs` and `get_stats`.
  - [ ] Code-load cost with the basename map on a ~1,000-file repo, 100 commits behind: before and after, in ms.
- [ ] Phase 7: Release prep
  - [ ] Bump all five version fields (1.32.0 or 1.31.1 per Phase 5) plus the lockfile.
- [ ] Phase 8: Cleanup -- remove junk and unused code this work created: scratch/test scripts, debug files, probe logging, one-off test functions, commented-out code, dead code from abandoned approaches (MANDATORY)
  - [ ] Remove the losing candidates from Phase 4; keep only the shipped one and its setting.
- [ ] Phase 9: Validate success through comprehensive testing (MANDATORY)
  - [ ] Every Phase 2 test passes as designed (plain `it`, or with the setting on).
  - [ ] Edge cases:
    - #98:
      - two tracked files sharing a basename, one deleted (stays resolved);
      - both deleted (dead);
      - a bare ref with a `:line` suffix;
      - a bare ref that is a directory name;
      - a case-only rename;
      - a bare name containing a dot but no slash (`README.md`);
    - #91:
      - a single-clause question is unchanged by the candidate (compare top 3 on every train question);
      - an identifier question keeps the identifier tier's order;
      - a query with no BM25 hit (pure vector order unchanged);
      - a negative question's abstention flag (`no_strong_match`) is unchanged.
  - [ ] Lint, build, `npm test`, `npm run eval`, `npm run gate:release` (fresh, BAND=1 vs 1.31.0).
  - [ ] Independent review of `git diff main...HEAD` (`claude -p --setting-sources "" --tools ""`, given the code, not our conclusions). Fix what it confirms; record rejections.
- [ ] Phase 10: Documentation pass with hit-em-with-the-docs; no secrets (MANDATORY)
  - [ ] `.documentation/architecture/code-graph.md`: bare-filename refs in the stale re-check (basename semantics, as hewtd resolves them).
  - [ ] `.documentation/operational/retrieval-tuning-guide.md`: the fusion change or the new opt-in setting, what it does to two-part questions, and the measured trade.
  - [ ] `.documentation/reference/configuration-reference.md`: the new `ranking` key, if one was added.
  - [ ] Plugin help (`src/core/help/topics.ts`):
    - `tune-ranking` names the new setting, if there is one;
    - `code-graph` mentions bare names, if its text describes the re-check.
    `test/unit/help-coverage.test.ts` and `test/unit/cli-help.test.ts` pass, and any `--help` text this touches stays accurate.
  - [ ] `docs/measure-and-tune.md`: the ranking route mentions the new setting, if one was added. The deny-list test still passes.
  - [ ] KB gotcha fact: a score fused as `w·cosine + (1−w)·bm25/max(bm25)` hands the full lexical share to whichever doc is lexically best on *this* query, even when that doc matches only one clause. `## Instead`: whatever Phase 5 shipped.
  - [ ] `CHANGELOG.md` and `.documentation/changelog/v<version>-two-part-and-bare-refs.md`.
  - [ ] `npx hewtd maintain --quick`; never hand-edit INDEX.md or REGISTRY.md. Re-run `npm run eval` after the docs.

## Key Questions
1. Should R91-B count as a target? No: the summary doc answers in prose. Measure it, report it, don't tune for it.
2. Can the repro questions be used for tuning? They are the acceptance cases (like the multi-hub fixture). Choose only on them plus the train splits, never on held-out. The gate is the held-out check.
3. Default on or opt-in? Decided by the Phase 5 gate, not by preference.

## Decisions Made
- One plan, one PR for #91 part 2 and #98 (user, 2026-11-14).
- Version 1.32.0 or 1.31.1, set in Phase 5.

## Errors Encountered
- Phase 2: the planned `it.fails` for "source_commit unknown: bare ref dead after deletion" passed today (root-relative `existsSync` of a bare name is always false, so it is wrongly "dead" by accident). Replaced by a plain guard for the deletion plus an `it.fails` where the basename exists elsewhere (falsely dead today).

## Status
**Phase 4 next** (#91 candidates, train only). Phase 3 done (#98 fixed in patchStale). Phase 2 done (tests `test/retrieval-eval/two-part-fixture.test.ts`, `test/integration/stale-code-graph.test.ts`). Phase 1 done: #91 reproduced on 1.31.0 with the reporter's folder; #98 confirmed by reading `patchStale`. See notes.md.
