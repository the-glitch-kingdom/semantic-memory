# Task Plan: long-term memory, opt-in locked sources searched only on request (#93)

## Goal
Old docs generations ("cold" trees, produced by hit-em-with-the-docs#97's rotation) become **long-term memory**: frozen, read-only and searchable on request, but invisible to everything else.

- **Never in default search.** Not in a plain search, not in the prompt hook's injected context, not counted in abstention.
- **Searchable on request**, semantically and by text, when a query names them (`sources: [...]`, CLI `--source`) or the user asks to "search long-term memory".

This is the **search side only**. Rotation, staging, the confirmation gate, undo and the secrets scan of the outgoing tree belong to hit-em-with-the-docs#97, not to this repo. Release as 1.29.0 (minor: new config keys, tool parameters and CLI flag; default search byte-identical).

## Phases
- [x] Phase 1: Verify and plan (notes.md)
- [ ] Phase 2: Acceptance as failing tests first (`it.fails` until fixed); fixtures
  - [ ] Fixtures:
    - a cold-generation tree under `test/fixtures/long-term/` with 2 generations (`cold-a/`, `cold-b/`), each with an `archive/` subfolder and a doc that answers a "what did we do about X" question the live fixture does not;
    - a hewtd config fixture with `reconcile.related_repos` and a `cold_storage` list in the hit-em-with-the-docs#97 shape: `{generation, path, source_commit, rotated_at, checksum, secrets_findings: ["rel/path.md:51"]}`;
    - one generation with a secrets-flagged file that holds a fake credential-shaped value (built at test time, never committed as a real-looking secret).
  - [ ] **Default output unchanged** (the core acceptance). With an opt-in source configured (`default: false`) and with a `cold_storage` manifest, these are byte-identical to a run with no source configured:
    - `search_hybrid`, `search_semantic` and `search_text` output, and `read_note` without `source`;
    - CLI `search`, on the existing snapshot (`test/fixtures/federation/single-source-snapshot.json`) and a golden set;
    - abstention flags (`no_strong_match`, `missing_terms`, `passing_terms`, `undocumented`) identical.
    - And the opt-in source's index is never built or loaded by default traffic: no context is created, nothing under `<primary index>/sources/` appears.
  - [ ] **Opt-in query.** `search_hybrid {sources: ["legacy"]}` returns only that source's hits, each with `source`. `sources: ["primary", "legacy"]` adds it to the default set. An unknown label gets a clear message, never silently the default. `search_text` and `search_semantic` take `sources` the same way. `read_note {source: "legacy"}` works for an opt-in label.
  - [ ] **Lazy index.** The first opt-in query on an unbuilt source answers "Indexing in progress" (as a cold start), then real hits once built.
  - [ ] **Locked, read-only.**
    - A locked source in a `chmod -R a-w` folder indexes without writing into it; its index lives under `sourceIndexPath`.
    - After a file in it changes, it does not reindex. The next opt-in query answers from the old index and warns, never rebuilds.
    - A rebuild happens only on an explicit human action (CLI `reindex --source <label>`, or MCP `reindex` with `source`).
  - [ ] **cold_storage manifest.**
    - Each generation is registered as an opt-in locked source labelled `cold-<generation>`.
    - Every hit carries `historical: {generation, source_commit, rotated_at}`.
    - A file named in `secrets_findings` is never indexed, embedded or returned. Its text is absent from the index files on disk too (grep the index dir for the fake value).
    - A checksum mismatch refuses that generation with a one-line warning; the others still answer.
  - [ ] **"long-term" target.** `sources: ["long-term"]` searches every cold generation, merged, each hit labelled with source and generation date. A query can also name one generation.
  - [ ] **Prompt hook.**
    - "search long-term memory for X" and "what did we do back in 2025 about X" inject a block from cold generations only, marked historical, with generation dates.
    - Ordinary prompts never surface an opt-in or cold source, with negatives like "our long-term plan", "back in the day the API", "long term support".
  - [ ] **CLI parity.**
    - `semantic-memory search --notes <primary> --source legacy "..."`, repeatable, plus `--source long-term`.
    - It resolves the label through the primary's federation config and uses `sourceIndexPath`, so it never writes into the source folder.
  - [ ] **related_repos opt-in.** `federation.related_repos: opt-in` registers hewtd related repos as `default: false` sources. `true` (the default) and `false` behave as today.
- [ ] Phase 3: Config, `default` and `locked` on sources, `related_repos: opt-in`, `cold_storage`
  - [ ] `FederationSource` gains `default: boolean` (true unless `default: false`), `locked: boolean` and optional `historical` metadata. Parse them in `loadFederation` (src/core/federation.ts), lenient as today: a bad value is dropped with a warning.
  - [ ] `federation.related_repos`: `true` | `false` | `"opt-in"`.
  - [ ] Read `cold_storage` from `.claude/hit-em-with-the-docs.json`, next to `relatedRepos()`:
    - Each valid entry becomes `{label: "cold-<generation>", path, default: false, locked: true, historical: {generation, source_commit, rotated_at}, checksum, secrets: [paths]}`.
    - Validate `generation` against the label regex and resolve `path` relative to the project root.
    - A malformed entry is a warning, never a throw.
    - Reserve the labels `primary` and `long-term`; a configured source using either is dropped with a warning.
  - [ ] `federation.cold_storage: false` opts out of reading the manifest, mirroring `related_repos`.
  - [ ] Unit tests in `test/unit/federation.test.ts`.
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
  - [ ] `reindex --source <label>` is the explicit human rebuild for a locked source.
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
  - [ ] A semantic-first or vault-first skill line: the user can say "search long-term memory for X". Add one line to `skills/semantic-first/SKILL.md` naming the `sources: ["long-term"]` parameter. No new skill.
- [ ] Phase 8: Measure
  - [ ] `npm run gate:release` (fresh, BAND=1) vs 1.28.0: every count identical, mcp vs cli 0 differ, p95 within band. Default search must not change at all. Run it once more with a `cold_storage` manifest pointing at a large cold copy configured (the gate's corpus duplicated as a generation): again identical, and no index built under `sources/`.
  - [ ] Opt-in cost on a ~1,000-file cold tree (copy this repo's `.documentation` plus fixtures, or generate one): first-query build time, checksum time, warm p95 and RSS before/after opening. Record in notes.md.
  - [ ] Long-term recall check: a small set of "what did we do about X" questions against the two fixture generations (train/held-out split as usual). Record @1/@3. Floors come from the measured numbers.
- [ ] Phase 9: Release prep
  - [ ] Bump all five version fields to 1.29.0, plus the lockfile.
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
    - `chmod a-w` on both the folder and its files.
  - [ ] Security: a path in `cold_storage` or `secrets_findings` cannot escape (`..` traversal, absolute paths in `secrets_findings`). The fake secret value is absent from every file under the index dir and from every tool output.
  - [ ] Lint, build, `npm test`, `npm run eval`, `npm run gate:release` (fresh).
  - [ ] Independent review of `git diff main...HEAD` (`claude -p`, given the code, not our conclusions).
- [ ] Phase 12: Documentation pass with hit-em-with-the-docs; no secrets (MANDATORY)
  - [ ] `.documentation/operational/federation-guide.md`: `default`, `locked`, `related_repos: opt-in`, `cold_storage`, the reserved labels, the checksum definition and the secrets exclusion.
  - [ ] New guide `.documentation/operational/long-term-memory-guide.md` (via `hewtd integrate`). It covers:
    - what long-term memory is, and how it is fed by hit-em-with-the-docs#97's rotation;
    - how to search it (tool `sources`, CLI `--source`, the prompt phrases);
    - what is never searched by default;
    - how to rebuild a locked source.
  - [ ] `.documentation/reference/mcp-tools-reference.md` (`sources` on three tools, `historical` on hits, `get_stats` sources) and `.documentation/reference/cli-reference.md` (`--source`, `reindex --source`).
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

## Errors Encountered

## Status
**Phase 2 next.** Phase 1: verified on main (1.28.0); see notes.md.
