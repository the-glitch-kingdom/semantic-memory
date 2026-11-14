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
