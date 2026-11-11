# Task Plan: long-term memory, opt-in locked sources searched only on request (#93)

## Goal
Old docs generations ("cold" trees, produced by hit-em-with-the-docs#97's rotation) become **long-term memory**: frozen, read-only and searchable on request, but invisible to everything else.

- **Never in default search.** Not in a plain search, not in the prompt hook's injected context, not counted in abstention.
- **Searchable on request**, semantically and by text, when a query names them (`sources: [...]`, CLI `--source`) or the user asks to "search long-term memory".

This is the **search side only**. Rotation, staging, the confirmation gate, undo and the secrets scan of the outgoing tree belong to hit-em-with-the-docs#97, not to this repo. Release as 1.29.0 (minor: new config keys, tool parameters and CLI flag; default search byte-identical).

## Dependency: hit-em-with-the-docs#97 (built in that repo, in another session)
Nothing in this plan touches the hit-em-with-the-docs repo. The rotation, staging, confirmation gate, undo, secrets scan and manifest writing are all #97's. We build against the contract #97 published (comment 2026-11-11T03:29):
- cold root `.documentation-cold/` or `reconcile.cold_root` (repo-relative, outside the docs root);
- generations `<YYYY-MM-DD>[-N]/`, read-only;
- ledger at `.generations/<gen>/ledger.json`;
- `cold_storage` entries `{generation, path, source_commit, rotated_at, checksum, secrets_findings, untracked_files}` in `.claude/hit-em-with-the-docs.json`;
- planned for hewtd 3.2.0.

Tests use fixtures in exactly that shape; no hewtd install is needed. The `checksum` definition is ours until #97 confirms it (Key Question 2).

## Phases
- [x] Phase 1: Verify and plan (notes.md)
- [x] Phase 2: Acceptance as failing tests first (`it.fails` until fixed); fixtures
  - [x] Fixtures:
    - a cold-generation tree under `test/fixtures/long-term/` with 2 generations (`cold-a/`, `cold-b/`), each with an `archive/` subfolder and a doc that answers a "what did we do about X" question the live fixture does not;
    - a hewtd config fixture with `reconcile.related_repos` and a `cold_storage` list in the hit-em-with-the-docs#97 shape: `{generation, path, source_commit, rotated_at, checksum, secrets_findings: ["rel/path.md:51"]}`;
    - one generation with a secrets-flagged file that holds a fake credential-shaped value (built at test time, never committed as a real-looking secret).
  - [x] **Default output unchanged** (the core acceptance). With an opt-in source configured (`default: false`) and with a `cold_storage` manifest, these are byte-identical to a run with no source configured:
    - `search_hybrid`, `search_semantic` and `search_text` output, and `read_note` without `source`;
    - CLI `search`, on the existing snapshot (`test/fixtures/federation/single-source-snapshot.json`) and a golden set;
    - abstention flags (`no_strong_match`, `missing_terms`, `passing_terms`, `undocumented`) identical.
    - And the opt-in source's index is never built or loaded by default traffic: no context is created, nothing under `<primary index>/sources/` appears.
  - [x] **Opt-in query.** `search_hybrid {sources: ["legacy"]}` returns only that source's hits, each with `source`. `sources: ["primary", "legacy"]` adds it to the default set. An unknown label gets a clear message, never silently the default. `search_text` and `search_semantic` take `sources` the same way. `read_note {source: "legacy"}` works for an opt-in label.
  - [x] **Lazy index.** The first opt-in query on an unbuilt source answers "Indexing in progress" (as a cold start), then real hits once built.
  - [x] **Locked, read-only.**
    - A locked source in a `chmod -R a-w` folder indexes without writing into it; its index lives under `sourceIndexPath`.
    - After a file in it changes, it does not reindex. The next opt-in query answers from the old index and warns, never rebuilds.
    - A rebuild happens only on an explicit human action (MCP `reindex {source}`, or the CLI rebuild flag from Phase 6).
  - [x] **cold_storage manifest.**
    - Each generation is registered as an opt-in locked source labelled `cold-<generation>`.
    - Every hit carries `historical: {generation, source_commit, rotated_at}`.
    - A file named in `secrets_findings` is never indexed, embedded or returned. Its text is absent from the index files on disk too (grep the index dir for the fake value).
    - A checksum mismatch refuses that generation with a one-line warning; the others still answer.
  - [x] **"long-term" target.** `sources: ["long-term"]` searches every cold generation, merged, each hit labelled with source and generation date. A query can also name one generation.
  - [x] **Prompt hook.**
    - "search long-term memory for X" and "what did we do back in 2025 about X" inject a block from cold generations only, marked historical, with generation dates.
    - Ordinary prompts never surface an opt-in or cold source, with negatives like "our long-term plan", "back in the day the API", "long term support".
  - [x] **CLI parity.**
    - `semantic-memory search --notes <primary> --source legacy "..."`, repeatable, plus `--source long-term`.
    - It resolves the label through the primary's federation config and uses `sourceIndexPath`, so it never writes into the source folder.
  - [x] **Opt-in notice** (`test/integration/cold-notice.test.ts`, hook run as a process with a temp project root).
    - With `.documentation-cold/2026-11-10/` present (or the folder named by `reconcile.cold_root`), the SessionStart hook prints a user-visible `systemMessage`. It says long-term memory exists, names the generations, says they are NOT searched by default, and says how to opt in ("search long-term memory for …", `sources: ["long-term"]`, `--source long-term`). It also adds one `additionalContext` line so Claude knows the same.
    - Without the folder: no message, and the output is byte-identical to today.
    - A generation folder on disk that is not in the `cold_storage` manifest, a checksum mismatch, or `federation.cold_storage: false` gets a message saying that generation is NOT searchable and why. An unregistered generation is never indexed (no secrets record exists for it).
    - Frequency: the full `systemMessage` once per new generation, recorded in `.claude/.semantic-memory/cold-notified.json`. The one `additionalContext` line on every `startup`/`resume`, never on `clear`/`compact`. A problem message on every startup until it is fixed.
  - [x] **Help** (`test/unit/help-topics.test.ts`; resolves through `findTopics`, which is what `help <words>` renders, not the typo-fuzzy `closestTopics`):
    - `semantic-memory help long-term memory`, `help cold storage`, `help opt-in` and `help documentation-cold` each resolve to the new `long-term-memory` topic (`closestTopics`);
    - the MCP `help {topic: "long-term-memory"}` serves the same text;
    - `help` with no topic lists it under "Search more".
  - [x] **related_repos opt-in.** `federation.related_repos: opt-in` registers hewtd related repos as `default: false` sources. `true` (the default) and `false` behave as today.
- [x] Phase 3: Config, `default` and `locked` on sources, `related_repos: opt-in`, `cold_storage`
  - [x] `FederationSource` gains `default: boolean` (true unless `default: false`), `locked: boolean` and optional `historical` metadata. Parse them in `loadFederation` (src/core/federation.ts), lenient as today: a bad value is dropped with a warning.
  - [x] `federation.related_repos`: `true` | `false` | `"opt-in"`.
  - [x] Read `cold_storage` from `.claude/hit-em-with-the-docs.json`, next to `relatedRepos()`:
    - Each valid entry becomes `{label: "cold-<generation>", path, default: false, locked: true, historical: {generation, source_commit, rotated_at}, checksum, secrets: [paths]}`.
    - Validate `generation` against the label regex and resolve `path` relative to the project root.
    - A malformed entry is a warning, never a throw.
    - Reserve the labels `primary` and `long-term`; a configured source using either is dropped with a warning.
  - [x] `federation.cold_storage: false` opts out of reading the manifest, mirroring `related_repos`.
  - [x] **Cold root** (hit-em-with-the-docs#97, comment 2026-11-11, shipping in hewtd 3.2.0):
    - `.documentation-cold/` at the repo root by default, or `reconcile.cold_root` (repo-relative, outside the docs root) from `.claude/hit-em-with-the-docs.json`;
    - one generation per folder, `<YYYY-MM-DD>` with an optional `-N` suffix;
    - the outgoing tree's ledger is at `.documentation-cold/.generations/<gen>/ledger.json`, never indexed;
    - manifest entries also carry `untracked_files` (gitignored files kept on disk). Parse it, index those files like any other (they are in the generation and covered by #97's secrets lane), and record the decision.
    One function, `coldGenerations(projectRoot)`, lists the generations on disk and joins them with the manifest: `registered | unregistered | checksum-mismatch | disabled | missing-path`. The notice, `get_stats` and `healthcheck` all use it. It is cheap (readdir plus JSON, no hashing), so the session hook stays fast.
  - [x] Unit tests in `test/unit/federation.test.ts`.
- [ ] Phase 4: Registry, opt-in sources stay closed until asked; locked sources never reconcile
  - [ ] `src/mcp/sources.ts`: `open()` returns only `default` sources, so the default path is unchanged. A new `openOptIn(labels)` builds a context lazily, only for named opt-in labels (`long-term` expands to every cold generation). Default traffic never builds or loads an opt-in context.
  - [ ] Locked contexts:
    - load the cached index or build once;
    - never run `ensureFresh` or `reconcileNow` afterwards;
    - a changed folder is detected by the checksum check (below), not by reconcile.
    Add a `locked` option to `buildContext` (src/mcp/context.ts) that makes `ensureFresh` a no-op once an index exists. Keep `readOnly: true`.
  - [ ] **Checksum.**
    - Before indexing, and on load, compute the generation's checksum and compare it with the manifest's.
    - On a mismatch, skip that source with the existing one-line `[federation: source "<label>" skipped, …]` note.
    - The checksum algorithm is NOT specified in hit-em-with-the-docs#97. Implement one documented function (`coldChecksum(dir)`: sha256 over sorted `relpath\0sha256(file)\n` lines, every regular file, symlinks not followed), and record in notes.md that #97 must use the same definition. Test it against a hand-computed value.
    - Cost on a 1,000-file tree: measure. If it exceeds about 2 s, verify once per process, and on later loads only if the folder's mtime changed.
  - [ ] **Secrets.** Files named in `secrets_findings` (the path part of `path:line`) are excluded before parsing: never embedded, indexed or returned, and `read_note` on them refuses. Exclude whole files, not lines (a line number can shift; a missed redaction would embed a secret). Record the decision.
  - [ ] **archive/ inside a cold generation is searchable** (the whole generation is history). Locked and cold sources do not apply the default `**/archive/**` exclude; the 0.3 multiplier stays. Decide on the fixture, record it, and test it.
- [ ] Phase 5: Tools take `sources`
  - [ ] `search_hybrid`, `search_semantic` and `search_text` take an optional `sources: string[]`.
    - Absent: exactly today's behaviour (default sources only).
    - `["primary", …]`: the default set plus those named.
    - Without `primary`: only those named.
    - Reuse the existing federated path in `search_hybrid` (`mergeSources`). Add the same per-source loop to `search_semantic` and `search_text`, which do not federate today. Keep `content[0]` a plain JSON array.
  - [ ] Every hit from a cold source carries `historical: {generation, source_commit, rotated_at}`. Opt-in non-cold sources carry `source` only.
  - [ ] Abstention flags on an opt-in search follow `mergeSources`' rules over the sources searched. Default queries are unchanged (Phase 2 test).
  - [ ] `read_note {source}` resolves opt-in labels through `openOptIn`.
  - [ ] Telemetry logs opt-in hits as `label:path`, as federation does today. `get_stats` lists sources with `default`, `locked`, state and, for cold sources, the generation.
  - [ ] Tool descriptions: one sentence each on `sources` and "long-term"; no other description churn.
- [ ] Phase 6: CLI `search --source`
  - [ ] `--source <label>`, repeatable, including `long-term` and `primary`, with the same semantics as the tool. It resolves through `loadFederation(--notes)` and reads or builds the index at `sourceIndexPath(<primary index>, source)`, never inside the source folder.
    - Locked: never rebuilds unless asked.
    - First use with no index: build it (the CLI is synchronous; no "Indexing in progress"). Measure that cost on the fixture and record it.
  - [ ] The explicit human rebuild for a locked source. There is NO `reindex` CLI command today: a rebuild is `serve --reindex`, and MCP has a `reindex` tool. Pick the smallest consistent surface: `search --source <label> --reindex` (rebuild that source's index, then search), plus MCP `reindex {source}`. Record the choice, and use that name everywhere `reindex --source` appears in this plan.
  - [ ] Output adds `source` and `historical` on hits; with no `--source`, output is byte-identical (Phase 2).
- [ ] Phase 7: Prompt hook, "search long-term memory"
  - [ ] `hooks/vault-context.js`: a narrow rule set recognises an explicit long-term request:
    - "search/check/look in long-term memory";
    - "in (the) long-term memory";
    - "what did we do back in <year>";
    - "back in <year>, what/how";
    - "in the old/cold docs";
    - "historically, what did we".
    On a match, run the CLI with `--source long-term` and inject a block labelled historical (`<vault-context source="long-term" …>` plus one line: past behaviour, not current; each hit with its generation date). Skip the default block for that prompt.
  - [ ] Negatives that must NOT trigger, as tests: "long-term plan", "long term support", "back in the day", "go back in the file", "memory leak in long-running", "back in 2025 we shipped" without a question shape. Keep the rule list in one place, as a module-level constant with a comment. No Jev or LLM call in the hook path.
  - [ ] **Opt-in notice at session start.** If `coldGenerations()` finds a cold root, the user must be told that long-term memory exists and is opt-in.
    - Implement it in a SessionStart hook, beside the skill-loop notice pattern (`hooks/skill-loop.js:40-60`). Import the dist module, never load the model, never compute checksums; target under 100 ms.
    - Output: `systemMessage` (shown to the user), plus one `additionalContext` line for Claude.
    - Wording, roughly: "Long-term memory: N old docs generation(s) in .documentation-cold/ (2026-11-10, …). Not searched by default. To search them, ask 'search long-term memory for …' (or pass sources: ["long-term"] / --source long-term). More: /help long-term-memory."
    - Problem wording: "… 2026-11-12 is on disk but not registered by hit-em-with-the-docs (or its checksum changed), so it is not searchable."
    - Frequency as in Phase 2. Skip under `SEMANTIC_MEMORY_REVIEWER=1`, like the other hooks.
  - [ ] `healthcheck` reports each generation's status from `coldGenerations()` (a warning for unregistered or mismatched ones). `get_stats` lists them (Phase 5).
  - [ ] A semantic-first or vault-first skill line: the user can say "search long-term memory for X". Add one line to `skills/semantic-first/SKILL.md` naming the `sources: ["long-term"]` parameter. No new skill.
- [ ] Phase 8: Measure
  - [ ] `npm run gate:release` (fresh, BAND=1) vs 1.28.0: every count identical, mcp vs cli 0 differ, p95 within band. Default search must not change at all. Run it once more with a `cold_storage` manifest pointing at a large cold copy configured (the gate's corpus duplicated as a generation): again identical, and no index built under `sources/`.
  - [ ] Opt-in cost on a ~1,000-file cold tree (copy this repo's `.documentation` plus fixtures, or generate one): first-query build time, checksum time, warm p95 and RSS before/after opening. Record in notes.md.
  - [ ] Long-term recall check: a small set of "what did we do about X" questions against the two fixture generations (train/held-out split as usual). Record @1/@3. Floors come from the measured numbers.
- [ ] Phase 9: Release prep
  - [ ] Bump all five version fields to 1.29.0, plus the lockfile.
  - [ ] Contract check: re-read hit-em-with-the-docs#97 and its `feat/cold-rotation-97` branch (read only). Confirm the cold root name, the generation folder pattern, the manifest fields and the checksum definition still match ours. If hewtd 3.2.0 has shipped, run one real `reconcile` rotation into a temp repo copy and check that semantic-memory registers, notifies and searches it. Record any mismatch under Errors Encountered and fix it on our side. If #97 is not settled, ship anyway: the fixtures pin the published contract. Say so in the changelog.
- [ ] Phase 10: Cleanup -- remove junk and unused code this work created: scratch/test scripts, debug files, probe logging, one-off test functions, commented-out code, dead code from abandoned approaches (MANDATORY)
- [ ] Phase 11: Validate success through comprehensive testing (MANDATORY)
  - [ ] Every Phase 2 test passes as plain `it`.
  - [ ] Edge cases:
    - a source with `default: false` and `locked: false` (opt-in, live, reconciles on opt-in queries);
    - `locked: true` with `default: true` (a frozen tree searched by default; allowed, documented);
    - a manifest generation whose path is missing;
    - duplicate generation dates;
    - a generation path inside the live docs tree (refuse: a cold tree must be outside, per #97);
    - `sources: []`;
    - `sources: ["long-term"]` with no cold generations (a clear message);
    - an opt-in label that is still indexing;
    - `read_note` on a secrets-flagged file;
    - a symlink in a cold tree pointing outside it (not followed, not indexed);
    - `chmod a-w` on both the folder and its files;
    - a `-2` same-day generation;
    - a `reconcile.cold_root` pointing inside the docs root (refuse, with a notice);
    - the notice when the hewtd config is missing but `.documentation-cold/` exists (unregistered, not searchable);
    - an unreadable `cold-notified.json` (notice shown again, never a crash).
  - [ ] Security: a path in `cold_storage` or `secrets_findings` cannot escape (`..` traversal, absolute paths in `secrets_findings`). The fake secret value is absent from every file under the index dir and from every tool output.
  - [ ] Lint, build, `npm test`, `npm run eval`, `npm run gate:release` (fresh).
  - [ ] Independent review of `git diff main...HEAD` (`claude -p`, given the code, not our conclusions).
- [ ] Phase 12: Documentation pass with hit-em-with-the-docs; no secrets (MANDATORY)
  - [ ] `.documentation/operational/federation-guide.md`: `default`, `locked`, `related_repos: opt-in`, `cold_storage`, the reserved labels, the checksum definition and the secrets exclusion.
  - [ ] New guide `.documentation/operational/long-term-memory-guide.md` (via `hewtd integrate`). It covers:
    - what long-term memory is, and how it is fed by hit-em-with-the-docs#97's rotation;
    - how to search it (tool `sources`, CLI `--source`, the prompt phrases);
    - what is never searched by default;
    - how to rebuild a locked source;
    - the session-start opt-in notice and what each status means.
  - [ ] **Plugin help** (`src/core/help/topics.ts`, the one source for CLI `help`, the MCP `help` tool and `/help`):
    - **New topic** `long-term-memory`: title "Search long-term memory (old docs generations)", group "Search more", aliases `long-term`, `cold-storage`, `documentation-cold`, `legacy-docs`, `opt-in`, `historical`.
      - The summary says it is opt-in and never in default search.
      - Steps:
        1. hit-em-with-the-docs rotates the old tree into `.documentation-cold/<date>/` and registers it;
        2. the session-start notice says it exists;
        3. ask "search long-term memory for …", or pass `sources: ["long-term"]`;
        4. results carry `historical`;
        5. the Phase 6 rebuild command rebuilds a locked source.
      - Commands: `semantic-memory search --notes .documentation --source long-term "…"`, `search_hybrid {query, sources: ["long-term"]}`, the Phase 6 rebuild command for `cold-<date>`, `semantic-memory healthcheck`.
      - Verify: results carry `source: cold-<date>` and `historical.generation`; a plain search shows none.
      - `doc`: the new long-term-memory guide.
    - **Update `federated-search`:** add steps for `default: false`, `locked: true`, `related_repos: opt-in` and searching an opt-in source with `sources`.
    - **Update `add-index`:** for a rarely used frozen tree, point at long-term-memory instead of a second server.
    - **Coverage:** `test/unit/help-coverage.test.ts` must pass with the new schema keys (`federation.sources[].default` and `locked`, `federation.cold_storage`, `related_repos: opt-in`), the new CLI flags (`search --source` and the Phase 6 rebuild flag) and the new tool parameter (`sources`), with no new exemptions.
    - **Fill in `commands/help.md`'s example topics** if it lists any.
  - [ ] **Bring the help up to date with 1.21-1.28** (audit 2026-11-11; the user asked that help cover every new feature). Each change lands in `src/core/help/topics.ts`; the coverage test is the check.
    - **`getting-started`:** new installs get `.mcp.json` entries `semantic-memory` (vault) and `semantic-memory-docs` (docs, read-only); `semantic-vault` and `semantic-sidekick` still work (1.26).
    - **New topic `tune-ranking`** ("Tune ranking", group "Measure and improve"; aliases `ranking`, `rerank`, `reranker`, `path_class`, `usage_boost`, `coverage_weight`, `link_prior`, `clause_weight`, `identifier-tier`). It covers:
      - the `ranking:` block and its measured defaults (coverage and link prior off, `clause_weight` 0 and why);
      - the opt-in reranker;
      - path classes (`archive/` at 0.3 and excluded);
      - the usage boost;
      - the identifier tier (1.28; docs holding the query's identifier rank first);
      - "measure before and after with eval".
      `doc`: `.documentation/operational/retrieval-tuning-guide.md`.
      Remove the `ranking`, `rerank`, `path_class`, `usage_boost` and `results` "ranking internals" exemptions from `test/unit/help-coverage.test.ts`. Keep only those the topic genuinely does not cover, each with its reason.
    - **New topic `stable-results`** ("Why results are stable (or differ)", group "Search more"; aliases `reproducible`, `limit`, `same-order`, `determinism`). It covers:
      - limits 1-8 return the first k of limit 8 (1.27);
      - two builds of the same files rank identically (exact search below 100,000 chunks);
      - decay scores are fixed for the UTC day (1.27.1);
      - what does change a ranking: an edit, a new code-graph load, a new day, usage citations.
    - **New topic `index-readiness`** ("Index readiness and stale answers", group "Getting going"; aliases `indexing`, `indexing-in-progress`, `stale`, `wait-for-ready`, `warm-up`). It covers:
      - "Indexing in progress" until a cold build has finished, including the code graph (1.28);
      - a warm start answers at once, marked stale until it is reconciled (`_meta.stale` and the trailing note);
      - `serve --wait-for-ready` for scripts and evals;
      - `get_stats` / `serve --stats` show the state.
    - **`eval`:** mention `cov@1/3/8` and `dominance` (1.24) in the steps or verify, and `--via mcp --settle` (already there).
    - **`query-routing`:** the label still never changes ranking. Add one sentence: a query naming an identifier present in the docs ranks the docs that hold it first, whatever the label (1.28), with a pointer to `tune-ranking`.
    - **`doc` links:** point `section-results`, `query-routing` and `weak-matches` at a current guide or reference section where one exists (`mcp-tools-reference.md` anchors), instead of a changelog page. Check every anchor resolves.
    - **Tests:**
      - `help-topics.test.ts` resolves each new topic by id and by two of its aliases;
      - `help-coverage.test.ts` passes with the narrowed exemptions;
      - a test that every topic's `doc` path exists (add it if missing);
      - `semantic-memory help` (no topic) lists every topic under its group;
      - the MCP `help` tool and `/help` (`commands/help.md`) serve the same text (existing tests).
  - [ ] **Every `--help` is accurate and complete** (the user asked for this alongside the help topics).
    - **Scope:** `semantic-memory --help`, each of its 27 commands' `--help`, and every subcommand of the 8 command groups (`skills`, `lexicon`, `dossier`, `profile`, `skill-loop`, `jev-mode`, `skill-eval`, `eval`).
    - **For each:**
      - the description matches what the command does today;
      - every option the command registers is listed, with a description and the real default (e.g. `search --limit` default 8 vs MCP's 10: say which);
      - no stale names: the `semantic-vault`/`semantic-sidekick` server names only as legacy, no "(v1.6 …)"-style version tags that read as current limits;
      - the new flags (`search --source`, the rebuild flag, anything else this plan adds) are described.
    - Keep the wording short; commander wraps long descriptions badly (see `healthcheck`, `migrate-state`).
    - **MCP side:** the tool descriptions are the tools' `--help` (`semantic-memory tools <name>` prints them). `sources` on `search_hybrid`, `search_semantic`, `search_text` and `read_note`, and `source` on `reindex`, are described there.
    - **Test** (`test/unit/cli-help.test.ts`, new). It walks `program.commands` recursively (import the program, or parse `--help` output) and, for every command and subcommand:
      - runs `--help`;
      - asserts exit 0, a non-empty description, and every registered option shown with a non-empty description.
      It also asserts that `search --help` mentions `--source`, and that `tools search_hybrid` mentions `sources`. Cheap (no model load); runs in `npm test`.
  - [ ] `.documentation/reference/mcp-tools-reference.md` (`sources` on three tools, `historical` on hits, `get_stats` sources) and `.documentation/reference/cli-reference.md` (`--source` and the rebuild flag).
  - [ ] KB gotcha facts:
    - owed from 1.28.0: matching an identifier token by token credits docs with the words scattered (`gate`/`release`/`sh`); `## Instead`: match the name literally (`Bm25Index.docContains`), with `test/unit/identifier-tier.test.ts` as the check;
    - plus any found in this work.
  - [ ] `CHANGELOG.md` 1.29.0 and `.documentation/changelog/v1-29-0-long-term-memory.md`.
  - [ ] `npx hewtd maintain --quick`; never hand-edit INDEX.md or REGISTRY.md. Re-run `npm run eval` after the docs.

## Key Questions
1. Exclude secrets-flagged content by line or by file? By file. A line number can drift, and a missed line embeds a secret. A whole flagged file is the safe unit.
2. What does the `cold_storage` checksum hash? Unspecified in hit-em-with-the-docs#97. We define `coldChecksum` and document it, so #97 can match it. The definition should be confirmed on #97 before either side ships.
3. Should `archive/` inside a cold tree be searchable? Yes (the generation is history as a whole). Decide on the fixture in Phase 4.
4. Can a locked source be in the default set? Allowed (`default: true, locked: true`) but documented as unusual. Cold generations are always `default: false`.

## Decisions Made
- Version 1.29.0.
- The search side only (#93 rescoped 2026-11-11). Rotation is hit-em-with-the-docs#97.
- Default search must be byte-identical; that is the gate, not a band.

- Phase 2 test layout: `test/long-term-fixture.ts` (project builder, checksum, fake secret), `test/fixtures/long-term/`, `test/integration/{long-term-default,long-term-optin,long-term-cli,long-term-hook,cold-notice}.test.ts`, `test/unit/{long-term-federation,long-term-checksum}.test.ts`, plus a block in `test/unit/help-topics.test.ts`.
- Names the tests pin that the plan left open (later phases follow them, or change the test with a reason): the SessionStart notice is a new `hooks/cold-notice.js`; `coldChecksum` lives in `src/core/cold.ts`; the manifest fields parsed onto a source are `checksum` and `secrets` (paths); `get_stats` rows are `{label, default, locked, generation}` under `sources`; the locked-source warning contains "changed"; an unknown label message matches /unknown.*source/; a cold_root inside the docs root says "inside the docs"; the notice for a checksum mismatch says "checksum", for a missing manifest "not registered", for the opt-out "disabled".
- The fake credential is assembled in `test/long-term-fixture.ts` (`FAKE_SECRET`) and written into the fixture copy at test time; the committed fixture holds only `__FAKE_SECRET__`. Tests never put it in a query: the tools echo a query's unknown identifiers back in `missing_terms`.
- Tests that hold today are plain `it` regression guards, not `it.fails`: `search_semantic`/`search_text`/`read_note` default equality, CLI default equality, a locked source in a `chmod -R a-w` folder indexing under `sourceIndexPath`, a plain search never surfacing a cold generation, `cold_storage: false`, `related_repos: true|false`, and the prompt-hook negatives.

- Phase 3: `coldGenerations(projectRoot, notesPath?)` lives in new `src/core/cold.ts` with `coldChecksum` (pulled forward from Phase 4: checksum-mismatch needs it). It returns `{root, problem?, generations[{generation, path, status}]}`; `problem` is `outside-repo` | `inside-docs` for an unusable cold root. It DOES hash registered generations: the cold-notice test needs a real mismatch and a manifest-only comparison cannot see one. No cache yet (shortcut noted in the code); Phase 7 adds an mtime cache if the hook is slow. `disabled` needs `notesPath` (reads `federation.cold_storage`).
- Phase 3: manifest parsing is `readColdManifest` in federation.ts (shared by `loadFederation` and `coldGenerations`). Paths are checked lexically and by realpath to stay inside the repo; an absolute path is refused. `loadFederation` skips (with a warning) a generation whose folder is missing. `secrets_findings` lose their `:line` and any absolute or `..` entry. `untracked_files` is not parsed: those files sit inside the generation folder, so they are indexed like any other and need no field. Reserved labels `primary`/`long-term` are dropped for every source kind. A bad `default`/`locked` value drops the source with a warning; a bad `related_repos` value warns and means true.
- Phase 3: src/mcp/sources.ts `start()` now builds only `default` sources (one filter line), else the cold generations would join every search once the manifest is read. That closes opt-in sources until Phase 4 adds `openOptIn`, so the "locked source indexes without writing into it" guard in long-term-optin.test.ts became `it.fails` until Phase 4 (it passed only because `default` was ignored).
- Phase 3: the 7 `it.fails` in long-term-federation.test.ts and the `coldChecksum` one became plain `it`; `coldGenerations` tests added there; federation.test.ts expectations gained `default: true, locked: false`.

## Errors Encountered

- Phase 3: real-corpus-eval beforeAll timed out again inside the full `npm run eval` (machine load); it passes alone (16 passed, 1 expected fail).
- Phase 2: the first draft of the secrets test put the fake secret in a query; `missing_terms` echoed it back, so the test failed for the wrong reason. Queries now describe the file instead.
- Phase 2: "a locked source indexes without writing into it" and `cold_storage: false` already passed (an `it.fails` flipped to unexpected-pass), so they became plain `it` guards.
- Phase 2: the abstention/default tests passed by timing while the opt-in source was still building (federated only once ready). `long-term-default.test.ts` now waits up to 20 s for that build in `beforeAll`, so it fails on every run today; once `default: false` is honoured the wait just times out (20 s, once).
- Phase 2 validation: `npm run eval` twice hit `real-corpus-eval` beforeAll "Hook timed out in 600000ms" (machine load average 16-35 from other sessions; the corpus and src are unchanged by this phase). The file passes alone (16 passed, 1 expected fail). Load flake, not a regression; the first run was left in the background by a tool timeout and its output cut before the failing name, so the second (verbose) run identified it.

## Status
**Phase 4 next.** Phase 3 done (config parsing, `coldGenerations`).

Previous: **Phase 3 next.** Phase 2 done: 31 `it.fails` acceptance cases (each confirmed failing as plain `it` for its stated reason) and 20 passing regression guards; see notes.md.
