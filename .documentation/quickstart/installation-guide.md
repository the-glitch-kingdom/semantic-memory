---
title: Installation Guide
tier: guide
domains: [quickstart]
audience: [developers]
tags: [install, setup, plugin, npm, update]
status: active
last_updated: '2026-10-24'
version: '1.6.1'
purpose: Three install routes (plugin / npm / dev), what a fresh install gets, updating, post-install housekeeping, uninstall
load_priority: 10
---

# Installation guide

> From zero to a running semantic-memory in your project. Three routes: plugin install (recommended), npm install (bare), and dev (contributing to this repo). The package was called `semantic-sidekick` before v1.0. **Don't install `@theglitchking/semantic-sidekick`**: it is the frozen pre-rebrand package.

## Prerequisites

- Node.js ≥ 18.
- Claude Code CLI or a compatible MCP client.
- A directory to serve as the vault (can be empty: a starter schema will be installed).

## Route A — Claude Code plugin (recommended)

### 1. Add the marketplace and install

```
/plugin marketplace add https://github.com/TheGlitchKing/semantic-memory
/plugin install semantic-memory@semantic-memory-marketplace
```

What you get:
- Skills `vault-first`, `research-mode`, `outage-silence` and `semantic-first`, plus the commands `/mode`, `/vault`, `/healthcheck`, `/contract`, `/status`, `/update`, `/policy`, `/relink` and `/normalize-config`.
- Hooks from `hooks/hooks.json`: `SessionStart`, `UserPromptSubmit`, `Stop` and `PostToolUseFailure`. The last one does nothing unless you turn it on (step 5).
- Write tools that mask API keys, tokens, passwords and private keys before writing (v1.5.3+).

### 2. First session

On the next `claude` start, the SessionStart hook:
- reconciles `.mcp.json` (`hooks/reconcile.js`): adds a `semantic-vault` entry for `./.claude/.vault/` (created if missing). When hit-em-with-the-docs is installed and `.documentation/` exists, it also adds `semantic-sidekick` for `./.documentation --read-only`. Entries use the stable `node ./node_modules/@theglitchking/semantic-memory/bin/semantic-memory` form. Entries you edited by hand are left alone.
- resets the mode in `.claude/.semantic-memory/mode` to `vault-first`.

The first server start builds each folder's index (`<folder>/.semantic-sidekick-index/`) in the background. It downloads the ~90 MB embedding model once, into `~/.semantic-sidekick/models/`. Searches made before the index is ready answer "Indexing in progress… Try again shortly."

### 3. Use a different vault (optional)

Edit the `semantic-vault` entry's `--notes` argument in `.mcp.json`:

```json
{
  "mcpServers": {
    "semantic-vault": {
      "type": "stdio",
      "command": "node",
      "args": ["./node_modules/@theglitchking/semantic-memory/bin/semantic-memory", "--notes", "/path/to/vault"]
    }
  }
}
```

The hooks search every `semantic-*` entry's folder and write state to the first one without `--read-only` (v1.5.2+).

### 4. Install the schema (optional but recommended)

```bash
npx semantic-memory install-schema --notes ./.claude/.vault
```

Writes `vault.schema.yml` with the default schema. Without it, lint runs against the bundled default.

### 5. Turn on the failure-time fact lookup (optional)

Add `"SEMANTIC_MEMORY_FAILURE_HOOK": "1"` to the `env` block of `~/.claude/settings.json`. It takes effect in the next session. After a failed Bash or MCP call, it injects the knowledge-base fact most likely to explain the failure. It is right about 6 times in 10. See [failure-lookup-guide.md](../operational/failure-lookup-guide.md).

### 6. Turn on the skill loop or jev mode (optional, v1.7+)

Both are off by default, and off changes nothing.

- **The skill loop** — `semantic-memory skill-loop on` (or `/skill-loop on`; `--repo` for one repo only). After a
  session with a failed command or a correction, a background review drafts a skill; you approve it with
  `/skill-loop review`. Needs `claude` on the PATH. See [skill-loop.md](../operational/skill-loop.md).
- **Jev mode** — `semantic-memory jev-mode on` (or `/jev-mode on`). Needs jev-loop at `~/.claude/jev-loop`,
  `TYPESAFE_API_KEY` and python3; `semantic-memory jev-mode status` says what is missing. See
  [jev-mode.md](../operational/jev-mode.md).

Both write `~/.claude/settings.json` `env` and take effect in the next session.

### 7. Verify

```bash
npx semantic-memory --version              # 1.6.1 or later
npx semantic-memory healthcheck --fast     # "local install starts cleanly"; drift findings, if any
```

In a Claude session: expand a hook line with `ctrl+o` to find `<vault-state-since>` / `<vault-context>`, run `/mode status` (it should report `vault-first`), and ask a project question; Claude should call `mcp__semantic-vault__search_hybrid`.

### Updating

```bash
claude plugin marketplace update semantic-memory-marketplace
claude plugin update semantic-memory@semantic-memory-marketplace   # then restart Claude Code
```

The project-local npm package updates separately: `/update`, or `npm i @theglitchking/semantic-memory@latest`. State from 1.5.1 and earlier carries over. A stale index is rebuilt at server start, and old capture-pending items are asked about once.

---

## Route B — npm install (no Claude Code plugin system)

The standalone CLI and MCP server, without the plugin runtime.

```bash
npm install @theglitchking/semantic-memory
npx semantic-memory --notes /path/to/vault            # stdio MCP server
```

Point your MCP client at `node ./node_modules/@theglitchking/semantic-memory/bin/semantic-memory --notes /path/to/vault`. Add `--read-only` for a folder another tool owns. That serves 20 read/search/lint tools and nothing that writes.

Route B gives you the 44 MCP tools and the CLI, but **not** the hooks, mode skills or slash commands. Those are plugin-only. For air-gapped hosts, use the offline tarball (`.claude/rules/operational-runbook.md`).

---

## Route C — Development (contributing to this repo)

```bash
git clone https://github.com/TheGlitchKing/semantic-memory
cd semantic-memory
bash .claude/scripts/setup.sh   # persistent-planning, babel-fish, hit-em-with-the-docs
npm install
npm run build
npm test                        # full vitest suite
npm run lint                    # tsc --noEmit
npm run eval                    # golden retrieval eval
npm run dev                     # tsup watch mode
```

To point a vault at this checkout's CLI, set the `.mcp.json` args to `["./dist/cli/index.js", "--notes", "/path/to/test/vault"]`. Releases: [release-process.md](../deployment/release-process.md).

---

## Post-install housekeeping

### Gitignore your runtime state

```
.claude/.semantic-memory/
.claude/.sidekick-*            # pre-1.2 state names, still read as a fallback
.semantic-sidekick-index/
```

Commit `log.md`: it is the durable record. The full recommended list is in [configuration-reference.md](../reference/configuration-reference.md).

### Pre-commit hook (vault repos)

```bash
cp node_modules/@theglitchking/semantic-memory/scripts/pre-commit-lint.sh .git/hooks/pre-commit
chmod +x .git/hooks/pre-commit
```

Blocks commits on schema errors and warns on stale notes, missing provenance and broken links. To check for secrets already in notes: `lint_vault({checks: ["secrets"]})`.

### Get a feel for the CLI

```bash
npx semantic-memory --help
npx semantic-memory lint --notes <vault>
npx semantic-memory log-query --notes <vault> --limit 10
npx semantic-memory search "how do we deploy" --notes <vault>
```

These are the interfaces the hooks use.

---

## Uninstall

```
/plugin uninstall semantic-memory@semantic-memory-marketplace
npm uninstall @theglitchking/semantic-memory
```

This doesn't touch `.mcp.json` or your vault, which are yours. Remove the `semantic-*` entries from `.mcp.json` by hand if you want them gone.
