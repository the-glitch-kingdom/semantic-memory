# Notes: long-term memory (#93)

## Phase 1: verification on main (1.28.0, c25ea68)

### Scope
#93 was rescoped on 2026-11-11 to the search side. Rotation (staged reconcile, confirmation, swap, locked dated cold generations, undo, secrets scan of the outgoing tree) is the-glitch-kingdom/hit-em-with-the-docs#97. #97 proposes the `cold_storage` list in `.claude/hit-em-with-the-docs.json`:
`{generation, path, source_commit, rotated_at, checksum, secrets_findings: ["rel/path.md:51"]}`, with `<cold_root>` outside the live docs tree. **#97 does not define what `checksum` hashes**, so we define it (task_plan Key Question 2).

### Federation today
- `loadFederation` (src/core/federation.ts:82) reads `federation.sources` from `vault.schema.yml` (`{label, path, weight}`) plus hewtd `reconcile.related_repos` (federation.ts:46) unless `federation.related_repos: false`. It is lenient: warnings, never throws. It drops duplicates by realpath and label.
- The registry (src/mcp/sources.ts:46):
  - It builds every source eagerly at the first `open()`: `buildContext(path, {readOnly: true, indexPath: sourceIndexPath(...)})`, then `tryLoadCachedIndex` → `reconcileNow` or `backgroundIndex`.
  - Indexes live at `<primary index>/sources/<label>-<hash8>` (sources.ts:21), so nothing is written into the source tree.
  - A source that is not ready is skipped with a one-line note.
- Only **`search_hybrid`** (src/mcp/tools/search.ts:265, `sources.open()` → `hybridSearch` per source → `mergeSources`) and **`read_note`** (src/mcp/tools/read.ts:16, `source` param) federate. `search_semantic` and `search_text` search the primary alone.
- `mergeSources` (src/core/federation-merge.ts) labels every item with `source`. `no_strong_match` stays only if every answering source is weak, and `missing_terms`/`passing_terms` only if every source lacks the term. Opt-in sources must not reach this on default queries.
- `search_hybrid` already calls `ensureFresh` on every ready source per query (search.ts:276). A locked source must skip that.

### Prompt hook
- `hooks/vault-context.js` `findNotesSources` (:52) reads `.mcp.json` `semantic-*` servers with `--notes`. `searchSources` (:128) spawns CLI `search --notes <path>` per server and merges. The hook **never federates** (the CLI has no federation), so an opt-in federation source is already out of the hook. Only the explicit long-term trigger is new.
- `formatContextBlock` (:197) drops `archive/` hits (`isArchived`), has a 0.35 score gate, and shows the top 3.

### CLI
- `search <query> --notes --limit --text-only --paths` (src/cli/index.ts:405) → `runSearch` (src/cli/search.ts). It has no federation. It keeps the index inside the notes tree (`.semantic-sidekick-index`), so `--source` must resolve through the primary's federation and use `sourceIndexPath`. Pointing `--notes` at a read-only cold tree would try to write into it.

### Archive and secrets
- `src/core/path-class.ts:37-38`: default `rules: [{glob: "**/archive/**", multiplier: 0.3}]`, `exclude: ["**/archive/**"]`. A cold tree's own `archive/` would be invisible unless locked and cold sources skip the exclude.
- `src/core/redact.ts` redacts what semantic-memory *writes* (notes, logs). It does not scan docs at index time, so secret-flagged files must be excluded before parsing (Phase 4).

### hit-em-with-the-docs side (read only, never modified)
- `/reconcile` is hewtd 3.1.8 `commands/reconcile.md`. Its only external hook is `reconcile.search_command` (an argv template). The confirmation gate and rotation are #97's.

### Cold root name (hit-em-with-the-docs#97, comment 2026-11-11T03:29)
- The cold root is `.documentation-cold/` at the repo root, configurable as `reconcile.cold_root` (repo-relative, outside the docs root), and committed to git.
- One generation per rotation: `.documentation-cold/<YYYY-MM-DD>/` (`-2`, `-3` on a same-day collision), a byte-for-byte copy of the outgoing tree, read-only. Gitignored files stay on disk and are listed in the manifest as `untracked_files`.
- The outgoing tree's ledger is `.documentation-cold/.generations/<gen>/ledger.json`.
- Staging is `reconcile --stage <dir>`, under `.hewtd/`. It ships in hewtd 3.2.0 (`feat/cold-rotation-97`), and the names may still change: #97 says it will confirm.
- User requirement (2026-11-11): when that folder exists, the user is told long-term memory is opt-in. That is the session-start notice (task_plan Phase 7).
- Precedent: `hooks/skill-loop.js:40-60` prints the skill-loop notice as SessionStart `additionalContext`. For the user to see it, use `systemMessage` too.

## Eval results: Phase 2
No ranking or search change; tests and fixtures only. New files: 5 integration, 2 unit and a help block, 31 `it.fails` cases across them (confirmed failing as plain `it`: `Cannot find module hooks/cold-notice.js`, `unknown option '--source'`, `Cannot find src/core/cold.js`, `sources` ignored so default hits come back, no `source`/`historical` fields, no cold index under `<index>/sources/`, no `long-term-memory` topic). The notice hook can only see a checksum mismatch if `coldGenerations()` compares something cheap; the plan says it never hashes. Phase 3 must decide how (e.g. compare the manifest checksum with one recorded at registration, or hash only on the first notice and cache by folder mtime); the test only needs the message.

The `hewtd-config.json` fixture pins the #97 contract (comment 2026-11-11): `cold_storage[]` entries `{generation, path, source_commit, rotated_at, checksum, secrets_findings, untracked_files}`; `checksum` is ours (sha256 over sorted `relpath\0sha256(file)\n`, regular files, no symlinks), hand-pinned in `test/unit/long-term-checksum.test.ts`. #97 must adopt the same definition.

## Eval results: Phase 3
No ranking change; config parsing only. No eval run (src/core/federation.ts is read at server start, not on the search path).

## Eval results: Phase 4
No ranking change for default queries (open() path untouched apart from reading the federation lazily); no eval measured. `coldChecksum` on a 1,000-file tree (20 dirs, 7.9 MB of markdown): about 20 ms per call warm, under 65 ms for three calls including the first. Well under the 2 s line, so no mandatory cache; the once-per-process plus folder-mtime check is kept for repeated queries.

## Eval results: Phase 5

No ranking change for default calls (no `sources`): federated-search, federation-notes, federation-sources and the Phase 2 default guards pass unchanged; `npm run eval` 24 files passed. The tool-surface golden snapshot was updated for the new `sources` and `reindex.source` parameters. Opt-in paths are covered by long-term-optin.test.ts (all `it.fails` flipped to plain tests).

## Eval results: Phase 6

No ranking change (the default path is untouched; `--source` reuses search_hybrid). First-use cost on the fixture (`--source long-term`, two cold generations, built outside the folders): 1.7 s including model load and index build; warm 0.65 s; `--reindex` 0.72 s. No eval measured.

## Eval results: Phase 7
No ranking change, no eval measured. cold-notice hook: 39 ms wall on a one-file cold tree (node start included).

## Eval results: Phase 8
**Gate, fresh `BAND=1 bash scripts/gate-release.sh 1.28.0` (no --cache): PASS.** local equals 1.28.0 on every count, both modes and both arms: no export hybrid @1 92/139, @3 115, sem@1 79, multi @1/3/8 20/28/31 of 41, cov@1/3/8 0.62/0.82/0.88, dom 32, negatives flagged 43/47, false flags 7; export hybrid @1 95/139, @3 116, multi 20/28/32, dom 23. mcp vs cli 0 of 186 differ in both modes; titled #1 139/139; p95 12-17 ms for both versions; local cold idx 37.9 s vs 34.8 s (noise).

**Same gate with a large cold generation configured** (`COLD_COPY=1`, new in scripts/eval-against-release.sh: this corpus copied 4 times into `.documentation-cold/2026-01-01`, 892 files, registered in `.claude/hit-em-with-the-docs.json` with its real checksum): PASS, every count identical to the run without it and to 1.28.0 (same figures as above), mcp vs cli 0 of 186. The script fails the run if `<index>/sources/` exists after local's index and both eval arms; it did not (it prints "no index under sources/", twice, once per mode). 1.28.0 ignores the manifest.

**Opt-in cost** (scratch script, in-process MCP client, 912-file cold generation = 4 copies of `.documentation`, 3.9 MB x4 markdown, loaded machine): coldChecksum 11 ms (first and second call); first `sources:["long-term"]` query, to the first hit: 48.1 s (embeds 912 files, model already loaded; the primary index was built); warm long-term p95 32 ms. Process RSS 1542 MB before opening, 1746 MB after (+204 MB for the index in memory). Default-search p95 10.0 ms before opening, 21.2 ms after (single run on a loaded machine; the gate's default p95 is unchanged at 12-17 ms with the generation configured but not opened). A default call never builds or loads the cold index.

**Long-term recall** (test/retrieval-eval/long-term{,-heldout}.jsonl, 10 + 10 own questions over the two fixture generations, `sources: ["long-term"]`, with a third ~240-file generation of this repo's `.documentation` as distractors; test/retrieval-eval/long-term-eval.test.ts): train @1 10/10, @3 10/10; held-out @1 7/10, @3 9/10 (identical across two runs). Floors in baseline.json `longTerm`: train 10/10, held-out 7/9, one case of slack in the test. Nothing was tuned on either split; the held-out misses were not looked at to change anything.

## Eval results: Phase 9

No ranking change, no eval measured. Contract check against hewtd 3.2.0 (read only): cold root `.documentation-cold/`, folder `<YYYY-MM-DD>`, manifest fields `generation, path, source_commit, rotated_at, checksum, disk_checksum, secrets_findings, untracked_files, scanner_allowlists` match; `untracked_files` are repo-relative (unused by us). Checksum differed (see plan, Errors Encountered) and was fixed. A real `--stage` and `--promote --confirm` in a temp repo gave a manifest that `coldGenerations` read as `registered`, `hooks/cold-notice.js` announced, and `search --source long-term` answered with `source: cold-<date>` and `historical`.

## Eval results: Phase 11
Fresh `BAND=1 bash scripts/gate-release.sh 1.28.0` (no --cache) PASS after the review fixes: local equals 1.28.0 on every count in both modes and arms (no export hybrid @1 92, multi 20/28/31 of 41, negatives 43/47, false flags 7; export hybrid @1 95, multi 20/28/32); mcp vs cli differ on 0 of 186 in both modes. p95 14 ms (cli and mcp), one local-export mcp reading of 29 ms on a loaded machine, inside the gate band. `npm test` 155 files and `npm run eval` 25 files pass, no load flakes.


## Eval results: Phase 12

Docs, help and `--help` only; the one src behaviour change is the wording of the locked-source `changed` note. No ranking change, nothing measured. `npm test` (156 files) passed except a load-flake stdin-eof test that passes alone; `npm run eval` (25 files) passed after the docs.
