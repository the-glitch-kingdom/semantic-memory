# Notes: v191-ranking-regression

## Source
Issue #43 (2026-11-07 UTC, TheGlitchKing): v1.9.0 vs v1.7.2 on a 751-doc + 279-archive corpus.
Hybrid answer@1 0.64 -> 0.57 overall; held-out set 0.71 -> 0.52. Offline replica of proposed fixes: 0.77.
Full text: `gh issue view 43 --repo the-glitch-kingdom/semantic-memory`.

## Verification (2026-11-06, main @ 448c518, v1.9.0)

| Finding | Verdict | Where |
|---|---|---|
| 1. Rank-only RRF k=60 displaces a correct semantic #1 | Confirmed | `src/core/bm25.ts:5,107-125` |
| 2. HNSW at default ef | Confirmed: no `setEf`. Measured here (2,764 test-vault vectors, 60 midpoint queries, k=24): recall 0.935 default, 0.984 ef=50, 0.988 ef=100, 0.991 ef=200. Top-1 agreement unreliable there (embeddings.json holds duplicate vectors) | `src/core/vector.ts:42,79,123` |
| 3. Excluded paths embedded/indexed | Confirmed. `IGNORE_GLOBS = ["**/node_modules/**"]` only; the v1.9.0 plan's "shared ignore globs with path_class.exclude" box was ticked but not done | `src/core/indexer.ts:19` |
| 4. Confidence margin term is noise; `no_strong_match` told to mean "not documented" | Confirmed | `src/core/confidence.ts:15-22`, `src/mcp/server.ts:97` |
| 5. Upgrade re-embeds everything, no service meanwhile | Confirmed: key `sha256(model\0text)`, no migration from `path:chunkIndex`. v1.9.0 changelog lines 40, 87 wrongly claim "vectors are kept" | `src/mcp/context.ts:179` |
| search_text unranked | Confirmed; and v1.9.0 sorted the file list, so it is alphabetical | `src/core/search-text.ts` |
| graph_path one-directional | Confirmed: out-edges only | `src/core/graph.ts:176-188` |
| backlinks/forwardlinks ignore exclude | Confirmed | `src/mcp/tools/graph.ts:14,25` |
| title repeats path | Confirmed: `title: meta.docPath` / `title: path` | `src/core/vector.ts:92`, `src/core/bm25.ts:98` |
| --read-only writes into notes tree | Confirmed: `deriveSessionDir("./.documentation")` = `.documentation/.claude/.semantic-memory/`; readOnly does not gate telemetry. Hidden here by a broad .gitignore rule | `src/core/session.ts:264-274`, `src/core/telemetry.ts:40` |

## Why the v1.9.0 eval missed it
- No gate compared hybrid with semantic on the same split; floors only compared against earlier floors.
- The real-corpus benchmark compared v1.8.0 hybrid with v1.9.0 hybrid, keyword-heavy questions.
- Phase 5 already showed hybrid @3 below vector-only after fusion (30 vs 32 of 35).
- No held-out split: thresholds (abstention 0.50) were fitted and judged on the same cases.

## Eval results
(per phase)
