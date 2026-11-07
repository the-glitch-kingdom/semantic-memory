# Task Plan: boost-decay-fallback

## Goal
Ship v1.11.0 for semantic-memory#48 (`GRAPH_BOOST` 1.3 → 1.0, a stale marker that agents can see, `meta_weight` and
abstention measured and documented) and #49 (a configurable age fallback when `last_verified` is missing, reported in
the `decay` block), in one PR from `feat/boost-decay-fallback`. Every target that is missed is stated in the PR.

## Rules for every phase
- **Verify before ticking.** Confirm in code, or with a test, that a box is actually done before ticking it.
- **Eval discipline.** Held-out questions are never used to choose a constant or a threshold. Tune on train only,
  report held-out as measured, and write all questions ourselves.
- **Floors.** A floor drops only when a measured change justifies it. Record each drop under Errors Encountered with
  the reason. An `it.fails` gate that starts passing becomes a real gate.
- **Reuse.** Extend the existing helpers (`applyGraphBoost`, `computeDecay`, `Indexer.resolveMtime`, `index-store`,
  the eval harness). Add no new dependencies.
- **Don't touch hit-em-with-the-docs.** That repo belongs to another session; hewtd#54 is the companion issue.

## Phases
- [x] Phase 1: Verify and plan
  - [x] Verify #48 and #49 against main @ 0c2b445, and sweep #48's constants on our eval (notes.md)
  - [x] Post the verifications on #48 and #49
  - [x] Sync main and cut `feat/boost-decay-fallback`
  - [x] Commit this plan (the staged archive move of `retrieval-ready-fields` goes in the same commit)
- [x] Phase 2: Eval first (written before any ranking or decay change)
  - [x] Decay fixture in `test/fixtures/decay-vault/` (separate dir, see Decisions): pairs of equally relevant docs, one with a recent `last_verified`
        and one with none, plus one with `last_verified` 400 days old. Write train and held-out questions where the
        verified doc is the answer. Record the shipped baseline (the unverified doc wins, or ties on fail-open).
  - [x] Give the eval's temp vault a git history with backdated commits (`GIT_COMMITTER_DATE`), so `git` mode can be
        measured. Keep the existing splits unaffected when decay falls back.
  - [x] Eval reports the age source per result, so the Phase 4 checks can assert on it
  - [x] Re-record the shipped baseline for all four splits in notes.md (the #48 sweep numbers are the reference)
- [x] Phase 3: Graph boost and the stale marker (#48)
  - [x] `GRAPH_BOOST` 1.3 → 1.0 in `src/core/graph-boost.ts`. Keep the helper and seeds in place (the boost is now a
        no-op multiplier). Re-check on train that 1.0 is not worse than 1.1, and record both.
  - [x] Re-measure every split. Raise floors that went up. Convert `it.fails` gates that now pass (expected: fixture
        held-out "hybrid paraphrase ≥ semantic"). Record each floor that drops (expected: fixture-train exact @1,
        fixture held-out multi @3).
  - [x] Stale marker: while the old index answers, the `search_*` text responses carry a visible line or field (e.g.
        `"stale": true` plus "index refreshing, re-run to confirm"), not only `_meta`. The MCP server and the CLI get
        the same behaviour. Add a test in `test/integration/freshness.test.ts` or `index-upgrade.test.ts`.
- [x] Phase 4: Decay age fallback (#49)
  - [x] `decay.missing_last_verified: git | mtime | fresh | penalty` and `decay.missing_penalty` (default 0.85) in
        `DecayConfig`, `loadDecayConfig` and `schema-default.ts`. Default: `git` (#49's suggestion). It changes
        ranking for existing vaults; `fresh` restores the old behaviour exactly.
  - [x] `git` mode: one `git log --name-only --format=%ct` pass per index build or reconcile, not one call per file.
        Store the date with the doc in the index and key it by content hash, so no query calls git. Outside a repo,
        or for an untracked or uncommitted file, fall back to `missing_penalty`.
  - [x] `mtime` mode: decide between the raw file mtime (#49) and `resolveMtime`'s chain (`last_updated` first) and
        record why. Never use `last_validated`: hewtd stamps it for frontmatter validation, not content verification.
  - [x] `computeDecay` takes the fallback age and source. Unparseable and future `last_verified` values use the
        fallback too.
  - [x] The `decay` block carries `source` (`last_verified` / `git` / `mtime` / `penalty` / `fresh`) and is attached
        whenever a fallback was used, even at multiplier 1. MCP and CLI match.
  - [x] Lint `stale` rule: report notes with no `last_verified` (count, or `decay_candidates`) instead of skipping
        them silently. Keep the severity unchanged.
  - [x] The index schema version is bumped only if the stored doc shape changes. Upgrade test: a v1.10.0 index
        re-reads git dates without re-embedding.
  - [x] Measure on the decay fixture and on all four splits. The verified doc must beat its unverified twin, and no
        split @1 may drop by more than noise (1 case on the real corpus).
- [x] Phase 5: `meta_weight` and abstention, measured (#48)
  - [x] `meta_weight`: measure 0.8 vs 1.0 on train with a metadata-rich subset, i.e. questions whose answer docs
        carry `purpose`/`symptoms`. The default stays 0.8 unless train shows otherwise. Document when to raise it,
        stating only what was measured.
  - [x] Abstention: on train only, try at most two rules beyond a single cosine cutoff (e.g. cutoff by top-1 vs
        top-2 gap, or by meta vs body cosine). Adopt one only if it flags more negatives on train while keeping
        answerable false flags ≤ 10% on every train split. Otherwise keep 0.36 and record the 0.45 sweep (notes.md)
        as the negative result. Report held-out as measured.
- [ ] Phase 6: Release prep v1.11.0
  - [ ] Bump all five version fields (`package.json`, both in `.claude-plugin/marketplace.json`,
        `.claude-plugin/plugin.json`, `AGENTS.md` frontmatter), then `npm install --package-lock-only --ignore-scripts`
  - [ ] Offline tarball builds (it is rebuilt from the merge commit before publishing)
- [ ] Phase 7: Cleanup -- remove junk and unused code this work created: scratch/test scripts, debug files, probe logging, one-off test functions, commented-out code, dead code from abandoned approaches (MANDATORY)
  - [ ] Remove trial knobs and sweep scripts; dead-code check over the branch diff (`tsc --noUnusedLocals`, grep)
  - [ ] If the graph boost is a plain ×1.0 after Phase 3, either keep it as a named constant with a one-line why, or
        remove it with its tests. Decide and record.
- [ ] Phase 8: Validate success through comprehensive testing -- we need to validate success thoroughly through comprehensive testing of our changes (MANDATORY)
  - [ ] Independent review of `git diff main...HEAD`. Look for:
    - per-query git calls
    - git dates leaking across content changes
    - `last_validated` being read
    - the decay block missing in the CLI
    - the stale marker missing on any `search_*` tool
    - floors lowered without a record
  - [ ] Unit (`test/unit/decay.test.ts`):
    - each mode
    - missing / unparseable / future `last_verified`
    - `source` in the result
    - `fresh` mode byte-identical to v1.10.0 (#49 check 2)
    - 400-day git age equals 400-day `last_verified` (#49 check 1)
  - [ ] Integration:
    - the git pass runs once per build, and no query spawns git (spy on `child_process`; #49 check 4)
    - a non-git vault falls back to the penalty
    - an untracked file falls back to the penalty
    - the `decay` block names the source (#49 check 3)
    - the stale marker is visible in `search_hybrid`, `search_semantic` and `search_text` text during an upgrade
  - [ ] Regression: on the decay fixture, the verified doc ranks above its unverified twin. Fixture held-out
        paraphrase hybrid ≥ semantic is a real gate.
  - [ ] Prove a gate fails: lower a constant in a scratch edit, see the floors fail, revert
  - [ ] Full suite: `npm run lint && npm run build && npm test && npm run eval`. Re-run known timing flakes alone and
        record them.
  - [ ] Offline tarball `--verify`; smoke install
  - [ ] Write an answer to each #48 and #49 acceptance item in notes.md, missed ones included
- [ ] Phase 9: Documentation pass -- a full hit-em-with-the-docs pass to create/update/deprecate as many docs as needed to capture all our changes: new procedures, tools, troubleshooting steps, gotchas, KB articles, etc. Never include secrets or passwords (MANDATORY)
  - [ ] New `.documentation/changelog/v1-11-0-boost-decay-fallback.md` (`npx hewtd integrate -a`): before/after tables
        per split, the decay default change and how to restore it (`missing_last_verified: fresh`), missed targets
  - [ ] `.documentation/reference/configuration-reference.md`: `decay.missing_last_verified`, `decay.missing_penalty`;
        `index_fields.meta_weight` guidance
  - [ ] `.documentation/operational/retrieval-tuning-guide.md`:
    - the graph boost sweep
    - `meta_weight` by corpus
    - the abstention negative result (0.45: 22% / 31% / 11% false flags)
  - [ ] Decay docs (find them with `grep -rl "last_verified" .documentation`): the age source, the fallback and the
        `source` field. Note that `last_validated` is not verification.
  - [ ] `.documentation/changelog/v1-9-1-ranking-regression.md`: correct "answers with `_meta.stale: true`" to say what
        an agent actually sees
  - [ ] Tool reference for the `decay` block and the stale marker; `README.md` version/status line
  - [ ] KB fact (gotcha): `_meta` on MCP results is not shown to the model in Claude Code, so put agent-facing state
        in the response text
  - [ ] `npx hewtd maintain --quick`; regenerate AGENTS.md with `regenerate_contract`, passing projectRoot
  - [ ] Tick the last boxes so `/plan-status` reads COMPLETE

## Key Questions
1. Is `git` the right default for the decay fallback? It changes ranking for every existing vault on upgrade. Planned
   as the default (#49's suggestion), with `fresh` as the documented opt-out; revisit if Phase 4 shows a split drop.
2. Does `mtime` mean the raw file mtime or `resolveMtime`'s frontmatter chain? (Phase 4)
3. Can any abstention rule beat a single cosine cutoff on train without breaking the 10% false-flag ceiling? (Phase 5)

## Decisions Made
- One PR, v1.11.0 (minor): the decay default changes ranking behaviour.
- `GRAPH_BOOST` → 1.0: held-out-backed in the #48 sweep (fixture held-out +3), not tuned on held-out. The Phase 3
  train re-check confirms it.
- `meta_weight` stays 0.8 and `NO_STRONG_MATCH_BELOW` stays 0.36 unless train shows otherwise: the #48 sweep showed
  abstention loss with 1.0, and 22-31% false flags at 0.45.
- `ranking.*` stays off (#48 agrees).
- Phase 2: the decay fixture is its own vault (`test/fixtures/decay-vault/`, 24 docs, 12 pairs) and its own eval
  (`decay-eval.test.ts`), not added to `docs-vault`: extra docs there would shift every existing split. Dates in the
  fixture are `{{ago:N}}` tokens stamped at run time, and `ages.json` gives each doc's backdated commit and file age.
- Phase 2: the existing splits get a temp-vault git history with every doc committed 10 days ago (`git-history.ts`), so
  the Phase 4 git fallback gives all docs the same ~1.0 multiplier. Measured identical to before (39/22/21/13 hybrid @1).

- Phase 3: boost 1.0 vs 1.1 on train: fixture-train 38 vs 38, real-train 22 vs 23 (+1, inside the 1-case HNSW noise
  on the real corpus). Kept 1.0 (the #48 ask; held-out was not used to choose it). The helper and seeds stay as a ×1.0
  no-op; Phase 7 decides whether to remove them. Its "order changes" unit test was deleted (it asserts a >1 boost).
- Phase 3 stale marker: MCP `search_*` text gets a leading `[stale: ...]` line (the JSON follows on the next line);
  `_meta.stale` stays. CLI: a live index.lock holder means the committed index is about to be replaced, so hits carry
  `stale: true` (output stays a JSON array for the hook) and `hooks/vault-context.js` adds a "Stale:" line to the block.
- Phase 4: `mtime` mode = `doc.mtime` (`resolveMtime`: `last_updated` -> `updated` -> `date` -> `lastmod` -> file mtime), not the raw
  file mtime #49 names. The raw mtime is rewritten by clone, checkout and rsync, so it dates the copy, not the content;
  `last_updated` is a content-edit date that hewtd keeps, and it is already stored with the doc (no new field). `last_validated` is
  never read.
- Phase 4 git dates: one `git log --relative --raw` per build or reconcile (only when something changed and a doc needs a date),
  keyed by BLOB ID, not path: a doc gets a git date only when the sha1 blob id of its bytes equals the blob id of its newest commit,
  so an edited-since-commit file takes the penalty and a date never leaks across a content change. Stored as `gitDate` on the
  doc; `INDEX_SCHEMA_VERSION` 5 -> 6 (re-parse, vectors kept), which also makes a v1.10.0 index re-read git dates on upgrade.
  Limits: a commit that changes no bytes dates a previously edited doc only at the next reconcile that has changes (or --reindex);
  `git` mode is only consulted at build time, so switching a vault to `git` needs a --reindex; shallow clones date old files at the
  boundary commit.
- Phase 4: the fallback `decay` block is compact (`multiplier`, `age_days`, `source`; no `reason`/`effective_half_life`): with
  git as default every result of a vault without `last_verified` carries one.
- Phase 4: the CLI search used to skip decay (a no-op while missing dates failed open). Now it would diverge from `search_hybrid`
  (search-parity failed), so it applies the same `decayForDoc` (new, `src/core/decay.ts`, shared with the MCP server) and its hits
  carry the same `decay` block. The `decay` CLI command also prints `source` (it has no git date, so it shows the penalty).
- Phase 4 lint: `LintReport.counts.noLastVerified` (a count; no findings, severity unchanged).

- Phase 5: `meta_weight` stays 0.8 (train: 1.0 = +1 @1 on real train, noise, and -1/-2 negatives flagged). Abstention stays the single 0.36 cutoff: two rules
  tried on train (top1-top2 gap; stricter-BM25 cutoff), neither adds a negative within the 10% false-flag ceiling. No code changed; numbers in notes.md.

## Errors Encountered
- Phase 4 ceiling raised: docs-vault `search_hybrid.meanBytes` 3831 -> 4575. Every result of a vault without `last_verified` now carries a
  compact git `decay` block (+744 B mean). Measured, deliberate; the block could not be dropped (plan: attached when a fallback is used).
- Phase 4: the three `decay.test.ts` fail-open tests now run in `fresh` mode (the default changed); `fresh` stays byte-for-byte the old
  behaviour (same multiplier, age and reason strings).
- Phase 3 floors dropped, all from the boost 1.3 → 1.0 change (measured, see notes.md): fixture-train hybrid all @1
  39 → 38 and exact @1 12 → 11; fixture held-out hybrid multi @3 6 → 5. Raised: fixture-train hybrid @3 51 → 52, multi
  @3 10 → 11; held-out hybrid all @1 22 → 25, nofield @1 1 → 2, paraphrase @1 12 → 13 and @3 13 → 13, symptom; real-train
  hybrid @1 20 → 21 (and tier floors); real-held-out paraphrase @3 14 → 15. `answeredFlagged` ceiling 3 → 2, `meanBytes`
  ceiling 4132 → 3831.
- Phase 3: the `it.fails` "fixture held-out hybrid paraphrase ≥ semantic" passes (13 = 13) and is now a real gate.
- Phase 3 flake: hook-failure "Jev error or hang" budget (3876 ms > 3000) under suite load; 25/25 alone.
- Phase 5 flake under load (avg 17): skill-eval concurrency failed once in the full run, passed alone 22/22 x3.
- Phase 4 flakes under suite load (all passed alone, 38/38): freshness-scale warm start, hook-failure Jev-hang budget, skill-eval concurrency.
- Phase 4: search-parity failed in the first full run (CLI skipped decay, order diverged once ranking depended on it); fixed in code, see Decisions.

## Status
**Currently in Phase 6** - Release prep v1.11.0

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
    /archive-plan boost-decay-fallback    # -> .planning/.archive/boost-decay-fallback/

Archiving moves this directory to the gitignored .planning/.archive/ and stamps
it archived. Nothing is destroyed.
