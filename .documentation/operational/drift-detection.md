---
title: Drift detection — SessionStart auto-check + /healthcheck deep audit
tier: guide
domains: [operational]
audience: [developers, admin]
tags: [drift, healthcheck, sessionstart, auto-check, install-health, v1.1, fix]
status: active
last_updated: '2026-10-24'
version: '1.6.1'
purpose: Operational guide to drift detection. The fast-tier auto-check that fires on every SessionStart, the manual /healthcheck deep audit, what each finding means, and how to fix them.
load_priority: 7
---

# Drift detection

semantic-memory has two drift-detection paths:

1. **Fast tier — automatic** — runs on every SessionStart. <100ms budget, fail-open, silent on healthy installs.
2. **Slow tier — manual** — runs via `/healthcheck`. Adds a full vault lint plus everything from fast tier.

The fast tier is "did anything in the install break since last session?" The slow tier is "is the vault content itself healthy?"

## Fast tier — what it checks

The SessionStart hook (`hooks/vault-context.js`) runs these checks in parallel. All file-system probes only — zero spawns, zero network.

| Check | What it looks at | When it warns |
|---|---|---|
| `mcp_json_entry` | `<project>/.mcp.json` | Present but missing a server entry for `semantic-vault`/`semantic-sidekick`/`semantic-memory` |
| `hook_registration` | `<project>/.claude/settings.json` + the plugin's `hooks/hooks.json` | Missing one of `SessionStart` / `UserPromptSubmit` / `Stop` (the opt-in `PostToolUseFailure` is not required) |
| `hook_double_registration` (v1.3.2+) | `settings.json` × plugin `hooks/hooks.json` | Same event registered in BOTH → each hook fires twice (plugin context only) |
| `agents_contract` | `<project>/AGENTS.md` | File exists but lacks managed-block markers |
| `session_staleness` | `<project>/.claude/.semantic-memory/session.json` | Open session with `last_activity_at` >24h ago |
| `legacy_state_files` (v1.2+) | `<project>/.claude/.sidekick-*` | Legacy state files present (read-fallback works, but v2.0 will remove) |

If all checks pass: hook stays silent. The user sees nothing.

If any check warns: hook emits a single block:

```
<vault-drift count="2">
⚠️  semantic-memory: 2 drift issues detected
  ⚠ mcp_json_entry: .mcp.json has no semantic-* server entry
  ⚠ hook_registration: missing hook events: Stop
Run /healthcheck for details, or /healthcheck --fix to auto-fix safe items.
</vault-drift>
```

The block appears once at SessionStart. UserPromptSubmit doesn't re-emit it. Subsequent prompts in the same session don't see it.

## Why the fast tier fails open

If the drift check itself throws (corrupted cache file, permission issue, etc.), the SessionStart hook does NOT block the session. It logs to stderr (only with `SIDEKICK_DEBUG=1`) and emits an empty drift block.

The principle: drift detection adding latency or false-blocking sessions is worse than missing a real drift.

## Why the fast tier is silent on healthy installs

The block appears only when `findings.length > 0` AND severity is `warn`/`error`. Healthy installs see zero output. The contract:

> The fast-tier check is observability, not noise. If you never see drift output, your install is healthy.

Note: `legacy_state_files` is the most-frequently-firing check on existing v1.1.x installs upgrading to v1.2. It's a one-time event — running `migrate-state` clears it.

## Slow tier — what `/healthcheck` adds

The full audit runs both tiers. The slow tier adds:

| Check | What it does |
|---|---|
| `lint_vault` | Full vault lint: schema violations, missing provenance, stale notes (>180d), broken wikilinks. Same as `lint_vault({checks: ["all"]})`. |
| (planned v1.2) `code_symbol_drift` | If babel-fish is active, cross-references vault notes' code mentions against the symbol index. Flags notes referencing renamed/removed symbols. |
| `decay_candidates` (planned, v1.3.x follow-up) | Notes that match recent queries highly but have decayed scores — i.e. "this keeps being relevant but is getting stale." Deferred from v1.3.0 (needs query-log history). |

The slow tier can take seconds-to-tens-of-seconds on a large vault. NOT in the auto path.

## /healthcheck CLI invocation

```bash
# Full audit — fast + slow tiers
node ./node_modules/@theglitchking/semantic-memory/bin/semantic-memory healthcheck

# Fast tier only (skips full vault lint)
node ./node_modules/@theglitchking/semantic-memory/bin/semantic-memory healthcheck --fast

# JSON output (for scripting)
node ./node_modules/@theglitchking/semantic-memory/bin/semantic-memory healthcheck --json
```

Or via npx if no local install:

```bash
npx --no @theglitchking/semantic-memory healthcheck
```

The `/healthcheck` slash command shells out to one of these.

## Caching

`runHealthcheck` caches its result at `<project>/.claude/.semantic-memory/healthcheck-cache.json` with a 5-minute TTL. Within 5 minutes of a previous run, the same `tier` returns the cached result without re-running. `--force` bypasses the cache (and the `runHealthcheck` programmatic API accepts `force: true`).

The SessionStart fast-tier check does NOT use this cache directly — it runs its own inline JS to avoid the spawn cost of invoking the CLI. The cache is for explicit `/healthcheck` invocations.

## Per-finding remediation

### `mcp_json_entry` warn

`.mcp.json` exists but has no semantic-* server entry. The plugin's MCP server isn't reachable.

**Fix:**
```bash
/normalize-config        # rewrites .mcp.json to the stable form
```
or:
```bash
/relink                  # re-runs the postinstall that writes .mcp.json
```

### `hook_double_registration` warn (v1.3.2+)

The same hook event (SessionStart / UserPromptSubmit / Stop) is registered in BOTH `.claude/settings.json` AND the plugin's own `hooks/hooks.json`. On a plugin install the plugin already registers its hooks, so the duplicate in `settings.json` makes each hook run **twice** — e.g. the `<vault-context>` block injected twice per prompt (~1.5k tokens of duplicated overhead per turn).

**Fix:** remove the `"hooks"` block from `.claude/settings.json`. The plugin's `hooks/hooks.json` is the single source of truth for plugin installs. Not auto-fixed by `--fix` (editing your `settings.json` is your call). Only fires in a plugin context (`CLAUDE_PLUGIN_ROOT` present); npm-dependency installs register via `settings.json` legitimately and never see this finding.

### `hook_registration` warn

`.claude/settings.json` is missing one or more of `SessionStart` / `UserPromptSubmit` / `Stop` hook entries. The plugin's hooks won't fire.

**Fix:**
```bash
/relink                  # re-registers hooks via claude-plugin-runtime postinstall
```

### `agents_contract` warn

`AGENTS.md` exists but lacks the managed-block markers. The plugin can't safely regenerate without overwriting.

**Fix:**
```bash
/contract inspect        # confirm state
# Then either:
/contract force          # overwrite hand-edits (lose them)
# Or manually add the markers around the existing content
```

### `session_staleness` warn

A session has been open for >24h with no activity. Probably abandoned.

**Fix (one of):**
```javascript
session_status()                                       // see what's there
session_run({ cmd: "..." })                            // resume — updates activity timestamp
session_finish({ summary: "...", verified: false, reason: "abandoned" })  // close
// Or:
rm <project>/.claude/.semantic-memory/session.json     // hard discard
```

### `legacy_state_files` warn (v1.2+)

Legacy `.claude/.sidekick-*` state files exist. The plugin still reads them via fallback, but v2.0 removes the fallback.

**Fix:**
```bash
node ./node_modules/@theglitchking/semantic-memory/bin/semantic-memory migrate-state
```

This atomically renames the three legacy files into `.claude/.semantic-memory/`. Idempotent.

### `index_freshness` warn

`<vault>/.semantic-sidekick-index/meta.json` doesn't exist. No index has been built yet.

**Fix:**
```javascript
reindex()                // MCP tool — full reindex
```

Or via CLI:
```bash
node ./node_modules/@theglitchking/semantic-memory/bin/semantic-memory --notes <vault> --reindex
```

### `lint_vault` findings (slow tier)

Findings from the lint suite. These are vault content issues, not install issues:

- `schema_violations` — frontmatter doesn't match `vault.schema.yml` rules
- `missing_provenance` — `note`/`decision`/`gotcha` notes lack both `sources` and `derived_from`
- `stale` — `last_verified` older than schema's `stale.max_age_days`
- `broken_links` — `[[wikilinks]]` pointing to non-existent notes

Most lint findings need **human review** — only you can decide if a stale note still applies, or if a broken link should be fixed vs. deleted.

## Auto-fix (`/healthcheck --fix`) — shipped in v1.2.3

`/healthcheck --fix` (and `semantic-memory healthcheck --fix`) runs drift detection, applies **safe** fixes for fixable findings, then re-runs detection so the printed result reflects the post-fix state. Combinable with `--fast` and `--json`.

"Safe" means idempotent, non-destructive, and derivable from the install itself. Findings that touch user-authored content are reported for human review, never auto-changed.

| Finding | Auto-fixed by `--fix`? | Action |
|---|---|---|
| `mcp_json_entry` | Yes | reconcile `.mcp.json` (`mcp-reconcile`) |
| `hook_registration` | Yes | re-link skills/hooks (`skill-link`) |
| `skill_manifest:*` | Yes | re-link skills (`skill-link`) |
| `index_freshness` | Yes | rebuild the vector index (`reindex`) |
| `legacy_state_files` | Yes | run `migrate-state` (`state-migrate`) |
| `agents_contract` (no markers / hand-edited) | No | run `/contract` or move content to a Local Notes section |
| `session_staleness` | No | resume, or remove the session file (your call) |
| `lint_vault` findings | No | human review — stale notes, broken wikilinks, schema violations |

The decision logic is a pure, unit-tested planner (`src/core/healthcheck-fix.ts`); the CLI executes the plan. Example:

```bash
semantic-memory healthcheck --fix          # smoke + full drift + fixes
semantic-memory healthcheck --fix --fast    # skip the slow-tier vault lint
semantic-memory healthcheck --fix --json    # machine-readable {smoke, result, fix}
```

> **Note (v1.2.3):** the `healthcheck` command now always runs drift detection. Before 1.2.3 it exited immediately after the install smoke-test on a healthy install, so drift detection silently never ran unless the smoke-test failed — that was a bug, fixed alongside `--fix`.

## Programmatic access

If you want to embed drift detection in your own tooling:

```typescript
import { runHealthcheck, formatDriftBanner, filterToDrift } from "@theglitchking/semantic-memory";

const result = await runHealthcheck({
  projectRoot: process.cwd(),
  tier: "fast",        // or "slow", or "all"
  force: true,         // bypass 5min cache
});

const drift = filterToDrift(result);
console.log(`${drift.length} drift issues:`);
for (const f of drift) {
  console.log(`  [${f.severity}] ${f.check}: ${f.summary}`);
}

// Or render the same banner the SessionStart hook uses:
console.log(formatDriftBanner(result));
```

## What drift detection does NOT do

To set expectations:

- **Doesn't detect content drift** (e.g. "this note's claim is outdated") — that's [confidence-decay](./decay-guide.md) (shipped in v1.3)
- **Doesn't auto-migrate or auto-reindex *unless you pass `--fix`*** — the default check is surfacing-only; `--fix` opts into safe auto-remediation
- **Doesn't check across machines** — strictly per-project, per-machine
- **Doesn't alert externally** — no webhooks, no notifications. Output is conversational text.

## Frequency: how often it runs

- **Fast tier:** every SessionStart (every time you open Claude Code with this plugin enabled). Usually <100ms.
- **Slow tier:** only when you explicitly run `/healthcheck` (no `--fast` flag).
- **Cache:** 5-minute TTL means rapid SessionStart bursts (e.g. testing) only run the check once.

## See also

- [v1-stack-overview.md](../architecture/v1-stack-overview.md) — drift detection in the v1.1 architecture
- [sessions-guide.md](./sessions-guide.md) — session staleness detection
- [contract-guide.md](./contract-guide.md) — `agents_contract` finding details
- [state-migration.md](./state-migration.md) — fixing `legacy_state_files`
- [troubleshooting.md](../troubleshooting/troubleshooting.md) — when fixes don't work
