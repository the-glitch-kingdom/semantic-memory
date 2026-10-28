---
title: Troubleshooting
tier: guide
domains: [troubleshooting]
audience: [developers]
tags: [troubleshooting, debugging, failure-modes, diagnostics, v1.7.0, skill-loop, jev-mode]
status: active
last_updated: '2026-10-25'
version: '1.7.0'
purpose: Symptom / cause / fix across all 5 layers + v1.x additions (sessions, AGENTS.md, drift, state migration). Each entry has a symptom, a likely cause, and a specific diagnostic command.
load_priority: 9
---

# Troubleshooting

> Known failure modes for semantic-memory at v1.2.0. v1.x-specific issues are at the top; the full v0.x five-layer matrix follows.

## v1.x rebrand & install issues

### `npm install @theglitchking/semantic-memory@1.0.0` or `@1.1.0` produces a working install but slash commands don't work / hooks don't fire
- **Cause:** v1.0.0 and v1.1.0 shipped with the rebrand wiring half-finished. The npm package was renamed but `scripts/link-skills.js`, `hooks/reconcile.js`, slash commands, and `src/cli/index.ts` still pointed at `@theglitchking/semantic-sidekick` paths internally.
- **Fix:** upgrade to v1.1.1+ — the hotfix completed the rebrand. `npm install --save @theglitchking/semantic-memory@latest`.
- **Avoid:** never install v1.0.x or v1.1.0 fresh. Both have the install-time regression.

### `npx --no @theglitchking/semantic-sidekick <cmd>` runs ancient pre-rebrand code
- **Cause:** the legacy package `@theglitchking/semantic-sidekick` is still on npm at v0.2.x. `npx` fetches that, not the rebranded `semantic-memory`.
- **Fix:** use `@theglitchking/semantic-memory` instead. v1.1.1+ slash commands all use the new name.

### Both `@theglitchking/semantic-sidekick` AND `@theglitchking/semantic-memory` installed in `node_modules/`
- **Cause:** mid-migration state. v0.x → v1.x users sometimes end up with both packages.
- **Fix:** remove the legacy package: `npm uninstall @theglitchking/semantic-sidekick`. The new package keeps both `bin/semantic-memory` and `bin/semantic-sidekick` aliases internally; nothing scripted against the legacy bin name will break.

## v1.5.2 docs index + hook issues (issue #29)

### Docs index stuck at an old `totalChunks` / `indexedAt` while `.documentation/` keeps growing
- **Cause (pre-1.5.2, any of):** a stale cached index was served forever (startup only rebuilt when the cache failed to load); the watcher never fired under chokidar 5 (glob target); one doc with invalid frontmatter made every rebuild fail.
- **Check:** `cat <docs>/.semantic-sidekick-index/meta.json` (compare `totalChunks` / `indexedAt` with the folder); the server's stderr for `Invalid frontmatter in …` or `Skipping …`.
- **Fix:** upgrade to 1.5.2+ and restart the session — a stale cache now rebuilds at startup and edits reindex live. Quote any frontmatter value named in an `Invalid frontmatter` line (an unquoted colon is the usual cause). Manual rebuild: `semantic-memory --notes <docs> --reindex`.
- **See:** [indices-and-storage.md](../architecture/indices-and-storage.md), [what-gets-indexed.md](../architecture/what-gets-indexed.md)

### Hooks inject nothing although the docs clearly cover the question
- **Cause (pre-1.5.2):** the prompt and SessionStart hooks searched only the first `semantic-*` entry in `.mcp.json` — normally the vault. An empty vault meant every prompt searched nothing.
- **Fix:** upgrade to 1.5.2+, which searches every entry's `--notes` folder and labels hits by server. Each folder needs a built index (`<folder>/.semantic-sidekick-index/`). `SIDEKICK_VAULT_PATH` limits the hook to one folder — unset it to search both.
- **See:** [injection-points.md](../architecture/injection-points.md)

### Stop hook asks you to file a capture from a conversation this session never had
- **Cause (pre-1.5.2):** `capture-pending.json` was shared by every session in the project, so a cue from a concurrent session showed up in this session's Stop prompt.
- **Fix:** upgrade to 1.5.2+ (items are keyed by `session_id`). Items written before the upgrade are asked about once, by whichever session stops first.

### `npm audit fix` / `npm update` crash with `Cannot read properties of null (reading 'edgesOut')`
- **Cause:** an npm 10 arborist bug resolving vitest 4's optional peer dependencies (`#loadPeerSet`).
- **Fix:** update the affected packages by name (`npm update <pkg> …`, leaving vitest out), and update the vitest chain with npm 11: `npx -y npm@11 update vitest`. npm 11 skips install scripts it hasn't approved, so run `npm rebuild <pkg>` for any it warns about.

## v1.6.1 release-audit issues

### A note's YAML block shows up as its title or search snippet (`title: x purpose: …`)
- **Cause (1.5.2–1.6.0):** the note has invalid frontmatter (usually an unquoted `: ` in a value). The first parse in a process indexed its body only, but gray-matter cached the failed parse, so every later parse (the startup rebuild, the watcher, `reindex`) returned the raw file and the YAML block was indexed as a heading.
- **Fix:** upgrade to 1.6.1, then quote the value named in the server's `Invalid frontmatter in <path>` stderr line.

### `update_frontmatter` wrote a second `---` block at the top of a note
- **Cause (before 1.6.1):** the note's frontmatter was invalid. The first call threw. A retry in the same server process got the cached unparsed file back and wrote new frontmatter above the old block.
- **Fix:** upgrade to 1.6.1 (it throws every time). Repair the note by hand: merge the two blocks and quote the bad value.

### Every MCP server start prints `Downloading ONNX model … Quantized model not available, falling back to fp32`
- **Cause (0.4.2–1.6.0):** the server asks for the quantized model, MiniLM has none, and the fp32 fallback ran before the cache was checked, so 90 MB were downloaded on every start. Offline, the download fails and the embedder never starts. A download killed mid-way leaves `model.onnx.<pid>.<ts>.tmp` behind.
- **Check:** `ls ~/.semantic-sidekick/models/*/ | grep -c tmp` and `du -sh ~/.semantic-sidekick/models`.
- **Fix:** upgrade to 1.6.1, which uses the cached `model.onnx`. Reclaim the space with `rm ~/.semantic-sidekick/models/*/model.onnx.*.tmp` (partial downloads only; `model.onnx` is the real model).

### The offline tarball is several GB instead of about 0.55 GB
- **Cause (before 1.6.1):** `build-offline-tarball.sh` copied the whole model cache, including the `*.tmp` partial downloads above.
- **Fix:** 1.6.1 skips `*.tmp`. On older checkouts, delete the `.tmp` files before building.

### `search_hybrid` says "Index not built. Run reindex first." right after the server starts
- **Cause (before 1.6.1):** the server was still loading its cached index. The message was wrong advice, and reindexing doesn't help.
- **Fix:** wait a few seconds and retry. 1.6.1 says "Indexing in progress… Try again shortly." instead.

### `log_event` is missing on the docs (`--read-only`) server
- **Expected since 1.6.1.** It wrote `log.md` into the docs folder. Log through the vault server (`mcp__semantic-vault__log_event`) or the `semantic-memory log-event` CLI.

### A value was masked as `[REDACTED]` that wasn't a secret, or a secret wasn't masked
- **Cause:** the redaction rules are pattern-based ([secret-redaction.md](../security/secret-redaction.md)). Notes use the *precise* set: a value is masked when it has a vendor key shape, follows a secret-named key (`api_key: …`; since 1.6.1, frontmatter fields too), is a URL password or a Bearer token, or exactly matches a secret-named env var on this machine. Logs and queries use the broader set, which also masks long random-looking tokens.
- **Check:** `lint_vault({checks: ["secrets"]})` lists what the rules see in existing notes (path, line, kind).
- **Fix:** for a false positive, rename the key (for example `token_count` instead of `token`) or write the value without a secret-named key in front. For a miss, add a named rule as described under "Adding a pattern" in secret-redaction.md, and open an issue with the *shape* of the value, never the value itself.

### `npm i @theglitchking/semantic-memory@<new>` 404s right after a publish
- **Cause:** the registry CDN serves the tarball a few minutes after `npm publish` succeeds (about 5 minutes for 1.6.0).
- **Fix:** wait and retry; don't republish. See [release-process.md](../deployment/release-process.md).

## v1.1+ session issues

### `session_finish` refuses with "no verification commands recorded"
- **Cause:** working as designed — the hard gate prevents silent un-tested closes.
- **Fix (one of):**
  - Run a real verification: `session_run({cmd: "npm test"})` then close
  - Waive verification with reason: `session_finish({summary, verified: false, reason: "doc-only edits, no test surface"})`
- **See:** [sessions-guide.md](../operational/sessions-guide.md)

### `session_start` refuses with "Session already open"
- **Cause:** another session is open with a different task. semantic-memory enforces one-at-a-time.
- **Check:** `session_status()` to see what's there.
- **Fix:** finish the existing session first, OR if it's stale (>24h, no activity): `rm <project>/.claude/.semantic-memory/session.json`.

### Stop hook prompts about a session you already closed
- **Cause:** the session.json file wasn't actually deleted, possibly because `session_finish` returned an error you missed.
- **Check:** `cat <project>/.claude/.semantic-memory/session.json`. If it has `closed_at`, that's a finished session that should have been removed.
- **Fix:** `rm <project>/.claude/.semantic-memory/session.json`.

### `session_run` hangs forever
- **Cause:** the wrapped command is interactive and never exits, OR the default 5-minute timeout is too short for a long-running test.
- **Fix:** pass `timeout_ms: <ms>` (e.g. `timeout_ms: 600000` for 10 minutes), OR Ctrl-C the wrapping process and re-run with a smaller scope.

## v1.1+ AGENTS.md contract issues

### `regenerate_contract` returns `hand_edit_detected: true`
- **Cause:** content inside the `<!-- semantic-memory:begin contract -->` ... `<!-- end -->` markers was hand-edited.
- **Fix (preserves your edits):** move the hand-edits to a Local Notes section OUTSIDE the markers, then re-run `regenerate_contract`.
- **Fix (loses hand-edits):** `regenerate_contract({force: true})` overwrites.
- **See:** [contract-guide.md](../operational/contract-guide.md)

### `regenerate_contract` returns "AGENTS.md exists but does not contain the semantic-memory managed-block markers"
- **Cause:** AGENTS.md exists but was hand-rolled (or written by another tool) without the managed markers.
- **Fix (manual):** wrap your existing content with the markers: `<!-- semantic-memory:begin contract -->` ... `<!-- semantic-memory:end contract -->`. Next regenerate will overwrite that section but preserve everything outside.
- **Fix (fresh start):** delete AGENTS.md and re-run `regenerate_contract`.

### AGENTS.md keeps showing "old" tool list after upgrade
- **Cause:** AGENTS.md is regenerable but doesn't auto-regenerate on upgrade.
- **Fix:** `/contract refresh` (or `regenerate_contract({})`) — pulls the current tool inventory into the managed block.

## v1.1+ drift detection issues

### SessionStart silently emits drift output every time
- **Cause:** there's actual drift. The block isn't noise — investigate.
- **Fix:** read the `<vault-drift>` block. Run `/healthcheck` for full details. Each finding has remediation in [drift-detection.md](../operational/drift-detection.md).

### `legacy_state_files` keeps firing after `migrate-state`
- **Cause (one of):**
  - Some tool restored the old `.sidekick-*` files (backup tool? IDE? shell history replay?)
  - You're running multiple semantic-memory versions in parallel — v1.1.x and v1.2.x in the same project will write to different paths
  - Migration didn't complete; check `<project>/.claude/.sidekick-*` to see what's still there
- **Fix:** identify the source, then re-run `bin/semantic-memory migrate-state --force`.

### `/healthcheck --fix` left a finding unfixed
- **Cause:** `--fix` (shipped in v1.2.3) only auto-applies **safe** fixes — re-link skills, reconcile `.mcp.json`, reindex, migrate state. Findings that touch user-authored content (`agents_contract` hand-edits, `session_staleness`, `lint_vault` stale/broken-link findings) are deliberately reported for human review, never auto-changed.
- **Fix:** apply the reported per-finding remediation manually. See [drift-detection.md](../operational/drift-detection.md#auto-fix-healthcheck---fix--shipped-in-v123).
- **Note:** if `--fix` appears to do *nothing at all* on a pre-1.2.3 install, it's genuinely unimplemented there — upgrade to ≥1.2.3.

## v1.2 state migration issues

### `migrate-state` reports "conflict (both paths exist)"
- **Cause:** both the legacy `.claude/.sidekick-mode` AND the new `.claude/.semantic-memory/mode` exist (typically because you ran the plugin in v1.2 mode before running migrate-state, OR a v1.1 install wrote to the old path while v1.2 was writing to the new).
- **Inspect:** `cat .claude/.sidekick-mode` vs `cat .claude/.semantic-memory/mode` — usually the new path's content is correct.
- **Fix:** `bin/semantic-memory migrate-state --force` (deletes old, preserves new). Or manually: pick the canonical path's content, restore it to the new path, delete the old.

### `migrate-state` exits with `Error: Dynamic require of "fs" is not supported`
- **Cause:** v1.2.0 had a bug where `require("node:fs")` was used inside the function. Caught and fixed.
- **Fix:** upgrade to v1.2.0 (the published version has the fix). If you're on a development build from the bug window, `npm update` fetches the published v1.2.0.

## v1.0 / v1.1 / v1.2 path inconsistency

### "Why is the path called `.semantic-sidekick-index/` if the package is `semantic-memory`?"
- **Cause:** intentional — v1.0 storage promise. Renaming the index dir would invalidate every existing user's index and force a model re-download.
- **Fix:** none needed; the path retains the legacy name through all of v1.x. v2.0 will move it to `.claude/.semantic-memory/index/` with a transparent atomic migration.

### "Why is `~/.semantic-sidekick/models/` the model cache path?"
- **Same reason** — preserved through v1.x via the storage promise. v2.0 renames to `~/.semantic-memory/models/`.

---

## v0.x layered failure modes (carried into v1.x)

The rest of this document is the original v0.x troubleshooting matrix. All entries still apply unless replaced above.

## Installation + plugin runtime

### "plugin not found" after `/plugin install semantic-memory`
- **Cause:** marketplace wasn't added, or the plugin name in the marketplace doesn't match.
- **Check:** `cat .claude-plugin/marketplace.json` — the `plugins[0].name` must match what you ran `/plugin install` with.
- **Fix:** `/plugin marketplace list` confirms registration; `/plugin marketplace add <url>` re-adds.

### `.mcp.json` shows npx-form instead of local-bin form
- **Cause:** pre-0.10.0 SessionStart hook wrote a fragile form; reconcile hook runs only on new sessions.
- **Fix:** `semantic-sidekick normalize-config [--dry-run]` rewrites to stable form. Backs up to `.mcp.json.bak` and verifies the binary starts before committing.

### `ERR_MODULE_NOT_FOUND` on first MCP call
- **Cause:** corrupted npx cache (classic failure mode that triggered 0.10.0).
- **Fix:** `semantic-sidekick healthcheck` auto-heals by rm-rf'ing the bad cache dir and retrying. Manual: `rm -rf ~/.npm/_npx/*/node_modules/@theglitchking`.

### "No vault found" on SessionStart
- **Cause:** `.mcp.json` missing or `semantic-vault` entry not present.
- **Check:** `grep -A5 semantic-vault .mcp.json`.
- **Fix:** restart Claude Code; reconcile hook writes `.mcp.json` on SessionStart. If that fails, check `hooks/session-start.js` is wired in `.claude/settings.json`.

---

## Index + search

### Search CLI fails with "index not built"
- **Cause:** `.semantic-sidekick-index/` missing or incomplete.
- **Fix:** `semantic-sidekick --notes <vault> --reindex`.

### Search results are stale (new notes not surfacing)
- **Cause:** parsed-doc cache is from a prior reindex; watcher didn't catch the add.
- **Check:** `cat <vault>/.semantic-sidekick-index/meta.json` — look at `indexedAt`.
- **Fix:** `semantic-sidekick --notes <vault> --reindex` rebuilds both the vector index and the parsed-doc cache.

### Hook latency is 6+ seconds per prompt
- **Cause:** parsed-doc cache missing; indexer re-parses all notes per call.
- **Check:** `ls -la <vault>/.semantic-sidekick-index/docs.cache.json`.
- **Fix:** run `--reindex` once; subsequent hook calls load the cache (~0.7s).

### Model mismatch error on search
- **Cause:** changed `--model` value without reindexing; cached embeddings are invalid.
- **Fix:** `--reindex` regenerates embeddings with the current model.

### HNSW / embedder fails to initialize
- **Cause:** missing native dependencies (`hnswlib-node`, `onnxruntime-node`).
- **Fix:** `npm install` in the plugin dir; if onnxruntime-node fails to build, falls back to onnxruntime-web automatically.

---

## Hooks

### Stop hook error: "Hook JSON output validation failed — (root): Invalid input"
- **Cause:** hook emitted `hookSpecificOutput` for the Stop event. Stop schema only accepts top-level fields (`decision`, `reason`, `continue`, `stopReason`, `suppressOutput`).
- **Fix:** already fixed in commit `183aa30`. If you still see it, you're on an older build — `git pull` and `npm run build`.

### Hook doesn't fire at all
- **Check 1:** `.claude/settings.json` has `hooks.SessionStart[0].hooks[0].command` pointing at `vault-context.js`.
- **Check 2:** `node hooks/vault-context.js` runs without error (from the repo root).
- **Check 3:** Claude Code sees the plugin — `/hooks` command in a live session lists registered hooks.

### Hook fires but no context is injected
- **Cause:** hook failed silently (fails-open design). Most likely: no vault configured, search CLI errored, or hook timeout.
- **Fix:** run with `SIDEKICK_DEBUG=1 claude` and expand the hook line with `ctrl+o` — stderr shows exactly where it bailed.

### SessionStart fires but `<vault-state-since>` is missing
- **Cause:** `log-query` CLI failed. Check for a `kind=error` entry from a prior session.
- **Fix:** `semantic-sidekick log-query --notes <vault>` manually — if that errors, you've diagnosed it.

### UserPromptSubmit hook not firing on prompts that should match
- **Cause 1:** mode is `outage-silence` — hook intentionally suppresses.
- **Cause 2:** fingerprint collision — this prompt (or a near-duplicate) was asked recently.
- **Check:** `cat .claude/.sidekick-mode` + `cat .claude/.sidekick-fingerprints.json`.
- **Fix:** `/mode vault-first` to exit outage; `rm .claude/.sidekick-fingerprints.json` to clear dedupe.

### Capture-on-close doesn't fire
- **Cause:** no item in `.claude/.semantic-memory/capture-pending.json` carries this session's `session_id` — no cue matched this session's prompts (a concurrent session's cues are not shown here, v1.5.2+).
- **Check:** `cat .claude/.semantic-memory/capture-pending.json` mid-session (before Stop) to verify cues were detected (legacy installs: `.claude/.sidekick-capture-pending.json`).
- **If detected but Stop still doesn't block:** check `SIDEKICK_DEBUG=1` output for stop-hook exit path (loop guard, mode, etc.).

### Stop hook loops
- **Cause:** `CLAUDE_STOP_HOOK_ACTIVE` env var missing in your harness.
- **Fix:** In Claude Code proper, this is set automatically. For other harnesses, set it when re-invoking after a block response.

---

## Skills + modes

### Skill doesn't activate when expected
- **Check:** `ls -la .claude/skills/` — each skill directory should be present as a symlink to `skills/<name>/`.
- **Fix (dev):** `ln -sfn ../../skills/<name> .claude/skills/<name>`.
- **Fix (installed plugin):** re-run `npm install` or `/plugin install semantic-sidekick` — link-skills.js recreates symlinks.

### `[research]` / `[outage]` prefix appears on wrong turns
- **Cause:** skill description's entry signals are too permissive.
- **Immediate fix:** `/mode vault-first` to override.
- **Long-term:** file a misfire as a gotcha note; tune the skill's `description` field to demote the specific false-positive trigger.

### `/mode` appears to write but subsequent hooks don't see the change
- **Check:** `cat .claude/.sidekick-mode` after `/mode research`.
- **Cause:** the command file relies on Claude executing the bash to write the file. If Claude skipped that step, the mode isn't persisted.
- **Fix:** rerun `/mode research` and confirm the bash runs; or manually `printf 'research' > .claude/.sidekick-mode`.

### `/vault <query>` returns nothing
- **Cause:** index may be empty or query has no matches.
- **Check:** `semantic-sidekick --notes <vault> --stats` shows note count.
- **Fix:** add notes; `--reindex`; try a broader query.

---

## Schema + lint

### apply_patch rejects every create with `missing required field "title"`
- **Cause:** `crud.update` with `mode: overwrite` discards existing frontmatter; the "new content" has no title.
- **Fix:** use `patch-by-heading` or include YAML frontmatter in the new content block.

### Lint shows errors on notes that *look* valid
- **Check:** field name typos (`tittle:`), enum value mismatch (`status: published` when enum is `[draft, active, ...]`).
- **Fix:** `semantic-sidekick lint --notes <vault> --json | jq '.byRule.schema_violations'` shows the exact message per file.

### Pre-commit hook blocks despite me wanting to commit a WIP
- **Fix:** `SKIP_VAULT_LINT=1 git commit ...` — documented in `scripts/pre-commit-lint.sh`.

### Broken-link lint flags legitimate links
- **Cause:** target note name has a different basename than the `[[wikilink]]` text.
- **Fix:** rename the link to match, or rename the target file to match.

---

## Capture + synthesis

### synthesize_note rejects with validation errors
- **Cause:** the proposed frontmatter fails schema validation (missing title, bad status, etc.).
- **Check:** the tool's response body has `result.lint[]` with specific findings.
- **Fix:** pass the missing/correct fields. Re-try with `dry_run: true` to confirm.

### Auto-wikilinks aren't inserted in synthesized notes
- **Cause:** `related_notes` entries don't match a plain-text occurrence in the body (case-sensitive or code-block).
- **Fix:** use exact basename or edit the body manually after synthesis.

### ingest_source creates a duplicate source-note
- **Cause:** reused `source_title` but new slugified `source_path` — pre-check thought it was a new note.
- **Fix:** pass `source.source_path` explicitly to point at the existing source-note.

---

## Logs

### log.md doesn't exist after several ingests
- **Cause:** `logEvent` silently failed (disk full, permissions, read-only filesystem).
- **Check:** `touch <vault>/log.md` — if permission denied, that's the issue.
- **Fix:** fix filesystem perms. Prior events are lost; future events will resume.

### log_query returns empty despite log.md having entries
- **Cause:** entries were added in a format other than the one our writer produces (e.g., hand-edited with different YAML structure).
- **Check:** open log.md, verify entries have ```yaml event fenced blocks.
- **Fix:** use `mcp__semantic-vault__log_event` (or the CLI equivalent) to append; those emit the exact parseable shape.

### State-delta preload shows "No logged activity" despite recent activity
- **Cause:** window is 14 days; entries older than that don't appear. Or timestamps are inconsistent (UTC vs local).
- **Check:** `semantic-sidekick log-query --notes <vault> --limit 5` — shows what the parser sees.

## The skill loop

### No drafts appear
- **Check first:** `semantic-memory skill-loop status` — is it on (and why), are sessions queued, is today's cap used?
- **Off for this repo:** a `skill_loop: off` in `.claude/.semantic-memory/config` beats the global switch. The switch is read at session start: turning it on mid-session takes effect next session.
- **No signal:** only sessions with a failed Bash/MCP call, a correction ("no, …", "use X instead", "don't …") or 20+ tool calls are queued. A failure the agent swallowed itself (`cmd; echo $?`, `cmd || true`) is not a failure to the hook.
- **Reviewed, nothing worth a skill:** `.claude/.semantic-memory/skill-loop.log` shows each review: `0 draft(s)` with the reviewer's reason, or `rejected` with the lint rule that failed. Most sessions teach nothing reusable; that is by design.

### The worker isn't running
- **Check:** `semantic-memory skill-loop status` shows the queue and the worker's pid; `.claude/.semantic-memory/skill-loop.log` shows what it did.
- **Lock left by a dead worker:** the next worker reclaims it (the pid is checked). Run one by hand: `semantic-memory skill-loop worker`.
- **`could not start claude: spawn claude ENOENT`** (often a session started from cron, whose PATH has no `~/.local/bin`): since 1.7.1 the worker also looks in `~/.local/bin/claude` and `~/.claude/local/claude`. If claude is elsewhere, set `SEMANTIC_MEMORY_CLAUDE_BIN` to its full path. A job that failed this way stays queued and runs at that repo's next worker start; to run it now, go to the repo and run `semantic-memory skill-loop worker`. See [the fact](../knowledge-base/facts/cron-sessions-start-workers-without-local-bin.md).
- **A job that keeps failing** is retried at the next worker start and set aside after 3 attempts in `~/.semantic-memory/review-queue/failed/` with the reason.

### "daily cap reached"
- At most `SEMANTIC_MEMORY_SKILL_LOOP_DAILY_RUNS` (10) reviews a day across all repos; the rest wait in the queue and run on the next worker start after midnight. Raise the variable if you want more.
- **The cap is used by sessions you did not run by hand:** `~/.semantic-memory/skill-loop-runs.jsonl` lists every review with its repo. Before 1.7.1, benchmark and test runs in temp directories (`/tmp/tmp…/work-on`) were reviewed too; 1.7.1 skips them. Sessions started by cron jobs in real repos are still reviewed.

### A skill I wanted was archived
- The curator archives learned skills unused for 30 days. `semantic-memory skill-loop restore <name>` brings it back; set `skill_loop.pinned: true` in its frontmatter so the curator leaves it alone. `skill-loop rollback <ledger-id>` undoes any single change exactly (`.claude/.semantic-memory/skill-ledger.jsonl` lists them).

### `--approve` refuses
- **"the eval gate said keep-draft":** evals ran and the draft did not beat the bar (with one or two sessions there is no held-out set yet). Land it anyway with `--override "<why>"`, which is recorded.
- **"changed since this patch was drafted":** the skill was edited after the patch was made. Reject the patch; the next review will redo it against the current text.
- **lint `name_clash`:** a skill the loop did not write has that name. Rename the draft (edit its SKILL.md and folder) or reject it.

### A skill-loop `claude` run sees MCP tools or hooks
- It must not: every run passes `--strict-mcp-config` and `disableAllHooks`. Without `--strict-mcp-config`, claude.ai connectors (Drive, Docs) load even with `--tools` set ([fact](../knowledge-base/facts/claude-p-tools-flag-keeps-claude-ai-connectors.md)).

## Jev mode

### `jev-mode status` says "on but unavailable"
- **jev-loop not found:** `router.py` missing at `~/.claude/jev-loop` — set `JEV_LOOP_DIR`.
- **`TYPESAFE_API_KEY is not set`:** neither the environment nor `~/.claude/settings.json` `env` has it.
- **`python3 not found`:** the bridge is a Python script.
- While unavailable, jev mode is effectively off: the failure hook behaves as without jev mode, the skill loop uses its rule-based defaults.

### The failure hook injects less (or nothing) in jev mode
- Jev mode only removes: a confident Jev no (≤ 0.05) suppresses the fact, and a timeout, an error or the daily ceiling inject nothing. Jev mode does not turn the hook on: it still needs `SEMANTIC_MEMORY_FAILURE_HOOK=1`. `SIDEKICK_DEBUG=1` prints the reason on stderr.
- **Ceiling:** `SEMANTIC_MEMORY_JEV_DAILY_TOKENS` (500,000) for the hook; the hook says so once on stderr.
- **Slow search:** the gate's whole budget is 1.5 s (`SEMANTIC_MEMORY_JEV_HOOK_BUDGET_MS`); with less than 300 ms left after the search, Jev is not asked.

---

## The golden diagnostic sequence

When something feels off and you don't know where to start:

```bash
# 1. Current mode (legacy: .claude/.sidekick-mode)
cat .claude/.semantic-memory/mode

# 2. Pending captures (each item has a session_id)
cat .claude/.semantic-memory/capture-pending.json

# 3. Recent errors
semantic-sidekick log-query --notes <vault> --kind error --limit 10

# 4. Vault health
semantic-sidekick lint --notes <vault> --json | jq '.counts'

# 5. Index freshness
cat <vault>/.semantic-sidekick-index/meta.json

# 6. Full debug on next session
SIDEKICK_DEBUG=1 claude
```

If steps 1-5 all look reasonable and step 6 shows the hook reaching its intended exit path, the system is operating correctly and the user-visible behavior is a tuning question (probably a skill description), not a bug.

---

## Legacy substrate troubleshooting

These are original `semantic-pages` diagnostics, preserved for substrate-level issues. For anything sidekick-specific, prefer the sections above.

### Vault/index mismatch
```bash
# Show current model + indexed-at timestamp
cat <vault>/.semantic-sidekick-index/meta.json

# Re-embed with a specific model
semantic-sidekick --notes <vault> --reindex --model nomic-ai/nomic-embed-text-v1.5
```

### Performance tuning
See [performance-tuning.md](../legacy/performance-tuning.md) for worker count, batch size, and quantization tradeoffs.

### Embedder options
See [embedder-guide.md](../legacy/embedder-guide.md).
