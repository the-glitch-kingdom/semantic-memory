# Task Plan: index-text-pooling-body-dates

## Goal
Ship v1.12.0 for semantic-memory#52 (keep code, inline code, table cells and in-word `_` in the indexed text), #53
(per-model pooling and query prompt, read from the model's own config) and #54 (git-date decay ages by the last
**body** change), plus the remaining #51 fixes (non-string `title` crash, outdated `search_hybrid` description,
CHANGELOG wording). One PR from `feat/index-text-pooling-body-dates`, one index schema bump, one re-embed for users.
Every missed target is stated in the PR.

## Rules for every phase
- **Verify before ticking.** Confirm in code, or with a test, that a box is actually done before ticking it.
- **Eval discipline.** Held-out questions are never used to choose a constant, a text rule or a threshold. Tune on
  train only, report held-out as measured, and write all questions ourselves.
- **Floors.** A floor drops only when a measured change justifies it. Record each drop under Errors Encountered with
  the reason. An `it.fails` gate that starts passing becomes a real gate.
- **Reuse.** Extend the existing code (`Indexer.stripMarkdown`, `gitCommitDates`, `computeDecay`, `Embedder` and
  `embed-worker`, the model-mismatch check in `context.ts`, `index-store`, the eval harness). No new dependencies.
- **No default model change.** #53 ships the mechanism only; MiniLM stays the default until the reporter's blind set
  says otherwise.
- **Don't touch hit-em-with-the-docs.** That repo belongs to another session.

## Phases
- [x] Phase 1: Verify and plan
  - [x] Verify #51 (remaining items), #52, #53 and #54 against main @ 93ab5f2 (notes.md)
  - [x] Sync main and cut `feat/index-text-pooling-body-dates`
  - [x] Commit this plan (the staged archive move of `boost-decay-fallback` goes in the same commit)
- [ ] Phase 2: #51 fixes
  - [ ] `title` is always a string: coerce non-string frontmatter titles (number, Date, array) in `Indexer.indexFile`
        (`src/core/indexer.ts:113`); a Date becomes its `YYYY-MM-DD` form. Also make `bm25SelfTop` skip non-string
        titles so an old index loaded from disk cannot throw either.
  - [ ] Regression test: a vault with `title: 2024` and `title: 2024-05-01` answers `search_hybrid` (unit test on
        `bm25SelfTop`, plus an integration test through the MCP tool), and the index save succeeds.
  - [ ] Check what happens when a background refresh throws today. If it fails every later call, keep serving the
        old index and log the error with its stack to stderr instead. Tool errors log their stack to stderr.
  - [ ] `search_hybrid` description without the graph boost in all three places: `src/mcp/tools/search.ts:158`,
        `src/mcp/tools/inventory.ts:25`, `src/cli/index.ts:216`. Grep for any other "graph proximity" text.
  - [ ] `CHANGELOG.md` 1.11.0 entry: the stale marker is a trailing separate text block, not a prefix.
- [ ] Phase 3: Eval first (written before any indexing, decay or embedder change)
  - [ ] Fixture docs and questions (train and held-out) for #52: an identifier only inside backticks (e.g.
        `check_rls_coverage.py`), a value only in a table cell (an env var name), a `snake_case_name` in prose, a
        command only inside a fenced block. Record the shipped baseline (expected: misses).
  - [ ] Decay fixture case for #54: a doc whose body was last changed 400 days ago, then touched by a
        frontmatter-only commit today, against an equally relevant verified twin. Record the shipped baseline
        (expected: the unverified doc wins).
  - [ ] Re-record all splits (fixture train/held-out, real train/held-out, decay) for main @ 93ab5f2 in notes.md.
- [ ] Phase 4: Git-date decay by last body change (#54)
  - [ ] `gitCommitDates` keeps each path's blob history from the same single `git log --raw` (newest first), not only
        the newest entry.
  - [ ] Body dates: read the needed blobs through ONE `git cat-file --batch` process; for each unverified doc whose
        newest blob matches the file on disk, walk back to the first commit whose body (text after frontmatter, same
        rule as `parseFrontmatter`) differs from the previous version. A file's first commit counts as a body change.
        Bounded walk, timeout as today.
  - [ ] Store the body date as `gitDate`; the `decay` block says which rule was used (`source: "git-body"`, or
        `git` with a field) and the commit date. Decide and record.
  - [ ] Still no git calls at query time; dates are kept with the doc and recomputed only when its content changes.
  - [ ] Measure on the decay fixture and every split.
- [ ] Phase 5: Indexed text keeps code, tables and identifiers (#52)
  - [ ] `stripMarkdown`: keep inline code contents (drop the backticks), keep fenced code contents (drop the fence
        lines), turn table rows into space-separated cells and drop separator rows, strip `*_~` only at word edges so
        `snake_case` survives. Check the other rules for in-word damage too (`>\s+`, `#{1,6}\s+`).
  - [ ] BM25 and `search_text` see the kept text (both read the chunk / `content` text today).
  - [ ] Embedded text: measure on train (a) the same kept text vs (b) prose plus inline identifiers, with long fenced
        blocks left out of the vector text. Choose on train, report held-out and cold build time for both.
        If (b) wins, keep one chunk text for BM25 and a second for embedding without doubling stored chunks.
  - [ ] Excerpts and snippets still read well with code kept (spot-check the shaped results).
  - [ ] `INDEX_SCHEMA_VERSION` 6 → 7 (shared with Phase 4 and 6): chunk text changes, so vectors are re-embedded
        once. Upgrade test: a v6 index re-embeds, keeps serving the old index while it does, and ends consistent.
- [ ] Phase 6: Per-model pooling and query prompt (#53)
  - [ ] On model download, also fetch `1_Pooling/config.json` and `config_sentence_transformers.json` into the model
        cache dir (missing file = mean pooling, no prompt; offline = use what is cached).
  - [ ] Pooling: `cls` (token 0, then L2-normalize) or `mean`, from the model config; override with
        `embedding.pooling` in `vault.schema.yml` and a CLI flag. Same code path in `embedder.ts` and
        `embed-worker.ts` (share one helper).
  - [ ] Query prompt: `prompts.query` from the model config (arctic-embed: "Represent this sentence for searching
        relevant passages: "), override `embedding.query_prompt`. Queries only, never documents; every query caller
        (search_semantic, search_hybrid, CLI search, hooks, reranker untouched) goes through one `embedQuery`.
        Check nomic-embed-text-v1.5's `search_query:` / `search_document:` prefixes and handle or document them.
  - [ ] Index meta records `pooling` and `queryPrompt`; the model-mismatch check (`src/mcp/context.ts:245`) forces a
        re-embed when either changes. MiniLM's vectors are unchanged (mean, no prompt).
  - [ ] Offline tarball bundles the two config files with the model cache.
  - [ ] Measure `BAAI/bge-small-en-v1.5` and `Snowflake/snowflake-arctic-embed-s` against MiniLM on all splits (train
        and held-out, reported as measured). No default change.
- [ ] Phase 7: Release prep v1.12.0
  - [ ] Bump all five version fields (`package.json`, both in `.claude-plugin/marketplace.json`,
        `.claude-plugin/plugin.json`, `AGENTS.md` frontmatter), then `npm install --package-lock-only --ignore-scripts`
  - [ ] Offline tarball builds (`--allow-dirty` here; rebuilt from the merge commit before publishing)
- [ ] Phase 8: Cleanup -- remove junk and unused code this work created: scratch/test scripts, debug files, probe logging, one-off test functions, commented-out code, dead code from abandoned approaches (MANDATORY)
  - [ ] Remove trial knobs, sweep scripts and the losing embed-text variant from Phase 5; dead-code check over the
        branch diff (`tsc --noUnusedLocals`, grep). Pre-existing unused locals are left alone.
- [ ] Phase 9: Validate success through comprehensive testing -- we need to validate success thoroughly through comprehensive testing of our changes (MANDATORY)
  - [ ] Independent review of `git diff main...HEAD`. Look for:
    - per-query git calls, or one git process per file
    - body dates leaking across content changes; frontmatter detection differing from `parseFrontmatter`
    - documents embedded with the query prompt, or queries without it
    - pooling or prompt changes that do not force a re-embed
    - in-word text damage left in `stripMarkdown`
    - floors lowered without a record
  - [ ] Unit:
    - `stripMarkdown`: backtick identifier, fenced block, table cell, separator row, `snake_case`, `**bold**`,
      `_emph_`, `a -> b`, nested/unclosed fences
    - CLS vs mean pooling on a hand-built tensor; query prompt applied to queries only
    - body-date walk: frontmatter-only commit skipped, body edit resets, first commit, file edited since commit
    - non-string titles (number, Date, array) through the indexer and `bm25SelfTop`
  - [ ] Integration:
    - #52 acceptance: a doc whose only mention of `check_rls_coverage.py` is in backticks is returned for a query
      naming it; an env var only in a table cell is found by `search_hybrid` and `search_text`; `snake_case_name`
      is one token
    - #54 acceptance: 400-day body + frontmatter-only commit today decays as 400 days; a body edit resets the age;
      a PATH spy counts one `git log` and at most one `git cat-file` per build, none per query
    - #53 acceptance: a model whose pooling config says CLS uses CLS without flags (stub model dir, no network);
      switching pooling forces a re-embed
    - #51: hybrid search and index save with a numeric/date title
    - schema 6 → 7 upgrade: re-embeds once, stale marker while it does, consistent after
  - [ ] Regression: every eval split at or above its floor; new #52 and #54 cases pass as real gates
  - [ ] Prove a gate fails: revert one stripMarkdown rule in a scratch edit, see the #52 gate fail, revert
  - [ ] Full suite: `npm run lint && npm run build && npm test && npm run eval`. Re-run known timing flakes alone and
        record them.
  - [ ] Offline tarball `--verify`; smoke install
  - [ ] Write an answer to each #52, #53, #54 acceptance item and each remaining #51 item in notes.md, missed ones
        included
- [ ] Phase 10: Documentation pass -- a full hit-em-with-the-docs pass to create/update/deprecate as many docs as needed to capture all our changes: new procedures, tools, troubleshooting steps, gotchas, KB articles, etc. Never include secrets or passwords (MANDATORY)
  - [ ] New `.documentation/changelog/v1-12-0-index-text-pooling-body-dates.md` (`npx hewtd integrate -a`):
        before/after tables per split, the one-time re-embed on upgrade, the body-date rule, measured model results,
        missed targets; `CHANGELOG.md` entry
  - [ ] `.documentation/reference/configuration-reference.md`: `embedding.pooling`, `embedding.query_prompt`, and the
        `git` decay rule change
  - [ ] Decay guide (`.documentation/operational/decay-guide.md`): body-change dating, frontmatter-only commits, the
        uncommitted-edit penalty (#51 note)
  - [ ] `.documentation/operational/retrieval-tuning-guide.md`: what the indexed text keeps, the embed-text choice and
        its numbers, how to try another embedder (pooling, prompt, re-embed)
  - [ ] Tool reference (`.documentation/reference/mcp-tools-reference.md`): `search_hybrid` description, `search_text`
        now matches code and table text
  - [ ] KB fact (gotcha): a numeric or date YAML `title` is not a string (`title: 2024`), and code that assumes it is
        throws; quote it or coerce it
  - [ ] KB fact (gotcha): sentence-transformers models declare their pooling and query prompt in their own config;
        mean-pooling a CLS model or skipping its query prompt quietly lowers retrieval
  - [ ] `README.md` version/status line; `npx hewtd maintain --quick`; regenerate AGENTS.md with
        `regenerate_contract`, passing projectRoot
  - [ ] Tick the last boxes so `/plan-status` reads COMPLETE

## Key Questions
1. Embedded text for #52: the same kept text, or prose plus inline identifiers without long code blocks? (Phase 5,
   chosen on train)
2. Does `git` mode simply switch to body dates, or is `git-body` a separate source value? (Phase 4)
3. Does the background refresh fail every later call when it throws, or only the self-query? (Phase 2)
4. Do bge-small / arctic-embed-s with the right pooling and prompt beat MiniLM on our splits? Reported only; no
   default change in this release. (Phase 6)

## Decisions Made
- One plan, one PR, v1.12.0 (minor): #52 and #53 both change vectors, and #54 changes stored `gitDate`, so all three
  share one schema bump (6 → 7) and users re-embed once instead of twice. #51 fixes ride along as Phase 2 because
  they are small and the title bug breaks hybrid search outright.
- #53 ships the mechanism and measurements only; the default model stays MiniLM.
- Order: #51 fixes, eval cases, #54 (independent of text), #52 (changes chunk text), #53 (changes vectors), so each
  measurement isolates one change.

## Errors Encountered
- (none yet)

## Status
**Currently in Phase 2** - #51 fixes

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
    /archive-plan index-text-pooling-body-dates    # -> .planning/.archive/index-text-pooling-body-dates/

Archiving moves this directory to the gitignored .planning/.archive/ and stamps
it archived. Nothing is destroyed.
