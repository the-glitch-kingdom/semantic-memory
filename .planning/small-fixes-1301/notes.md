# Notes: small fixes 1.30.1 (#36, #35, #34, #27, #28)

## Verification on 1.30.0 (2026-11-14)

- **#36:** `src/core/synthesize.ts:120` `autoWikilink`:
  - `body.split(/(```[\s\S]*?```)/g)` skips fenced blocks only;
  - `new RegExp(`\\b${escaped}\\b`, "i")` is the boundary bug;
  - `buildBody` (:104) writes `- [[${wikilinkName(r)}]]` for every related entry, resolved or not.
  `buildSynthesizeChangeSet` is pure (no vault access), so the known-names set must come from the MCP handler.
- **#35:** reproduced with `lintVault` from dist on a temp vault holding `research/INDEX.md` (index-regen header) and `log.md` (log header). The result was 4 `schema_violations`: "missing required field title/status for type note" on each. The headers are at `src/core/index-regen.ts:102` and `src/core/log.ts:25`.
- **#34:** `src/core/healthcheck.ts:238` `pluginRegisteredHookEvents` returns `[]` without `CLAUDE_PLUGIN_ROOT`. `checkHookRegistration` (:252) runs only when `.claude/settings.json` exists, and warns for `SessionStart`, `UserPromptSubmit` and `Stop` missing from settings and from the plugin. The `--fix` path doesn't relink hooks itself. `scripts/link-skills.js` says the runtime does "settings.json hook registration with plugin/npm dedup".
  - `installed_plugins.json` on this machine: `{version: 2, plugins: {"semantic-memory@semantic-memory-marketplace": [{scope: "user", installPath: ~/.claude/plugins/cache/semantic-memory-marketplace/semantic-memory/1.30.0, version, installedAt, lastUpdated}]}}`.
- **#27:** `src/core/lint.ts:103` adds only `basename(rel)` to `knownNames`. `findBrokenLinks` (:187) takes the last path segment of the target, minus `#heading`. hewtd folder-form incidents are `incidents/<slug>/narrative.md` + `facts.md`, with frontmatter `id` (narrative) and `incident_id` (facts). This repo's `.documentation` has no `[[YYYY-MM-DD-…]]` wikilinks, so it's unaffected. The search graph (`src/core/graph.ts:70`) is basename-only too; out of scope.
- **#28:** closed 2026-11-14 as not planned. `docs/corpora-json.md` (5 mentions of `.babel-fish`) and `docs/smart-middle-activation.md` (3), last touched 2026-05-07. `package.json` `files` includes `docs`.

## Closed alongside (2026-11-14)
- #76: closed by the user (covered by #91).
- #87: closed as not planned (pool 24 is stable to limit 8; reopen to raise it).

## Eval results: Phase 2
Tests only, no ranking change. As plain `it`, the 10 bug cases fail on: inline-code and prefix/path links, non-note related entry wrapped (#36); generated INDEX.md/log.md schema errors (#35); folder slug / `id` / `incident_id` links reported broken (#27); `hook_registration` warn with a user- or project-scope installed_plugins.json entry (#34). 12 guards pass today. #34 tests stub HOME, CLAUDE_CONFIG_DIR and CLAUDE_PLUGIN_ROOT under a temp dir.

## Eval results: Phase 3
No ranking change (lint/synthesize only). #36 (4) and #27 (3) cases pass as plain `it`; #35 and #34 it.fails remain for Phase 4.

## Eval results: Phase 4

No ranking change (lint/healthcheck only). #35 (1) and #34 (2) it.fails now plain it; 11 tests pass in the two files. Generated = index-regen or log banner at file start (CRLF tolerated); such files skip schema validation and noLastVerified, broken-link checks still run. #34 also feeds checkHookDoubleRegistration (same pluginRegisteredHookEvents), which is correct for user-scope installs.
Also: test/unit/healthcheck.test.ts and healthcheck-double-hook.test.ts now stub CLAUDE_CONFIG_DIR, because the real ~/.claude installed_plugins.json made the fallback hide expected warnings.

## Eval results: Phase 5

Docs-only change (banner in docs/corpora-json.md and docs/smart-middle-activation.md); no measurements.

## Eval results: Phase 6
- `BAND=1 bash scripts/gate-release.sh 1.30.0` (fresh, no --cache): PASS. local equals 1.30.0 on every count, plain and export: hyb@1 91/139 (export 94), hyb@3 116 (115), sem@1 79 (81), multi@1/3/8 20/28/31 of 41 (export 20/28/32), cov@3 0.82, dominance 31 (export 23), negatives flagged 43/47, false flags 7, mcp vs cli 0 of 186 differ, titled #1 139/139. p95 14ms, cold idx 38.9s (1.30.0: 39.4s).
- Healthcheck by hand: `node dist/cli/index.js healthcheck` refuses here (needs ./node_modules local install; this repo is the package). Instead ran runHealthcheck (fast tier, force) from src via tsx with `env -u CLAUDE_PLUGIN_ROOT` and projectRoot = this repo: hook_registration ok "all 3 hook events registered" (found via installed_plugins.json user-scope install), hook_double_registration ok. No warning.
- `lint --notes .documentation`: 3 errors, 176 warnings over 234 files. All 3 errors are schema_violations on archive/README.md and archive/scaffold-readme.md (missing title/status), not generated INDEX.md/log.md. No schema error on any generated INDEX/log.
