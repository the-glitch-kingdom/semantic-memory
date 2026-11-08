# Notes: user-help

## Starting facts (2026-11-08)
- No help command exists today: `commands/` has contract, healthcheck, jev-mode, mode, normalize-config, policy, relink, skill-loop, status, update, vault.
- hit-em-with-the-docs ships a `/help` command (`commands/help.md` in its plugin, 2.19.0) to copy the pattern from.

## Phase 1 inventory (2026-11-08, verified against branch code)

### CLI (`src/cli/index.ts` 1253 lines; `retrieval-eval.ts`, `skill-eval.ts`, `skill-loop.ts`, `features.ts`)
Top level: `serve` (default; `--reindex --stats --wait-for-ready --read-only --model --pooling --query-prompt --workers --batch-size --no-quantized --no-watch`),
`search <query>` (`--notes` required, `--limit`, `--text-only`, `--json`; NO `--paths` yet: Phase 4), `eval-failures`, `lint` (`--rule --json --strict`),
`log-event` (`--payload`), `log-query` (`--kind --after --before --limit`), `install-schema` (`--force`), `tools [name]`, `normalize-config` (`--dry-run`),
`healthcheck` (`--fast --json --fix`), `skills` (`targets|install|uninstall|list|lint`), `migrate-state` (`--dry-run --project`), `decay-config`,
`decay-trace <notePath>`, `lexicon` (`list|compile|add`), `dossier` (`init|list`), `profile` (`init|show`), `selection-stats`, `usage-set` (`--root --out`),
`gaps` (`--root --since --include-repo-grep --json`), `eval` (`--notes --set --dir --baseline --check --band --json`; `eval generate --notes --docs --model --dir`),
`skill-eval` (`trigger|task|tune`), `skill-loop` (`on|off|status|auto|worker|review|rollback|curate|restore|verify`), `jev-mode` (`on|off|auto|status`).
Plugin-runtime commands (`update`, `policy`, `status`, `relink`) come from claude-plugin-runtime. Global flag `--notes <path>` on most.
No `help` command yet; commander `--help` stays for flags.

### MCP tools (`src/mcp/tools/inventory.ts`, 45 entries, groups search/read/write/patch/lint/log/metadata/graph/system/contract/session)
search_semantic, search_text, search_graph, search_hybrid (`mode` auto|identifier|fact|flow, `granularity`, `full`, filters), read_note, read_multiple_notes (deprecated),
list_notes, create/update/delete/move_note, apply_patch, synthesize_note, synthesize_promote, ingest_source, install_schema, verify_note, manage_lexicon/dossier/profile,
find_* (4, deprecated), lint_vault, log_event, log_query, regenerate_index, get_frontmatter, update_frontmatter, manage_tags, rename_tag (deprecated), backlinks, forwardlinks,
graph_path, graph_statistics, get_stats, reindex, regenerate_contract, inspect_contract, session_start/run/finish/status. `help` is added in Phase 3.

### Slash commands (`commands/*.md`)
contract, healthcheck, jev-mode, mode, normalize-config, policy, relink, skill-loop, status, update, vault. `help.md` is added in Phase 3.

### vault.schema.yml keys (`schema-default.ts`, documented in `configuration-reference.md` L302+)
version, provenance_fields, status_enum, confidence_enum, severity_enum, types, lint, decay (incl. `code`, `hotness_boost`, `per_type`, `missing_last_verified: git`),
path_class, results, graph, index_fields, ranking, rerank, usage_boost, tools, telemetry, federation (commented in default), embedding (pooling, query_prompt; override-only, not in default).
Phase 7 coverage test should read the zod schema in `src/core/schema.ts` as the authoritative list.

### Hooks (`hooks/hooks.json`)
SessionStart (session-start, vault-context, skill-loop), UserPromptSubmit and Stop (vault-context), PreToolUse Grep|Bash (doc-search-redirect),
PostToolUseFailure Bash|mcp (vault-context; opt-in SEMANTIC_MEMORY_FAILURE_HOOK=1), PostToolUse (usage-capture; skill-loop), SessionEnd (skill-loop). reconcile.js, jev-bridge.py also ship.
Env switches: SEMANTIC_MEMORY_{FAILURE_HOOK,DOC_SEARCH_REDIRECT,USAGE_CAPTURE,SKILL_LOOP,JEV,INJECT_MIN_SCORE,STATE_HOME,...}.

### .documentation guides (task-relevant)
operational: federation-guide, retrieval-eval-guide, retrieval-tuning-guide, search-gaps-guide, decay-guide, modes-guide, drift-detection, failure-lookup-guide, jev-mode, skill-loop, lexicon-guide, dossiers-guide, contract-guide, capture-workflows, usage-feedback-guide, session-paging-guide, state-migration, logs-and-events.
architecture: code-graph, indices-and-storage, what-gets-indexed, injection-points, mcp-internals, schema-and-provenance. legacy: embedder-guide, performance-tuning, how-it-works.
reference: cli-reference, configuration-reference, mcp-tools-reference, hooks-reference, frontmatter-spec, gaps-format, skill-format. quickstart: installation-guide, sidekick-overview. troubleshooting: troubleshooting. deployment: release-process (offline tarball: runbook in operational-runbook.md). changelog: v1-12 (embedder/pooling), v1-16 (code graph), v1-17 (section results), v1-18 (query routing), v1-19 (federation).
No dedicated doc for "add another index" beyond indices-and-storage.md + federation-guide.md; "add another index" topic = federation sources (a second docs tree) and `serve --notes`/`.mcp.json` for a separate vault.

### hit-em-with-the-docs house pattern (node_modules/@theglitchking/hit-em-with-the-docs/commands/help.md, read only)
Frontmatter: description, allowed-tools (Bash(npx:*), Read), argument-hint "[topic]". Body: "Arguments: $ARGUMENTS"; empty args = tight orientation + "What would you like to do?";
a bullet list of topic keywords (with aliases like `knowledge-base`/`kb`) each focusing the orientation; one-paragraph brief; the 5 most common workflows; command list (CLI + slash); contract summary.
Take: topic ids with aliases, empty -> grouped list, ends with a question. Our command differs by running the CLI (one source) instead of embedding prose.

### Topic list (ids; group; aliases) for `src/core/help/topics.ts`
Getting going: `getting-started` (start, install, quickstart); `healthcheck` (troubleshooting, doctor, check-install, broken); `offline-install` (offline, air-gapped, tarball); `updating` (update, upgrade, version).
Search more: `add-index` (another-index, second-vault, more-docs); `federated-search` (federation, other-repo, sibling-repos, sources); `hewtd-search` (reconcile-search, hit-em-with-the-docs; Phase 4 `search --paths`); `section-results` (sections, granularity, anchors); `query-routing` (mode, identifier, fact, flow, query-type).
Measure and improve: `eval` (measure, floors, baseline, retrieval-eval); `gaps` (unanswered, usage-set, handoff-hewtd); `embedder` (embedders, pooling, query-prompt, model); `decay` (decay-git, git-dates, stale, last-verified); `code-graph` (grounding, code, drift, entity-card).
Working modes: `modes` (vault-first, research, outage-silence, mode).
Maps to the plan's 13 required topics plus `hewtd-search` (Phase 4 item); `add-index` and `getting-started` share doc links with federation-guide and installation-guide.

## Eval results: Phase 2
No retrieval change; no eval numbers. Added test/unit/help-topics.test.ts (9 tests: unique ids/aliases, doc files exist, matching incl. the plan's six task phrases, rendering).

## Eval results: Phase 3
No retrieval code changed; `npm run eval` 132 passed, 5 expected fail. Tool surface 44 -> 45 (read-only 21). `help` is in the minimal (outage) surface via registerSystemTools.

## Eval results: Phase 4
No retrieval code changed; `npm run eval` 132 passed, 5 expected fail. New: `search --paths` (src/cli/search.ts `pathsOutput`, src/cli/index.ts), test/unit/search-paths.test.ts (replays hewtd 2.21.0 runCommand parsing).
End to end (scratch copy /tmp/claude-1000/e2e-hewtd, not this repo, hewtd 2.21.0): 3 docs, query "how do we deploy to production" shares no words with them. `hewtd reconcile --overview ... --json` with search_command `npx semantic-memory search --notes .documentation --paths {query}`: 3 members, all `via: search`; without the config: 0 members. A failing command only warns and falls back to hewtd's BM25.
Topic commands run in a temp vault: healthcheck (needs installed plugin), serve --reindex/--stats, search, search --paths, install-schema, decay-config, decay-trace, gaps (+ --json -> `hewtd reconcile --gaps`: 0 proposals, accepted), usage-set, eval generate (real claude call, $0.039), eval, eval --baseline, eval --check (rc 0 after baseline, 1 before). Code refs verified on `search runSearch` in this repo. Slash commands only checked to exist in commands/. Pseudo-calls (search_hybrid {...}, <hf-model-id>, <notePath>) not runnable; Phase 7 drift test must skip them.
