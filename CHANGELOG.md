# Changelog

All notable changes to semantic-memory (formerly semantic-sidekick) will be documented here.

## [1.6.1] - 2026-10-24 — Release audit fixes (1.5.2 → 1.6.0)

A full validation of 1.5.2, 1.5.3 and 1.6.0 through the published packages and real entry points (fresh install, plugin update, upgrade from 1.5.1 state, a stdio MCP server, the read-only docs server, the live watcher, the hooks as real processes, the offline tarball) found six defects. Each has a regression test.

### Fixed

- **A note with invalid frontmatter was indexed with its YAML block as a heading after the first parse.** gray-matter caches parses by content when called without options, including a parse that threw, which then comes back unparsed and without an error. The 1.5.2 body-only fallback therefore only held for the first parse in a process; the startup cache load plus rebuild, the watcher and `reindex` all parse again. The same cache made `update_frontmatter` on such a note throw once and then **write a second frontmatter block** on retry, and shared one mutable `data` object between callers, so one update's edits showed up in the next parse of identical content. `src/core/matter.ts` bypasses the cache and every caller uses it.
- **Frontmatter `api_key: <value>` was written unmasked.** `redactDeep` checked each value without its key, and a bare random value has no context for the secret-named rule. Object fields are now checked as `key=value`. Values under other keys are unchanged.
- **`manage_lexicon add` now reports its redaction count** (`redacted`), like every other write tool.
- **A search made while the cache was still loading said "Index not built. Run reindex first."** It now says indexing is in progress. That advice was never right: with no vector index, the server is always loading or building one.
- **`--read-only` servers no longer expose `log_event`**, which appended to `log.md` in a folder another tool owns. The read-only surface is 20 tools. Hooks log through the CLI to the writable vault and are unaffected.
- **A filtered `lint_vault({checks: [...]})` reported the error and warning counts of the full lint**, for example 16 errors next to 2 secrets findings. Counts now match the returned findings.

### Verified, unchanged

- The v1.6 failure eval re-runs to the same numbers (32/38 ranked first). The golden eval holds (recall@1 86%, MRR 0.929). 544 tests pass.
- `npm audit --omit=dev`: only zod, whose fix is zod 4 (see 1.5.2).

## [1.6.0] - 2026-10-24 — Failure-time fact lookup (opt-in) and the failure eval

Issue #29's proposal: surface the right knowledge-base fact when a tool call fails, with the injection threshold *measured* rather than guessed. It was measured — and fell short of the 95%-precision bar — so the hook ships **off by default**.

### Added

- **`PostToolUseFailure` hook (opt-in: `SEMANTIC_MEMORY_FAILURE_HOOK=1`).** On a failed Bash or MCP call it searches every `semantic-*` notes path with a normalized query and injects the first knowledge-base fact (`facts/*.md`) scoring ≥ 0.50 (`SEMANTIC_MEMORY_FAILURE_MIN_SCORE`) as a `<vault-fact source="tool-failure">` block — one fact, at most once per session, snippet redacted. Skips interrupts, user denials, other tools and outage-silence mode. When off it exits before any lookup (~30 ms); when on ~0.6 s. Issue #29's `pkill -f` / exit-144 fact is found from the raw failure (score 0.77).
- **`semantic-memory eval-failures --cases --judgments [--query raw|normalized]`** — replays failed tool calls through the hook's search and reports how often the right fact ranks first, precision and coverage per score threshold, the lowest threshold that holds a target precision, and the unlabelled top hits to judge next (`--unjudged-out`, `--hits-out`). Generic JSONL inputs; metrics in `src/core/failure-eval.ts`.
- **`failureQuery(error, command)`** (`src/core/failure-query.ts`) — keeps the error lines, error class, exit code and program/subcommand; strips paths (to basename), ids, timestamps, hex, URLs (to host), long numbers, stack frames and ANSI.
- `scripts/eval-failures/` — build a local labelled set from jev-loop failure logs and each repo's fact commit history (`build-set.mjs`), pack unjudged hits for judging (`judge-pack.mjs`), and turn judgments into eval inputs (`make-cases.mjs`). The data stays under `~/.semantic-memory/eval/`; it is never committed.

### Measured (553 real failures across 14 repos, 1,214 judged pairs)

- Normalizing the failure is the big win: the right fact ranked first for 32 of 38 failures with a known answer, vs 19 with the raw text.
- Blending in keyword matches made ranking worse at every weight; not shipped.
- No setting reached 95% precision: ~95% of failures have no relevant doc, and similarity barely separates "the answer" from "same topic". Best useful point: facts only, score ≥ 0.50 → ~61% of injections on target, firing on ~3.6% of failures.
- `symptoms:` works: a prose fact scored 0.44 for its own error (not injected) and 0.75 with `symptoms: ["Exit code 144"]` (injected). None of the 341 facts measured had one — writing them is the main lever.

### Changed

- `src/cli/search.ts`: `openSearch()` loads a corpus once and searches it many times (same scoring as before); `runSearch()` is a one-shot wrapper. New standalone build entry `dist/core/failure-query.js` for the hook.

### Deferred

- Paging facts back in after compaction (`SessionStart` with `source: "compact"`): no data to measure it yet.

## [1.5.3] - 2026-10-24 — Secret redaction

Patch release. Until now nothing stopped an API key, token or password that passed through the plugin from being written to disk in the clear — and vault notes are usually committed to git. Every write point now masks secrets first, and `lint_vault` can find the ones already there.

### Security

- **Redaction at every write point** (`src/core/redact.ts`), two layers: the exact values of secret-named env vars on the machine (process env + `~/.claude/settings.json` `env`), then patterns — PEM private keys, `user:pass@` URL credentials, `Bearer`/`Basic` headers, secret-named `name=value` / `name: value` / JSON pairs, `--token VALUE` flags, vendor key prefixes (`sk-`/`pk-`/`rk-`, `ghp_`, `github_pat_`, `glpat-`, `xox*-`, `GOCSPX-`, `hvs.`, `AKIA`/`ASIA`, `AIza`, `whsec_`, `re_`, `hf_`, `npm_`), JWTs.
  - **Notes** (create/update, `apply_patch`, synthesize, ingest, promote, `update_frontmatter`, dossiers, speaker profile, lexicon aliases, `log.md`) use a *precise* set tuned so ordinary content survives: commit SHAs, UUIDs, hashes, paths, `pk_customer_orders`, `max_tokens`, `monkey: …`, code such as `api_key = os.getenv` (a name=value only counts when the value looks random: a digit, or 16+ letters) and placeholders (`<your-key>`, `${API_TOKEN}`, `process.env.X`, `changeme`, `xxxx`) are untouched. `update_note` redacts only the incoming text.
  - **Logs and state** (search queries in `selection.jsonl`, `session.json` task / `session_run` command and output tail, the hook's capture-pending excerpt) also mask long base64 and letter-and-digit tokens.
  - The hook imports the redactor from `dist/core/redact.js`; if it cannot load, the capture excerpt is withheld rather than stored raw.
  - Tool results say how many secrets were redacted (`… (2 secrets redacted)`, or `redacted: N` in JSON results), never which.
- **`lint_vault({ checks: ["secrets"] })`** — opt-in check that reports notes already containing a secret: path, line and kind, never the value; nothing is rewritten. A secret that was ever committed must be **rotated**: redaction cannot remove it from git history.
- Known limit: a secret written as plain prose ("the password is hunter2") is not caught.

### Changed

- `NoteCrud.create()` returns `{ path, redacted }` instead of the path string; `NoteCrud.update()` returns the same shape (was `void`). Only affects code using `@theglitchking/semantic-memory` as a library.

### Tests

- Full suite **516 green** (440 in 1.5.2). One integration test per write point through the real MCP tools (all fail without the change), a sweep of the whole vault for the fake values, false-positive cases for ordinary note content, linear-time checks on 1 MB pathological inputs.

## [1.5.2] - 2026-10-24 — Docs index freshness (issue #29)

Patch release. In the standard two-server setup (`semantic-vault` → `.claude/.vault`, `semantic-sidekick` → `.documentation --read-only`) the docs index went stale after it was first built and the hooks never searched the docs. Fixes for every cause found, plus the dependency audit.

### Fixed

- **Stale cached index is rebuilt at startup.** A cache whose `meta.totalChunks` no longer matches the notes on disk loaded as `"stale"` and was served forever; startup only reindexed when the cache failed to load. It now rebuilds in the background and serves the stale index meanwhile.
- **File watcher works under chokidar 5.** `watch("**/*.md")` is a literal path since chokidar 4 dropped globs, so no event ever fired and edits during a session were never reindexed. The watcher now watches the notes folder and filters (`node_modules`, `.semantic-sidekick-index`, `.git`, non-markdown).
- **One bad doc no longer fails the whole index.** `indexAll()` rejected if any file failed, so a single doc with invalid YAML frontmatter (e.g. an unquoted colon in `purpose:`) left the entire corpus unindexed. Invalid frontmatter now indexes the body with empty frontmatter; any other per-file error skips that file. Both are reported on stderr.
- **Hooks search every `semantic-*` notes path.** The prompt hook and the SessionStart search used only the first `.mcp.json` entry, normally an (often empty) vault. They now search every entry's `--notes` path in parallel and merge hits by score; with more than one corpus each hit is labelled with its server. Writes (log events, dossiers, session digests, speaker profile) stay on one path: the first entry without `--read-only`. `SIDEKICK_VAULT_PATH` still means a single path. Hook latency on a two-server project: ~670 ms → ~800 ms.
- **Capture prompts stay in their own session.** `capture-pending.json` is per project, so a cue typed in one session showed up in another concurrent session's Stop prompt, and any SessionStart or Stop wiped every session's items. Items now carry `session_id`; each session asks about and clears only its own. Items from before 1.5.2 go to whichever session reads them first; other sessions' items older than a week are pruned.
- **Watcher tests can fail again.** They treated their own timeout as "filesystem events not available" and passed while the watcher was dead.

### Changed

- **Dependency audit:** 30 findings (1 critical, 19 high; 22 in production) → 3 (1 in production). `overrides` re-pinned to current patches (several 1.5.1 pins had become the vulnerable versions); in-range updates including `@modelcontextprotocol/sdk` 1.32.2, `@huggingface/transformers` 4.3.1, `onnxruntime-node` 1.30.0, `vitest` 4.1.12. Still open, breaking-only fixes: `zod` (every 3.x is affected; the fix is zod 4, which changes the MCP tool schemas) and dev-only `esbuild` (low).

### Tests

- Full suite **440 green** (was 418); build and lint clean; golden retrieval eval unchanged (recall@1 86%, MRR 0.929). Each fix has a test that fails on 1.5.1.

## [1.5.1] - 2026-07-12 — Dependency audit hardening (supply chain)

Patch release: clears the transitive `npm audit` findings surfaced after upgrading from the 1.2.x line, with **no runtime or API change**. Every advisory was unreachable in practice — this is a local **stdio** MCP server plus hook scripts processing the user's **own** files: the `hono`/`express-rate-limit`/`ip-address`/`qs`/`fast-uri` cluster is the MCP SDK's HTTP-server transport, which this plugin never instantiates (stdio only); `protobufjs`/`@xmldom/xmldom` are the local embedding runtime; `js-yaml`/`brace-expansion` parse your own notes/globs.

### Changed

- **`overrides` block pins patched, SAME-MAJOR transitive versions** — `protobufjs 7.6.5`, `@protobufjs/utf8 1.1.2`, `@xmldom/xmldom 0.9.10`, `brace-expansion 5.0.7`, `qs 6.15.3`, `ip-address 10.2.0`, `express-rate-limit 8.5.2`, `hono 4.12.29`, `@hono/node-server 1.19.14`. No breaking bumps. `js-yaml` (3.15.0) and `fast-uri` (3.1.3) resolve to their patched in-range versions on a fresh install — no override needed.
- **Result: `npm audit --omit=dev` (the production tree consumers install) = 0 vulnerabilities.** The one remaining full-audit item (`esbuild`, low) is a dev-only tsup/vitest tool whose advisory is a *Windows dev server* file-read — it never ships in the package (`files` excludes it) and never runs in a consumer.

### Notes for consumers

npm ignores a **dependency's** `overrides` in downstream installs — only the *root* project's overrides apply. So a project that gates CI on `npm audit` after installing this plugin should either run `npm audit fix` (all fixes are in-range, non-breaking, no `--force`) or mirror the `overrides` block above. `js-yaml` and `fast-uri` are deliberately **not** force-bumped to their next majors: doing so breaks `gray-matter` frontmatter parsing and `ajv`/MCP tool-input validation (empirically — forcing the majors failed 76 tests), and the DoS vectors require attacker-controlled input this plugin never accepts.

### Tests

- Full suite **418 green** with the pinned overrides; `npm run build` clean; production audit 0.

## [1.5.0] - 2026-07-11 — Expert-character layer (v1.5.0: Phases 8–11)

Where v1.4.0 taught the plugin *how this human talks about the system*, v1.5.0 gives it the other two traits of a resident expert: it organizes memory by **component** (not by file) and **learns from its own usage**. Tool surface 42 → 44 (`manage_dossier`, `manage_profile`; read-only unchanged at 21). Additive throughout; `usage_boost.enabled: false` reproduces byte-identical pre-v1.5 ranking.

### Added

- **Entity dossiers** (`src/core/dossier.ts`, **`manage_dossier`**). Per-component living notes at `<vault>/dossiers/<slug>.md` (`dossier` note type) with fixed sections — Purpose / Failure modes / Knobs & commands / Incident log / Current state. Knowledge accretes **in place** (incidents append, current-state is revised; never a new note per event). `manage_dossier` actions: `init | append_incident | set_state | get | list`. CLI: `semantic-memory dossier init <entity> [--alias …] [--seeded-from …]` / `dossier list`. Dossier `aliases:` fold into the lexicon compiler so Tier-1 expansion routes to them.
- **Two-hop retrieval** (`resolveDossierForPrompt` + `formatDossierHead` in `vault-context.js`). When an utterance names a tracked entity/alias, the dossier head (Purpose + Current state + a read-the-Incident-log pointer) is injected **first**, ahead of semantic hits — utterance → entity → dossier. Finally makes the graph load-bearing at query time.
- **Usage-feedback ranking** (`src/core/usage-boost.ts`, `applyUsageBoost`). Consumes the v1.3.1 selection log: repeatedly-cited notes earn a bounded boost `min(cap, 1 + citations·per_citation)` (default `cap: 1.5`, `per_citation: 0.1`, `usage_boost` block in `vault.schema.yml`), composed **multiplicatively** with decay + path-class + `load_priority` at the shared `context.ts` rank site. TTL-cached (15s) citation snapshot; boosted results carry a `usage: {citations, multiplier}` block. The cap stops a feedback runaway.
- **Decoys lint** (`findDecoys`, `lint_vault({checks:["decoys"]})`). Notes retrieved 3+ times but never cited are **surfaced for review, never auto-down-ranked** — down-rank on evidence, never on ambiguous inference (decision Q5).
- **Session paging.** Stop: the session-close prompt drafts a durable digest (decisions / resolutions / task-state) via `synthesize_note` as a reviewable **proposal** (`proposal_subdir: "sessions"`), graduated by `synthesize_promote` (decision Q10). SessionStart: `buildSessionStartDigest` pages in a curated block (active task + last session digest + dossier current-states + mode) instead of a broad whole-vault sweep when there's durable state; falls back otherwise.
- **Speaker profile** (`src/core/profile.ts`, **`manage_profile`**). `profile` note type at `<vault>/profile/speaker.md` (evergreen), fixed sections — Severity calibration / Chronic omissions / Verbosity preference / Shorthand & terms. Injected at SessionStart (`<vault-speaker-profile>`, capped, silent until filled). `manage_profile` actions: `init | get | update_section`. CLI: `profile init|show`. Updated via a correction cue ("when I say X I mean Y") folded into the existing capture-cue machinery, routed to `manage_profile` rather than `synthesize_note`. One human, one profile.

### Decisions (locked at kickoff, 2026-07-11)

Q5 — decoys stay lint-only. Q9 — conditional tool registration stays default OFF (`tools/list_changed` reliability unverified). Q10 — session digest is an automatic draft filed as a proposal. Q11 — learned aliases stay propose-and-confirm regardless of `evidence_count`.

### Tests

- New: `dossier`, `two-hop-dossier`, `usage-boost`, `lint-decoys`, `profile` unit suites; `dossier-mcp`, `usage-boost-ranking`, `profile-mcp` integration; `phase10/session-paging`, `phase11/speaker-profile` hook suites. Regression shape snapshots made citation-independent.
- Tool counts 42 → 44 (read-only unchanged at 21). Golden eval: zero regression (recall@1=86% recall@3/@5=100% MRR=0.929). **418 tests green; fresh-install smoke PASS.**

## [1.4.0] - 2026-07-10 — Resident-expert bridge (v1.4.0: Phases 1–7)

The human→LLM bridge arc: learn how *this human* talks about the system, map that phrasing to concrete artifacts, and pay down the plugin's own token overhead. Tool surface 41 → 42 (`manage_lexicon`). Additive throughout; default ranking behavior is unchanged except for the new archive down-weight (opt-out).

### Added

- **Golden retrieval eval harness** (`test/retrieval-eval/`, `npm run eval`). Pure metrics engine (recall@k, MRR, per case-class) + a class-tagged golden set driven through the real `search_semantic` stack. The measurement foundation — every ranking/expansion change now shows a delta. Baseline captured at recall@1=86%, MRR=0.929.
- **Path-class ranking** (`src/core/path-class.ts`). `archive/**` → 0.3× down-weight (configurable via `path_class` in `vault.schema.yml`), composed multiplicatively with decay + `load_priority` at the same rank site. Directly fixes retired-doc copies dominating results.
- **Injection hygiene** in `formatContextBlock` (the `<vault-context>` render point): score-gates weak prompts (`SEMANTIC_MEMORY_INJECT_MIN_SCORE`, default 0.35), dedupes archive twins by basename, caps at top-3, and shrinks the instructions from ~150 to ~45 words — cutting per-prompt token overhead at the source while preserving the cite-or-deflect scoping.
- **Lexicon corpus** — learned human→artifact aliases. `alias` note type under `<vault>/lexicon/`, a derived `lexicon-cache.json`, and **`manage_lexicon`** (`action: add|lookup|list|remove|compile`, one tool). CLI: `semantic-memory lexicon list|compile|add`. Repeat observations bump `evidence_count` + confidence.
- **Alias capture loop** — propose-and-confirm: a `vault-first` skill instruction offers a `manage_lexicon add` when the LLM resolves the user's vague phrasing to a concrete artifact (never auto-adds). Conflict detection via opt-in `lint_vault({checks:["alias_conflicts"]})` (a phrase mapping to >1 target is surfaced, never auto-resolved).
- **Verbatim symptom capture + symptom-keyed indexing.** `synthesize_note` gains a `symptoms` param → `symptoms:` frontmatter; the indexer adds each verbatim symptom phrase as its own chunk pointing at the note (synthetic child chunks, no index-format change). A note surfaces on a terse symptom query even when its prose never uses those words — the asymmetric-retrieval fix.
- **Query expansion (two tiers).** Tier 1 (deterministic, in `vault-context.js`): `expandQueryViaLexicon` appends alias canonical targets to a user utterance before embedding. Tier 2 (LLM-side): a `vault-first` instruction to rewrite a terse utterance with conversation context and re-search once before concluding "not in vault".
- **Token-frugal tool surface.** `read_note` gains a `section` param (return one heading's section, not the whole file). Conditional tool registration (`tools.conditional` in `vault.schema.yml`, **default OFF** per the risk of mid-session mode switches): when enabled, outage-silence mode registers only the core search/read surface.

### Deferred within the arc (documented)

Near-duplicate collapse at index time (injection-layer basename dedup covers the observed case), rolling-topic query expansion (`topic.json` — start dumb, KQ7), and compact-search-output as the default shape. v1.5.0 (dossiers, usage-feedback ranking, session paging, speaker profile) is the next arc.

### Tests

- New unit suites: eval-metrics, path-class, injection-hygiene, lexicon, lint-alias-conflicts, query-expansion, section, tools-config. New integration: symptom-keyed retrieval, archive down-weight, section reads, conditional registration. Golden eval wired into `npm run eval`.
- Tool-surface + output snapshots updated additively (manage_lexicon; alias_conflicts enum/byRule; read_note `section` + synthesize_note `symptoms` params). Tool counts 41 → 42 (read-only unchanged at 21). **371 tests green; fresh-install smoke PASS.**

## [1.3.2] - 2026-07-10 — Fix hook double-registration (double vault-context injection)

### Fixed

- **`vault-context.js` no longer fires twice per prompt.** On a plugin install the plugin's own `hooks/hooks.json` registers SessionStart/UserPromptSubmit/Stop — but this repo's committed `.claude/settings.json` *also* registered the same three events (legacy dogfooding scaffolding from the Phase 2 era, before the plugin was marketplace-installable). With the plugin enabled, both sources fired, so `vault-context.js` ran twice and the `<vault-context>` block was injected **twice on every prompt** (~1.5k tokens of duplicated overhead per turn). Removed the redundant `hooks` block from `.claude/settings.json`; the plugin's `hooks/hooks.json` is now the single source of truth.

### Added

- **`hook_double_registration` healthcheck finding** (fast tier). Detects the same hook event declared in BOTH `.claude/settings.json` and the plugin's `hooks/hooks.json` and warns that each hook fires twice, pointing at the fix. Only fires in a plugin context (`CLAUDE_PLUGIN_ROOT` present); a silent no-op for npm-dependency installs, which legitimately register via `settings.json`. This is the durable guard so the double-injection can't silently recur on any install — the item flagged as v1.4 Phase 0.

### Tests

- New: `test/unit/healthcheck-double-hook.test.ts` (warns on overlap; no-op without `CLAUDE_PLUGIN_ROOT`; no warn on disjoint events). 331 tests green.

## [1.3.1] - 2026-07-10 — Selection-logging telemetry (the v1.4 precursor)

Ships the two pieces deferred out of v1.3.0 so retrieval can learn from its own outcomes. v1.3.1 only **observes** — there is no ranking change (usage-feedback ranking is v1.4). Strictly local, append-only, opt-out.

### Added

- **Selection logging** (`src/core/telemetry.ts`) → `.claude/.semantic-memory/selection.jsonl` (local, append-only JSONL, gitignored, never leaves the machine). Two event kinds: a `search` event (`{tool, query, results:[{path, score, decay?}]}`) logged by `search_semantic`/`search_hybrid` — reusing the decay multiplier already computed — and a `selection` event (`{note_path, via, correlated}`) logged by `read_note`. `correlated: true` marks a read that followed a search which returned that path (best-effort, 60s in-process window). Awaited so the signal is durable; `appendEvent` never throws and respects the opt-out, so it can never fail the tool. Config: `telemetry.enabled` in `vault.schema.yml` (default true; `false` disables all logging). **No network** — enforced by a unit test that greps the module.
- **`lint_vault({checks:["decay_candidates"]})`** — new opt-in lint rule. Cross-references the selection log (notes that appeared in recent search results) against each note's current decay multiplier, and flags notes retrieved frequently but decayed to ≤0.5 ("retrieved N× recently but decayed to M — verify_note or revise"), sorted most-retrieved first. Index-free (no embedder); a silent no-op when there's no selection log. Never in the default report, same as `code_symbols`.
- **`semantic-memory selection-stats --notes <path>`** — CLI rollup of the log: searches, selections, most-cited notes, and retrieved-but-never-cited notes (`--json` for raw).

### Fixed

- **`regenerate_contract` no longer hardcodes the contract version** (`src/mcp/tools/contract.ts` had `pluginVersion: "1.1.0"` frozen, so AGENTS.md was stamped 1.1.0 on every regeneration — the same class of freeze bug as the `plugin.json` fix in 1.2.2). Now resolves the real version by walking up from the module's runtime location to the package's own `package.json` (matched by name), robust to tsup bundling/splitting. (Landed on main ahead of this release; AGENTS.md was regenerated to 1.3.0.)

### Deferred (still, to v1.4+)

- Backlink hotness (wired but flag-off) and the **usage-feedback ranking** that consumes this log — the latter is v1.4 Phase 9. v1.3.1 deliberately produces the signal without acting on it, so the log can accumulate real data before ranking tunes against it.

### Tests

- New: `test/unit/telemetry.test.ts` (append/read, opt-out, fire-and-forget-never-throws, correlation window, stats rollup, no-network grep); `test/unit/lint-decay-candidates.test.ts` (flags retrieved-but-decayed, spares fresh, opt-in gating, no-log no-op).
- Extended: `test/integration/mcp-server.test.ts` (search→read lands both events; the selection is `correlated`).
- Updated: tool-surface + tool-output regression snapshots (additive `decay_candidates` enum value + byRule key). 328 tests green.

## [1.3.0] - 2026-07-10 — Confidence decay: age-aware retrieval ranking

Replaces age-blind ranking with smooth, type-aware confidence decay. Notes age out of relevance gracefully; explicitly-verified notes reset the clock; agents see decay state and can re-verify. Opt-out via one config line.

### Added

- **Decay engine (`src/core/decay.ts`).** Pure, side-effect-free: `multiplier = 0.5^(age_days / half_life)`, keyed on time since `last_verified`. Per-type half-life (`decision`/`note` 365d, `gotcha` 180d, `source` never, `proposal` 14d), floored at 0.1 (notes down-weight, never disappear). Fails open (multiplier 1.0) on any uncertainty — disabled config, missing/invalid/**future** `last_verified` — so decay can only down-rank a note we're confident is old.
- **Decay applied at search time.** `search_semantic` and `search_hybrid` multiply decay into the score after the existing `load_priority` boost (composes, never replaces). `search_text` (exact-match intent) and `search_graph` (graph distance is the signal) are deliberately unaffected.
- **`decay` block surfaced in results.** Decayed results (multiplier < 1) carry `{ multiplier, age_days, effective_half_life, reason }`; fresh results stay clean.
- **`verify_note` MCP tool** (tool count 40 → 41). Stamps `last_verified` to today WITHOUT touching content or any other field, logs a `verify` event, and returns the note's new decay multiplier. The explicit clock-reset.
- **`evergreen` frontmatter.** `evergreen: true` pins a note at multiplier 1.0 while its `last_verified` is within 365 days; past that it decays normally (the evergreen claim itself expires, forcing periodic re-affirmation).
- **CLI introspection.** `semantic-memory decay-config --notes <path>` prints the active config (defaults vs. `vault.schema.yml` override); `semantic-memory decay-trace <note> --notes <path>` prints the full calculation for one note.
- **Config in `vault.schema.yml`.** A documented `decay:` block ships in the default schema. `decay.enabled: false` restores byte-identical pre-v1.3 ranking.

### Fixed

- **Unquoted-date frontmatter no longer silently disables decay.** YAML parses `last_verified: 2019-01-01` (unquoted) into a `Date`, not a string, so a naive `typeof === "string"` check dropped it and every such note read as "no last_verified (fail open)". New `normalizeVerifiedDate()` coerces string **or** Date at all read sites (search, `verify_note`, `decay-trace`). Caught by the `decay-trace` smoke test during development.

### Semantics note: `last_verified` vs. edits

Decay keys on `last_verified`, which is stamped only at note creation (`synthesize_note`, `ingest_source`) and by `verify_note` — **no edit path bumps it**. So ordinary edits do not reset the decay clock, which is the intended v1.3 correctness property. The separate `last_modified` frontmatter field from the original plan (Phase 2) is therefore not required for correct decay and is deferred; it can be added later for edit-recency use cases without affecting decay.

### Deliberately deferred (documented, not dropped)

- **Backlink hotness boost (Phase 7)** — the engine supports it (`hotness_boost` config), but it ships **flag-off by default**; hub notes (index.md) distort the signal, so it must be earned via telemetry before defaulting on.
- **`decay_candidates` lint (Phase 8)** and **selection-logging telemetry (Phase 10)** — both need query-log history / weeks of passive collection to be meaningful, and telemetry is the dependency for the v1.4 usage-feedback ranking. Staged as a v1.3.x follow-up.

### Tests

- New: `test/unit/decay.test.ts` (12 cases — half-life curve, floor, per-type, never-decay, fail-open, evergreen + expiry, hotness, Date-normalization regression).
- Extended: `test/integration/mcp-server.test.ts` (verify_note round-trip; `search_semantic` attaches a `decay` block to an old-`last_verified` note).
- Updated: tool-surface regression snapshots (additive `verify_note` tool + decay-aware search descriptions); tool-count assertions 40 → 41 (read-only mode unchanged at 21 — `verify_note` is write-gated).

## [1.2.3] - 2026-07-10 — Complete the v1.2 hygiene line: `--fix`, code-symbol drift, CI smoke

Ships the three v1.2 roadmap items that slipped when 1.2.1/1.2.2 were preempted by defect fixes. All three are additive; no tool is removed and default behavior is unchanged unless a flag is passed.

### Added

- **`healthcheck --fix` — auto-remediation of safe drift.** `/healthcheck --fix` (and the `semantic-memory healthcheck --fix` CLI) now applies **safe, idempotent, non-destructive** fixes for fixable findings and re-runs drift detection to show the post-fix state. Actions: re-link skills (`skill-link`), reconcile `.mcp.json` (`mcp-reconcile`), reindex the vault (`reindex`), and migrate legacy state (`state-migrate`). Findings that touch user-authored content — stale notes, broken wikilinks, hand-edited `AGENTS.md` — are reported for human review, never auto-changed. The decision logic lives in a pure, unit-tested planner (`src/core/healthcheck-fix.ts`); the CLI executes the plan. The `legacy_state_files` finding's `fixable_via` changed from `none` to `state-migrate`.
- **`lint_vault({checks: ["code_symbols"]})` — code-path drift detection.** New opt-in lint rule: scans note inline-code spans for repo-relative file-path references and flags ones whose first segment IS a real directory in the repo but whose full path no longer exists (a stale reference to a moved/deleted file). Anchoring on an existing first segment keeps false positives low — paths belonging to other repos are skipped. Fails open (silent no-op) outside a code repo. **Opt-in only:** never part of the default `lint_vault` report or the healthcheck slow tier, so existing behavior is byte-stable. Scope note: this validates *path* references; fine-grained symbol-name checking needs a real symbol index and is deferred to the v1.4 lexicon arc, which will extend this same `code_symbols` rule.
- **Fresh-install CI smoke test.** New `scripts/smoke-install.sh` + `.github/workflows/ci.yml` `smoke` job: `npm pack` → install the tarball into a throwaway consumer project → assert (1) `bin --version` reports the current version, (2) the CLI loads all subcommands, (3) every runtime file is actually in the tarball, and (4) the SessionStart `reconcile` wiring populates `.mcp.json` on a fresh install. This mechanically prevents the v1.1.0-class packaging bug (the highest-ROI item on the v1.2 roadmap).

### Fixed

- **Drift detection now runs on healthy installs.** The `healthcheck` CLI command called `process.exit(0)` immediately after the install smoke-test succeeded, so the drift-detection `postAction` hook (added in v1.1) never ran on a clean install — it only surfaced when the smoke-test failed. The command is now a single coherent action: smoke-test → drift → optional `--fix` → emit, exiting once at the end. The `formatDriftBanner` line advertising `/healthcheck --fix` is no longer a promise for a flag that doesn't exist.

### Tests

- New: `test/unit/healthcheck-fix.test.ts` (planner: safe-action mapping, human-review routing, ok-finding filtering).
- New: `test/unit/lint-code-symbols.test.ts` (drift on a stale path, no-flag on an existing path, other-repo skip, URL/glob rejection, opt-in gating, fail-open outside a code repo).
- Updated: tool-surface regression snapshots (additive `code_symbols` enum value + description on `lint_vault`).

## [1.2.2] - 2026-06-27 — Plugin-aware hook-registration check + manifest version sync

### Fixed

- **`hook_registration` drift no longer false-positives on plugin-style installs.** The check (both the SessionStart fast path in `hooks/vault-context.js` and the CLI `checkHookRegistration` in `src/core/healthcheck.ts`) only inspected the project's `.claude/settings.json`. When semantic-memory is installed as a Claude Code plugin, its SessionStart/UserPromptSubmit/Stop hooks live in the plugin's own `hooks/hooks.json` (resolved via `CLAUDE_PLUGIN_ROOT`) and fire correctly, so the check warned about "missing" hooks that were in fact registered. Both sites now treat events declared in the plugin's `hooks/hooks.json` as registered. Npm-dependency installs (no `CLAUDE_PLUGIN_ROOT`) are unaffected and still require the hooks in `settings.json`.
- **Plugin manifest version sync.** `.claude-plugin/plugin.json` was frozen at `1.0.1` while `package.json`, git tags, and `marketplace.json` advanced — Claude Code reads the plugin version from `plugin.json`, so `claude plugin update` always reported "already at latest (1.0.1)" and never pulled newer code. Bumped `plugin.json` to match, and corrected its stale `homepage`/`repository` URLs (they pointed at the old `semantic-sidekick` repo).

## [1.2.1] - 2026-06-11 — Capture-cue false-positive fixes

Fixes two classes of false positives in the Stop-hook capture nudge (`hooks/vault-context.js`), where the cue scanner over-fired and asked to synthesize moments that carried no new knowledge.

### Fixed

- **Conversational "gotcha" no longer fires the cue.** The `gotcha` cue was a bare-word match (`\bgotcha\b`), so filler acknowledgments like "Gotcha, ok…" tripped it. It now requires noun-context (`a/the gotcha`, `gotcha:`, `gotchas`, `gotcha is/was/here/with`). `workaround`/`hack` are unchanged.
- **Quoted machinery no longer re-primes the cue.** Cue detection ran over the entire raw prompt, so pasting tool output back — especially this hook's own `<vault-capture-prompt>` block, which contains the words "gotcha"/"workaround"/"hack" and the cue regexes themselves — re-primed `capture-pending` in a self-referential loop. New `stripQuotedMachinery()` removes self-emitted `<vault-*>` blocks, fenced code, and inline-code spans before matching, so only the user's own prose is scanned.

### Tests

- Extended `test/phase4/mode-hook.test.ts` with four regression cases: conversational "gotcha" does not prime; noun-context "the gotcha is…" does; pasting a `<vault-capture-prompt>` block does not re-prime; and a real cue alongside fenced machinery still primes (the strip is surgical, not total).

## [1.2.0] - 2026-05-09 — State consolidation under .claude/.semantic-memory/

Consolidates every transient state file under one namespace. Renames the legacy `.sidekick-*` files to drop the obsolete prefix. All legacy paths remain readable through v1.x via fallback; v2.0 will remove the fallback.

### Changed (state file paths)

The three v1.1-era state files in `hooks/vault-context.js` move:

| Old path | New path |
|---|---|
| `.claude/.sidekick-mode` | `.claude/.semantic-memory/mode` |
| `.claude/.sidekick-fingerprints.json` | `.claude/.semantic-memory/fingerprints.json` |
| `.claude/.sidekick-capture-pending.json` | `.claude/.semantic-memory/capture-pending.json` |

Reads check the new path first; if absent, fall back to the old path. Writes always go to the new path. The `bin/semantic-memory migrate-state` command does the explicit move for users who want the legacy files cleaned up immediately.

`session.json` and `healthcheck-cache.json` were already correctly placed under `.claude/.semantic-memory/` since v1.1 — no change.

### Added

- **`bin/semantic-memory migrate-state`** — one-shot CLI command that atomically moves the three legacy state files. Idempotent. `--dry-run` previews; `--force` resolves conflicts (when both old and new exist) by preferring the new path and deleting the old.
- **`legacy_state_files` healthcheck finding** — fast-tier check that detects legacy `.sidekick-*` files and surfaces a `warn` with a pointer to `migrate-state`. Pure read-only detection; never auto-migrates.

### Backwards compatibility

Three statements that remain true after v1.2.0 ships:

1. **All legacy paths continue to be readable through v1.x.** Users who never run `migrate-state` see no behavioral change.
2. **No state files are silently moved or deleted.** Migration is opt-in via `bin/semantic-memory migrate-state`; healthcheck only warns.
3. **v2.0 will remove the legacy-path read fallback** — committed in this CHANGELOG entry. Users have all of v1.x to migrate. Storage paths (`.semantic-sidekick-index/`, `~/.semantic-sidekick/models/`) are NOT affected by this change; those are preserved through v1.x per the v1.0 promise.

### Tests

- New: `test/unit/migrate-state.test.ts` (idempotency, dry-run, conflict refusal, force resolution)
- Extended: `test/unit/healthcheck.test.ts` (legacy state file detection)
- Updated: `test/phase4/mode-hook.test.ts` (verifies writes land at new path)

## [1.1.2] - 2026-05-09 — Add ROADMAP.md (docs-only)

Adds a public-facing `ROADMAP.md` at the repo root tracking the committed near-term direction. Captures v1.2 (state consolidation, `/healthcheck --fix`, fresh-install CI smoke, code-symbol drift), v1.3 (confidence-decay), and v2.0 (close the migration window — remove deprecation shims, move the vector index out of the vault, drop legacy fallbacks). Also documents what's deferred and what we've actively decided NOT to ship.

`ROADMAP.md` is now in the published npm tarball alongside `README.md` and `CHANGELOG.md`. No code changes; pure documentation.

The detailed per-version task plans live under `.planning/v1*-*` (gitignored runtime state); ROADMAP.md is the durable summary.

## [1.1.1] - 2026-05-08 — Hotfix: complete the rebrand wiring

v1.1.0 published with the rebrand-to-`semantic-memory` half-finished: the npm package, marketplace entry, and tool surface all moved to the new name, but the postinstall, SessionStart reconcile, slash commands, and CLI helpers were still hardcoded to the legacy `@theglitchking/semantic-sidekick` package path. Fresh `npm install @theglitchking/semantic-memory@1.1.0` installs failed to register hooks correctly and slash commands hit ancient code from the legacy npm package (still on the registry at 0.2.x).

### Fixed

- **Postinstall (`scripts/link-skills.js`)** — `runPostinstall` now passes `packageName: "@theglitchking/semantic-memory"`, `pluginName: "semantic-memory"`, and `hookCommand` pointing at the new node_modules path. Hooks now register correctly on fresh installs.
- **SessionStart reconcile (`hooks/reconcile.js`)** — `findLocalBin` checks the rebranded package path first, falls back to the legacy path for machines mid-migration. `isOurEntry` recognizes both old and new shapes when removing stale `.mcp.json` entries.
- **SessionStart hook (`hooks/session-start.js`)** — `runSessionStart` delegate now passes the new package name + plugin name + config file.
- **vault-context hook (`hooks/vault-context.js`)** — vault path discovery now matches `semantic-memory` server entries in `.mcp.json` (was only matching `semantic-vault` and `semantic-sidekick`). CLI bin discovery prefers the new path with legacy fallback.
- **Slash commands** — all 7 (`/healthcheck`, `/status`, `/normalize-config`, `/policy`, `/mode`, `/update`, `/relink`) now invoke `@theglitchking/semantic-memory` instead of the legacy package.
- **CLI helpers (`src/cli/index.ts`)** — `PKG_NAME`, `findLocalBin`, `runRelink`, `isLocalForm` updated. Error messages reference the new path. `registerUpdateCommands` passes the new plugin name + config file.

### Storage paths preserved (unchanged)

- `<vault>/.semantic-sidekick-index/` — vector index location, kept for backwards-compat with existing v1.0.x indices
- `~/.semantic-sidekick/models/` — model cache location, kept for backwards-compat

These intentionally retain the legacy `semantic-sidekick` name in the path — renaming would invalidate every existing user's index and force a re-download of the embedding model. The path-name mismatch with the package name is a one-time cost; we eat it.

### Backwards compatibility

All legacy fallbacks preserved. Users with `@theglitchking/semantic-sidekick` still installed (from v0.x or v1.0 pre-rebrand) continue to work — `findLocalBin`, `runRelink`, hook discovery, and `isOurEntry` all check both paths. The DOCS_KEY entry name in `.mcp.json` stays as `"semantic-sidekick"` for existing-user compatibility.

### How v1.1.0 slipped through

Phase 9's automated validation ran tests against `createServer()` directly with in-memory MCP clients — it never simulated a fresh `npm install` from the published tarball. The bug only fires at install time and slash-command invocation time, both of which were on the manual-smoke-deferred list. The hotfix re-emphasizes that "manual smoke against an existing v1.0.x install" needs to happen BEFORE publish, not after.

## [1.1.0] - 2026-05-08 — brain-absorption

Adapts four targeted strengths from `JimmyMcBride/brain` into semantic-memory: AGENTS.md contract artifact, hard-gated verification sessions, multi-agent skill bundler, distill/synthesize unification — plus a server.ts refactor that makes future additions cheap, a deprecation-shimmed tool consolidation, and an opt-in SessionStart drift-detection layer.

### Added

- **AGENTS.md contract artifact** at the project root with managed-block markers (`<!-- semantic-memory:begin contract -->`...`<!-- end -->`). Frontmatter records `generated_by`, `version`, `last_generated`. The block lists Active Modes, Required Workflow, Tool Surface (live + deprecated), and Memory Policy. Local Notes tail outside the markers is preserved verbatim across regenerations. New tools: `regenerate_contract`, `inspect_contract`. New slash command: `/contract`.
- **Hard-gated verification sessions.** New module `src/core/session.ts` owns `<project>/.claude/.semantic-memory/session.json`. New MCP tools: `session_start`, `session_run`, `session_finish`, `session_status`. `session_finish` refuses without recorded verifications unless `verified: false` AND a non-empty `reason` is provided. State is opt-in; sessions auto-record `notes_touched` from `apply_patch` / `synthesize_note` / `synthesize_promote` operations.
- **Distill ↔ synthesize_note unification.** `synthesize_note` gains `proposal: boolean` (writes to `proposals/<date>-<slug>.md` with `status: proposal`), `proposal_subdir` (override), and `from_session: boolean` (auto-pulls task context, verifications, and touched notes from the active session). New tool `synthesize_promote` atomically moves a reviewed proposal to its canonical destination.
- **Multi-agent skill bundler.** New CLI subcommand tree `bin/semantic-memory skills {targets,install,uninstall,list}` for codex, copilot, and pi. Each install writes a `.semantic-memory-skill-manifest.json` with sha256s for stale/drift detection. Non-destructive by default; `--force` overrides. Existing Claude flow via `claude-plugin-runtime` postinstall is unchanged.
- **SessionStart drift detection.** Fast-tier checks (file-system probes only) for `.mcp.json` server entry, hook registration, AGENTS.md managed-block presence, and session staleness. Inline JS in `hooks/vault-context.js` — no spawn cost. Healthy installs see nothing; drifted installs see a single `<vault-drift>` block at session start with a pointer to `/healthcheck`.
- **Manual `/healthcheck` deep audit.** New module `src/core/healthcheck.ts` provides fast and slow tiers (slow includes full `lint_vault`). 5-minute result cache. CLI command `semantic-memory healthcheck` accepts `--fast` and `--json`. The `--fix` flag is reserved for v1.2.

### Changed

- `src/mcp/server.ts` (1039 lines, 33 tools in one file) split into per-domain modules under `src/mcp/tools/*.ts` with a shared `src/mcp/context.ts`. server.ts shrinks to 96 lines (composition root + lifecycle). **Tool surface unchanged** — every tool name, schema, and handler is preserved bit-for-bit, gated by the existing regression snapshot suite.
- `lint_vault` accepts a new optional `checks: ("schema"|"provenance"|"stale"|"broken_links")[]` filter. Omit for the existing full report. Additive schema change.
- `manage_tags` `action` enum widens to include `"rename"`, with new optional `from` / `to` fields. `action='rename'` calls the existing `tagManager.renameVaultWide`. Additive schema change.
- `.claude/CLAUDE.md` now opens with a pointer to `AGENTS.md` as the primary contract; CLAUDE.md remains for repo-specific augmentation.

### Deprecated (callable through v1.x via shim, removed in v2.0.0)

- `find_schema_violations` → use `lint_vault({checks: ["schema"]})`
- `find_missing_provenance` → use `lint_vault({checks: ["provenance"]})`
- `find_stale` → use `lint_vault({checks: ["stale"]})`
- `find_broken_links` → use `lint_vault({checks: ["broken_links"]})`
- `read_multiple_notes` → call `read_note` in a loop or via batched MCP calls
- `rename_tag` → use `manage_tags({action: "rename", from, to})`

All shims emit `[DEPRECATED — removed in v2.0.0; use ...]` prefix in their tool descriptions, visible to agents in the MCP tool list.

### Tool-surface delta

```
v1.0.1 → v1.1.0
  +regenerate_contract  +inspect_contract     (Phase 3)
  +synthesize_promote                          (Phase 4)
  +session_start +session_run +session_finish
  +session_status                              (Phase 5)
  = 33 → 40 tools (write mode)
  = 21 → 21 tools (read-only mode, unchanged)
```

### Backwards-compatibility contract

Four statements that remain true after v1.1.0 ships:

1. **Every existing MCP tool name remains callable.** Eliminated tools become deprecation shims that delegate to their survivors. No automation needs to change in v1.x.
2. **Hook output is unchanged when no session is active and no drift exists.** The Stop hook only adds new prompts when a session is open; the SessionStart hook only adds drift output when actual drift is detected.
3. **AGENTS.md generation is opt-in.** Existing repos see no new files until they call `regenerate_contract` or run `/contract`.
4. **Drift detection is silent on healthy installs.** Auto-check at SessionStart adds <100ms latency and emits zero output when no drift is present.

Storage layout (`.semantic-sidekick-index/`, `~/.semantic-sidekick/models/`) preserved per the v1.0 promise. No re-index, no model re-download required when upgrading from v1.0.x.

### Tests

Suite expanded from 211 (v1.0.1) to 277 tests across 31 files. New coverage:
- `test/unit/agents-contract.test.ts` (7 tests)
- Extended `test/unit/synthesize.test.ts` (6 new tests for proposal mode)
- `test/unit/session.test.ts` (24 tests)
- `test/phase5/stop-hook-session.test.ts` (5 tests)
- `test/unit/skills-bundler.test.ts` (12 tests)
- `test/unit/healthcheck.test.ts` (12 tests)

All pre-existing tests pass unchanged. Snapshot diffs are verified additive-only across all phases.

## [1.0.1] - 2026-05-08 — Republish (no functional changes)

### Republish only

`@theglitchking/semantic-memory@1.0.0` was published briefly then unpublished while the publish strategy was being reviewed. npm tombstones unpublished version slots, so the same version cannot be republished. This patch bumps to **1.0.1** with no functional changes — content is byte-identical to what 1.0.0 would have shipped.

If you somehow have `@theglitchking/semantic-memory@1.0.0` installed (cached from the brief publish window), bump to `1.0.1` directly. No migration steps required between 1.0.0 and 1.0.1.

## [1.0.0] - 2026-05-07 — Rebrand to `semantic-memory`

### Renamed (publication identity)

- **npm package**: `@theglitchking/semantic-sidekick` → `@theglitchking/semantic-memory`
- **Claude Code plugin name**: `semantic-sidekick` → `semantic-memory`
- **Marketplace name**: `semantic-sidekick-marketplace` → `semantic-memory-marketplace`
- **MCP server name**: `semantic-sidekick` → `semantic-memory` (announced in initialize handshake)
- **CLI binary**: `bin/semantic-memory` is the new primary; `bin/semantic-sidekick` is preserved as an alias during the transition

### Why

`semantic-sidekick` framed the plugin as a "vault helper" because that's what it was at v0.x. v1.0.0 introduces a multi-corpus architecture: vault, code, plans, docs, research, project-map. The plugin is no longer a sidekick — it's the unified memory layer for Claude Code. The new name reflects the actual scope.

### Preserved (no migration required for existing installs)

- **Internal storage layout** is unchanged: `<project>/.semantic-sidekick-index/` continues to be the index directory, `~/.semantic-sidekick/models/` continues to be the model cache. Existing users do NOT need to re-index or re-download models when they upgrade.
- **All 33 existing MCP tools** remain registered under the same names with the same input schemas and the same output structures. The regression-snapshot suite (`test/regression/`) gates this guarantee — every tool's surface is bit-for-bit preserved.
- **The `--read-only` mode** continues to suppress the same 12 write tools (21-tool surface).
- **All existing slash commands, hooks, skills, and capture flow** are unchanged.
- **`bin/semantic-sidekick` shell command** continues to work as an alias for `bin/semantic-memory`.
- **Configuration files** (`.claude/semantic-sidekick.json`, `.claude/.semantic-sidekick-update-cache.json`) keep their names. The claude-plugin-runtime `pluginName: "semantic-sidekick"` is preserved so update tracking continues without state loss.

### Phase 2.0.0a (this release) — what shipped

This is the **mechanical rebrand** portion of Phase 2.0.0 of the unified memory-layer plan tracked in `~/workspace/the-glitch-kingdom/persistent-planning/.planning/layered-planning-with-mcp-and-hewtd-frontmatter/task_plan.md`. It includes:

- All publication-identity renames listed above
- Preview docs for the planned multi-corpus architecture (`docs/corpora-json.md`, `docs/smart-middle-activation.md`)
- README rebrand framing
- Bin alias for `semantic-memory`

### Phase 2.0.0b (next release) — what's coming

The actual multi-corpus refactor — registry-driven indexer, per-corpus search verbs (`search_vault`, `search_code`, ...), `search_all` cross-corpus verb, smart-middle first-run detection, `corpora.json` schema implementation — ships in a follow-up PR. Until that lands, semantic-memory's runtime behavior is identical to semantic-sidekick 0.2.5.

### Migration for existing users

```bash
# Uninstall the old plugin
/plugin uninstall semantic-sidekick

# Install the new one (same marketplace repo, new plugin name)
/plugin marketplace add https://github.com/TheGlitchKing/semantic-sidekick
/plugin install semantic-memory@semantic-memory-marketplace
```

Or for npm/global installs:

```bash
npm uninstall -g @theglitchking/semantic-sidekick
npm install -g @theglitchking/semantic-memory
```

Or as a project devDependency:

```bash
npm uninstall @theglitchking/semantic-sidekick
npm install --save-dev @theglitchking/semantic-memory
```

Existing on-disk state (the index, model cache, hooks, skills, slash commands) requires no changes. The new package reads from the same paths as the old one.

### Inter-PR dependencies (this release)

- Hard-depends on: nothing (the regression-snapshot baseline already lives on main and gates this release)
- Soft-coupled with: hit-em-with-the-docs#3 (HEWTD 2.2.0 — `tier: "plan"` schema extension); persistent-planning#1 (3.0.0 lg-mode). Neither blocks this release; both ship coordinated for a coherent ecosystem-wide v1.0 launch.

## [0.2.5] - 2026-04-28

### Fixed
- **`<vault-context>` hook injected an unconditional cite-or-deflect imperative
  on every prompt.** The injected block ended with `Instructions: Read the top
  hits ... cite filenames in your response. If none of these actually answer
  the question, say "not in vault" and name the nearest misses.` That string is
  more specific and immediate than the CLAUDE.md rule that says "ignore on
  non-lookup prompts," so models in consumer projects (e.g. RE-InvestorHub)
  obeyed the inline string and blurted citations like
  `Vault citation: keycloak-custom-image.md unrelated — not in vault for this`
  on debugging, status, and directive prompts.

  Fix: rewrote the Instructions string in `hooks/vault-context.js` to be
  conditional and aligned with the CLAUDE.md cite-or-deflect rule — apply only
  on project prose lookups; ignore silently on meta/tool/debugging/status/
  directive/conversational prompts; explicitly forbid the "X unrelated"
  narration. Also gated `main()` on script invocation so the hook can be
  imported by tests, and added a regression test asserting the new shape.
  Suite: 189/189.

## [0.2.4] - 2026-04-26

### Fixed
- **Stop hook emitted invalid output shape on early-exit paths.** The `183aa30`
  fix patched `emitStop()` and the catch block to write `{}` instead of the
  SessionStart-shaped `{hookSpecificOutput: {hookEventName: "Stop"}}` envelope
  (Stop's schema rejects `hookSpecificOutput`). But two earlier short-circuits
  in `main()` — when `findVaultPath` or `findCliBin` returns null — were still
  routing through the generic `emit()` helper, which wrote the broken envelope
  unconditionally. This surfaced in projects where Claude opened in a subdir
  without a local `.mcp.json` or local `node_modules/@theglitchking/...`,
  producing `Stop hook error: Hook JSON output validation failed — (root):
  Invalid input` on every response.

  Fix: introduced `emitNoop(eventName)` helper that branches on Stop and writes
  `{}` for it. Wired into both early-exits and the catch block. Two regression
  assertions added to `test/phase4/mode-hook.test.ts` covering the no-vault
  and no-CLI-bin paths. Suite: 188/188.

## [0.2.3] - 2026-04-22

### Fixed
- **`vault-first` skill + CLAUDE.md rule over-triggered "not in vault"
  deflection.** The rule was written as "cite or deflect on every answer";
  in practice the UserPromptSubmit hook injects `<vault-context>` on *every*
  prompt (including meta-questions, debugging, yes/no, directives, and
  conversational turns), so Claude was opening every response with "not in
  vault" regardless of whether the prompt was actually a vault-eligible
  project lookup.

  Fix: the cite-or-deflect rule now explicitly applies only when the *user's
  question shape* is a project/operational lookup. Meta/tool/debug/status/
  directive prompts → silently ignore the injected block. The filter is the
  user's intent, not the hook's output. Updated in both `skills/vault-first/SKILL.md`
  and the CLAUDE.md rule block.

## [0.2.2] - 2026-04-22

### Fixed
- **Docs MCP (`semantic-sidekick`) was silently removed by reconcile on every
  SessionStart when `hit-em-with-the-docs` was enabled per-project but not
  globally.** `reconcile.js:hewtdEnabled()` only checked `~/.claude/settings.json`;
  per-project enablement (project `.claude/settings.json` or `.claude/settings.local.json`)
  was ignored. Since isOurEntry recognized the docs entry as ours, the reconcile
  removal path deleted it on every boot.
- Fix: `hewtdEnabled(projectRoot)` now checks all three scopes (user, project,
  project-local) and returns true if hewtd is enabled in any of them. The docs
  MCP now persists correctly for project-scope installs.

## [0.2.1] - 2026-04-22

### Fixed (critical)
- **SessionStart hook no longer crashes with `ERR_MODULE_NOT_FOUND` when
  installed via `/plugin install`.** Claude Code's plugin extractor unpacks
  the npm tarball but does not run `npm install` — so `hooks/session-start.js`'s
  static `import { runSessionStart } from "@theglitchking/claude-plugin-runtime"`
  failed at load time, producing the reported errors:

      SessionStart:resume hook error
      Failed with non-blocking status code: node:internal/modules/cjs/loader:1386
      Failed with non-blocking status code: node:internal/modules/package_json_reader:314

  Fix: rewrite `session-start.js` so the critical path (reconcile .mcp.json,
  ensure .claude/.vault) uses zero external deps — `reconcile.js` is pure
  node built-ins. The `claude-plugin-runtime` integration (auto-update policy)
  is now a best-effort dynamic import — skipped silently when not resolvable.
  The hook always emits a valid SessionStart response and never blocks the
  session, even if every optional component is missing.

## [0.2.0] - 2026-04-22

### Phase 1 — Activation layer
- `vault-first` skill at `skills/vault-first/SKILL.md` with cite-or-deflect contract.
- SessionStart + UserPromptSubmit hooks backed by `hooks/vault-context.js`. Seeded search on session start; fingerprinted per-prompt injection with suppression of recent duplicates.
- CLAUDE.md vault-first rule block enforcing cite-or-deflect at system-prompt level.
- New `semantic-sidekick search` CLI subcommand (hybrid / text-only / JSON output) — hooks shell out instead of running an MCP client.
- 10-prompt conversational test suite at `test/phase1/run.js`. Pass criterion ≥7/10; current ≥9/10.

### Phase 2 — Structure + capture
- Minimal default schema (`src/core/schema-default.ts`) with four types (note, decision, gotcha, source) + provenance fields + lint policy. Bootstrappable via `install_schema` MCP tool or `semantic-sidekick install-schema` CLI.
- `apply_patch` MCP tool — atomic multi-note ChangeSet with pre-check, schema validation, reverse-order rollback, dry-run.
- `synthesize_note` MCP tool — answer + sources → filed note with auto-wikilinks, routed through apply_patch.
- Lint suite: `find_schema_violations`, `find_missing_provenance`, `find_stale`, `lint_vault` (full report). MCP tools + `semantic-sidekick lint` CLI + `scripts/pre-commit-lint.sh` template.
- Stop hook with capture-cue detection (`\bbecause\b`, `\bthe fix was\b`, etc.) → `decision: "block"` prompt at session close.
- Parsed-doc cache (`.semantic-sidekick-index/docs.cache.json`) — hook latency dropped ~6s → ~0.7s (9x).

### Phase 3 — Ingest + maintenance
- `ingest_source` MCP tool — source + extracted units → atomic ChangeSet with derived_from wiring. Auto-logs `kind=ingest` on success.
- Structured `log.md` at vault root: human bullet line + machine-readable `yaml event` blocks per entry. `log_event` + `log_query` MCP tools.
- Hierarchical INDEX.md auto-regen on apply_patch (creates/deletes/moves). Overflow signal at 100 entries.
- `find_broken_links` lint — cross-note wikilink validation, skips code blocks.
- `regenerate_index` MCP tool for manual regen.

### Phase 4 — Routing + transitions
- `research-mode` skill — aggressive vault behavior for sustained investigation; every source filed; synthesis mandatory on exit.
- `outage-silence` skill — incident mode; suppresses auto-vault; forces postmortem on exit.
- `/mode` slash command — explicit mode setter (ground truth). Writes `.claude/.sidekick-mode`.
- `/vault <query>` slash command — explicit vault search, works in any mode including outage-silence.
- CLAUDE.md routing rule — visible `[research]` / `[outage]` prefix, transition-capture contract.
- Mode-aware hooks: UserPromptSubmit suppresses in outage-silence; Stop branches per mode (research-synthesis / outage-postmortem / vault-first generic).
- SessionStart resets mode to `vault-first` (relevance-decay at session boundary).

### Phase 4.5 — Auto-logging + state-delta preload
- `apply_patch` / `synthesize_note` / `ingest_source` auto-log `kind=error` on failure, `kind=synthesis` / `kind=ingest` on success.
- Hook crashes auto-log `kind=error` with stack excerpt (no longer stderr-only and lost).
- SessionStart injects `<vault-state-since date="…">` block — 14-day log.md summary + 6 most recent entries. Future-Claude boots with "what past-me did this week."
- Mode drift (session ended in non-default mode) auto-logs `kind=mode_change` at next SessionStart.
- New CLI subcommands `log-event` + `log-query` so hooks and CI scripts write/read log.md without importing core.

### Plugin packaging
- `.claude-plugin/plugin.json` + `marketplace.json` updated for Phase 1–4.5 scope (category: knowledge).
- `hooks/hooks.json` declares SessionStart + UserPromptSubmit + Stop hooks against `${CLAUDE_PLUGIN_ROOT}/hooks/vault-context.js`.
- `package.json` `files[]` now ships `skills/{vault-first,research-mode,outage-silence}` and `scripts/pre-commit-lint.sh`.

### Fixes
- Stop hook output shape corrected — uses top-level `decision` / `reason` instead of `hookSpecificOutput` (which Claude Code rejects for Stop).
- CLI `lint --json` stdout flush fixed — large JSON payloads were truncating mid-array when `process.exit` ran before flush.
- `src/core/index.ts` exports all Phase 2/3 public APIs (applyPatch, buildSynthesizeChangeSet, buildIngestChangeSet, lintVault, logEvent/logQuery, schema helpers).

### Tests
- 186/186 tests passing (from 139 at 0.1.0).
- 47 new tests across schema, patch, synthesize, lint, ingest, log, index-regen, mode-hook, state-delta, auto-logging.

### Docs
- Full operator's manual in `.documentation/`: INDEX + 14 topic docs + 4 per-phase change logs. See `.documentation/INDEX.md`.

## [0.1.0] - 2026-04-21

### Forked from semantic-pages 0.10.0
Initial fork. Package renamed, bin renamed (`semantic-sidekick`), MCP server identifier changed, index directory changed (`.semantic-sidekick-index`). All retrieval functionality inherited unchanged from semantic-pages.

### Planned (per `.planning/semantic-sidekick/task_plan.md`)
- **Phase 1**: Activation layer — SessionStart + UserPromptSubmit hooks, `vault-first` skill with conversational cue detection, CLAUDE.md rule. Hypothesis test: does the vault get used without explicit invocation?
- **Phase 2**: Structure — `vault.schema.yml`, provenance frontmatter, `apply_patch` MCP tool, `synthesize_note`, cheap lint.
- **Phase 3**: Ingest + maintenance — `ingest_source`, structured log, hierarchical indexes.
- **Phase 4**: Routing — mode skills (research / default / outage), signal weighting, transition capture.
- **Phase 5**: Advanced — contradiction detection, situation snapshots, calibration loop.

### Heritage
Upstream substrate tracked at `git@github-glitch:TheGlitchKing/semantic-pages.git` (remote `upstream`, push disabled). Substrate fixes are cherry-picked from upstream; semantic-sidekick does not push back.
