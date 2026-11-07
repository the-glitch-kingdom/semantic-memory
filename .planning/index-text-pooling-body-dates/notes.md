# Notes: index-text-pooling-body-dates

## Verification against main @ 93ab5f2 (2026-11-07)

### #51 remaining items
- **`s.toLowerCase is not a function`: cause reproduced.** A YAML `title: 2024` parses as a number and
  `title: 2024-05-01` as a Date. `Indexer.indexFile` keeps it (`(frontmatter.title as string) || ...`,
  `src/core/indexer.ts:113`). `bm25SelfTop` (`src/core/bm25.ts:157`) runs `index.search(d.title)` →
  `tokenize(s)` → `s.toLowerCase()` throws with exactly the reported message. Reproduced in a vitest scratch test.
  - Hybrid only: `bm25Min()` → `selfTop()` is called by `search_hybrid` (`shape(..., ctx.bm25Min())`), not by
    `search_semantic`.
  - Repeats every call: `selfTopCache` is only set on success (`src/mcp/context.ts:229`).
  - Breaks the save: `commitIndex` meta calls `selfTop()` (`context.ts:455`), so a refresh that hits it never commits
    and is retried on the next start.
  - Intermittent (likely, not proven): `bm25SelfTop` samples every ⌈n/200⌉th titled doc (every 4th on a 751-file
    tree); a reconcile changes the position of changed docs in `documents`, so the bad doc is sampled on some runs
    only. An index whose meta already holds `bm25SelfTop` never recomputes.
- **Stale marker:** the published 1.11.0 tarball (`dist/mcp/server.js:6105-6126`) already appends a separate
  `{type:"text"}` block; `content[0]` is the JSON. The reporter's harness joins text blocks. Real bug: `CHANGELOG.md:13`
  says responses "start with" the marker.
- **Outdated description:** "re-ranked by graph proximity" in `src/mcp/tools/search.ts:158`,
  `src/mcp/tools/inventory.ts:25`, `src/cli/index.ts:216`.
- `meta_weight` / `NO_STRONG_MATCH_BELOW` question: answered in the #48 closing comment.
- Not split into issues (left in #51): identifier-aware fusion or RRF, "#1 + related" metric, blind set as CI floor.

### #52 stripMarkdown
- `src/core/indexer.ts:272`. Input `` Run `check_rls_coverage.py` first. `` + `plain check_rls_coverage` + an env-var
  table + a fenced block gives `"Run  first.\n\nplain checkrlscoverage here\n\nHeading"`.
- The stripped text feeds embedding (chunks), BM25 (`bm25.addDoc(d.path, d.chunks, ...)`) and `search_text`
  (`doc.content = plainText`, `src/core/search-text.ts`).
- The BM25 tokenizer already keeps `_` (`[\p{L}\p{N}_]+`); only the stripper breaks snake_case.

### #53 pooling
- `embedder.ts` (`meanPoolAndNormalize`, `meanPoolAndNormalizeMany`) and `embed-worker.ts`
  (`meanPoolAndNormalizeMany`) always mean-pool. No query/document distinction exists.
- Hugging Face configs (fetched 2026-11-07):
  - `BAAI/bge-small-en-v1.5`: `pooling_mode_cls_token: true`; no prompts in `config_sentence_transformers.json`;
    `onnx/model.onnx` exists.
  - `Snowflake/snowflake-arctic-embed-s` and `-xs`: CLS; `prompts.query` = "Represent this sentence for searching
    relevant passages: "; `onnx/model.onnx` exists.
  - `sentence-transformers/all-MiniLM-L6-v2`: mean.
- So arctic's poor result in #53 is likely pooling + the missing query prompt.
- `nomic-embed-text-v1.5` is in `ONNX_MODEL_PATHS` and likely needs `search_query:` / `search_document:` prefixes
  (unchecked).
- The model-mismatch reindex check is at `src/mcp/context.ts:245` (model + dimensions only).

### #54 git dates
- `gitCommitDates` (`src/core/git-dates.ts`) keeps only the first (newest) entry per path from
  `git log --raw --no-renames --no-abbrev --format=%ct`. The caller (`src/mcp/context.ts:361-378`) uses it only when
  the newest blob matches the file on disk.
- Plan: keep the per-path blob list from the same log, read blobs via one `git cat-file --batch`, walk back to the
  first body change. A bulk frontmatter commit costs ~2 blob reads per file.

## Baselines
- (Phase 3)

## Append-Only Log
### 2026-11-07
- Plan written; one plan for #51 leftovers + #52 + #53 + #54 (shared schema bump and re-embed).
