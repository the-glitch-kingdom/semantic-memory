---
title: CLI Reference
tier: reference
domains: [reference]
audience: [developers]
tags: [cli, commands, flags, reference]
status: active
last_updated: '2026-07-11'
version: '1.5.0'
purpose: Every semantic-memory subcommand + flags + env vars + exit codes. Covers v1.1 skills tree, v1.2 migrate-state, v1.3 confidence-decay (healthcheck --fix, decay-config, decay-trace), v1.3.1 selection-stats telemetry introspection, the v1.4.0 lexicon subcommand group, and the v1.5.0 dossier + profile subcommand groups.
load_priority: 9
---

# CLI reference — `semantic-memory <subcommand>`

Binary: `node node_modules/@theglitchking/semantic-memory/bin/semantic-memory` (or `semantic-memory` if globally linked). The legacy `bin/semantic-sidekick` alias is preserved inside the package. Hooks shell out to either binary; both work identically.

## Subcommand overview

| Command | Category | Purpose |
|---|---|---|
| `serve` (default) | MCP | Start MCP stdio server |
| `search <query>` | Hook backing | Hybrid/text-only search, JSON output |
| `lint` | Maintenance | Run all lints; exit code = errors count |
| `log-event` | Hook backing | Append structured event to log.md |
| `log-query` | Hook backing | Read entries by kind/date/limit |
| `install-schema` | Setup | Write default vault.schema.yml |
| `tools [name]` | Info | List or describe MCP tools |
| `normalize-config` | Maintenance | Rewrite fragile .mcp.json npx forms |
| `healthcheck` | Maintenance | Verify local install + run drift detection; `--fix` (v1.3+) auto-applies safe fixes |
| `skills` (v1.1+) | Plugin install | Install/uninstall/preview skill bundles for non-Claude agents |
| `migrate-state` (v1.2+) | Migration | Move legacy `.claude/.sidekick-*` files under `.claude/.semantic-memory/` |
| `decay-config` (v1.3+) | Info | Print the active confidence-decay config as JSON |
| `decay-trace` (v1.3+) | Info | Print the decay calculation for one note as JSON |
| `selection-stats` (v1.3.1+) | Info | Print selection-log telemetry stats (searches, selections, most/never-cited notes) |
| `lexicon <action>` (v1.4+) | Maintenance | Manage the learned human→artifact lexicon (list/compile/add) |
| `dossier <action>` (v1.5+) | Maintenance | Manage entity dossiers — per-component living notes (init/list) |
| `profile <action>` (v1.5+) | Maintenance | Manage the speaker profile — how this human communicates (init/show) |
| `eval-failures` (v1.6+) | Measurement | Replay failed tool calls through the hook's search; precision/coverage per threshold |
| `update` / `policy` | Plugin runtime | Inherited from `@theglitchking/claude-plugin-runtime` |

All subcommands accept `--help`.

---

## `serve` — start MCP server (default)

```bash
semantic-memory --notes <path> [--reindex] [--stats] [--wait-for-ready] [--read-only]
                               [--model <name>] [--workers <n>] [--batch-size <n>]
                               [--no-quantized] [--no-watch]
```

- `--reindex` — force full reindex and exit.
- `--stats` — print note/chunk/wikilink/tag counts and exit.
- `--wait-for-ready` — block until index fully built (default: lazy; search tools return "Indexing in progress" until ready).
- `--read-only` — suppress write tools. Read-only mode exposes 21 tools (search × 4, read × 3, get_frontmatter, log × 2, lint × 5, graph × 4, system × 2) — unchanged in v1.3/v1.4/v1.5 since `verify_note`, `manage_lexicon`, `manage_dossier`, and `manage_profile` are all write-gated. Write-mode exposes 44 (v1.5+; was 42 in v1.4, 41 in v1.3, 40 in v1.2).
- `--model <name>` — override the embedding model (default: `all-MiniLM-L6-v2`). Switching models invalidates the existing index — startup detects mismatch and forces a reindex.
- `--workers <n>` — number of worker threads for parallel embedding.
- `--batch-size <n>` — batch size for embedding requests.

**Default mode:** starts stdio MCP server, reads stdin, writes MCP JSON-RPC to stdout. Claude Code attaches via `.mcp.json`.

---

## `search <query>`

Underpins the UserPromptSubmit + SessionStart hook injection.

```bash
semantic-memory search "<query>" --notes <path> [--limit N] [--text-only] [--json]
```

- `--limit <n>` — max results (default 8).
- `--text-only` — skip ONNX embedder, use TextSearch only. Faster cold start but noisier for natural-language queries.
- `--json` — default is also JSON; flag exists for self-documentation.

**Output:** JSON array of `{ path, title, score, snippet, mtime }`.
**Uses parsed-doc cache** at `.semantic-sidekick-index/docs.cache.json` for ~0.7s latency on cache hit.

---

## `lint`

Runs schema/provenance/stale/broken-links across the vault.

```bash
semantic-memory lint --notes <path> [--rule <name>] [--json] [--strict]
```

- `--rule <name>` — limit output to one of `schema_violations`, `missing_provenance`, `stale`, `broken_links`.
- `--json` — emit JSON (full `LintReport` or just `byRule[<rule>]`).
- `--strict` — exit non-zero on warnings too (default: exit non-zero only on errors).

**Exit code:**
- 0 — clean (or errors/warnings below threshold).
- 1 — errors > 0, or (with `--strict`) warnings > 0.

**Intended use:** pre-commit hook. `scripts/pre-commit-lint.sh` is the drop-in template.

---

## `log-event` / `log-query` / `install-schema` / `tools`

Unchanged from v0.x. See the v0.x notes below for full details — these subcommands kept their original shape across the rebrand.

```bash
semantic-memory log-event --notes <path> --kind <name> --summary <text> [--payload <json>]
semantic-memory log-query --notes <path> [--kind <name>] [--after <iso>] [--before <iso>] [--limit <n>]
semantic-memory install-schema --notes <path> [--force]
semantic-memory tools          # list all MCP tools by category
semantic-memory tools <name>   # show args + examples for one tool
```

`tools` lists 44 tools at v1.5.0 (42 at v1.4.0, 41 at v1.3.0, 40 at v1.2.0, was 33 at v0.2.x).

---

## `normalize-config`

```bash
semantic-memory normalize-config [--dry-run]
```

Rewrites `.mcp.json` entries from the fragile `npx --latest` form to stable `node ./node_modules/...` form. Backs up to `.mcp.json.bak` and verifies the binary starts before committing.

In v1.1.1+, recognizes both legacy `@theglitchking/semantic-sidekick` and current `@theglitchking/semantic-memory` package paths.

---

## `healthcheck` (extended in v1.1+, v1.3+)

```bash
semantic-memory healthcheck [--fast] [--json] [--fix]
```

Two-phase:

1. **Install verification** (v0.x behavior, preserved):
   - Detects fragile `.mcp.json` npx-form
   - Smoke-tests the local bin (`--version`)
   - Self-heals classic `ERR_MODULE_NOT_FOUND` from corrupted npx caches by clearing + retrying

2. **Drift detection** (v1.1+ addition, runs in postAction):
   - Without `--fast`: full audit (fast tier + slow tier including full vault lint)
   - With `--fast`: fast tier only — file-system probes for `.mcp.json` server entry, hook registration, AGENTS.md managed blocks, session staleness, legacy state files
   - With `--json`: emits structured JSON (drift findings array) instead of human text

**v1.3.0 fix:** drift detection now always runs. Previously, on a healthy install the command exited early right after the install smoke-test, so drift detection never fired — that early-exit was a bug and is now removed.

**`--fix` (v1.3+):** after drift detection, auto-applies safe fixes for fixable findings, then re-runs detection to show the post-fix state. Combinable with `--fast` and `--json`.

Safe fix actions (auto-applied):
- `skill-link` — re-link skills
- `mcp-reconcile` — reconcile `.mcp.json`
- `reindex` — rebuild the vector index
- `state-migrate` — run `migrate-state` for legacy `.sidekick-*` files

Findings that touch user-authored content — stale notes, broken wikilinks, hand-edited `AGENTS.md` — are **reported for human review only**; `--fix` never auto-changes them.

5-minute result cache at `<project>/.claude/.semantic-memory/healthcheck-cache.json`.

**See:** [drift-detection.md](../operational/drift-detection.md)

---

## `skills` (v1.1+) — multi-agent skill bundler

Subcommand tree for installing skill bundles into non-Claude agent runtimes (codex, copilot, pi). Existing Claude flow via npm `postinstall` + `claude-plugin-runtime` is unchanged.

### `skills targets`

Preview where bundles would land for one or more agents.

```bash
semantic-memory skills targets [--agent <name>...] [--scope <local|global>] [--project <path>]
```

- `--agent <name>` — repeatable; defaults to all 4 agents (claude, codex, copilot, pi)
- `--scope` — `local` (project-relative) or `global` (`~/`-rooted), default `local`
- `--project <path>` — project root for local-scope paths, default cwd

**Output:** JSON array `[{ agent, scope, path }]`.

### `skills install`

```bash
semantic-memory skills install --agent <name> [--scope <s>] [--project <p>] [--only <names>...] [--force]
```

- `--agent` — required: `codex`, `copilot`, `pi`. (Claude path is rejected — use `npm install` for the Claude flow.)
- `--scope` — `local` or `global`, default `local`
- `--only <names>...` — restrict to specific skill bundle names; default ships all 4 (vault-first, research-mode, outage-silence, semantic-first)
- `--force` — overwrite even if drift is detected (manifest sha mismatch against existing install)

Writes a manifest at `<target>/.semantic-memory-skill-manifest.json` with sha256s for stale detection on subsequent runs.

### `skills uninstall`

```bash
semantic-memory skills uninstall --agent <name> [--scope <s>] [--project <p>]
```

Removes only manifest-tracked bundles. User-written skills outside the manifest are preserved. Manifest itself removed.

### `skills list`

```bash
semantic-memory skills list
```

Lists shipped skill bundle names.

**Agent target paths:**

| Agent | Global | Local |
|---|---|---|
| claude | `~/.claude/skills/` | `.claude/skills/` |
| codex | `~/.codex/skills/` | `.codex/skills/` |
| copilot | `~/.copilot/skills/` | `.github/skills/` |
| pi | `~/.pi/agent/skills/` | `.pi/skills/` |

---

## `migrate-state` (v1.2+) — move legacy state files

Moves the three v1.1 state files from `.claude/.sidekick-*` to `.claude/.semantic-memory/`. Idempotent.

```bash
semantic-memory migrate-state [--dry-run] [--force] [--project <path>]
```

- `--dry-run` — preview without changing anything
- `--force` — when both old and new paths exist (conflict), prefer new and delete old
- `--project <path>` — project root, default cwd

**Output:** JSON `{ migrated: [...], skipped: [...], conflicts: [...] }`.

**Status semantics per file:**

| Status | Meaning |
|---|---|
| `migrated` | Old path existed, new path didn't, atomic rename succeeded |
| `skipped-no-source` | Neither path exists |
| `skipped-already-migrated` | Old absent, new exists |
| `conflict` | Both exist; refused without `--force` |
| `resolved-by-force` | Both existed; `--force` deleted old, preserved new |

**Exit code:** 1 when conflicts exist and `--force` was not passed (and not `--dry-run`).

**See:** [state-migration.md](../operational/state-migration.md)

---

## `decay-config` (v1.3+) — print active confidence-decay config

```bash
semantic-memory decay-config --notes <path>
```

Prints the active confidence-decay config as JSON:

```json
{ "source": "defaults", "config": { "...": "..." } }
```

`source` is `"defaults"` when no `decay:` block is present in `vault.schema.yml`, or `"vault.schema.yml (overridden)"` when the vault supplies one.

**See:** [configuration-reference.md](./configuration-reference.md#decay-vaultschemayml)

---

## `decay-trace` (v1.3+) — debug one note's decay calculation

```bash
semantic-memory decay-trace <notePath> --notes <path>
```

Prints the decay calculation for a single note as JSON:

```json
{
  "path": "...",
  "type": "...",
  "last_verified": "...",
  "evergreen": false,
  "multiplier": 0.87,
  "age_days": 42,
  "effective_half_life": 365,
  "reason": "..."
}
```

**Use when:** debugging why a note ranks where it does in `search_semantic`/`search_hybrid` results.

**See:** [configuration-reference.md](./configuration-reference.md#decay-vaultschemayml)

---

## `selection-stats` (v1.3.1+) — telemetry introspection

```bash
semantic-memory selection-stats --notes <path> [--json]
```

Reads `<path>/.claude/.semantic-memory/selection.jsonl` (written by `search_semantic`/`search_hybrid`/`read_note` — see [configuration-reference.md](./configuration-reference.md#telemetry-vaultschemayml)) and prints:

- **searches** — total `search`-kind entries logged.
- **selections** — total `selection`-kind entries logged (i.e. `read_note` calls).
- **most-cited notes** — notes read most often, most first.
- **retrieved-but-never-cited notes** — notes that showed up in search results but were never subsequently read; a candidate list for "is this note actually useful, or just matching on keywords."

Human-readable text by default; `--json` emits the raw counts/lists for scripting.

No-op (empty stats, exit 0) when `selection.jsonl` doesn't exist yet — e.g. fresh vault, or `telemetry.enabled: false`.

**Use when:** sanity-checking whether telemetry is actually capturing activity, or scoping which notes are candidates for the `decay_candidates` lint / manual `verify_note` attention. See [mcp-tools-reference.md](./mcp-tools-reference.md) for `lint_vault({checks:["decay_candidates"]})`.

---

## `lexicon` (v1.4+) — manage the learned human→artifact lexicon

Subcommand group for the alias lexicon that backs the `manage_lexicon` MCP tool (see [mcp-tools-reference.md](./mcp-tools-reference.md)) — human phrases mapped to canonical vault/code targets.

### `lexicon list`

```bash
semantic-memory lexicon list --notes <path>
```

Lists all lexicon entries: canonical target, phrases, source (`learned`/`authored`), evidence_count.

### `lexicon compile`

```bash
semantic-memory lexicon compile --notes <path>
```

Rebuilds `<path>/.claude/.semantic-memory/lexicon-cache.json` from the vault's `alias`-type notes under `<vault>/lexicon/` (see [frontmatter-spec.md](./frontmatter-spec.md)). Run after hand-editing `alias` notes directly, or after a batch of `lexicon add` calls.

### `lexicon add`

```bash
semantic-memory lexicon add <canonical> <phrases...> --notes <path> [--authored]
```

- `<canonical>` — the canonical target the phrases should resolve to (a path or symbol).
- `<phrases...>` — one or more human phrases to associate with `<canonical>`.
- `--authored` — mark the entry `source: authored` instead of the default `source: learned`. Re-running `add` for a canonical/phrase pair that already exists bumps `evidence_count` rather than creating a duplicate.

**Output:** JSON of the upserted lexicon entry.

**See:** [configuration-reference.md](./configuration-reference.md) for the `lexicon-cache.json` runtime-state file, [mcp-tools-reference.md](./mcp-tools-reference.md) for the equivalent `manage_lexicon` MCP tool.

---

## `dossier` (v1.5+) — manage entity dossiers

Subcommand group for entity dossiers — per-component living notes that back the `manage_dossier` MCP tool (see [mcp-tools-reference.md](./mcp-tools-reference.md)). CLI covers scaffolding and listing; incident/state accretion is MCP-only (`manage_dossier` actions `append_incident`/`set_state`).

### `dossier init`

```bash
semantic-memory dossier init <entity> --notes <path> [--alias <phrase...>] [--seeded-from <ref>]
```

- `<entity>` — the canonical entity name to scaffold a dossier for.
- `--alias <phrase...>` — repeatable; human phrase(s) for this entity, fed to the lexicon compiler for query expansion.
- `--seeded-from <ref>` — provenance of the scaffold (e.g. a babel-fish project-map entry). Fail-open — a missing reference never blocks scaffolding.

No-op (returns the existing entry) if a dossier already exists for that entity or one of its aliases.

**Output:** JSON `{ path, created, entity }`.

### `dossier list`

```bash
semantic-memory dossier list --notes <path>
```

Lists all dossiers: entity, aliases, resolved path, purpose head, current state.

**See:** [dossiers-guide.md](../operational/dossiers-guide.md) for the full operating model, [mcp-tools-reference.md](./mcp-tools-reference.md) for the equivalent `manage_dossier` MCP tool.

---

## `profile` (v1.5+) — manage the speaker profile

Subcommand group for the speaker profile — the singleton note modeling how THIS human communicates, that backs the `manage_profile` MCP tool (see [mcp-tools-reference.md](./mcp-tools-reference.md)). CLI covers scaffolding and reading; section updates are MCP-only (`manage_profile` action `update_section`).

### `profile init`

```bash
semantic-memory profile init --notes <path>
```

Scaffolds `profile/speaker.md` with the fixed Severity calibration / Chronic omissions / Verbosity preference / Shorthand & terms sections. No-op if it already exists.

**Output:** JSON `{ path, created }`.

### `profile show`

```bash
semantic-memory profile show --notes <path>
```

Prints the speaker profile's injection head — the capped, placeholder-stripped view (real learned content only). Prints `(profile is empty — only placeholders)` when nothing has been learned yet, or `(no speaker profile — run \`profile init\`)` if the note doesn't exist.

**See:** [session-paging-guide.md](../operational/session-paging-guide.md) for the full operating model, [mcp-tools-reference.md](./mcp-tools-reference.md) for the equivalent `manage_profile` MCP tool.

---

## `eval-failures` (v1.6+) — measure failure-time fact lookup

```bash
semantic-memory eval-failures --cases cases.jsonl --judgments judgments.jsonl \
  [--query normalized|raw] [--limit 5] [--target 0.95] [--min-judged 20] \
  [--unjudged-out next.jsonl] [--hits-out hits.jsonl] [--json]
```

- `cases.jsonl` — one failed tool call per line: `{id, notes, error, command}` (`notes` = the docs folder that repo searches, indexed).
- `judgments.jsonl` — `{case, path, relevant}`; a positive label wins over a negative one for the same pair.
- Loads each corpus once (`openSearch`) and searches with the same scoring the hooks use. `--query normalized` (default) uses `failureQuery()`; `raw` uses error + command as-is.
- Prints: answer ranked first / anywhere in hits; for thresholds 0.20–1.00 the injected, judged, correct, precision and coverage of the top hit; the lowest threshold that holds `--target` from there up with ≥ `--min-judged` judged injections; and the count of unlabelled top hits (`--unjudged-out` writes them for labelling).

Building the inputs from real failures: [failure-lookup-guide.md](../operational/failure-lookup-guide.md#measuring-it-on-your-own-failures).

## Plugin runtime commands

`update`, `policy`, and related commands come from `@theglitchking/claude-plugin-runtime`. See that package's README for the auto-update policy contract.

In v1.1.1+, `update` re-runs the v1.2-aware skill linker after `npm update`, so skills land at the new paths.

---

## Environment variables

| Variable | Effect |
|---|---|
| `SIDEKICK_DEBUG=1` | Hook logs decisions to stderr (visible under `ctrl+o` in Claude Code). Same name kept across rebrand. |
| `SIDEKICK_VAULT_PATH=<path>` | Overrides vault discovery for hooks (used by test runners). Same name kept. |
| `SEMANTIC_MEMORY_FAILURE_HOOK=1` | (v1.6+) Turns on the opt-in `PostToolUseFailure` fact lookup. Off by default. |
| `SEMANTIC_MEMORY_FAILURE_MIN_SCORE=<n>` | (v1.6+) Score a fact needs to be injected on a failure (default `0.50`). |
| `SEMANTIC_MEMORY_INJECT_MIN_SCORE=<n>` | Score gate for the prompt/SessionStart `<vault-context>` block (default `0.35`). |
| `CLAUDE_STOP_HOOK_ACTIVE=1` | Set by Claude Code when re-entering after a Stop-hook block. Hook respects this as a loop-guard. |
| `CLAUDE_PROJECT_DIR` | Set by Claude Code to the project root. Hooks default to this over `process.cwd()`. |
| `CLAUDE_PLUGIN_ROOT` | Set by Claude Code to the plugin install dir. Used in `hooks.json` command resolution. |

The env var names retain `SIDEKICK_*` prefix for backwards compat. Don't break user shell configs that already set them.

---

## Exit code conventions

| Exit code | Meaning |
|---|---|
| 0 | Success (or no-op) |
| 1 | Soft failure — `lint` errors, `migrate-state` unresolved conflicts, install verification failure |
| 2 | Argument parsing error — invalid agent, invalid scope, missing required flag |

---

## See also

- [hooks-reference.md](./hooks-reference.md) — what shells out to which CLI subcommand
- [mcp-tools-reference.md](./mcp-tools-reference.md) — the MCP tool surface (44 tools)
- [drift-detection.md](../operational/drift-detection.md) — `healthcheck` deep dive
- [state-migration.md](../operational/state-migration.md) — `migrate-state` deep dive
