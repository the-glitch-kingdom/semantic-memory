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
