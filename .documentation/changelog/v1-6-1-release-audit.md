---
title: v1.6.1 — release audit of 1.5.2 → 1.6.0
tier: reference
domains:
  - changelog
audience:
  - developers
  - admin
tags:
  - v1.6.1
  - release-audit
  - gray-matter
  - redaction
  - read-only
  - embedder
  - offline
  - validation
status: active
last_updated: '2026-10-24'
version: 1.6.1
purpose: What the full validation of 1.5.2, 1.5.3 and 1.6.0 found through the
  published packages and real entry points, the seven defects 1.6.1 fixes, and
  what was checked and left as it is.
load_priority: 6
estimated_read_time: 4 minutes
word_count: 717
last_validated: '2026-10-25'
backlinks: []
---

# v1.6.1 — release audit of 1.5.2 → 1.6.0

1.5.2 (docs index freshness, [issue #29](https://github.com/the-glitch-kingdom/semantic-memory/issues/29)), 1.5.3 (secret redaction) and 1.6.0 (failure-time fact lookup) were each tested by the repo's suite. This release tests them the way users meet them, through the **published** packages and real processes, not in-memory transports:
- a fresh `npm i @theglitchking/semantic-memory@1.6.0` with the standard two-server `.mcp.json`
- `claude plugin update` from 1.5.1
- an upgrade from 1.5.1 state (legacy capture items, a stale index, a doc with invalid frontmatter)
- a stdio MCP client driving every write tool with fake secrets
- the read-only docs server
- the live watcher
- every hook as a real process
- `eval-failures`
- the offline tarball: build, install, upgrade, verify, rollback, and an offline start

## Defects found and fixed

| # | Defect | Since | Fix |
|---|---|---|---|
| 1 | A note with invalid frontmatter was indexed with its YAML block as a heading after the first parse in a process. `update_frontmatter` on it threw once, then wrote a second frontmatter block on retry. Parsed `data` was shared between callers. | 1.5.2 (fallback), older (cache) | `src/core/matter.ts` bypasses gray-matter's content cache, and every caller uses it. See [gray-matter-caches-a-failed-parse](../knowledge-base/facts/gray-matter-caches-a-failed-parse.md). |
| 2 | Frontmatter `api_key: <bare random value>` was written unmasked. | 1.5.3 | `redactDeep` checks object fields as `key=value`. |
| 3 | `manage_lexicon add` didn't report its redaction count. | 1.5.3 | returns `redacted`. |
| 4 | A search made while the cache loaded at startup said "Index not built. Run reindex first." | older | says indexing is in progress. |
| 5 | `--read-only` servers exposed `log_event`, which wrote `log.md` into the docs folder. | 1.1 | write-gated. The read-only surface is 20 tools. |
| 6 | A filtered `lint_vault` returned the full report's counts. | 1.1 | counts match the returned findings. |
| 7 | Every server start re-downloaded the 90 MB model, offline starts failed, and the offline tarball was 5.7 GB of partial downloads. | 0.4.2 | uses the cached fp32 model, and the build skips `*.tmp`. See [commander-no-flag-makes-the-default-true](../knowledge-base/facts/commander-no-flag-makes-the-default-true.md). |

Each fix landed after a failing regression test (`test/unit/frontmatter.test.ts`, `indexer.test.ts`, `redact.test.ts`, `lint-secrets.test.ts`; `test/integration/redaction-write-points.test.ts`, `stale-index-startup.test.ts`, `embedder.test.ts`; `test/regression/tool-surface.test.ts`).

## Verified, unchanged

- **Fresh install:** `--version` 1.6.0, `healthcheck --fast` clean, `dist/core/{redact,failure-query}.js` shipped.
- **Plugin update:** 1.5.1 → 1.6.0, with all four hook events registered.
- **Upgrade from 1.5.1 state:** the stale index rebuilt at server start, and the legacy capture item was asked about once, then cleared.
- **Redaction end to end:** after the fixes, six fake secret shapes sent through every write tool, a search query and `session_run` left none in the project tree or in any tool result. The read-only `lint_vault({checks:["secrets"]})` reports path, line and kind, and changes no file.
- **Watcher:** edits, adds in a subfolder and deletes reindex. `.txt` and index-folder writes don't.
- **Hooks:**
  - SessionStart takes ~0.95 s for both scripts, and UserPromptSubmit ~0.6 s, with hits labelled by server.
  - Stop takes ~30 ms and asks only about its own session's items, which are redacted.
  - PostToolUseFailure takes ~25 ms when off. When on, it takes ~0.6 s and returns the pkill / exit-144 fact once per session.
- **`eval-failures`:** the published and repo builds print the same report. The v1.6 eval re-runs to 32/38 ranked first.
- **Offline tarball (1.6.1):** 557 MB. Install, upgrade, `--verify` and `--rollback` work, and the server starts with every network fetch failing.
- **Suite and checks:** 545 tests, lint, the golden eval (recall@1 86%, MRR 0.929), and `hewtd audit-facts --run-verify-all` pass. `npm audit --omit=dev` reports zod only, whose fix is zod 4 (see [v1-5-2](v1-5-2-docs-index-freshness.md)).

## Not fixed (noted)

- `get_stats.lastIndexed` reports the current time whenever the index is ready, not when it was built. `meta.json` `indexedAt` is the real value.
- Vector search hits carry the note path as `title`.
- `semantic-memory tools` prints a legacy 21-tool list.
- hit-em-with-the-docs 2.10.0:
  - Its generated `INDEX.md` / `REGISTRY.md` link "Related Domains" that don't exist in this repo (44 of the 59 broken links).
  - `hewtd archive` overwrites a file already at the archive path. See [hewtd-archive-overwrites-an-existing-archive-file](../knowledge-base/facts/hewtd-archive-overwrites-an-existing-archive-file.md).

## Docs

- **New:** [release-process.md](../deployment/release-process.md), which supersedes the archived `marketplace-registration.md`.
- **Rewritten:** the installation guide (it still named the pre-rebrand package) and the hooks reference (four hooks, per-session capture, multi-folder search).
- **Updated:** README, SECURITY.md, the configuration, MCP-tools, CLI and frontmatter references, troubleshooting, secret redaction, the architecture and operational guides, and the runbook.
- **KB:** three new gotcha facts, with their literal error strings in `tags:`. String `symptoms:` on facts fail `hewtd audit`, because in a hewtd tree `symptoms:` is hewtd's playbook object schema. semantic-memory doesn't read those objects yet. The clash is documented in the failure-lookup guide and the frontmatter spec, and left for a follow-up.
