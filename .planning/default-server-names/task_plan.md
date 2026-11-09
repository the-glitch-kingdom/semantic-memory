# Task Plan: default server names (semantic-memory / semantic-memory-docs), name-agnostic everywhere

## Goal
A new install's `.mcp.json` gets `semantic-memory` (the vault, `./.claude/.vault`) and `semantic-memory-docs` (read-only `./.documentation`). Everything else stays name-agnostic:
- an existing entry is never renamed or duplicated;
- any `semantic-*` entry with `--notes` keeps working for the hooks, skills and healthcheck;
- no message names a tool on a server the user doesn't have.

Release as 1.26.0: a default changes for new installs.

Asked by the user on 2026-11-09, after #81: "default install to carry those server names but remain agnostic".

## Phases
- [x] Phase 1: Verify and plan (notes.md)
- [x] Phase 2: Reproduce first, as failing tests (expected-fail until fixed)
  - [x] A new `test/unit/reconcile.test.ts`. Run `hooks/reconcile.js` as the SessionStart hook runs it, in temp projects with a fake local install, and check the resulting `.mcp.json`:
    - [x] fresh project, hewtd enabled with `.documentation/` → `semantic-memory` + `semantic-memory-docs` (fails on main: it writes `semantic-vault` + `semantic-sidekick`);
    - [x] existing `semantic-vault` → `./.claude/.vault` → unchanged; no `semantic-memory` added (passes on main, and must keep passing);
    - [x] existing `semantic-sidekick` → `./.documentation --read-only` → unchanged; no `semantic-memory-docs` added;
    - [x] an entry under ANY other name already serving `./.claude/.vault` (e.g. `my-vault`, `semantic-memory`) → no second vault entry. The rule is "a `semantic-*` (or any) entry whose `--notes` resolves to the same folder";
    - [x] hewtd disabled: our docs entry is removed under either name (`semantic-sidekick` or `semantic-memory-docs`), only when `isOurEntry` matches; a hand-written entry is kept;
    - [x] the `.mcp.json.bak` backup and the "could not parse" path are unchanged.
  - [x] (skipped: 1.25.1 vaultTool already prints the real name; only the fallback changes, Phase 4) The hook messages in `hooks/vault-context.js` print the writable entry's real name. Skip this if #81 (1.25.1) already did it; otherwise add a failing test (vault entry `my-vault` → messages say `mcp__my-vault__…`, never `mcp__semantic-vault__…`).
  - [x] Record which fail on main. (5 it.fails: fresh defaults, vault served by my-vault/semantic-memory (2 cases), docs served by my-docs, removal of semantic-memory-docs. Passing on main: legacy entries unchanged, semantic-sidekick removal, hand-written kept, .bak, parse error.)
- [x] Phase 3: New defaults, served-folder check
  - [x] `hooks/reconcile.js`: `VAULT_KEY = "semantic-memory"` and `DOCS_KEY = "semantic-memory-docs"`. Keep the legacy keys (`semantic-vault`, `semantic-sidekick`) as recognized names for removal and the served check.
  - [x] Before adding an entry, check every existing entry: if one's `--notes` arg resolves (relative to the project root) to the same folder, add nothing. This prevents duplicates, whatever the existing entry is called.
  - [x] Removal (hewtd off): remove the docs entry under any recognized key, only when `isOurEntry` matches.
  - [x] Update the header comment (the old "DOCS_KEY stays semantic-sidekick" rationale), keeping the reasoning: existing entries are never renamed, because renaming changes tool names and breaks allowlists and CLAUDE.md references.
- [x] Phase 4: Every other place that assumes a name
  - [x] `scripts/smoke-install.sh:80` asserts a `semantic-vault` key. Assert `semantic-memory` for a fresh install, and that no legacy-named duplicate exists.
  - [x] `hooks/vault-context.js`: comments at :44 and :50 describe the standard setup as `semantic-vault` / `semantic-sidekick`; update them. Messages: per Phase 2.
  - [x] Skills: after #81 the semantic-first skill names servers by role with both name pairs. Make the new names "the default" and the old pair "older installs". The same goes for the sibling skills' role lines.
  - [x] Server instructions and `src/`: grep for any literal server name (none expected; the healthcheck already matches `/^semantic-/`).
  - [x] `hooks/hooks.json` description and the plugin description: wording only, if they name servers.
  - [x] Slash commands and one CLI help string still hard-code `mcp__semantic-vault__` (found by #81's review):
    - `commands/vault.md`, `commands/contract.md`: their `allowed-tools` frontmatter needs exact names. List the tools under BOTH default names (`semantic-memory` and `semantic-vault`). That pre-approves them on old and new default installs; a custom name falls back to the normal permission prompt. The body names tools bare, on "the vault server" (role wording, as in the skills).
    - `commands/mode.md:25` wording.
    - `src/cli/index.ts:542` help string.
    - A test (extend `test/unit/skill-surfaces.test.ts`, or a sibling) asserting that no `commands/**` or `skills/**` body text hard-codes a single server prefix, and that `allowed-tools` lists both default names wherever it lists one.
  - [x] `vaultTool()` (`hooks/vault-context.js:93`) falls back to `semantic-vault` when no writable entry is found. Make the fallback `semantic-memory`, the new default.
- [x] Phase 5: Release prep: bump all five version fields to 1.26.0 and the lockfile; the offline tarball is deferred to release. Check whether `scripts/install-offline.sh` writes `.mcp.json` entries; if it does, apply the same defaults. (done: five fields + lockfile at 1.26.0; tarball deferred to release; install-offline.sh writes no .mcp.json, so no change)
- [x] Phase 6: Cleanup -- remove junk and unused code this work created: scratch/test scripts, debug files, probe logging, one-off test functions, commented-out code, dead code from abandoned approaches (MANDATORY) (done: no scratch files, probes, commented-out code, it.fails or dead constants left; every new constant in hooks/reconcile.js is used)
- [x] Phase 7: Validate success through comprehensive testing (MANDATORY)
  - [x] Phase 2 tests pass as plain `it`.
  - [x] Upgrade scenario end-to-end: take a scratch project set up the old way (`semantic-vault` + `semantic-sidekick`), install the branch build, run the SessionStart hook twice. `.mcp.json` must be byte-identical, with no duplicates and no backup written.
  - [x] Fresh scenario end-to-end: a scratch project with no `.mcp.json` gets the new names. Start the vault server from the written entry and call `search_hybrid`. The hook messages name `mcp__semantic-memory__…`.
  - [x] Mixed scenario: `semantic-memory` for the vault, plus a hand-written docs entry under another name → nothing added.
  - [x] `npm run smoke` (or `scripts/smoke-install.sh`) passes with the new assertion; CI's smoke job too.
  - [x] Healthcheck (`semantic-memory healthcheck --fast`) is clean in both the old-named and new-named scratch projects. (Only drift: "no index built yet" in each, no naming drift.)
  - [x] Lint, build, `npm test`, `npm run eval`.
  - [x] Independent review of `git diff main...HEAD`.
- [ ] Phase 8: Documentation pass with hit-em-with-the-docs; no secrets (MANDATORY)
  - [ ] `.documentation/quickstart/installation-guide.md`: what the hook writes (new names), and that existing entries are kept as they are.
  - [ ] `.documentation/reference/configuration-reference.md`: the `.mcp.json` example and the names.
  - [ ] `.documentation/architecture/injection-points.md`: the "standard setup" wording.
  - [ ] `.documentation/operational/drift-detection.md`: if it names the default keys.
  - [ ] `README.md`: install section, if it shows `.mcp.json`.
  - [ ] An upgrade note in `CHANGELOG.md` 1.26.0 and in `.documentation/changelog/v1-26-0-default-server-names.md`: nothing to do for existing projects, and how to rename by hand if wanted (rename the key, then update allowlists and CLAUDE.md references from `mcp__semantic-vault__` to `mcp__semantic-memory__`).
  - [ ] `npx hewtd maintain --quick`; never hand-edit INDEX.md or REGISTRY.md. Re-run `npm run eval` after the docs.

## Key Questions
1. Should an existing install be offered an automatic rename? No: renaming changes every tool name the session sees, breaking permission allowlists and CLAUDE.md references. The docs give the manual steps instead.
2. Does `install-offline.sh` write `.mcp.json`? No (Phase 5: no mcp references in the script), so no change there.

## Decisions Made
- New defaults only; existing entries are never renamed or duplicated (the served-folder check). The old names stay recognized forever.
- Starts after #81 ships as 1.25.1, so the skill text it edits is the new one.

## Errors Encountered
- Phase 3: the served-folder check also accepts `--notes=<path>` (single arg), and resolves absolute paths, so an npx or node entry written either way counts.
- Phase 2: tests run hooks/session-start.js as a subprocess (HOME and CLAUDE_PROJECT_DIR set to temp dirs), not reconcile() directly.

## Status
**Currently in Phase 8.** Queued behind #81 (1.25.1). Before launching, merge main into this branch (don't rebase).
