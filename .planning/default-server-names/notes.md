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
