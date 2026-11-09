# Notes: hub-doc-ranking-regression (#71)

## Verification against main @ 3e50e14 (v1.20.0), 2026-11-08

### Same-run bisect of the published packages on clones of this repo
Each version ran from `npm pack`, on its own `git clone --local` of main: today's docs, code and history present, no
`.hewtd/`. Each got `--reindex`, then `eval` on `real-corpus.jsonl` + `real-corpus-heldout.jsonl` (54 answerable).
The script is in the session scratchpad (`bisect71.sh`, `probe.mjs`); Phase 2 turns it into
`scripts/eval-against-release.sh`.

| version | hybrid @1 / @3 | #1+related | multi @1 | paraphrase @1 | exact @1 | semantic @1 | negatives flagged |
|---|---|---|---|---|---|---|---|
| 1.15.0 | 33 / 44 | 40 | 11 | 12 | 10 | 29 | 32 |
| 1.16.0 | 34 / 46 | 39 | 9 | 14 | 11 | 27 | 32 |
| 1.17.0 | 35 / 49 | 42 | 10 | 15 | 10 | 29 | 30 |
| 1.20.0 | 35 / 49 | 42 | 10 | 15 | 10 | 29 | 30 |

- **The #1 drop does not reproduce on this repo's real-corpus set.** Multi @1 dips 11 → 9 → 10, and negatives
  flagged fall by 2.
- **Likely why:** our questions rarely target hub docs (long docs citing many code files), and the in-repo
  real-corpus eval copies only `.documentation`, so grounding never runs in CI.
- **Grounding has plenty to act on here:** on a clone, 58 of 127 docs carry drift (see the #58 release check), so a
  hub question set should show the reporter's effect.

### MCP probes (in-process server, same clones)
- `related` per #1 (mean): 0.76 (1.15), 0.78 (1.16), 1.24 (1.17), 1.24 (1.20). **Not 0 on this repo.**
- Entity card on `resolveDossierForPrompt`, `findLocalBin`, `runHealthcheck`, `scripts/link-skills.js` (all cited in
  docs), on 1.20: **the CLI and in-process MCP both return the card.**
- **Not reproduced yet:** the reporter's MCP path is the plugin's stdio `--read-only` server. Phase 2 reproduces
  through that exact launch.

### Code-read confirmations
- `negative: true`: eval metrics treat only `tier === "negative"` as a negative (`src/core/retrieval-eval/metrics.ts`).
  **Confirmed.**
- PascalCase: `ID_EXTRA` in `src/core/query-type.ts` requires 3+ capitalised words, so `TaskResponse` is `fact`.
  **Confirmed.**
- **Drift penalty:** 0.97 per drifted file, at most 3 (`decay.code`). Any doc citing many files collects it, so the
  penalty grows with how grounded a doc is. **True by construction**, which matches the reporter's 6 of 8 hub docs
  pushed to #2.
- **Section scoring:** results take the doc's best single chunk. Since 1.17, chunks are sections, so a broad doc loses
  to a short dense section (the reporter's multi @1 drop). `granularity: "doc"` changes only the output shape, not
  the ranking. **Confirmed.**
- **Fields:** `shape()` emits `section`/`anchor`/`code`/`decay`/`grounding` whenever they exist, so missing fields mean
  the data is empty on that path. Phase 2 checks it on the stdio server.

## Eval results: Phase 2 (baseline, no fixes), 2026-11-08

Tool: `scripts/eval-against-release.sh` (published versions from `npm pack`, `local` = this checkout's `dist/`, one
`git clone --local` of HEAD per run, `--reindex`, `eval --json`, then `scripts/lib/eval-probe.mjs` through the stdio
server `--notes .documentation --read-only`, cwd = the clone). `--docs-only` copies `.documentation` alone (what the
in-repo real-corpus eval does, so no code and no grounding); `--export` runs `npx hewtd index` in the clone first (it
also regenerates the clone's INDEX/REGISTRY files). Hub set `real-hub.jsonl` (12 train) + `real-hub-heldout.jsonl` (10)
was written and facet-checked against the docs before the first measurement; 22 answerable, 3 negatives. Real-corpus =
train + held-out, 54 answerable, 36 negatives. One run per cell: HNSW is random per build, so about one case of noise.
`local` = the branch with only the eval-output change (ranking identical to 1.20.0).

Columns: hybrid @1 (of answerable), hybrid @3, semantic @1, multi @1, `#1+related`, `related` per #1 (stdio probe,
answerable questions), negatives flagged, p95, entity cards returned (of 4 identifier queries), answerable #1s that
carry `grounding`.

| set / tree | export | version | hyb@1 | hyb@3 | sem@1 | multi@1 | #1+rel | rel/#1 | neg flagged | cards | grounding on #1 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| real-corpus, docs copied (no code) | no | 1.15.0 | 43/54 | 50 | 32 | 12/15 | 46 | 0.72 | 33/36 | 0/4 | 0 |
| | | 1.20.0 | 41/54 | 50 | 31 | 11/15 | 47 | 1.20 | 30/36 | 0/4 | 0 |
| | | local | 41/54 | 50 | 31 | 11/15 | 47 | 1.20 | 30/36 | 0/4 | 0 |
| real-corpus, clone (code present) | no | 1.15.0 | 33/54 | 44 | 29 | 11/15 | 40 | 0.76 | 32/36 | 0/4 | 0 |
| | | 1.20.0 | 35/54 | 49 | 29 | 10/15 | 42 | 1.22 | 30/36 | 4/4 | 32 |
| | | local | 35/54 | 49 | 29 | 10/15 | 42 | 1.24 | 30/36 | 4/4 | 33 |
| real-corpus, clone | yes | 1.15.0 | 33/54 | 44 | 29 | 11/15 | 40 | 0.76 | 32/36 | 0/4 | 0 |
| | | 1.20.0 | 34/54 | 49 | 29 | 10/15 | 41 | 1.15 | 30/36 | 4/4 | 51 |
| | | local | 34/54 | 49 | 29 | 10/15 | 41 | 1.15 | 30/36 | 4/4 | 51 |
| hub, clone | no | 1.15.0 | 10/22 | 18 | 7 | 3/8 | 13 | 1.77 | 2/3 | 0/4 | 0 |
| | | 1.20.0 | 10/22 | 19 | 9 | 4/8 | 16 | 1.86 | 2/3 | 4/4 | 11 |
| | | local | 10/22 | 19 | 9 | 4/8 | 16 | 1.86 | 2/3 | 4/4 | 11 |
| hub, clone | yes | 1.15.0 | 10/22 | 18 | 7 | 3/8 | 13 | 1.77 | 2/3 | 0/4 | 0 |
| | | 1.20.0 | 12/22 | 17 | 7 | 6/8 | 18 | 1.64 | 2/3 | 4/4 | 21 |
| | | local | 12/22 | 17 | 7 | 6/8 | 18 | 1.64 | 2/3 | 4/4 | 21 |

Other numbers: p95 11 to 26 ms on every run. An earlier combined run (all four sets, clone, no export) gave 1.15.0
43/76, 1.20.0 45/76 and local 45/76 at hybrid @1; multi @1 14/23 on all three.

### What the baseline says
- **The #1 loss does not reproduce on this repo, on the real-corpus sets or on the hub set**, with or without an export:
  1.20.0 is at or above 1.15.0 at hybrid @1 everywhere except the docs-copied real-corpus cell (41 vs 43, which has no
  code, so no grounding runs: that gap is the 1.17 section scoring alone, 2 cases, inside the run-to-run noise but in
  the reporter's direction). Multi @1 on real-corpus: 11 (1.15) to 10 (1.20) on the clone, 12 to 11 docs-copied.
- **The hub set cannot show the reporter's effect with this repo's docs.** Its docs carry little drift and the
  question set is small (22). So the gate has to be judged by the reporter's tree after publish (Phase 9 states this),
  and the hub set is a regression guard, not proof. Hub multi @1 is 3/8 on 1.15.0 and 4/8 to 6/8 on 1.20.0: no
  regression.
- **Negatives flagged fall 32 to 30 on the clone, 33 to 30 docs-copied** (real-corpus, 36 negatives): 1.16/1.17 cost
  two or three flagged negatives. This is the one consistent loss against 1.15.0. Hub negatives (3) are too few to read.
- **Grounding runs and is visible**: `grounding` is on 32 to 51 of 54 #1s on a clone (51 with the export, 32 without).
  The export raises the drift count a lot (the export dates each doc's body; the git fallback skips many docs).

### MCP-only bugs through the stdio `--read-only` launch
Launch as the plugin does it: `node dist/cli/index.js --notes .documentation --read-only`, cwd = the clone.
- **Entity card: does not reproduce on a ready index.** 4/4 identifier queries (`resolveDossierForPrompt`,
  `findLocalBin`, `runHealthcheck`, `scripts/link-skills.js`) return `entity` on 1.20.0 and local, with and without the
  export. CLI and stdio agree. 1.15.0 has no card (feature came later). With no `.git` (docs copied) there is no code
  graph: 0/4 by design.
- **`related` on #1: does not reproduce.** 1.20.0 averages 1.15 to 1.86 per #1 (1.15.0: 0.72 to 1.77). Never 0.
- **Result fields: do not reproduce on a ready index.** `section`, `anchor`, `decay` on 100% of #1s, `code` on 80 to
  85%, `grounding` where the doc has any, with or without the export (docs copied: no `grounding`, no code graph).
- **What does reproduce: the upgrade window.** An index built by 1.15.0 (schema 7), then served by the 1.20.0 stdio
  server: for the first answers (10 s on 133 docs; longer on a 919-doc tree) every `search_hybrid` is served from the
  old index with no `entity` card, no `section`/`anchor`, no `grounding`, because the old `docs.cache.json` has no
  `codeRefs`/`grounding` and the first reconcile has not re-parsed yet. After that all appear. That matches "fields
  missing / card missing over MCP" if the reporter probed right after updating the plugin, and the in-process and CLI
  runs always had a fresh index. Phase 3 decides the fix (not reproduced on a ready index is recorded; the upgrade
  window needs a decision: serve the code-dependent fields only once the reconcile ran, or mark the response).
  Probe: `$scratchpad/upg/upg.mjs` (not in the repo).
- **Not reproduced, so unverified against the reporter's tree**: their tree is private (919 docs).

### Eval changes made in this phase (reporting only, no ranking change)
`eval --json` now has `settings` (`granularity`, `decay`, `decay.code`) and per-arm `relatedPerTop`; the text report
prints both. Full gates green: lint, build, `npm test` (1156 passed, 5 expected fail), `npm run eval` (133 passed, 5
expected fail).

## Eval results: Phase 3 (bug fixes, no ranking change by design)
`npm run eval`: 135 passed, 5 expected fail (floors unchanged). The only ranking-adjacent change is grounding inputs (non-path
refs dropped, bare/full duplicates counted once, a doc never counts itself), which can only remove dead/drift entries; the real-corpus
eval copies `.documentation` only, so it does not exercise it. Phase 4 measures on a clone against 1.15.0 and 1.20.0.
`npm test`: 1165 passed; freshness-scale warm start and hook-failure Jev-hang failed under load and passed alone.
Reproduction status: stdio card, `related` and fields do not reproduce on a ready index (test/e2e/stdio-readonly.test.ts passes
on the 1.20.0 behaviour for the non-PascalCase parts); the PascalCase case and the upgrade-window note are the new regressions.

## Eval results: Phase 4 (grounding off the hot path), 2026-11-08
Same-run, `scripts/eval-against-release.sh`, one `git clone --local` per cell, `local` = this branch. Sets: train = real-corpus + real-hub
(39 answerable, 22 negatives); held-out = real-corpus-heldout + real-hub-heldout (37 answerable, 17 negatives). Noise about 1 case.

Tuning, train only, local build with a `vault.schema.yml` written into the clone (hybrid @1 of 39; multi @1 of 13):

| variant | no export | export |
|---|---|---|
| A: drift 0.97 per file, dead 0.95 (1.20.0 behaviour) | 26 (x3 runs), multi 8 | 27, multi 9 |
| B: drift off, dead 0.95 (new default) | 23 (x3), multi 7 | 26, multi 9 |
| C: drift off, dead 0.975 | 23 | 25 |
| D: grounding off | 23 | 23 |
| share-scaled drift 0.9 / 0.8 / 0.7 (dropped) | 23 / 23 / 23 | 26 / 24 / 24 |

Reading: dead refs move nothing on train (B = D without export), so dead_penalty stays 0.95. Per-file drift helps on train by 3 (no export)
and 1 (export); share-scaled drift does not help, so it was dropped and `drift_penalty` < 1 is kept as the plain opt-in (0.97 = 1.20).
The default is dead-only because the field report says drift costs hub docs the #1; this repo cannot show that effect.

Final, 1.15.0 / 1.20.0 / local (hyb@1, hyb@3, multi@1, negatives flagged):

| split | export | 1.15.0 | 1.20.0 | local |
|---|---|---|---|---|
| held-out (37) | no | 18, 30, 5/10, 15/17 | 19, 33, 6/10, 13/17 | **22**, 32, 7/10, 13/17 |
| held-out | yes | 18, 30, 5/10, 15/17 | 19, 31, 7/10, 13/17 | **22**, 31, 7/10, 13/17 |
| train (39) | no | 25, 32, 9/13, 19/22 | 26, 35, 8/13, 19/22 | **23**, 35, 7/13, 19/22 |
| train | yes | 25, 32, 9/13, 19/22 | 27, 35, 9/13, 19/22 | **26**, 34, 9/13, 19/22 |

Held-out is at or above both releases (+3 over each, multi @1 7/10 against 5/10 and 6/10). Train without an export is 2 below 1.15.0 and 3 below
1.20.0 (multi 7 vs 9 and 8): a missed target on that cell, in line with the tuning table (it is the cost of dropping per-file drift here).
Negatives flagged: 13/17 held-out (1.15.0: 15/17), unchanged from 1.20.0; Phase 4 does not touch that.
Gates: lint, build, `npm test` (1166 passed; hook-failure Jev-hang and one more load flake failed in the full run, hook-failure and freshness-scale
pass alone), `npm run eval` 135 passed, 5 expected fail. Floors: only codeGraph answer@1 9 -> 7 (see Errors Encountered).

## Eval results: Phase 5 (doc-level scoring), 2026-11-08
Same tool and sets as Phase 4 (`scripts/eval-against-release.sh`, one `git clone --local` per cell, `--reindex`). Variants were built behind a
throwaway env switch, measured on TRAIN only (real-corpus + real-hub, 39 answerable, 22 negatives), then the losers and the switch were removed.
The doc chunk is `title + purpose + first 40 headings + first paragraph (<= 500 chars)`, indexed as a `meta` chunk with `field: "doc"`, so it
rides the existing machinery (score = max(best body, `meta_weight` 0.8 x best meta); excerpt, `section`, `anchor` from the best body chunk).

Tuning (train, local build; hyb@1 / hyb@3 / multi@1 / negatives flagged):

| variant | no export | export |
|---|---|---|
| (a) best section only (today) | 23 / 35 / 7 / 19 (x3 runs, identical) | 26 / 34 / 9 / 19 |
| (b) max(best section, doc chunk) | **24 / 36-37 / 7 / 19** (x3 runs) | **27 / 35 / 9 / 19** |
| (c) best + 0.5 x doc chunk | 20 / 30 / 5 / 10 | 22 / 27 / 5 / 10 |
| (c) best + 1.0 x doc chunk | 21 / 28 / 5 / 10 | 23 / 28 / 6 / 10 |
| (d) title + purpose prepended to every section chunk | 25 / 32 / 8 / 19, `section` on 38 of 39 | 27 / 32 / 9 / 19, `section` on 38 of 39 |

Reading: (c) is out: a doc chunk that matches every broad question adds the same lift to most docs and costs 9 flagged negatives of 22 (10/22).
(d) wins one case at @1 but loses 3 at @3, drops one `section`, and re-embeds every chunk; BM25 also sees the prefix. (b) is +1 @1 and +1 to +2
at @3 in both cells, stable over three runs, costs nothing on negatives and re-embeds nothing but the new chunk. Kept (b). `meta_weight` was not retuned.
`INDEX_SCHEMA_VERSION` 9 to 10: a re-parse; vectors are keyed by chunk text, so only the new doc chunks embed.

Final, same run, 1.15.0 / 1.20.0 / local (hyb@1, hyb@3, multi@1, negatives flagged):

| split | export | 1.15.0 | 1.20.0 | local |
|---|---|---|---|---|
| held-out (37) | no | 18, 30, 5/10, 15/17 | 19, 33, 6/10, 13/17 | **22**, 32, 7/10, 13/17 |
| held-out | yes | 18, 30, 5/10, 15/17 | 19, 31, 7/10, 13/17 | **23**, 31, 7/10, 13/17 |
| train (39) | no | 25, 32, 9/13, 19/22 | 26, 35, 8/13, 19/22 | 24, 37, 7/13, 19/22 |
| train | yes | 25, 32, 9/13, 19/22 | 27, 35, 9/13, 19/22 | 27, 35, 9/13, 19/22 |

Held-out is above both releases (+4 over 1.15.0, +3 to +4 over 1.20.0) and was not used to choose anything. Train without an export is still
below both (24 vs 25 and 26; multi 7 vs 9 and 8): the Phase 4 miss (dropping per-file drift) is cut from 3 to 2 cases against 1.20.0 and 1 against
1.15.0, not closed. #1+related: 33/39 train, 29/37 held-out.

Cold index time (`--reindex` of the clone, vectors cold, same run; the machine was otherwise idle but 1.15.0 varied 19 to 33 s run to run):

| run | 1.15.0 | 1.20.0 | local |
|---|---|---|---|
| train sets, no export | 32.9 s | 34.0 s | 36.5 s |
| held-out sets, no export | 19.4 s | 33.3 s | 39.4 s |
| train sets, export | 20.0 s | 35.7 s | 37.4 s |
| held-out sets, export | 19.9 s | 36.9 s | 41.8 s |

The doc chunk adds about 7 to 17 percent over 1.20.0 (one extra chunk per doc, 133 docs on top of about 600 chunks); 1.20.0 is already slower than 1.15.0 on the
quiet runs (more section chunks, not measured separately). A section-eval floor and anchors are unchanged (`section`/`anchor` on every #1 of the
answerable questions where 1.20.0 has them).

Gates after the change: lint, build, `npm run eval` 135 passed / 5 expected fail, `npm test` 1166 passed (freshness-scale warm start and hook-failure
Jev-hang failed under load and pass alone). Tests and fixtures changed because the doc chunk is one more embedded chunk per doc:
- `get_stats` golden: totalChunks/totalEmbeddings 17 to 27 (test/regression snapshot);
- `single-source-snapshot.json`: three score values re-taken; paths, order and fields are identical (checked query by query);
- `freshness.test.ts`: an edit re-embeds the doc's body chunks plus its summary chunk;
- `stale-audit.mjs` counts meta chunks as current chunks (its index-mismatch check compared body chunks with the whole HNSW metadata);
- docs-eval "mode flow" invariant relaxed by one question (see Errors Encountered).
The doc chunk never shows as `matched` (that field names an authored metadata field), so result items keep their v1.20 fields.
Phase 10 docs: INDEX_SCHEMA_VERSION 10, the doc summary chunk (retrieval-tuning-guide, indexing docs), `eval-against-release.sh` prints cold index time.

## Eval results: Phase 6

`npm run gate:release -- 1.20.0` (scripts/gate-release.sh, held-out real-corpus + hub sets combined, clones, no export):

| run | hyb@1 | multi@1 | sem@1 | neg flagged |
|---|---|---|---|---|
| 1.20.0 | 19/37 | 6/10 | 16/37 | 13/17 |
| local | 22/37 | 7/10 | 15/37 | 13/17 |

PASS (band 1). The two sets run as one eval, so the gate is one combined number, not one per set. The default previous version is the newest published below package.json's version (1.19.0 until the Phase 7 bump; same ranking numbers as 1.20.0). Cold index 60 s vs 76 s.

## Eval results: Phase 9 (review and #71 checks), 2026-11-08
Same run per set, `scripts/eval-against-release.sh --set <file> 1.15.0 1.20.0 local`, clones, no export, one run per cell (noise about 1 case).
Nothing here was used to choose a constant; Phase 9 changed no ranking code.

| set | run | hyb@1 | hyb@3 | multi@1 | #1+rel | rel/#1 | neg flagged |
|---|---|---|---|---|---|---|---|
| real-corpus held-out (27) | 1.15.0 | 14 | 21 | 4/6 | 18 | 0.74 | 15/16 |
| | 1.20.0 | 15 | 25 | 4/6 | 20 | 1.15 | 13/16 |
| | local | 16 | 23 | 4/6 | 21 | 1.15 | 13/16 |
| hub held-out (10) | 1.15.0 | 4 | 9 | 1/4 | 6 | 1.8 | 0/1 |
| | 1.20.0 | 4 | 8 | 2/4 | 7 | 1.9 | 0/1 |
| | local | 6 | 9 | 3/4 | 8 | 1.3 | 0/1 |
| real-corpus train (27) | 1.15.0 | 19 | 23 | 7/9 | 22 | 0.78 | 17/20 |
| | 1.20.0 | 20 | 25 | 6/9 | 22 | 1.33 | 17/20 |
| | local | 18 | 27 | 4/9 | 23 | 1.26 | 17/20 |
| hub train (12) | 1.15.0 | 6 | 9 | 2/4 | 7 | 1.75 | 2/2 |
| | 1.20.0 | 5 | 10 | 2/4 | 8 | 1.83 | 2/2 |
| | local | 6 | 10 | 3/4 | 10 | 1.58 | 2/2 |

Release gate, `npm run gate:release` (default previous = 1.20.0 now that package.json is 1.21.0; both held-out sets in one eval):
1.20.0 19/37, multi 6/10, neg 13/17; local 22/37, multi 7/10, neg 13/17. PASS. `git status` after: clean (no write into the repo).
Combined held-out against 1.15.0 (sum of the two rows above): 1.15.0 18/37, multi 5/10, neg 15/17; local 22/37, multi 7/10, neg 13/17.
Combined train: 1.15.0 25/39, multi 9/13, neg 19/22; 1.20.0 25, 8/13 (Phase 5 table: 26); local 24/39, multi 7/13, neg 19/22.

### Answers to the #71 checks
1. Real-corpus held-out hybrid @1 and multi @1 at or above 1.15 within the band: MET (16 vs 14; 4/6 vs 4/6).
2. Hub set too: held-out MET (6 vs 4; 3/4 vs 1/4). Hub train MET (6 vs 6; 3/4 vs 2/4). NOT MET on the real-corpus TRAIN set: hybrid @1 18 vs 19 (inside the band) but
   multi @1 4/9 vs 7/9 in this run (Phase 5 measured 7/13 vs 9/13 over train as a whole). That is the Phase 4 cost of dropping per-file drift, only partly recovered
   by the doc chunk. Train and held-out disagree on direction; the reporter's tree decides.
3. Anchors point at the matching section: MET. Section eval green in `npm run eval` (135 passed, 5 expected fail); `section`/`anchor` on every #1 of every set
   (one probe run showed 8 of 10 on the hub held-out; re-run three times gave 10 of 10 each time, so it was the probe skipping answers it could not parse; the probe now retries
   and prints `skipped`).
4. `related` on #1 averages >= 1 without the export: MET on every set (1.15 to 1.58 local; 1.15.0 itself is 0.74 and 0.78 on the real-corpus sets).
5. `search_hybrid` over the stdio server returns the CLI's entity card: MET, 4/4 identifier queries on local (1.15.0: 0/4, the feature came later);
   test/e2e/stdio-readonly.test.ts covers the PascalCase case. The reporter's missing card was not reproduced on a ready index; the upgrade window is only marked (note).
6. `decay.code` can be switched off and `eval` prints it: MET. `decay: {code: false}` gives `settings: ... decay.code=off` (checked on a clone; unit test added in suite.test.ts).
7. `TaskResponse`-style identifiers classified `identifier` when the graph knows them: MET (stdio e2e: `query_type` identifier + entity card; a prose `SessionEnd` stays prose).
8. `negative: true` rows scored as negatives: MET (suite.test.ts, normalizeCase in loadSets).
9. Negatives flagged at the 1.15 level with no new false flags: NOT MET. Real-corpus held-out 13/16 vs 15/16 for 1.15.0 (same as 1.20.0); gate sets 13/17 vs 15/17. Train and hub equal.
   Nothing in 1.21.0 addresses it; it dates from 1.16/1.17. "No new false flags" holds (answered@1 flagged is not worse than 1.20.0).

### Review of `git diff main...HEAD` (adversarial)
- Constants tuned on held-out: no. Phase 4/5 tuning tables are train only; held-out appears only as the final measurement. Gate band (1 question) is a noise allowance, not a tuned value.
  The one test relaxation (docs-eval `at[3] - 1`) and the graph-eval floors 9 to 7 follow measured train/fixture results and are recorded.
- A second identifier detector: no. PASCAL lives in `identifiers()` (the single detector) and is gated by `knownToCode`. `classifyQuery`, `entityCard`, `missingTerms`, MCP and CLI all pass it.
- Anchors: `section`/`anchor` come from the best body chunk; the `field: "doc"` chunk never sets `matched` (vector.ts). Verified by the section eval and the probe.
- MCP/CLI drift: both call `knownToCode`; the CLI loads the code graph for any 2+-capital PascalCase word (one git call, perf only). Parity tests pass.
- `content[0]`: unchanged JSON array; the stale note is a trailing block.
- Gate script writes: none. Temp dirs under TMPDIR, `--dir` for eval output, `git status` clean after a full gate run.
- Bug fixed: `scripts/lib/eval-probe.mjs` silently skipped answers it could not parse and under-counted fields (one run showed section 8 of 10). It now retries up to 3 times and prints `skipped`.
- Risks recorded, not fixed (out of scope or by plan):
  - Schemas installed by 1.16 to 1.20 (`install_schema`, from the old template) hold `drift_penalty: 0.97` explicitly, so the new default does not reach them; those users need `drift_penalty: 1` or `code: false`. Phase 10 docs must say so.
  - The path-shape rule drops bare refs with no `/` and no extension (`Makefile`, `Dockerfile`), so they never count as dead or drifted. By the plan's rule.
  - `gate-release.sh` parses the table by column position, and the default previous-version lookup needs network.

### Full suite
lint 0, build 0, `npm test` 1166 passed, 2 failed (freshness-scale warm start, hook-failure Jev hang: both pass alone, 16 tests), `npm run eval` 135 passed, 5 expected fail.
After adding one test (suite.test.ts) and the probe fix: lint green, suite.test.ts passes.

### Not met, stated plainly
- Real-corpus train multi @1 below 1.15.0 (4/9 vs 7/9 this run; 7/13 vs 9/13 over train as a whole) and train hybrid @1 without an export 24 vs 25.
- Negatives flagged 13/16 and 13/17 on held-out vs 15/16 and 15/17 for 1.15.0.
- The reporter's #1 loss does not reproduce on this repo; their set C / A+B numbers are re-run by them after publish.

## Eval results: Phase 10 (docs)
`npm run eval` after the docs: 136 passed, 5 expected fail (no floor moved; hub pages got one or two sentences, new material is in v1-21-0-hub-doc-ranking.md and a new KB fact). Changelog numbers are the Phase 9 same-run tables.
