# Task Plan: semantic-first skill refresh (#81)

## Goal
An agent following `skills/semantic-first/` calls only tools and parameters that exist, finds the servers whatever the `.mcp.json` entries are named, and acts correctly on each field a 1.25.0 search result carries. A test keeps the skill, the sibling skills and the server instructions from drifting apart again. Release as 1.25.1; text and tests only, no ranking change.

## Phases
- [x] Phase 1: Verify and plan (notes.md, "Phase 1: verification")
- [ ] Phase 2: Reproduce first, as failing tests (expected-fail until fixed)
  - [ ] Extend `test/unit/search-guidance.test.ts`, or add a sibling file. No `skills/**` file names a hard-coded server tool prefix as the only way to call a tool:
    - `mcp__semantic-sidekick__`;
    - a bare `mcp__semantic-vault__` without the role wording from Phase 3.
  - [ ] No `top_k` anywhere in `skills/`, and no `create_note` as the default write.
  - [ ] Every tool name the skills mention exists in `CURRENT_TOOL_INVENTORY`, and every parameter they name exists in that tool's schema.
  - [ ] The semantic-first skill and the server instructions both cover:
    - `missing_terms`, `passing_terms`, `undocumented` and `no_strong_match`;
    - the "Indexing in progress" answer;
    - multi-part coverage (#76).
  - [ ] Record which assertions fail on main.
- [ ] Phase 3: Rewrite `skills/semantic-first/SKILL.md` (keep it short)
  - [ ] **Servers by role, not by name.**
    - The docs server is a `semantic-*` entry with `--read-only`; the vault is a writable `semantic-*` entry. Tools are `mcp__<entry>__<tool>`, so use whichever entries the session lists.
    - Defaults written by `hooks/reconcile.js` are `semantic-vault` and `semantic-sidekick` (read-only `.documentation`, added when hit-em-with-the-docs is enabled). Other installs use other names, such as `semantic-memory` and `semantic-memory-docs`.
    - Any read-only notes dir can be configured by hand (#81 item 5).
  - [ ] Use `limit`, not `top_k`.
  - [ ] Writes default to `synthesize_note` (provenance stamped); `ingest_source` for an external source plus findings; `create_note` and `update_note` are fallbacks.
  - [ ] "Indexing in progress… Try again shortly." means wait and retry. It never means "no docs", even when `get_stats` already answered.
  - [ ] One "Reading the results" section for items 6–10, a line each, pointing at the server instructions for detail:
    - `missing_terms`: say it's absent; don't answer from the nearest hit.
    - `undocumented`: go to the code with Grep.
    - `passing_terms`: verify the hit answers.
    - `no_strong_match`: verify before citing, and say so.
    - Multi-part questions: read the top 3, but for a multi-part question scan the top 8 or search each part, and check every part is covered.
    - Grep confirms literal identifiers.
    - Docs aren't the source of truth: check a load-bearing claim against the code; `decay` means past its verification window.
    - `related` and the `entity` card.
  - [ ] The frontmatter `description` keeps its trigger phrases; only names and the "degrades when hit-em-with-the-docs is not installed" claim change.
  - [ ] `skills/semantic-first/evals/evals.json` and `references/vault-frontmatter.md`: fix the stale names, 1 and 3 hits.
- [ ] Phase 4: Server instructions match the skill
  - [ ] `serverInstructions` in `src/mcp/server.ts` adds `passing_terms`, the indexing answer and multi-part coverage, in one or two short clauses. It is read every session, so keep it tight.
  - [ ] The `search_hybrid` description in `src/mcp/tools/search.ts`: check it says the same, and fix only what contradicts it.
  - [ ] The existing "top 3 / each step separately" assertions still hold.
- [ ] Phase 5: Sibling skills and hook messages with the same hard-coded vault name
  - [ ] `skills/vault-first`, `skills/research-mode` and `skills/outage-silence` name `mcp__semantic-vault__*`. Apply the same role wording: the vault server is whatever writable `semantic-*` entry the session lists, `semantic-vault` by default.
  - [ ] `hooks/vault-context.js` prints `mcp__semantic-vault__…` in five messages. The hook already resolves the writable `semantic-*` entry. Print that entry's real name if this is a small change. If not, record why and leave it.
- [ ] Phase 6: Trigger check
  - [ ] If the semantic-first `description` changed beyond names, run the skill trigger eval on train only, within a stated budget, and compare with main. If only names changed, skip and say so.
- [ ] Phase 7: Release prep: bump all five version fields to 1.25.1 and the lockfile; the offline tarball is deferred to release.
- [ ] Phase 8: Cleanup -- remove junk and unused code this work created: scratch/test scripts, debug files, probe logging, one-off test functions, commented-out code, dead code from abandoned approaches (MANDATORY)
- [ ] Phase 9: Validate success through comprehensive testing (MANDATORY)
  - [ ] Phase 2's tests pass as plain `it`; no `it.fails` left.
  - [ ] Grep `skills/` for `semantic-sidekick__`, `top_k` and `create_note` as the default: none.
  - [ ] Every field in #81 item 6 has a one-line instruction that matches what `src/mcp/tools/search.ts` returns. Check against a real `search_hybrid` response from a built server on a small fixture.
  - [ ] The indexing string in the skill matches `src/mcp/context.ts` exactly.
  - [ ] hooks: the existing hook tests pass, plus a test for the printed entry name if Phase 5 changed it.
  - [ ] Lint, build, `npm test`, `npm run eval` (real-corpus floors unchanged: no doc text in `.documentation` changes before Phase 10).
  - [ ] Independent review of `git diff main...HEAD` against #81's acceptance list.
- [ ] Phase 10: Documentation pass with hit-em-with-the-docs; no secrets (MANDATORY)
  - [ ] `.documentation/operational/modes-guide.md`, `.documentation/quickstart/installation-guide.md`, `.documentation/quickstart/sidekick-overview.md`, `.documentation/reference/configuration-reference.md`, `.documentation/architecture/injection-points.md`: check what each says about semantic-first and server names; fix only what is now wrong. Keep hub-page edits tight, because the real-corpus eval reads them.
  - [ ] `README.md` skill row, if it names the old servers.
  - [ ] `CHANGELOG.md` 1.25.1 entry and a `.documentation/changelog/v1-25-1-semantic-first-refresh.md` page (`npx hewtd integrate -a`).
  - [ ] `npx hewtd maintain --quick`; never hand-edit INDEX.md or REGISTRY.md. Re-run `npm run eval` after the docs.

## Key Questions
1. Should `hooks/reconcile.js` change its default docs entry name from `semantic-sidekick` to something current? Not in this plan: renaming would break existing `.mcp.json` files and every hook that matches on it. Recorded for a later issue.
2. Does the hook print the real entry name cheaply? Answered in Phase 5.

## Decisions Made
- Name servers by role, because there is no single correct name: our reconcile hook writes `semantic-vault` and `semantic-sidekick`, while the reporter's install uses `semantic-memory` and `semantic-memory-docs`.
- Keep "read the top 3" (the existing test asserts it on 4 surfaces) and add multi-part coverage alongside it.
- Patch release (1.25.1): skill and instruction text, tests, maybe hook message text. No ranking or index change.

## Errors Encountered
- (none yet)

## Status
**Currently in Phase 2.** The workflow waits until the speed-up PR (`chore/faster-validation-runs`) merges (user, 2026-11-09).
