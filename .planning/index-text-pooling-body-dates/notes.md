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
Phase 3, measured on feat/index-text-pooling-body-dates @ a91ddbc (Phase 2 code; ranking, indexing and decay unchanged since main @ 93ab5f2). `npm run eval`, one run.
Existing splits (answer@1 / @3, floors in baseline.json untouched):
| split | semantic | hybrid |
|---|---|---|
| fixture train (57) | 39 / 50 | 38 / 52 |
| fixture held-out (36) | 23 / 31 | 25 / 29 |
| real train (27) | 15 / 22 | 21 / 27 |
| real held-out (27) | 13 / 19 | 15 / 23 |
Fixture search_text train: 20 / 41. Negatives flagged (hybrid): fixture train 11/12, held-out 7/8, real train 12/12, held-out 7/8. hnsw recall 1.000. Golden-14 eval: recall@1 86%, @3 100%.

#52 code-vault (`code-eval.test.ts`, `test/fixtures/code-vault`, 20 answer docs each with a same-topic distractor; answer ranked first):
| split | arm | all | backtick | fence | table | snake | plain (control) |
|---|---|---|---|---|---|---|---|
| train | semantic | 9/10 | 1/2 | 2/2 | 2/2 | 2/2 | 2/2 |
| train | hybrid | 9/10 | 1/2 | 2/2 | 2/2 | 2/2 | 2/2 |
| train | search_text | 2/10 | 0/2 | 0/2 | 0/2 | 0/2 | 2/2 |
| held-out | semantic | 5/10 | 1/2 | 1/2 | 0/2 | 1/2 | 2/2 |
| held-out | hybrid | 6/10 | 2/2 | 2/2 | 0/2 | 0/2 | 2/2 |
| held-out | search_text | 2/10 | 0/2 | 0/2 | 0/2 | 0/2 | 2/2 |
Reading: search_text finds none of the 16 code-only terms (the text is stripped), the control passes. The embedding arms still
find many answer docs because the answer prose around the identifier (and the topic words in the question) leaks the topic; so
search_text is the sharpest #52 arm and hybrid/semantic the end-to-end one. Questions were fixed before any run and not edited after.
The 6 it.fails gates (code-only terms all ranked first, per arm and split) pass as expected failures; Phase 5 turns each that starts
passing into a real gate (a semantic arm may never reach 8/8 on held-out; report as measured).

#54 decay fixture, new tier `frontmatter-touch` (twin: no last_verified, body 400 days old, frontmatter-only commit today via
`touched.json`; answer verified 5 days ago; 3 train + 3 held-out cases):
| split | arm | frontmatter-touch (answer first) | twin decay block |
|---|---|---|---|
| train | semantic / hybrid | 3/3 / 3/3 | multiplier 1.0, source git |
| held-out | semantic / hybrid | 2/3 / 2/3 | multiplier 1.0, source git |
Existing tiers unchanged: unverified 4/4 (both splits), old-verified 2/2.
Deviation from the plan's expectation ("the unverified doc wins"): the twin is dated today (multiplier 1.0 vs the answer's 0.989) but the two docs are
near-identical, so relevance decides and the answer still wins 5 of 6. The sharp gate is the twin's decay block: multiplier 1.0 now, ~0.47 (400 days)
after Phase 4. Gates: train beats-twin is a real gate; held-out beats-twin (2/3 now) and the "touched twin decays as 400 days
(multiplier < 0.6, source git)" check for both splits are it.fails until Phase 4.

## Append-Only Log
### 2026-11-07
- Plan written; one plan for #51 leftovers + #52 + #53 + #54 (shared schema bump and re-embed).

### Phase 2 findings (2026-11-07)
- Background refresh that throws: `runReconcile` and `backgroundIndex` catch, log `err.message`, set state `stale`, and
  `ensureFresh` awaits a promise that never rejects. So later calls keep serving the old index; the refresh is retried
  on the next throttle window. Only search_hybrid failed (bm25Min -> selfTop in the tool). No behaviour change needed;
  the log now carries `err.stack` instead of the message.
- Fix: `Indexer.indexFile` coerces title (Date -> YYYY-MM-DD, array -> space-joined, number -> String); `bm25SelfTop`
  skips non-string titles. Tests: `test/unit/bm25.test.ts` and `test/integration/non-string-title.test.ts` both fail with
  "s.toLowerCase is not a function" on the unfixed code (checked by stashing the two src files).
