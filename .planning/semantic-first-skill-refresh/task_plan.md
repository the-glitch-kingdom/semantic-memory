# Task Plan: semantic-first skill refresh (#81, revised after the issue update)

## Goal
Replace `skills/semantic-first/SKILL.md` with the reporter's draft (saved verbatim as `draft-SKILL.md` in this folder). Delete `references/vault-frontmatter.md`. Fix the hard-coded vault tool names in the three sibling skills. A test keeps every tool and field the skills name tied to the release.

Release as 1.25.1: text, tests and a deleted file only. No ranking or index change.

## Phases
- [x] Phase 1: Verify and plan (notes.md: "Phase 1: verification" and "Phase 1b: the revised issue")
- [x] Phase 2: Reproduce first, as failing tests (expected-fail until fixed)
  - [x] New `test/unit/skill-surfaces.test.ts` (static checks) and `test/e2e/skill-result-fields.test.ts` (live checks). Over `skills/**/*.md` and `skills/**/*.json`:
    - [x] no `mcp__semantic-sidekick__` or `mcp__semantic-vault__` tool prefixes;
    - [x] no `top_k`;
    - [x] no `create_note` as the default write (it may appear only as a fallback, or not at all);
    - [x] every MCP tool name a skill mentions (`search_*`, `read_note`, `forwardlinks`, `backlinks`, `synthesize_note`, `ingest_source`, …) exists in `CURRENT_TOOL_INVENTORY`;
    - [x] every parameter named (`limit`) exists in that tool's schema (e2e: search_hybrid's live inputSchema has `limit`, no `top_k`; passes on main, guards the draft);
    - [x] every result field the semantic-first skill names (`missing_terms`, `undocumented`, `passing_terms`, `no_strong_match`, `decay`, `entity`, `related`) is emitted by `src/mcp/tools/search.ts`. Check it on a real `search_hybrid` response from a built server on a small fixture, not by grepping the source;
    - [x] the indexing string the skill quotes matches `src/mcp/context.ts` ("Indexing in progress").
  - [x] Keep the existing `search-guidance.test.ts` assertions ("top 3", "each step separately") passing for the surfaces they cover. If the draft's wording drops "top 3" for semantic-first, change that one surface's assertion to the draft's multi-part rule ("read down to result 8" / "every part is covered") and record why.
  - [x] Record which assertions fail on main.
- [x] Phase 3: Replace the skill with the draft
  - [x] `skills/semantic-first/SKILL.md` = `draft-SKILL.md`, with ONE change: the two-server lines.
    - The draft hard-codes `semantic-memory-docs` / `semantic-memory`, but `hooks/reconcile.js` writes `semantic-sidekick` / `semantic-vault` by default.
    - Describe the servers by role (read-only docs, writable vault). Give both name pairs as examples ("names come from `.mcp.json`; e.g. `semantic-memory-docs` / `semantic-memory`, or the defaults `semantic-sidekick` / `semantic-vault`"). Keep it to 2–3 lines and keep the draft's other text verbatim.
  - [x] Delete `skills/semantic-first/references/vault-frontmatter.md` (and the empty `references/` dir). Nothing else references it except SKILL.md and evals.json.
  - [x] `skills/semantic-first/evals/evals.json`: fix the old tool names and the reference-file mention in `expected_output`, to match the new skill.
  - [x] Word count: report it (the draft is ~516 words; the current skill is ~1,968 plus a 1,099-word reference file).
- [x] Phase 4: Sibling skills and hook messages
  - [x] `skills/vault-first`, `skills/research-mode` and `skills/outage-silence`: replace `mcp__semantic-vault__<tool>` with the bare tool name on "the vault server". Use the same role wording as Phase 3, in at most one line per skill.
  - [x] `hooks/vault-context.js` prints `mcp__semantic-vault__…` in six messages. The hook already resolves the writable `semantic-*` entry; print that entry's real name if this is a small change, with a test. If not, record why and leave it.
  - [x] Server instructions (`serverInstructions` in `src/mcp/server.ts`) omit `passing_terms`. Add it in one short clause, so the server and the skill name the same fields; keep the existing "top 3 / each step separately" text.
- [x] Phase 5: Trigger check (NOT MEASURED, see notes.md and Errors Encountered) (the issue asks for it)
  - [x] Build a prompt set (JSONL `{session, text}`), written before running:
    - should trigger: prose questions about the repo; "is there something that does X"; research questions;
    - should not trigger: exact code-symbol lookups; unrelated chat.
    - Include the 4 prompts in `evals.json`.
    - About 24–30 prompts, train only.
  - [x] (ran, but no valid result: 18 (old) and 19 (new) of 25 prompts errored with error_max_turns; numbers not usable) Run `semantic-memory skill-eval trigger` on the OLD skill (from main) and the NEW skill, same prompts, same run.
    - Budget: at most 2 runs per prompt per skill, about 120 claude runs in total. State the cost and runtime in notes.md.
  - [x] (NOT EVALUATED: no valid counts; no description change made; left for a tooling fix) **Pass:** the new description triggers on at least as many should-trigger prompts as the old one, minus at most 1, with no more false triggers plus at most 1. If it fails, adjust only the description's trigger phrases, re-run once, and record both runs.
- [ ] Phase 6: Release prep: bump all five version fields to 1.25.1 and the lockfile; the offline tarball is deferred to release.
- [ ] Phase 7: Cleanup -- remove junk and unused code this work created: scratch/test scripts, debug files, probe logging, one-off test functions, commented-out code, dead code from abandoned approaches (MANDATORY)
  - [ ] Remove `draft-SKILL.md` from the plan folder if it is identical to the shipped skill apart from the documented server lines; otherwise keep it as the record of the change.
- [ ] Phase 8: Validate success through comprehensive testing (MANDATORY)
  - [ ] Phase 2's tests pass as plain `it`; no `it.fails` left.
  - [ ] Grep `skills/` for `mcp__semantic-sidekick__`, `mcp__semantic-vault__`, `top_k` and `create_note`: none, or `create_note` only as a fallback.
  - [ ] Every tool and field the skill names exists in the release (the Phase 2 test, on a built server).
  - [ ] Skill linking still works: `scripts/link-skills.js` or `semantic-memory relink` with the deleted `references/` dir. No dangling symlink or missing-file error, in a scratch project.
  - [ ] Hook tests pass, plus the new test if Phase 4 changed hook messages.
  - [ ] Lint, build, `npm test`, `npm run eval`.
  - [ ] Independent review of `git diff main...HEAD` against #81's acceptance list, item by item.
- [ ] Phase 9: Documentation pass with hit-em-with-the-docs; no secrets (MANDATORY)
  - [ ] These docs mention semantic-first or the server names; fix only what is now wrong:
    - `.documentation/operational/modes-guide.md`
    - `.documentation/quickstart/installation-guide.md`, `.documentation/quickstart/sidekick-overview.md`
    - `.documentation/reference/configuration-reference.md`, `.documentation/reference/cli-reference.md`
    - `.documentation/architecture/injection-points.md`, `.documentation/architecture/indices-and-storage.md`

    Keep hub-page edits tight; the real-corpus eval reads them.
  - [ ] `README.md` skill row, if it describes the old skill.
  - [ ] `CHANGELOG.md`: turn `[Unreleased]` (the tooling entry from #82) into the 1.25.1 entry, with #81's changes. Add `.documentation/changelog/v1-25-1-semantic-first-refresh.md` (`npx hewtd integrate -a`).
  - [ ] `npx hewtd maintain --quick`; never hand-edit INDEX.md or REGISTRY.md. Re-run `npm run eval` after the docs.

## Key Questions
1. Should `hooks/reconcile.js` default to `semantic-memory` / `semantic-memory-docs`? Not in this plan: existing `.mcp.json` files and every hook that matches on the old keys would need a migration. Raise it with the reporter as a follow-up.
2. Does the hook print the real entry name cheaply? Yes (Phase 4): `vaultTool()` in `hooks/vault-context.js` reads the writable semantic-* entry from .mcp.json via findNotesSources; falls back to semantic-vault.

## Decisions Made
- Take the reporter's draft verbatim, except for the server-name lines, which name servers by role with both name pairs as examples. Hard-coding the reporter's names would misdirect every default install (our reconcile hook writes `semantic-vault` / `semantic-sidekick`).
- Delete `references/vault-frontmatter.md`: it documents `tier`, `source` and `owner`, which `synthesize_note` never writes (it writes `title`, `type`, `status`, `last_verified`, `confidence`, `sources`; `src/core/synthesize.ts:67-80`).
- Patch release 1.25.1, which also carries the #82 tooling changes from `[Unreleased]`.

## Errors Encountered
- Phase 5: trigger eval gave no usable result. `runTrigger` runs claude with maxTurns 2; a run that calls the Skill and then goes on ends as `error_max_turns`, which `runClaude` reports as `ok:false`, so the run is discarded, not counted as a trigger. Calling the skill is what makes a run fail, so the counts are biased against triggering. Both arms also used 92 runs (184 total, over the ~120 budget) because errored runs are retried. Raw output: `trigger-old-raw.json`, `trigger-new-raw.json`. Not re-run (budget). Fix needed in tooling (count a Skill call seen before the max-turns stop as a vote), outside this plan.
- Phase 3: `search-guidance.test.ts` required "top 3" / "each step separately" in the semantic-first skill; the draft drops both. That surface now asserts the draft's rule ("search each part, or read down to result 8", "every part is covered"); the other three surfaces are unchanged.
- Phase 3: full suite hit freshness-scale warm start and stdin-eof SIGTERM (known load flakes); both pass alone.
- Phase 3: the prefix test in `skill-surfaces.test.ts` stays `it.fails` until Phase 4 fixes the sibling skills; the other eight are plain `it`.
- Phase 2: freshness-scale warm start failed once under the full suite (known load flake) and passed alone.
- Phase 2: the "every tool a skill names" regex also matches `read_time_min`, a frontmatter field in the reference file. It is deleted in Phase 3, so the regex stays simple.

## Status
**Currently in Phase 6.**
