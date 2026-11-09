# Notes: default server names

## Phase 1: what depends on the names (origin/main at 0e732b1, 2026-11-09)

### Writes the defaults: `hooks/reconcile.js`
- **Constants:** `VAULT_KEY = "semantic-vault"` and `DOCS_KEY = "semantic-sidekick"` (:33-34).
- **Presence check:** by exact key only (`if (!data.mcpServers[VAULT_KEY])`, :176; same for DOCS_KEY, :185). Renaming the constants alone would therefore add a duplicate `semantic-memory` entry to every existing project: two servers on one vault index, and every tool listed twice.
- **Removal (hewtd off):** deletes `DOCS_KEY` only when `isOurEntry` matches (:190).
- **Header comment (:20-25):** explains why the docs key kept the old name ("renaming it would orphan user state").

### Already name-agnostic
- `hooks/vault-context.js:44-50`: any `semantic-*` entry with `--notes` is searchable, and state goes to the first writable one (since v1.5.2 / v1.7.2).
- `src/core/healthcheck.ts:187`: `/^semantic-/`.
- No literal server name anywhere in `src/`.

### Assumes a name
- `hooks/vault-context.js:424, 888, 890, 915, 925, 947`: messages print `mcp__semantic-vault__…`. #81 Phase 4 may fix these (print the resolved entry name); check first.
- `scripts/smoke-install.sh:80`: fails unless a `semantic-vault` key exists. This runs in the CI `smoke` job.
- Skills: covered by #81 (role-based wording, both name pairs).

### Not server names
`semantic-sidekick` also appears as the legacy *package* name, the index dir (`.semantic-sidekick-index`), the model cache (`~/.semantic-sidekick`) and the offline tarball paths. None of those change here.

### Why existing entries are never renamed
An entry's key is the MCP server name, so it sets the tool prefix: `mcp__semantic-vault__search_hybrid`. Renaming it would silently break:
- permission allowlists in settings.json;
- CLAUDE.md and rule files that name tools (this repo's own CLAUDE.md does);
- the user's habits.

## Eval results: Phase 2
Test-only phase, no ranking change. test/unit/reconcile.test.ts: 6 pass, 5 expected-fail on main (fresh defaults; vault served by `my-vault` and by `semantic-memory`; docs served by `my-docs`; removal of `semantic-memory-docs`). Full validation green (148 passed, 4 expected fail in eval run).

## Eval results: Phase 3
Full suite: only the known freshness-scale warm-start load flake failed (2 tests, > 1s under load); both pass alone (22s). Eval 148 passed, 4 expected fail.
No ranking change (hook + tests only). reconcile.test.ts: 12/12 pass as plain `it` (11 from Phase 2 + npx `--notes=` absolute-path case).

## Eval results: Phase 4
Wording, comments, smoke assertion, command allowed-tools and one vaultTool fallback change only; no ranking numbers. hooks/hooks.json description left as is (it names the product, not a server). The other skills already speak of "the vault server"; only semantic-first's name pair needed swapping. Example prompts in vault-first that mention semantic-vault/semantic-sidekick are user quotes, kept.

## Eval results: Phase 5
Release prep only: versions bumped to 1.26.0 in package.json, package-lock.json (2 fields), plugin.json, marketplace.json (2 fields), AGENTS.md. install-offline.sh has no .mcp.json writes. No ranking numbers.

## Eval results: Phase 6
Cleanup only; no code changed, no ranking numbers. Checked git status (no untracked files), branch diff for console/debug/TODO (only the intentional smoke-script error messages), reconcile.test.ts for leftover it.fails/.only (none), reconcile.js constants (all used).

## Eval results: Phase 7
Independent review of `git diff main...HEAD`: no bugs found, no code changed. Scenarios run with the repo symlinked as the installed package, temp HOME:
- Upgrade (semantic-vault + semantic-sidekick): .mcp.json byte-identical after two SessionStarts, no .mcp.json.bak.
- Fresh: semantic-memory + semantic-memory-docs written; server started from the entry, search_hybrid returned a real hit; vaultTool gives mcp__semantic-memory__search_hybrid.
- Mixed (semantic-memory + hand-written `my-docs` with --notes=./.documentation): unchanged, no backup.
- healthcheck --fast in old and new projects: only "no index built yet".
- smoke-install.sh: first run failed at npm install of the tarball (transient), passed on rerun (v1.26.0).
- Full validation: lint, build, npm test 1146 passed/1 skipped, npm run eval 148 passed/4 expected fail.

## Eval results: Phase 8
Docs only (installation-guide, configuration-reference, injection-points, drift-detection, README, CHANGELOG, new changelog/v1-26-0-default-server-names.md; AGENTS.md regenerated, timestamp only). `npm run eval`: 148 passed, 4 expected fail (same as Phase 7). Lint and build pass. `npm test` skipped: no src or test change. Pre-existing broken anchors from `hewtd link-check` (e.g. installation-guide.md:67 injection-points anchor) are not from this phase.
