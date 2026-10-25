---
title: State migration — moving legacy .sidekick-* files to .semantic-memory/
tier: guide
domains: [operational]
audience: [developers, admin]
tags: [migration, state, sidekick, semantic-memory, migrate-state, v1.2]
status: active
last_updated: '2026-10-24'
version: '1.6.1'
purpose: Operational guide for v1.2's state-file consolidation. What's moving, when to run migrate-state, what conflicts mean, and what's deferred to v2.0.
load_priority: 6
---

# State migration

v1.2 consolidates three transient state files under `.claude/.semantic-memory/`. Reads check the new path first and fall back to the old path; writes always go to the new path. Use `bin/semantic-memory migrate-state` for explicit cleanup.

## What's moving in v1.2

| Old path | New path | What it stores |
|---|---|---|
| `.claude/.sidekick-mode` | `.claude/.semantic-memory/mode` | Active mode (`vault-first`/`research`/`outage-silence`) |
| `.claude/.sidekick-fingerprints.json` | `.claude/.semantic-memory/fingerprints.json` | sha1 prompts for re-fire suppression |
| `.claude/.sidekick-capture-pending.json` | `.claude/.semantic-memory/capture-pending.json` | Stop-hook capture queue |

**The capture-pending format changed in v1.5.2 too.** Items gained a `session_id`, and each session asks about and clears only its own. Items without one (written by 1.5.1 or earlier, at either path) are asked about once, by the first session to stop, and items older than 7 days are dropped. No migration step is needed. v1.6 adds `.claude/.semantic-memory/failure-shown.json` (the opt-in failure hook's shown-once list), which has no legacy path.

These three were the v0.x → v1.1 carryover paths. v1.2 brings them into the `.claude/.semantic-memory/` namespace alongside `session.json` (v1.1+) and `healthcheck-cache.json` (v1.1+), which were already correctly placed.

## What's NOT moving in v1.2

- **`<vault>/.semantic-sidekick-index/`** — vector index dir. Deferred to v2.0 (one-shot atomic move with verify). The path retains the legacy name through all of v1.x per the v1.0 storage promise.
- **`~/.semantic-sidekick/models/`** — global model cache. Deferred to v2.0 (cross-device, multiple repos may share).
- **`<vault>/.vault/`** — user content. NOT moving; this is the public `--notes` interface.
- **`<project>/.claude/skills/`** — managed by claude-plugin-runtime, shared with other plugins.

## Migration semantics

### Read-with-fallback

When the plugin reads any of the three state files, it checks the new path first. If absent, falls back to the old path. This means:

- Existing v1.1.x users who don't run `migrate-state`: continue working unchanged
- After upgrade, the OLD path is still authoritative until something writes
- The first write to a state file (mode change, capture pending append, fingerprint save) creates the NEW path
- After that write, the old path becomes "ghost" — readable, but not the canonical source

### Always-write-to-new

Every write to these files now goes to `<project>/.claude/.semantic-memory/<name>`. Old paths are never written to (post-v1.2). This means:

- Once a single write happens, the new path is the canonical
- Old paths only get cleaned up by explicit `migrate-state` or manual `rm`
- Deleting an old path while the new path exists has no effect — the new path is what gets read

### v2.0 will remove the fallback

Sometime in v2.0 (after v1.x has been stable for a quarter+), the read-with-fallback logic is removed. At that point:

- Users who ran `migrate-state` (or had the new path naturally created by a write): unaffected
- Users with ONLY the legacy path: their state effectively disappears (mode resets to vault-first, fingerprints lost, capture-pending lost)

To future-proof, run `migrate-state` once during your v1.x window.

## When to run migrate-state

- **Right after upgrading to v1.2.x** if you want a clean state directory
- **When `/healthcheck` reports `legacy_state_files` warning** (this is the prompt)
- **NEVER required** — it's hygiene, not a correctness fix

If you're migrating in a hurry and don't care about preserving fingerprints/capture-pending state, you can also just `rm -rf .claude/.sidekick-*` and let the plugin recreate fresh state at the new paths. You'll lose fingerprint history (some recently-fired vault contexts will re-fire on subsequent prompts) and any pending capture cues (rarely critical).

## Running migrate-state

```bash
# Basic — atomic move from old to new
node ./node_modules/@theglitchking/semantic-memory/bin/semantic-memory migrate-state

# Preview without modifying
node ./node_modules/@theglitchking/semantic-memory/bin/semantic-memory migrate-state --dry-run

# Resolve conflicts (when both old AND new paths exist)
node ./node_modules/@theglitchking/semantic-memory/bin/semantic-memory migrate-state --force

# Different project root
node ./node_modules/@theglitchking/semantic-memory/bin/semantic-memory migrate-state --project /path/to/other/project
```

Output:

```json
{
  "migrated": [
    {
      "name": "mode",
      "status": "migrated",
      "oldPath": ".../.claude/.sidekick-mode",
      "newPath": ".../.claude/.semantic-memory/mode",
      "detail": "renamed"
    },
    {
      "name": "fingerprints",
      "status": "migrated",
      "oldPath": ".../.claude/.sidekick-fingerprints.json",
      "newPath": ".../.claude/.semantic-memory/fingerprints.json",
      "detail": "renamed"
    },
    {
      "name": "capture-pending",
      "status": "migrated",
      "oldPath": ".../.claude/.sidekick-capture-pending.json",
      "newPath": ".../.claude/.semantic-memory/capture-pending.json",
      "detail": "renamed"
    }
  ],
  "skipped": [],
  "conflicts": []
}
```

## Status semantics

Each entry in the output is one of:

| Status | Meaning |
|---|---|
| `migrated` | Old path existed, new path didn't, atomic rename succeeded |
| `skipped-no-source` | Neither old nor new path exists; nothing to do |
| `skipped-already-migrated` | Old path doesn't exist, new path does; already done |
| `conflict` | Both old AND new exist; refused without `--force` |
| `resolved-by-force` | Both existed; `--force` was passed; old was deleted, new preserved |

## Conflicts

If both old AND new paths exist, `migrate-state` refuses without `--force`. This protects against silent data loss when:

- You ran `migrate-state` from one shell, then went back and `cp`'d an old file
- A file watcher or backup tool restored the old path while the new was active
- Some script you didn't know about wrote to both paths

**Inspect first:**

```bash
node ./dist/cli/index.js migrate-state --dry-run
# → conflicts: [{ name: "mode", oldPath: "...", newPath: "...",
#                 detail: "both paths exist (old: 2026-04-15, new: 2026-05-09);
#                          pass --force to keep new and delete old" }]
```

The new path's content is almost always what you want (it's been the canonical write target since the upgrade). `--force` deletes the old and preserves the new:

```bash
node ./dist/cli/index.js migrate-state --force
```

If for some reason the OLD path has content you want, restore it manually first:

```bash
cp .claude/.sidekick-mode .claude/.semantic-memory/mode  # take old as the new
node ./dist/cli/index.js migrate-state --force            # then resolve the conflict
```

## Idempotency

`migrate-state` is fully idempotent. Running it twice has no additional effect:

```
Run 1: migrated mode, fingerprints, capture-pending
Run 2: skipped-already-migrated (×3)
Run N: skipped-already-migrated (×3)
```

Safe to run from cron, postinstall scripts, or as part of a "fresh project setup" flow.

## Manual migration

If you'd rather move the files yourself, the equivalent of `migrate-state` is:

```bash
mkdir -p .claude/.semantic-memory
mv .claude/.sidekick-mode .claude/.semantic-memory/mode 2>/dev/null
mv .claude/.sidekick-fingerprints.json .claude/.semantic-memory/fingerprints.json 2>/dev/null
mv .claude/.sidekick-capture-pending.json .claude/.semantic-memory/capture-pending.json 2>/dev/null
```

This skips the conflict-detection logic but achieves the same end state when the new paths don't exist.

## Verifying migration

After running:

```bash
# Old paths should be gone
ls -la .claude/.sidekick-* 2>&1 | grep -v "No such" || echo "✓ no legacy files"

# New paths should exist (with content from before)
ls -la .claude/.semantic-memory/

# Healthcheck should not flag legacy state
node ./dist/cli/index.js healthcheck --fast
```

The `legacy_state_files` healthcheck finding goes from `severity: warn` to `severity: ok` after successful migration.

## What gets preserved

- **Mode**: the active mode (`research`/`vault-first`/`outage-silence`) is preserved verbatim
- **Fingerprints**: the prompt-suppression fingerprints are preserved (no extra vault-context re-firing)
- **Capture pending**: any queued capture cues are preserved (will surface at next Stop)

What does NOT get preserved (because it's tiered storage, not state):

- Vector index — that's `<vault>/.semantic-sidekick-index/`, NOT moved in v1.2
- Embeddings cache — same
- Model cache — that's `~/.semantic-sidekick/models/`, NOT moved in v1.2

## Multi-project bulk migration

If you have many projects to migrate:

```bash
# Find all projects with legacy state files
find ~/workspace -maxdepth 4 -name ".sidekick-mode" 2>/dev/null

# Run migrate-state for each
for project in $(find ~/workspace -maxdepth 4 -name ".sidekick-mode" -exec dirname {} \; -exec dirname {} \;); do
  echo "=== Migrating $project ==="
  node ~/some/path/to/dist/cli/index.js migrate-state --project "$project"
done
```

Or in each project:

```bash
cd /path/to/each/project
node ./node_modules/@theglitchking/semantic-memory/bin/semantic-memory migrate-state
```

## Programmatic access

```typescript
import { migrateState } from "@theglitchking/semantic-memory";

const result = migrateState({
  projectRoot: "/path/to/project",
  dryRun: false,
  force: false,
});

if (result.conflicts.length > 0) {
  console.error("Conflicts found:", result.conflicts);
  process.exit(1);
}
console.log(`Migrated ${result.migrated.length} files.`);
```

## Troubleshooting

### "Permission denied" on rename

Filesystem permission issue. `migrate-state` uses `renameSync` which needs write access to the parent directory. Check ownership of `.claude/`:

```bash
ls -la .claude/ | head
# Should be owned by your user, not root
```

### "EXDEV: cross-device link"

Theoretically possible if `.claude/` and `.claude/.semantic-memory/` are on different filesystems (rare; both are typically on the project disk). The error appears in the `conflicts[]` output. Workaround: copy + delete manually:

```bash
cp .claude/.sidekick-mode .claude/.semantic-memory/mode
rm .claude/.sidekick-mode
```

### Files reappear after migration

Some other process is writing to the old paths. Check:

- Are you on v1.2+? `node ./dist/cli/index.js --version` should report ≥1.2.0
- Is this repo using a v1.1.x install via npx? `npx --no @theglitchking/semantic-memory@latest --version` to verify
- Is there a backup tool restoring the old paths?

If you have v1.1.x and v1.2.x running simultaneously in the same project, the v1.1.x install will keep writing to the old paths. Pick one version per project.

## See also

- [v1-stack-overview.md](../architecture/v1-stack-overview.md) — v1.2 state consolidation in context
- [drift-detection.md](./drift-detection.md) — `legacy_state_files` finding details
- [indices-and-storage.md](../architecture/indices-and-storage.md) — what's in `.semantic-memory/` after migration
- [troubleshooting.md](../troubleshooting/troubleshooting.md) — when migration goes sideways
