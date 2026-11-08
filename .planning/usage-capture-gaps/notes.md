# Notes: usage-capture-gaps

## Verification against main @ 29e74db (2026-11-08, read-only agent, file:line checked)

| #59 claim | Verdict | Evidence |
|---|---|---|
| Agents read docs with the built-in Read tool, so the server never sees a selection | True (cause). The "69 searches / 2 selections" count could not be checked here (no log on this machine) | Only `read_note` writes a `selection` (`src/mcp/tools/read.ts:18-23`). The plugin's only PostToolUse matcher is `Skill` (`hooks/hooks.json`) |
| The log only feeds a stats report, not ranking | **False** | `usage_boost` is on by default (`src/core/usage-boost.ts:29-33`, `schema-default.ts:165-168`). It counts every `selection` (`usage-boost.ts:69-76`) and gives up to 1.5x regardless of query (`context.ts:613-640`, used at `search.ts:90-92,176-180`). Also feeds the `decoys` / `decay_candidates` lint rules (`lint.ts:303,359`) |
| (doc) the usage boost counts reads that followed a search | **False** | `usage-feedback-guide.md` says so; the code ignores `correlated` and counts every `read_note` |
| Where `selection.jsonl` lives | Docs partly wrong | `deriveProjectRoot` only strips `.claude/.vault` (`session.ts:264-274`). `--notes .documentation` logs to `.documentation/.claude/.semantic-memory/`; a `--read-only` server logs to `<notes>/.semantic-sidekick-index/selection.jsonl` (`telemetry.ts:40-47`, `context.ts:662`). `mine-selection.mjs:11` reads a default path that misses it |
| No doc text is logged | True today | Search events are `{path, score, decay}` (`search.ts:17-25`); the query is redacted (broad) (`telemetry.ts:76`) |
| A switch turns logging off | True | `telemetry.enabled` (`telemetry.ts:54-64`) |
| Which searches are logged | Partial | `search_semantic` and `search_hybrid` only (`search.ts:101,194`). The search-to-read link is held in memory per server process, with a 60 s window (`telemetry.ts:20,88-99`) |
| `.claude/.semantic-memory` is gitignored | Not enforced | Only stated in docs (`schema-default.ts:179`, `hooks-reference.md`) |

## Contract: gaps.v1 (hit-em-with-the-docs#66, comment on #59 2026-11-08T02:12Z)
- `{version: 1, source, gaps: [{query (required), used_doc (path or null), suggested?, count?, last_seen?}]}`.
- hewtd owns the schema. It refuses unknown versions; additive fields keep v1.
- `used_doc` may be docs-relative, vault-relative or absolute.
- hewtd secret-scans every query and drops hits.
- What hewtd does with each gap:
  - a `used_doc` that resolves gives a `symptoms.user_phrase` proposal, capped at 5 per doc;
  - identifiers in the query that resolve in code give a new-doc candidate;
  - anything else is an open question.
- hewtd also accepts a bare array of gaps, or a hand-written list of questions.
- As of 2026-11-08 hewtd has not published `schemas/gaps.v1.schema.json`. Its `schemas/` folder holds only `graph.v1.schema.json` (commit 832de35, draft 2020-12, `version` const, no `additionalProperties: false`), and its `package.json` `files` already includes `schemas` and `docs`.
- Our devDependency on hewtd is `latest` (2.10.0 installed, no `schemas/`), so CI can't depend on its copy.

## Risks
- The MCP `tool_response` shape in PostToolUse is unverified, so Phase 2 captures real payloads first.
- Hook cost: one Node start on every Read, Grep, Glob and Bash call (the redirect hook measured about 25 ms), so the cheap exits must run first.
- Code greps after a docs search are often normal, so only fallbacks inside a vault count by default.
- `selection-stats` (server log) and `gaps` (usage log) will report different numbers. Document that rather than merging the two logs.
