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
