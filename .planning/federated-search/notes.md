# Notes: federated-search

## Verification against main @ 29e74db (2026-11-08, read-only agent)
- **One server per index: true.**
  - `buildContext` hardcodes `join(notesPath, ".semantic-sidekick-index")` (`src/mcp/context.ts:142`), and so does the CLI (`src/cli/search.ts:65`).
  - `--notes` is required (`src/cli/index.ts:621`).
- **"The agent has to guess which server": half true.**
  - The prompt hook already searches every `semantic-*` server: one CLI per source, merged by raw, uncalibrated score, with `source` added only when there are several (`hooks/vault-context.js:44-80,120-129`).
  - The MCP tools do not federate.
- **Freshness:** a throttled pull reconcile (`ensureFresh`, `context.ts:537-544`) with one writer at a time through `index.lock` (`index-store.ts:106`). A `--read-only` server still writes its index into the tree (`context.ts:662`).
- **`related_repos`: confirmed.**
  - It lives at `<root>/.claude/hit-em-with-the-docs.json` → `reconcile.related_repos: [{name, path}]`, with the path relative to the project root (`hit-em-with-the-docs/src/utils/config.ts:195-199,228,290`; `docs/reconcile.md:228`).
  - It points at a repo root, not a docs tree. The docs tree is that repo's own `docs_root`, default `.documentation` (`config.ts:15,266`).
  - hewtd treats siblings as read-only.
- **Calibration model exists.**
  - `bm25SelfTop` (median top score of title self-queries) is stored in `meta.json` (`bm25.ts:157-162`, `context.ts:468`), and `bm25Min = selfTop * 0.8` (`context.ts:673-676`).
  - The fused score normalizes BM25 by this query's own best match (`bm25.ts:135-145`), so raw fused scores from two indexes compare different things.
  - The cosine cutoff 0.36 is shared (`confidence.ts:5`), so cosines are comparable with the same model.
- **Memory.**
  - Each `buildContext` makes its own Embedder (`context.ts:147`), about 180-200 MB RSS per ONNX instance (`server.ts:121-123`).
  - A 538-doc index on disk: docs.cache 11.4 MB, hnsw-meta 5.3 MB, hnsw.bin 4.7 MB, graph 0.6 MB, embeddings.json 22 MB (read only when embedding).
  - Estimated 50-100 MB heap per source with a shared embedder (not measured).

## Eval results: Phase 2
Config only; no retrieval change. `npm run eval` green (14 files, 125 passed, 5 expected fail); real-corpus numbers unchanged
(train @1 21/27 @3 25/27 @8 27/27; held-out @1 18/27 @3 25/27 @8 27/27). Unit: test/unit/federation.test.ts (7 tests).

## Eval results: Phase 3
Plumbing only; no retrieval change. `npm run eval` green (14 files, 125 passed, 5 expected fail); fixture train/heldout @1 9/9 @3 9/9 unchanged.
Integration: test/integration/federation-sources.test.ts (source built under primary index dir, source tree mtimes unchanged,
no index dir in source, missing and chmod 000 paths each reported once, shared embedder).

## Eval results: Phase 4
Calibration chosen on TRAIN only (docs-vault train questions from golden-docs.jsonl with one facet, mapped to the docs holding the facet, 44 questions; plus the 14 questions of golden.jsonl for test/fixtures/vault; 58 total; both orientations, so each fixture is primary once, weight 1). found@1 / found@3 with the expected path AND source:

| calibration | docs primary + vault source | vault primary + docs source |
|---|---|---|
| raw fused | 45 / 53 | 39 / 47 |
| BM25 / selfTop (capped 1) | **46 / 54** | **46 / 54** |
| RRF | 36 / 52 | 11 / 49 |

Chosen: selfTop. It is also the only one that does not depend on which vault is primary. The two others were removed.
Held-out (golden-docs-heldout.jsonl, 29 single-facet questions, docs-vault answers, vault as distractor; measured once per arm, not used to choose): selfTop 22 / 26, raw 21 / 25 (docs primary), 18 / 19 (vault primary), RRF 22 / 24 and 0 / 22. The cross-source held-out set is Phase 5.
Single-source: test/integration/single-source-snapshot.test.ts compares 10 search_hybrid calls on docs-vault with a snapshot taken from the v1.18.0 code before the extraction (numbers within 1e-4, everything else exact, one content block, no `source`). Real-corpus and fixture eval numbers unchanged (npm run eval: 14 files, 125 passed, 5 expected fail).
Tests: test/unit/federation-merge.test.ts (5), test/integration/federated-search.test.ts (4: skipped source in trailing block, labels from both sources, read_note source, per-source order, nothing written into a source).

## Eval results: Phase 5
Fixture: docs-vault (primary) + vault (source "vault"); test/retrieval-eval/federation-eval.test.ts. found@k with source-qualified paths (train 21 cases, held-out 20; measured once, nothing tuned):

| split | joint federated @1 / @3 | docs alone @1 / @3 | vault alone @1 / @3 | primary-own federated @1 vs alone | vault-own federated @1 vs alone |
|---|---|---|---|---|---|
| train | 17 / 20 of 21 | 11 / 12 | 8 / 8 | 10 vs 10 | 7 vs 8 |
| held-out | 16 / 20 of 20 | 10 / 13 | 8 / 8 | 9 vs 10 | 6 vs 7 |

Federated found@3 beats either alone on both splits; per-source @1 is within one case of alone. Misses: train 1 of 21 at @3, held-out 0.
