# Task Plan: usage-capture-gaps

## Goal
Ship semantic-memory#59 plan A: a PostToolUse hook that records "searched, then read X" and "searched, then fell back
to grep" into a separate usage log, a `semantic-memory gaps [--json]` export in hit-em-with-the-docs' `gaps.v1`
format, and a usage-derived question set for `eval` (#56). No ranking change in this plan: the usage prior is plan B,
a later plan gated on weeks of data and on `eval`. One PR from `feat/usage-capture-gaps`. Series step 2 (after #56
built-in eval and #57). Every missed target is stated in the PR.

## Prerequisites
- #56 (`builtin-eval`) merged: the usage set's line format must match `eval`'s question-set format.
- hit-em-with-the-docs#66 / `gaps.v1` contract (posted on #59). hewtd owns the schema and shipped it in
  `@theglitchking/hit-em-with-the-docs` 2.21.0 (`schemas/gaps.v1.schema.json`, in the npm package). It is our
  devDependency at `latest`, but the lockfile holds 2.10.0: pin it to `^2.21.0` and update the lock in Phase 2.

## Rules for every phase
- **Verify before ticking.** Confirm in code, or with a test, that a box is actually done before ticking it.
- **No ranking change.** The hook never writes `selection` events: `usage_boost` is on by default and counts every
  `selection`, so feeding it would change ranking with no eval gate. A test proves `loadCitationCounts` is unchanged.
- **Privacy.** The log never holds file contents, tool responses, snippets or grep patterns. Queries are redacted
  (broad) when logged and again on export; if the redactor cannot load, write nothing.
- **Works without hit-em-with-the-docs.** No code path references or spawns hewtd; a missing log gives an empty export.
- **Reuse.** `findNotesSources` (hooks/vault-context.js), `searchedCorpus` / `bashSearchArgs`
  (hooks/doc-search-redirect.js), the dist-import pattern of hooks/skill-loop.js, `appendEvidence`'s append-and-rotate
  (src/core/skill-evidence.ts), `readRepoConfig` (src/core/features.ts), `telemetryEnabled`, `tokenize` (src/core/bm25.ts),
  `redact` (src/core/redact.ts). No new runtime dependencies (ajv is already present through the MCP SDK; tests only).
- **Don't touch hit-em-with-the-docs.** Another session owns it.

## Phases
- [x] Phase 1: Verify and plan
  - [x] Verify #59 against main @ 29e74db (notes.md)
  - [x] Re-verify against main @ 865322b (v1.14.0): claims unchanged; hewtd 2.21.0 published `gaps.v1.schema.json`
  - [x] Post the verification comment on #59
  - [x] Sync main, cut `feat/usage-capture-gaps`, commit this plan (with the archive move of the previous plan, if any)
- [x] Phase 2: Real payloads first
  - [x] Pin hewtd devDependency to ^2.21.0, update the lock; schema file confirmed present
  - [x] Capture one real PostToolUse payload each for an MCP `search_hybrid`, `read_note`, `Read`, `Grep`, `Glob` and a
        Bash grep (debug hook or `SIDEKICK_DEBUG=1`), redact them, and store them as test fixtures. Record the
        `tool_response` shape of MCP tools in notes.md before writing the parser.
- [x] Phase 3: Usage log module (`src/core/usage-log.ts`)
  - [x] Log at `<repoRoot>/.claude/.semantic-memory/usage.jsonl`, one per project. Every line has `"v":1`. Events:
        `search {ts, session, id, server, tool, query, results[≤20 vault-relative paths], weak?}`,
        `use {ts, session, search, server, path, rank|null, via}`, `fallback {ts, session, search, via, scope}`.
        Rotate to `.1` past 5 MB.
  - [x] `parseSearchResponse` (string, `[{text}]`, `{content:[…]}`; `[]` for the indexing message; ignores the
        trailing `[stale: …]` block), `matchSearch` (same session, 10-minute window, the newest search whose results
        hold the doc, else the newest), `computeGaps`, `usageEvalSet`.
  - [x] Unit tests for each, including session isolation, the window edge and the stale block.
- [x] Phase 4: The hook (`hooks/usage-capture.js`, second PostToolUse entry in `hooks/hooks.json`)
  - [x] Matcher `Read|Grep|Glob|Bash|mcp__.*semantic-.*__(search_hybrid|search_semantic|search_text|read_note)`
        (server names matched by suffix, so plugin-provided servers match).
  - [x] Exits, cheapest first: `SEMANTIC_MEMORY_REVIEWER=1`, `SEMANTIC_MEMORY_USAGE_CAPTURE=0`, repo config
        `usage_capture: off`, no semantic source; Bash that is not a grep; Read that is not `.md` under a source
        (longest matching source path). Only then read the last 256 KB of the log. Respect the searched vault's
        `telemetry.enabled`. Fails open on bad input. (Note: Read/Bash exits sit before the .mcp.json read; the 256 KB log tail is read only for use/fallback, after a source and a tool shape match.)
  - [x] Read maps to `{server, vault-relative path}`; rank from that search's results.
- [ ] Phase 5: `semantic-memory gaps [--root <dir>] [--since <iso>] [--json] [--include-repo-grep]`
  - [ ] A search is a gap when it has no `use` in the window, a `fallback` came before its first `use`, or the doc
        used was not in its results. By default only fallbacks inside a vault count (`--include-repo-grep` widens it).
  - [ ] Clustering without an LLM: group by `used_doc`; searches with none are grouped greedily by token Jaccard
        ≥ 0.5; the representative query is the most frequent wording.
  - [ ] `--json` is exactly `gaps.v1`: `{version: 1, source: "semantic-memory <version>", gaps: [{query, used_doc,
        suggested, count, last_seen}]}`; `used_doc` vault-relative or null; `suggested` is `symptoms.user_phrase`
        when `used_doc` is set, else `new doc`; `last_seen` YYYY-MM-DD. A query that still holds `[REDACTED]` after
        redaction is dropped. The text report may also show the signals (no selection, grep fallback, not in results).
- [ ] Phase 6: Usage eval set
  - [ ] `semantic-memory usage-set [--out]` writes `.claude/.semantic-memory/eval/usage.jsonl` in `eval`'s
        question-set format (#56), only searches whose doc was used, split by a deterministic hash of the normalized
        query (`tune` / `heldout`). `eval` picks it up when present.
  - [ ] Delete `scripts/retrieval-eval/mine-selection.mjs` and update its doc references.
- [ ] Phase 7: Release prep v1.15.0
  - [ ] Bump all five version fields, `npm install --package-lock-only --ignore-scripts`
  - [ ] Offline tarball builds (rebuilt from the merge commit with a clean model cache before publishing)
- [ ] Phase 8: Cleanup -- remove junk and unused code this work created: scratch/test scripts, debug files, probe logging, one-off test functions, commented-out code, dead code from abandoned approaches (MANDATORY)
  - [ ] Remove payload-capture scaffolding and debug logging; dead-code check over the branch diff.
- [ ] Phase 9: Validate success through comprehensive testing -- we need to validate success thoroughly through comprehensive testing of our changes (MANDATORY)
  - [ ] Independent review of `git diff main...HEAD`: any path that writes `selection` events, doc text or tool
        responses in the log, unredacted queries in the export, hook work before the cheap exits, hewtd references.
  - [ ] Hook integration (`test/integration/usage-capture-hook.test.ts`, spawn the real hook with the Phase 2
        fixtures in a temp repo whose `.mcp.json` points at `./.documentation --read-only`):
    - search then `Read` of a returned doc gives a `use` with its rank (#59 check 1)
    - `Read` of a doc not in the results gives `rank: null`
    - search then Grep and no read gives a `fallback`, and `gaps` lists it as `new doc` (#59 check 2)
    - search, Grep, then Read of X gives a `symptoms.user_phrase` gap with `used_doc` X
    - another session is not linked; a read after the window is not linked (injected clock)
    - Bash `ls` writes nothing and the hook stays under its budget; bad stdin fails open; nested vaults resolve to
      the longest path
  - [ ] Privacy (#59 check 3): a marker string in the tool response and file content never reaches `usage.jsonl`;
        an `AKIA…` key in a query is redacted; `telemetry.enabled: false` and `SEMANTIC_MEMORY_USAGE_CAPTURE=0` write
        nothing.
  - [ ] No ranking leak: after hook events `loadCitationCounts` is unchanged and eval numbers are identical.
  - [ ] Schema (#59 check 4): `gaps --json` on a fixture log validates with Ajv2020 against
        `node_modules/@theglitchking/hit-em-with-the-docs/schemas/gaps.v1.schema.json` (the devDependency, 2.21.0+;
        no copy kept in this repo); a hand-written minimal gaps file validates; `version: 2` fails. We emit only the full
        `gaps.v1` object, not the other input forms `hewtd reconcile --gaps` accepts.
  - [ ] Other plugin absent (#59 check 6): no `.hewtd`, no hewtd install; `gaps` on a missing log prints `gaps: []`
        and exits 0; a grep test asserts `usage-log.ts` and the hook never reference hewtd or spawn anything.
  - [ ] #59 check 5 (the prior does not lower blind @1) is plan B: record it as not in scope.
  - [ ] Full suite: `npm run lint && npm run build && npm test && npm run eval`; known flakes re-run alone and recorded.
  - [ ] Offline tarball `--verify`; smoke install. Answer each #59 acceptance item in notes.md.
- [ ] Phase 10: Documentation pass -- a full hit-em-with-the-docs pass to create/update/deprecate as many docs as needed to capture all our changes: new procedures, tools, troubleshooting steps, gotchas, KB articles, etc. Never include secrets or passwords (MANDATORY)
  - [ ] New `.documentation/changelog/v1-15-0-usage-capture-gaps.md` (`npx hewtd integrate -a`) and a `CHANGELOG.md` entry
  - [ ] New `.documentation/reference/gaps-format.md`: what semantic-memory fills and how (vault-relative `used_doc`,
        clustering, redaction, dropped queries), linking hewtd's `docs/gaps-format.md` and schema as the source of truth
  - [ ] New `.documentation/operational/search-gaps-guide.md`: reading `gaps`, handing it to `hewtd reconcile --gaps`
  - [ ] `.documentation/reference/hooks-reference.md` (new PostToolUse entry, state table, off switch),
        `.documentation/reference/cli-reference.md` (`gaps`, `usage-set`),
        `.documentation/reference/configuration-reference.md` (`usage_capture`)
  - [ ] `.documentation/operational/usage-feedback-guide.md`: fix "only reads that followed a search are counted"
        (the code counts every `read_note`), explain the two logs and where a read-only server's log lives
  - [ ] `.documentation/operational/retrieval-tuning-guide.md`, `.documentation/testing/tests-and-validation.md`:
        replace `mine-selection` references
  - [ ] KB fact (gotcha): a read-only server writes `selection.jsonl` under the index folder, not
        `.claude/.semantic-memory/`
  - [ ] `README.md`, `npx hewtd maintain --quick`, regenerate AGENTS.md; tick the last boxes so `/plan-status` reads COMPLETE

## Key Questions
(Resolved at branch time, 2026-11-07; see Decisions Made.)

## Decisions Made
- `.claude/.semantic-memory/usage.jsonl` could be committed by accident: healthcheck warns when `git check-ignore`
  says it is not ignored (a warning, not an auto-edit of `.gitignore`). Add this to Phase 5's work and test it in Phase 9.
- Reads after the UserPromptSubmit `<vault-context>` injection are not logged: they have no search, and logging
  them would mean storing prompts.
- The hewtd devDependency is pinned to `^2.21.0`, so the schema test runs against the published schema.
- Separate `usage.jsonl`, never `selection` events: keeps the default-on `usage_boost` unchanged.
- `used_doc` is vault-relative: the contract accepts docs-relative, vault-relative or absolute, not repo-relative.
- The schema is hewtd's; we keep a test copy and a drift check, and do not ship our own schema file.
- Plan B (separate, later): a query-dependent usage prior (similar past queries vote for the docs used, ≥2 sessions,
  recency decay, cap ~1.15×, `usage_prior.enabled: false` by default), tuned on the `tune` split and enabled only if
  held-out usage and blind-set @1 do not drop; and a decision on the old query-independent `usage_boost`.

## Errors Encountered
- Phase 4: tsup had no entries for usage-log/telemetry, so the plain-JS hook could not import them from dist; added both to tsup.config.ts. Full suite had the 2 known flakes (hook-failure Jev-hang, freshness-scale warm start); both pass alone.
- Phase 3: full suite had the 2 known load flakes (freshness-scale warm start, hook-failure Jev-hang); both pass alone. `usageEvalSet` emits tier `paraphrase` (FacetCase needs a tier). Fallback `scope` is `vault` | `repo`; the hook (Phase 4) decides which.
- Phase 2: no errors. Live capture succeeded on the second try (first used a library file as the server entry).

## Status
**Currently in Phase 5** - the gaps command

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
    /archive-plan usage-capture-gaps    # -> .planning/.archive/usage-capture-gaps/

Archiving moves this directory to the gitignored .planning/.archive/ and stamps
it archived. Nothing is destroyed.
