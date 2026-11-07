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
- [ ] Phase 2: Eval first (written before any ranking or decay change)
  - [ ] Decay fixture in `test/fixtures/docs-vault/`: pairs of equally relevant docs, one with a recent `last_verified`
        and one with none, plus one with `last_verified` 400 days old. Write train and held-out questions where the
        verified doc is the answer. Record the shipped baseline (the unverified doc wins, or ties on fail-open).
  - [ ] Give the eval's temp vault a git history with backdated commits (`GIT_COMMITTER_DATE`), so `git` mode can be
        measured. Keep the existing splits unaffected when decay falls back.
  - [ ] Eval reports the age source per result, so the Phase 4 checks can assert on it
  - [ ] Re-record the shipped baseline for all four splits in notes.md (the #48 sweep numbers are the reference)
- [ ] Phase 3: Graph boost and the stale marker (#48)
  - [ ] `GRAPH_BOOST` 1.3 → 1.0 in `src/core/graph-boost.ts`. Keep the helper and seeds in place (the boost is now a
        no-op multiplier). Re-check on train that 1.0 is not worse than 1.1, and record both.
  - [ ] Re-measure every split. Raise floors that went up. Convert `it.fails` gates that now pass (expected: fixture
        held-out "hybrid paraphrase ≥ semantic"). Record each floor that drops (expected: fixture-train exact @1,
        fixture held-out multi @3).
  - [ ] Stale marker: while the old index answers, the `search_*` text responses carry a visible line or field (e.g.
        `"stale": true` plus "index refreshing, re-run to confirm"), not only `_meta`. The MCP server and the CLI get
        the same behaviour. Add a test in `test/integration/freshness.test.ts` or `index-upgrade.test.ts`.
- [ ] Phase 4: Decay age fallback (#49)
  - [ ] `decay.missing_last_verified: git | mtime | fresh | penalty` and `decay.missing_penalty` (default 0.85) in
        `DecayConfig`, `loadDecayConfig` and `schema-default.ts`. Default: `git` (#49's suggestion). It changes
        ranking for existing vaults; `fresh` restores the old behaviour exactly.
  - [ ] `git` mode: one `git log --name-only --format=%ct` pass per index build or reconcile, not one call per file.
        Store the date with the doc in the index and key it by content hash, so no query calls git. Outside a repo,
        or for an untracked or uncommitted file, fall back to `missing_penalty`.
  - [ ] `mtime` mode: decide between the raw file mtime (#49) and `resolveMtime`'s chain (`last_updated` first) and
        record why. Never use `last_validated`: hewtd stamps it for frontmatter validation, not content verification.
  - [ ] `computeDecay` takes the fallback age and source. Unparseable and future `last_verified` values use the
        fallback too.
  - [ ] The `decay` block carries `source` (`last_verified` / `git` / `mtime` / `penalty` / `fresh`) and is attached
        whenever a fallback was used, even at multiplier 1. MCP and CLI match.
  - [ ] Lint `stale` rule: report notes with no `last_verified` (count, or `decay_candidates`) instead of skipping
        them silently. Keep the severity unchanged.
  - [ ] The index schema version is bumped only if the stored doc shape changes. Upgrade test: a v1.10.0 index
        re-reads git dates without re-embedding.
  - [ ] Measure on the decay fixture and on all four splits. The verified doc must beat its unverified twin, and no
        split @1 may drop by more than noise (1 case on the real corpus).
- [ ] Phase 5: `meta_weight` and abstention, measured (#48)
  - [ ] `meta_weight`: measure 0.8 vs 1.0 on train with a metadata-rich subset, i.e. questions whose answer docs
        carry `purpose`/`symptoms`. The default stays 0.8 unless train shows otherwise. Document when to raise it,
        stating only what was measured.
  - [ ] Abstention: on train only, try at most two rules beyond a single cosine cutoff (e.g. cutoff by top-1 vs
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

## Errors Encountered
- [Error]: [Resolution]

## Status
**Currently in Phase 2** - eval first (decay fixture, git-history temp vault)

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
