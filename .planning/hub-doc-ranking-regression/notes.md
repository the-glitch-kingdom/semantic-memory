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
