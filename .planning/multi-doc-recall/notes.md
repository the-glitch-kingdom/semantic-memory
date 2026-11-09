# Notes: multi-doc-recall (#76)

## Phase 1: verification (main @ 066c730, v1.22.0)

### Same-run measurement on this repo
`scripts/eval-against-release.sh`, `git clone --local` trees, all 8 in-repo sets (real-corpus, real-hub, long-section and long-section-hard, each train and held-out; 129 answerable, 23 multi). Hybrid; CLI and MCP agree on every row.

| version | all @1 | multi @1 | multi @3 | multi @8 |
|---|---|---|---|---|
| 1.15.0, no export | 94 | 14 | 18 | 22 |
| 1.21.0, no export | 90 | 14 | 20 | 23 |
| 1.22.0, no export | 97 | 16 | 21 | 22 |
| 1.15.0, export | 94 | 14 | 18 | 22 |
| 1.21.0, export | 94 | 16 | 20 | 23 |
| 1.22.0, export | 99 | 14 | 19 | 22 |

**The multi-doc regression did not reproduce here.** 1.22.0 is at or above 1.15.0 at every depth. These multi questions have 2 facets each, and this repo has no long "operator notes" hub docs or short broad vocabulary docs. That shape is what the reporter describes, so Phase 2 must build it.

### Mechanism confirmed in code (matches the reporter's hypothesis 1)
- `src/core/vector.ts` `search(q, k)` asks HNSW for k nearest **chunks**, then groups them by doc (best body chunk, best metadata chunk). The number of distinct docs returned is therefore at most k, and is smaller whenever one doc owns several of the k chunks.
- Callers pass `limit * 3`: `src/mcp/tools/search.ts:119` and `:172`, `src/cli/search.ts:156`. Graph seeds pass `GRAPH_SEARCH_SEEDS * 3`.
- Chunk counts rose twice since 1.15.0:
  - schema 9 (`d677a76`, 1.16): chunks split at headings;
  - schema 11 (`d5ff988`, 1.22.0): 1000-character windows. On this repo, 1113 chunks became 1326.
  A long hub doc with many sections near the query now fills more of the 24 neighbour slots. That leaves fewer distinct docs for fusion and the top 8, which is the multi @8 loss.
- BM25 (`src/core/bm25.ts`) already returns one result per doc (its best chunk), so the shrink is semantic-arm only.

### Other candidates (unmeasured, for Phase 4/5)
- Summary chunk (`5b7d7a9`): a doc scores max(best section, summary). A short doc is one chunk and its summary, so both match broadly. This may explain the reporter's "vocabulary doc in the top 3 of 4-5 questions".
- #73's open lead: without doc metadata, hybrid @1 was 51 against 46. Priority, decay, path class or fold costs about 5 @1 on real-corpus, and this has not been decomposed.
- Export path: grounding, `related`, duplicates or fold may push exact-term hub docs down (the d1b-only C14 and C22).

### Raw logs
Scratchpad only: `r76-noexp.log` and `r76-exp.log`, with per-question JSON under `g76n/` and `g76e/`.
