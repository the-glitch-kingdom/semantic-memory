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

## Real PostToolUse payloads (Phase 2, captured 2026-11-07, Claude Code via `claude -p`, model haiku)
Captured live: a temp settings file with a PostToolUse hook (matcher `.*`) appending stdin, a `.mcp.json` running `node dist/cli/index.js --notes <notes> --read-only` (server name `semantic-docs`), and a 6-call prompt. No repo settings file touched. Redacted fixtures: `test/fixtures/usage-capture/{mcp-search_hybrid,mcp-read_note,Read,Grep,Glob,Bash}.json` (paths rewritten to `/home/user/proj/.documentation`, session/prompt/tool-use ids and transcript path replaced). Re-capture needs `--allowedTools` for the tools plus `--add-dir <notes>` (`--dangerously-skip-permissions` was refused by the auto-mode classifier).
- Common keys: `session_id, transcript_path, cwd, prompt_id, permission_mode, effort, hook_event_name, tool_name, tool_use_id, tool_input, tool_response, duration_ms`.
- **MCP tools: `tool_name` is `mcp__<server>__<tool>` (here `mcp__semantic-docs__search_hybrid`). `tool_response` is an ARRAY `[{type:"text", text:"<string>"}]`**, not a string and not `{content:[...]}`. For `search_hybrid`, `text` is the pretty-printed JSON array of `{path,title,score,confidence,snippet,decay}` (paths vault-relative); no `[stale:]` block in this capture. For `read_note`, `text` is the raw note (frontmatter + body). `tool_input`: `{query}` / `{path}` (vault-relative).
- `Read`: `tool_input {file_path}` absolute; `tool_response {type:"text", file:{filePath, content, numLines, startLine, totalLines}}`.
- `Grep`: `tool_input {pattern, path, output_mode, -n}`; `tool_response {mode, numFiles, filenames, content, numLines, totalLines}`. In `content` mode `numFiles` is 0 and `filenames` empty, so the files grepped must come from `tool_input.path`, not the response.
- `Glob`: `tool_input {pattern, path}`; `tool_response {filenames[], durationMs, numFiles, truncated, totalMatches, countIsComplete}`.
- `Bash`: `tool_input {command, description}`; `tool_response {stdout, stderr, interrupted, isImage, noOutputExpected}` (no exit code).
- Implication for Phase 3: `parseSearchResponse` must accept the array form first; the hook must not read `tool_response` of Read/Grep/Glob/Bash at all (privacy rule).
- Haiku's first attempt failed with the server connection closed when `.mcp.json` ran `dist/mcp/server.js` (a library, not an entry point); `dist/cli/index.js --notes` is the server entry.
- hewtd devDependency pinned to `^2.21.0` (lock at 2.21.0); `schemas/gaps.v1.schema.json` present.
- Phase 2: full suite had 2 known flakes (freshness-scale warm start, hook-failure Jev-hang) under load; both pass alone. Eval green; no code changed.

## Eval results: Phase 4
No retrieval-eval change (hook only); `npm run eval` green (76 passed, 5 expected fail).
Hook cost on a non-matching Bash call (`ls -la`, 20 runs, node 18-20 ms bare): usage-capture.js ~20 ms avg vs bare `node -e 0` ~18 ms, so about 2 ms over node startup (doc-search-redirect.js ~23 ms). It exits before reading .mcp.json, the log or dist/.
Not done: search `weak` flag is not recorded (optional field).

## Eval results: Phase 5
No retrieval change; `npm run eval` green (76 passed, 5 expected fail). `gaps --json` validates with Ajv2020 against hewtd 2.21.0 gaps.v1.schema.json; `signals` is stripped by `toGapsV1` (text report keeps it).

## Eval results: Phase 6
- `semantic-memory usage-set [--root] [--out]` writes `<root>/.claude/.semantic-memory/eval/usage.jsonl` via usageEvalSet; `eval` loads every *.jsonl in that dir, so no eval change was needed (cases carry `expected`, no `facets`).
- `npm run eval` unchanged: 76 passed, 5 expected fail. Full suite: 2 known flakes (freshness-scale, hook-failure Jev-hang), both pass alone.
- Not run: `eval` against a real usage.jsonl (none exists yet).

## Eval results: Phase 9 (review and validate)
Review of `git diff main...HEAD` against the plan:
- `selection` writes: none. `appendUsage` writes only KEEP-listed fields and returns false for any other type (unit-tested); the integration test asserts the raw log never contains "selection".
- Doc text / tool responses: the hook reads `tool_response` only for the MCP search tools (paths only, via `parseSearchResponse`); Read/Grep/Glob/Bash responses and grep patterns are never read. New test plants a marker in the search snippet, Read content, Grep pattern and Grep output: not in the log.
- Export: `computeGaps` and `usageEvalSet` redact again and drop queries still holding `[REDACTED]`. The redactor deliberately skips placeholder-looking values (anything containing "example", e.g. the AWS docs key `AKIAIOSFODNN7EXAMPLE`); a realistic key is redacted. Not a bug.
- Cheap exits: env, config, Bash-not-grep, Read-not-.md all run before `.mcp.json`, dist or the log. Non-matching Bash ~2 ms over node start (Phase 4).
- hewtd: no reference or spawn in `usage-log.ts` or the hook (grep test added). The only mention is a doc comment in `toGapsV1`'s header, which is a comment.
- No real bug found, so no source change. Added `test/integration/usage-capture-review.test.ts` (6 tests): rank null for a Read outside the results; search+Grep = `new doc` gap, then +Read X = `symptoms.user_phrase` with `used_doc` X; nested vaults resolve to the longest path; privacy marker + key redaction; real no-ranking-leak (selection log, `loadCitationCounts`, selection.jsonl files identical after hook events); no hewtd references.
- Audit of ticked boxes: all hold, with the recorded deviations (search `weak` flag not recorded; Read/Bash exits before the .mcp.json read; offline tarball deferred to release).
Full suite: lint, build green. `npm test` 970 passed, 5 expected fail, 1 failure (hook-failure Jev-hang budget, 3901 ms under load); passes alone (14/14). `npm run eval`: 76 passed, 5 expected fail, unchanged (identifier negatives flagged 8/8 train and 8/8 heldout, recall@24 0.998).
Tarball: `npm pack` output extracted, contains hooks/usage-capture.js and dist/core/{usage-log,telemetry}.js; `--version` 1.15.0, `gaps` and `gaps --json` on an empty root give `gaps: []` / empty v1 and exit 0; hook on a Bash `ls` exits 0 silently. The real offline tarball (`--verify`) is built at release; not run.

### #59 acceptance checks
1. Search then Read of a returned doc gives a `use` with its rank: PASS (hook test, fixtures from live payloads; rank 1 for read_note, rank 5 for Read).
2. Search then grep with no read gives a fallback and a `new doc` gap: PASS (integration test; scope "vault" only for greps inside a source).
3. No doc text or tool responses in the log, queries redacted, off switches work: PASS (marker test, `SEMANTIC_MEMORY_USAGE_CAPTURE=0`, `usage_capture: off`, `telemetry.enabled: false`, reviewer env).
4. `gaps --json` validates against hewtd 2.21.0's gaps.v1 schema, `version: 2` fails: PASS (Ajv2020, gaps-command test). `hewtd reconcile --gaps` end to end was not run.
5. The prior does not lower blind @1: NOT IN SCOPE (plan B). No ranking change here; eval identical.
6. Works with the other plugin absent: PASS (missing log gives `gaps: []`, exit 0; no hewtd reference or spawn).
Known weak spots: `computeGaps` counts every search with no `use`, including ones answered from the search snippet, so it is noisy; a Bash grep with no path assumes cwd; a plugin server whose `.mcp.json` name differs from its tool-name server is skipped; the stale-block parse is only tested with a synthetic block; the hook is tested only with fixtures, not a fresh live Claude Code run.

## Eval results: Phase 10
Docs only; code unchanged. See the eval run below in the commit message / final report.
Floors lowered for the new docs; measured: real-train hybrid @1 18 (was 21), semantic @1 19 (was 14), real-heldout hybrid false flags 1/9. See Errors Encountered in the plan.
