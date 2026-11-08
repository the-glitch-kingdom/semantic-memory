# Task Plan: code-graph

## Goal
Ship semantic-memory#58: put the code in the graph. When it is present, read hit-em-with-the-docs' `.hewtd/graph.json`
v1. Otherwise fall back to code spans and links that resolve to repo paths. The work covers:
- `code:` and `symbol:` nodes with `cites_code` and `defined_in` edges;
- code drift and dead references as a damped ranking factor, reported in a `grounding` block;
- entity cards for identifier queries;
- `undocumented` terms: names that exist in code but in no doc, the #57 follow-up.

With neither the export nor any resolvable refs, behaviour is today's doc-only graph. One PR from `feat/code-graph`.
Series step 2. Every missed target is stated in the PR.

## Prerequisites
- #56 (`builtin-eval`) and #57 (`identifier-abstention`) merged: measured with `eval`; the identifier detector is #57's.
- `.hewtd/graph.json` v1 (hit-em-with-the-docs#65): optional input, **shipped in hewtd 2.21.0** (our devDependency,
  pinned `^2.21.0` by #59). Source of truth: hewtd `docs/graph-export.md` and `schemas/graph.v1.schema.json` (in the npm
  package). Facts to code against (shipped comment on #58):
  - `docs` keys are **docs-relative** (no `docs_root` field in the export); `source_commit` is HEAD or null; no timestamp.
  - `symbols[name] = {file, cited_by[], file_kind?}`; `file_kind` (`definition` | `reference`) arrives in hewtd 2.22.0
    (unpublished): optional, prefer `definition` when present, never require it.
  - `points_to.from` is always null; `duplicates.section` is the owner's anchor; `resolved: null` is never dead; a file
    ref resolving to a directory has no `code_changed`; drift is `code_changed > body_changed`.
  - hewtd's config key is `docs_path` in 2.21.0 and `docs_root` from 3.0.0 (renamed): read both.

## Rules for every phase
- **Verify before ticking.** Confirm in code, or with a test, that a box is actually done before ticking it.
- **The export is untrusted input from another tool.** Missing file = no export. Bad JSON or `version` ≠ 1 gives one
  stderr warning and is ignored. Unknown fields are skipped, malformed entries dropped. `resolved: null` is never dead.
- **No new walks change.** `cites_code` stays out of `LINK_EDGE_TYPES`, so graph walks, `graph_path` and `related` are
  unchanged; only `backlinks` / `forwardlinks` include code edges.
- **Response shape.** `content[0]` stays a doc array; the entity card rides on result #1 (`entity`), and `grounding`
  appears only when there is something to report. Watch the payload ceiling (`meanBytes` 4750).
- **No new dependencies; one `git ls-files` and one `git log` per build in the fallback; no git at query time.**
- **Works without hit-em-with-the-docs.**
- **This repo's own export.** hewtd 2.21.0 `index` writes `<repo>/.hewtd/graph.json`; it is derived, so add `.hewtd/` to
  `.gitignore` in Phase 2. The real-corpus eval copies only `.documentation`, so a local export must not change its numbers;
  state that in the eval phase.

## Phases
- [x] Phase 1: Verify and plan
  - [x] Verify #58 against main @ 29e74db (notes.md), with the graph.json v1 contract
  - [x] Re-verify against main @ f616f73 (v1.15.0): claims unchanged; hewtd 2.21.0 ships the export and `graph.v1.schema.json`
  - [x] Post the verification comment on #58
  - [x] Sync main, cut `feat/code-graph`, commit this plan (with the archive move of the previous plan)
- [x] Phase 2: Eval first
  - [x] Fixture `test/fixtures/code-graph-vault/`: a `.documentation/` vault plus `backend/scripts/check_rls_coverage.py`
        and `scripts/ci/guards.sh`, backdated history (temp copy, `git-history.ts`), and `.hewtd/graph.json` v1 plus a
        v2 variant (fixture exports validate against hewtd's `graph.v1.schema.json` with Ajv2020). Also generate a **real**
        export for this repo with `npx hewtd index` in a scratch git copy (never in the repo: it rewrites INDEX.md files)
        and keep a redacted, trimmed copy as a fixture. Questions and gates (train/held-out) for the acceptance checks, and a "top-3 docs citing no
        missing references" metric in the eval. `startEval` takes a vault-subfolder argument. Record the baseline.
- [x] Phase 3: Extract code refs (`indexer.ts`, `types.ts`)
  - [x] `codeRefs?: string[]` per doc from inline code spans and links to non-`.md` targets (resolved from the doc's
        folder, `../` allowed). Fenced blocks are not used (too noisy). `INDEX_SCHEMA_VERSION` 7 → 8 (re-parse only;
        chunk text unchanged, nothing re-embedded; test it).
- [x] Phase 4: `src/core/code-graph.ts`
  - [x] `loadExport(gitRoot)` per the rules above. Doc keys: use a `docs_root` field if the export has one; otherwise
        read hewtd's `docs_root` or `docs_path` from `.claude/hit-em-with-the-docs.json` (default `.documentation`) and map keys from
        it to vault paths; else vault-relative. Fewer than half the keys matching gives one warning and the docs
        table is ignored.
  - [x] Fallback: `gitFiles(root)` (one `git ls-files -z`) and `gitLastChanged(root, files)` (one `git log`, pathspecs
        in batches). A span matches a file by exact repo path, or by basename when that name is unique; symbol-like
        spans become symbols with no file. Dead refs only for a link to a missing file or a span with `/` whose
        top-level folder exists. The repo root comes from `repoRoot()` (`skill-evidence.ts`).
- [x] Phase 5: Graph
  - [x] Nodes `code:<path>` (or `code:<repo>:<path>` for sibling repos) and `symbol:<name>` with a `kind`
        attribute; edges `cites_code` and `defined_in`; `buildFromDocuments(docs, code?)`; `statistics()` stays
        doc-only plus a `codeNodes` count.
  - [x] `backlinks` / `forwardlinks` accept a file path or symbol name and include code edges. These two tools are
        `code_to_docs` / `doc_to_code`; no new tools.
  - [x] Code data is rebuilt in `sync()`; `ensureFresh` also rebuilds when the export's mtime or `<gitdir>/logs/HEAD`'s
        mtime changes (one `stat`, no spawn).
- [x] Phase 6: Grounding and ranking
  - [x] Per doc `grounding = {source: "export" | "code-spans", verdict?, code_drift[], dead_refs[]}`, stored like
        `gitDate`. The export's `body_changed` replaces the git body date for docs it covers; its `last_verified` and
        `verdict` are used when present.
  - [x] Drift = refs whose `code_changed` is later than max(`body_changed`, `last_verified`), so a real verification
        clears drift.
  - [x] One shared `groundingMultiplier(doc, cfg)` used by MCP and CLI: default 0.97 per drifted file (≤ 3) × 0.95
        per dead ref (≤ 3), floor 0.8, `archive-candidate` × 0.85; others add nothing (their causes already count).
        Settings in a `decay.code` block, tuned on train with `eval`.
  - [x] Result block only when there is something to report: `grounding: {source, verdict?, code_drift: [≤3],
        dead_refs: [≤3], more?}`; `verdict` shown only for `check`, `stale`, `archive-candidate`, `secret`.
        (Done in `decay.ts` `groundingMultiplier`/`groundingBlock`, called by `decayForDoc`, which MCP `applyDecay` and the CLI both use; `groundDocs` in `code-graph.ts` sets `doc.grounding`, saved in docs.cache.json so the CLI reads it. Defaults needed no tuning. Deviation: the export's `body_changed` replaces the git body date for drift only, not for the age decay.)
- [x] Phase 7: Entity cards and `undocumented`
  - [x] Query tokens through #57's detector, looked up against symbols and file paths / unique basenames. The card
        rides on result #1: `entity: {entity, kind, path, cited_by: [{path, title, stale}] ≤ 5}`; citers ordered by
        search score, fresh first. Cards say "found in" (hewtd locates a symbol by the first file containing it).
        (Done: `entityCard` in code-graph.ts, `location` is "defined in" only for file_kind definition; `getCode()` on ctx; CLI loads code lazily, only for a query with an identifier. Deviation: files are matched too (path suffix or unique name with/without extension) via `CodeData.files` from `git ls-files`; stale = drift, dead refs or a check/stale/archive-candidate verdict.)
  - [x] `undocumented: [{entity, path}]` alongside `missing_terms`: an identifier in no doc that exists in code is reported as
        undocumented, not missing.
        (Done in `splitUndocumented`, used by MCP `shape()` and CLI `openSearch`; `no_strong_match` is still set; `missing_terms` keeps only names found in neither docs nor code.)
- [x] Phase 8: Release prep v1.16.0
  - [x] Bump all five version fields, lockfile (offline tarball: deferred to release, built from the merge commit)
- [ ] Phase 9: Cleanup -- remove junk and unused code this work created: scratch/test scripts, debug files, probe logging, one-off test functions, commented-out code, dead code from abandoned approaches (MANDATORY)
  - [ ] Remove trial knobs and sweep scripts; dead-code check over the branch diff.
- [ ] Phase 10: Validate success through comprehensive testing -- we need to validate success thoroughly through comprehensive testing of our changes (MANDATORY)
  - [ ] Independent review: trusting the export (crash on bad input, `null` counted dead, unknown versions read), git
        at query time or per file, `cites_code` leaking into walks or `related`, CLI/MCP drift in grounding, payload.
  - [ ] Unit: ref extraction; export reader (missing, v1, v2 warns once, bad JSON, `null` refs, `repo` refs, key
        mapping); conservative dead refs; drift date maths; verdict multipliers.
  - [ ] Integration: #58 check 1 (`forwardlinks(doc)` has its code refs, `backlinks("scripts/ci/guards.sh")` lists the
        citing docs); check 2 (a `check_rls_coverage` query returns the card on result #1); check 3 (two near-identical
        docs, one with drift: it carries `code_drift` and ranks lower); CLI/MCP parity.
  - [ ] #58 check 4: on the eval, "top-3 docs citing no missing references" rises and answer @1 does not drop (blind
        set via `eval`; the external 751-doc tree as a release step if available).
  - [ ] #58 checks 5 and 6: the same fixture without `.hewtd/` (fallback grounding, no crash); no git repo (doc-only
        graph, unchanged graph stats); every existing floor passes untouched.
  - [ ] Full suite; known flakes re-run alone. Answer each #58 acceptance item in notes.md.
- [ ] Phase 11: Documentation pass -- a full hit-em-with-the-docs pass to create/update/deprecate as many docs as needed to capture all our changes: new procedures, tools, troubleshooting steps, gotchas, KB articles, etc. Never include secrets or passwords (MANDATORY)
  - [ ] New `.documentation/architecture/code-graph.md` (the export contract as consumed, key mapping, fallback rules)
  - [ ] New changelog doc (`npx hewtd integrate -a`); `CHANGELOG.md`
  - [ ] `.documentation/architecture/what-gets-indexed.md`, `.documentation/architecture/indices-and-storage.md`,
        `.documentation/operational/decay-guide.md` (code drift, verdicts), `.documentation/reference/mcp-tools-reference.md`
        (`grounding`, `entity`, `undocumented`, code edges in backlinks/forwardlinks),
        `.documentation/reference/configuration-reference.md` (`decay.code`)
  - [ ] `README.md`, `npx hewtd maintain --quick`, regenerate AGENTS.md; tick the last boxes so `/plan-status` reads COMPLETE

## Key Questions
1. Resolved: doc keys are docs-relative (hewtd `docs/graph-export.md`); the Phase 4 mapping reads `docs_root`/`docs_path`.
2. Resolved by hewtd 2.22.0 (unpublished): `file_kind: definition | reference`. Cards say "defined in" when
   `file_kind` is `definition`, else "found in".

## Decisions Made
- Drift counts from max(`body_changed`, `last_verified`), not `body_changed` alone, so verifying a doc clears drift.
  This differs from the contract's wording on purpose.
- No new `code_to_docs` / `doc_to_code` tools: `backlinks` / `forwardlinks` accept files and symbols.
- `undocumented` (from #57) is added here, where the symbol table exists.
- Schema 8 is a re-parse only. `codeRefs` holds raw inline-span text (no whitespace, <= 120 chars) plus non-`.md` link targets normalised against the doc folder (`../` kept, trailing `/` dropped); deciding which are files/symbols is Phase 4's job. Proven by `index-upgrade.test.ts` (schema 7 cache: `embedBatch` never called, `codeRefs` appear in `docs.cache.json`).
- Phase 2 fixture (`test/fixtures/code-graph-vault/`): the vault is `.documentation/` inside a small repo (scripts, `.hewtd/graph.json` v1,
  `truth.json` = hand-written ground truth for dead and drifted refs). 12 twin topics (6 drift, 6 dead; the clean twin alternates a/b),
  3 identifier docs (`guards.sh` cited by three), 3 plain docs, 4 undocumented scripts. Train/held-out split by topic.
  Other exports live outside the vault in `test/fixtures/code-graph-exports/` (`v2.json`, `real-trimmed.json`).
- `startEval(source, prefix, prepare, vault)` serves `source/vault`; `gitHistory` now commits `*.{md,py,sh}` including dot dirs (existing fixtures have none).
- `.gitignore` gets `/.hewtd/` anchored at the root so the fixture's `.hewtd/graph.json` stays tracked.
- Ajv2020 for the fixture validation comes from the hoisted `ajv` (hewtd's dependency); not added to package.json (test only).
- The "top-3 clean" metric counts the twin of a dead pair even when it is demoted to rank 2, so on a 2-doc twin it barely moves; the drift/dead
  pair gate (`it.fails`, answer above twin) is the sensitive check on the fixture, and the metric is the one to watch on the real tree.

- Phase 4 module API: `loadExport(gitRoot, vaultDir, vaultPaths)` and `fallbackCode(gitRoot, vaultDir, docs)` both return `CodeData {docs: Map<vaultPath, DocCode>, symbols: Map<name, {file?, fileKind?, citedBy[]}>}`; `loadCodeData(vaultDir, docs)` merges them (export wins per doc; null outside git). Only `file` and `symbol` refs are kept; dates are ms.
- Fallback dead refs are conservative: a `/` in the ref, no match, and the (repo-root) top folder exists. A link to a missing file inside the vault is not reported dead (a raw `codeRefs` string cannot be told from a span); `../` links are resolved to the repo first. Symbol spans: `identifiers()` shape, no `/` or `.`, not ALL_CAPS (env names).
- One `git ls-files -z`; `git log --name-only` in batches of 500 pathspecs (one for a normal build).

- Phase 5: `cites_code` / `defined_in` are `EdgeType`s and `CODE_EDGE_TYPES` (graph.ts), outside `LINK_EDGE_TYPES`. The graph methods keep their defaults; the `backlinks`/`forwardlinks` MCP tools pass link + code types when `types` is omitted. Dead refs (`resolved: false`) get no node. A note's `linkCount`/`backlinkCount` and `statistics()` ignore code edges; `GraphStats.codeNodes` is new (two snapshots updated: graph_statistics, tool surface).
- Phase 5: `setDocuments(docs, code)` takes the code data loaded by `loadCode()` (errors give a stderr line and a doc-only graph). `lastCodeStamp` = mtimes of `.hewtd/graph.json` and `.git/logs/HEAD`; no CLI change (the CLI has no graph build).

## Errors Encountered
- (none yet)

## Status
**Currently in Phase 8** - Release prep v1.16.0 (Phase 7 done: entity cards and `undocumented`)

---

## Notes
- This file persists across sessions
- Update status after each phase
- Mark completed phases with [x]
- Save research to notes.md instead of stuffing context

## On Completion
This plan is complete when every checkbox above is checked. That IS the
completion signal -- there is no separate status to remember to flip.

When complete, archive it instead of deleting it:

    /plan-status                  # confirm this plan reads COMPLETE
    /archive-plan code-graph    # -> .planning/.archive/code-graph/

Archiving moves this directory to the gitignored .planning/.archive/ and stamps
it archived. Nothing is destroyed.
