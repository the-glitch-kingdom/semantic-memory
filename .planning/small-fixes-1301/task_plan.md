# Task Plan: four small fixes and a doc banner (#36, #35, #34, #27, #28), release 1.30.1

## Goal
Close the four open bugs that still reproduce on 1.30.0, plus the doc follow-up promised when #28 was closed. None of them touches ranking, so the release gate against 1.30.0 must be identical.

1. **#36** `synthesize_note`'s autoWikilink corrupts text:
   - it links inside inline code spans (only fenced blocks are skipped);
   - `\b` treats `-`, `/` and `.` as boundaries, so a name is linked inside a longer path: `` `.documentation/devops/[[keycloak-custom-image]]-workflow.md` ``;
   - it links `related_notes` entries that are not vault notes (`[[operational-runbook]]` for a rules file), in the body and in the `## Related` list.
2. **#35** `lint_vault` (and the healthcheck slow tier) reports schema errors on the plugin's own generated files: every folder `INDEX.md` (`src/core/index-regen.ts:102`) and the root `log.md` (`src/core/log.ts:25`). They carry no frontmatter, so they are linted as type `note` and fail `title`/`status`. Reproduced on 1.30.0: 4 errors on a vault holding only those two files.
3. **#34** `healthcheck` `hook_registration` warns "missing hook registrations" on a plugin install. `pluginRegisteredHookEvents()` (`src/core/healthcheck.ts:238`) finds the plugin only through `CLAUDE_PLUGIN_ROOT`, which is unset when healthcheck runs from a terminal or from `/healthcheck`. The duplicate-hooks part of the report is already handled: the postinstall runtime de-duplicates plugin and npm registrations. Only the false warning remains.
4. **#27** `lint_vault` `broken_links` resolves `[[target]]` by file basename only (`src/core/lint.ts:103`), so a link to a hit-em-with-the-docs folder-form incident (`[[2026-07-09-slug]]` → `incidents/2026-07-09-slug/narrative.md`, frontmatter `id: 2026-07-09-slug`) is reported broken.
5. **#28 follow-up** (closed as not planned): `docs/corpora-json.md` and `docs/smart-middle-activation.md` describe a corpora.json / smart-middle feature that was never built, with `.babel-fish/` paths babel-fish never writes. `docs/` ships in the npm package. Add a short banner to each: superseded, never implemented, see federation.

Release as **1.30.1** (patch: fixes only, no new options).

**Out of scope.**
- Wikilink resolution in the search graph (`src/core/graph.ts` `pathLookup`, basename only). Changing it adds edges and can move ranking. #27 asks for lint. Record it as a possible follow-up.
- Rewriting the two `docs/` design docs: a banner only.

## Phases
- [x] Phase 1: Verify and plan (notes.md)
- [x] Phase 2: Acceptance as failing tests first (`it.fails` until fixed)
  - [x] #36 (unit, `test/unit/synthesize*.test.ts`, next to the existing synthesize tests):
    - a related note named in inline code (`` `.claude/rules/operational-runbook.md` ``) stays unlinked;
    - a name that is a prefix of a longer path or filename (`keycloak-custom-image` in `keycloak-custom-image-workflow.md`, `devops/keycloak-custom-image.md`) stays unlinked;
    - a related entry that is not a vault note is never wrapped in `[[ ]]`, in the body or under `## Related`;
    - guards (plain `it`, pass today): a bare title in prose is still linked once, including next to sentence punctuation (`see keycloak-custom-image.`); fenced code stays untouched; a name with spaces (`Auth Migration`) is still linked.
  - [x] #35 (unit, lint): a vault with a generated `research/INDEX.md` and root `log.md` (the exact headers from index-regen.ts and log.ts, no frontmatter) gives no `schema_violations`. Guard: a hand-written frontmatter-less `notes/foo.md` still gets them, and so does a file named `INDEX.md` that lacks the generated banner.
  - [x] #34 (unit, healthcheck): with `CLAUDE_PLUGIN_ROOT` unset, a temp HOME whose `.claude/plugins/installed_plugins.json` lists `semantic-memory@<marketplace>` (version 2 shape: `{version: 2, plugins: {"semantic-memory@m": [{scope, installPath, version, projectPath?}]}}`), and whose `installPath/hooks/hooks.json` registers the three events, gives `hook_registration` ok. Guards: no entry → today's warning; a `scope: "project"` entry for another `projectPath` doesn't count.
  - [x] #27 (unit, lint): `[[2026-07-09-slug]]` resolves when `incidents/2026-07-09-slug/narrative.md` exists (folder slug), and when any note has frontmatter `id: 2026-07-09-slug` or `incident_id: …`. Guard: a truly missing target is still reported.
- [x] Phase 3: Fix #36 and #27 (shared resolver)
  - [x] One name-resolution helper in `src/core/lint.ts`, exported. Its set of known names is the basenames, plus frontmatter `id` and `incident_id`, plus the folder slug of a folder whose canonical entry is `narrative.md` or `index.md`. `findBrokenLinks` uses it.
  - [x] `autoWikilink` (`src/core/synthesize.ts:120`):
    - skip inline code spans as well as fenced blocks;
    - match with path-aware boundaries, e.g. `(?<![\w./\\-])name(?![\w/\\-]|\.\w)`, so trailing sentence punctuation still links but `.md`/`-workflow` does not.
  - [x] Only entries that resolve to a vault note are linked: `buildSynthesizeChangeSet` takes an optional known-names set, passed by the MCP `synthesize_note` handler from the indexed docs with the helper above. Entries that don't resolve are listed under `## Related` as plain `` `code` `` text, not `[[ ]]`. Without the set, today's behaviour, so callers that pass nothing don't change.
  - [x] Phase 2 cases for #36 and #27 become plain `it`.
- [x] Phase 4: Fix #35 and #34
  - [x] #35: `lintVault` skips schema validation for generated files. Recognise them by banner, not by name: the first lines match the index-regen header (`> Auto-generated by semantic-sidekick`) or the log header (`# Vault Log` + `> Append-only session and ingest log`), so vaults written by older versions are covered too. Those files also don't count toward `noLastVerified`. Broken-link checks still run on them.
  - [x] #34: `pluginRegisteredHookEvents` falls back when `CLAUDE_PLUGIN_ROOT` is unset:
    - read `<claude config dir>/plugins/installed_plugins.json`, where the config dir is `CLAUDE_CONFIG_DIR` or `~/.claude`;
    - take `semantic-memory@*` entries with `scope: "user"`, or `scope: "project"` / `"local"` whose `projectPath` is the healthcheck's project root;
    - read each entry's `installPath/hooks/hooks.json`.
    A missing or malformed file falls back to today's result, never throws.
  - [x] Phase 2 cases become plain `it`.
- [x] Phase 5: #28 banner
  - [x] One blockquote at the top of `docs/corpora-json.md` and `docs/smart-middle-activation.md`: superseded and never implemented; for extra corpora see federation (`.documentation` federation doc, link it); babel-fish writes `.claude/project-map/sections/`, not `.babel-fish/`. No other change to those files.
- [x] Phase 6: Measure
  - [x] Fresh `BAND=1 bash scripts/gate-release.sh 1.30.0`: every count identical (no ranking change).
  - [x] By hand on this repo: `node dist/cli/index.js healthcheck` in a shell without `CLAUDE_PLUGIN_ROOT` shows no `hook_registration` warning (the plugin is installed at user scope here). Then `lint_vault` on `.documentation` shows no schema errors on generated `INDEX.md`/`log.md`, if any exist there. Record both.
- [x] Phase 7: Release prep
  - [x] Bump all five version fields to 1.30.1, plus the lockfile.
- [x] Phase 8: Cleanup -- remove junk and unused code this work created: scratch/test scripts, debug files, probe logging, one-off test functions, commented-out code, dead code from abandoned approaches (MANDATORY)
- [ ] Phase 9: Validate success through comprehensive testing (MANDATORY)
  - [ ] Every Phase 2 test passes as plain `it`.
  - [ ] Edge cases:
    - #36: a name containing regex characters (`c++-notes`); a name at the start and end of the body; a name inside a markdown link URL (`[x](devops/name.md)`) stays unlinked; a related entry given as a path (`decisions/auth.md`) that resolves; Windows-style backslash paths in inline code;
    - #27: a folder with both `narrative.md` and `facts.md` resolves once; `[[slug#heading]]` and `[[slug|alias]]` forms; a frontmatter `id` that is not a string (number, array) is ignored, not thrown;
    - #35: a generated file that later had frontmatter added by hand is linted normally; CRLF line endings in the header;
    - #34: `installed_plugins.json` version 1 shape or unknown shape; an `installPath` that no longer exists; `CLAUDE_CONFIG_DIR` set.
  - [ ] Failure paths: unreadable `installed_plugins.json`, unreadable note during lint, `synthesize_note` with an empty vault.
  - [ ] Lint, build, `npm test`, `npm run eval`, `npm run gate:release` (fresh, BAND=1 vs 1.30.0).
  - [ ] Independent review of `git diff main...HEAD` (`claude -p`, given the code, not our conclusions). Fix what it confirms; record rejections.
- [ ] Phase 10: Documentation pass with hit-em-with-the-docs; no secrets (MANDATORY)
  - [ ] `.documentation/reference/mcp-tools-reference.md`: `synthesize_note` links only notes that exist, never inside code or paths; unresolved related entries are listed as code text. `lint_vault`: generated files skip schema checks; wikilinks resolve by basename, frontmatter `id`/`incident_id`, and incident folder slug.
  - [ ] `.documentation/troubleshooting/troubleshooting.md`: the `hook_registration` entry (how the plugin install is found now) and the lint entries, if present; add them if missing.
  - [ ] Plugin help (`src/core/help/topics.ts`): any topic that describes lint, healthcheck or synthesize stays accurate. `test/unit/help-coverage.test.ts` and `test/unit/cli-help.test.ts` pass, and any `--help` text this touches stays accurate.
  - [ ] KB gotcha fact: `\b` in a JS regex treats `-`, `/` and `.` as word boundaries, so a whole-word match fires inside paths and hyphenated names. `## Instead`: use explicit lookarounds over the path characters.
  - [ ] `CHANGELOG.md` 1.30.1 and `.documentation/changelog/v1-30-1-small-fixes.md`.
  - [ ] `npx hewtd maintain --quick`; never hand-edit INDEX.md or REGISTRY.md. Re-run `npm run eval` after the docs.

## Key Questions
1. Should unresolved related entries be dropped from `## Related`? No. They are listed as code text, so the provenance stays visible but doesn't pretend to be a link.
2. Should generated files be recognised by name or by banner? By banner. A hand-written `INDEX.md` is still a note and still linted.
3. Should the search graph resolve folder-form incidents too? Not here (see Out of scope).

## Decisions Made
- Version 1.30.1.
- #34's duplicate-hook risk is already handled by the postinstall runtime's de-duplication; only the false warning is fixed.

## Errors Encountered
- Phase 3: `lintVault` with a narrowed `pathGlob` built known names from the globbed files only, so #27 cases could never resolve; names now load from the whole vault. One #36 test asserted `not.toMatch(/`[^`]*\[\[/)`, which matched the `## Related` link after an earlier code span; it now checks the body before `## Related`.

## Status
**Phase 9 next** (Validate). Phase 8 done: no scratch files or probe logging found; dropped redundant startsWith guard in isGeneratedFile. (Was: Phase 8 next.) Phase 7 done: five version fields and lockfile at 1.30.1. (Was: Phase 7 next.) Phase 6 done: gate PASS, counts identical; hook_registration ok without CLAUDE_PLUGIN_ROOT. (Was: Phase 6 next.) Phase 5 done: #28 banner added to both docs. (Was: Phase 5 next, #28 banner.) Phase 4 done: `isGeneratedFile` in `src/core/lint.ts`, `pluginRoots` in `src/core/healthcheck.ts`; #35 and #34 cases are plain `it`. (Was: Phase 4 next, fix #35 and #34.) Phase 3 done: `addKnownNames`/`loadKnownNames` in `src/core/lint.ts`, path-aware `autoWikilink` and `knownNames` in `src/core/synthesize.ts`, handler in `src/mcp/tools/patch.ts`; #36 and #27 cases are plain `it`. (Was:) Phase 2 done: acceptance tests in `test/unit/synthesize-autolink.test.ts` (`knownNames` is the Phase 3 input name), `test/unit/lint-generated-and-ids.test.ts` (#35, #27) and `test/unit/healthcheck-plugin-install.test.ts` (#34). 10 `it.fails` (each confirmed failing as plain `it` for the stated reason), 12 passing guards. Phase 3/4 flip the matching `it.fails` to `it`.
