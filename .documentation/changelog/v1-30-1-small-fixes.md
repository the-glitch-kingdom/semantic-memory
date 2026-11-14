---
title: v1.30.1 - small fixes
tier: reference
domains:
  - changelog
audience:
  - developers
  - admin
tags:
  - v1.30.1
  - lint
  - synthesize
  - healthcheck
status: active
last_updated: '2026-11-14'
version: 1.30.1
purpose: What v1.30.1 fixed (synthesize auto-links, lint on generated files and incident ids, healthcheck plugin lookup) and the measurements behind it.
load_priority: 5
estimated_read_time: 2 minutes
backlinks: []
sources:
  - src/core/lint.ts
  - src/core/synthesize.ts
  - src/core/healthcheck.ts
  - src/mcp/tools/patch.ts
  - package.json
---

# v1.30.1 - small fixes

Issues #36, #35, #34, #27, #28. Fact: [js-regex-word-boundary-matches-inside-paths](../knowledge-base/facts/js-regex-word-boundary-matches-inside-paths.md).

## What changed

- **#36 synthesize_note.** Auto-linking skips inline code spans and uses path-aware boundaries, so a name inside `dir/name-workflow.md` is not linked. Only `related_notes` that resolve to a vault note are linked; the rest appear under `## Related` as code text. Callers that pass no known-names set behave as before.
- **#35 lint_vault.** Generated `INDEX.md` and `log.md` are recognised by banner (CRLF tolerated) and skip schema checks and `noLastVerified`; broken-link checks still run. Hand-added frontmatter makes the file a normal note.
- **#34 healthcheck.** Without `CLAUDE_PLUGIN_ROOT`, `hook_registration` reads `installed_plugins.json` (`CLAUDE_CONFIG_DIR` or `~/.claude`): `semantic-memory@*` at user scope, or project/local scope for this project. Missing or malformed files give today's result. `hook_double_registration` uses the same lookup.
- **#27 lint_vault.** `[[target]]` resolves by basename, frontmatter `id` / `incident_id`, and the folder slug of a `narrative.md` / `index.md` folder. Known names load from the whole vault even with `pathGlob`.
- **#28.** Superseded banners on `docs/corpora-json.md` and `docs/smart-middle-activation.md`.

## Measured

`gate-release.sh 1.30.0` (fresh): identical counts (hybrid @1 91/139, multi 20/28/31 of 41, negatives 43/47, mcp vs cli 0 of 186 differ).

## Limits

A bare `(name)` inside a markdown link URL can still be auto-linked (path forms are protected). The search graph still resolves wikilinks by basename only.
