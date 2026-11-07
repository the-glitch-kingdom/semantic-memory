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

## Eval results: Phase 4 (body dates)
Decay fixture (answer ranked first), tier `frontmatter-touch`: train semantic 3/3, hybrid 3/3; held-out semantic 3/3, hybrid 3/3 (was 3/3 and 2/3). Twin decay block: ~400-day
age, multiplier < 0.6, source git, both splits. unverified 4/4 and old-verified 2/2 unchanged. Three it.fails gates are now real gates
(held-out beats-twin, twin multiplier x2 splits). `npm run eval`: 51 passed, 11 expected-fail (was 48 / 14). Other splits unchanged (hybrid fixture train 38/52 class,
real train 21/27, real held-out 15/23, #52 code-vault as in Baselines); no ranking code besides decay input changed.
Unit: test/unit/git-body-dates.test.ts (frontmatter-only skipped, body edit resets, first commit, delete/restore). PATH-spy (one log, <=1 cat-file) is Phase 9.

## Eval results: Phase 5 (indexed text, #52)
Option (a) = same kept text for BM25 and vectors (chosen). Option (b) = fenced block contents dropped from the text (inline code, tables kept); measured with a scratch env switch on stripMarkdown (reverted), so BM25 also lost the fence text in (b).
| split | arm | before | (a) | (b) |
|---|---|---|---|---|
| code-vault train | semantic / hybrid / search_text | 9 / 9 / 2 of 10 | 10 / 10 / 10 | 10 / 10 / (not read) |
| code-vault held-out | semantic / hybrid / search_text | 5 / 6 / 2 of 10 | 10 / 10 / 10 | 9 / 10 / (not read) |
| fixture train (57) @1 | semantic / hybrid | 39 / 38 | 42 / 43 | 42 / 43 |
| fixture held-out (36) @1 | semantic / hybrid | 23 / 25 | 25 / 26 | 25 / 26 |
| real train (27) @1 | semantic / hybrid | 15 / 21 | 19 / 22 | 19 / 20 |
| real held-out (27) @1 | semantic / hybrid | 13 / 15 | 12 / 17 | 10 / 17 |
The fixture docs-vault has no fenced blocks, so (a) and (b) are identical there. Choice from TRAIN only: (a) ties or wins (real train hybrid 22 vs 20); held-out shown as measured and also favours (a). No second chunk text, no extra vectors.
Cold build of a copy of .documentation (one run each, load-noisy): v1.11 text 14.9 s, (a) 29.5 s, (b) 36.7 s (first run included a model load); more chunks than before because code is kept.
Regressions under (a) (floors lowered, see plan Errors Encountered): some prose tiers lose 1 case; real-train hybrid negatives flagged 12/12 -> 9/12 (known failure now); real held-out semantic paraphrase 8->6 @1. `npm run eval` all other gates pass.

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

## Eval results: Phase 6 (#53 pooling and query prompt)
Default (MiniLM) after the change: `npm run eval` 56 passed, 6 expected-fail, same as Phase 5; MiniLM vectors byte-identical (test).
Other models, same code, `EVAL_MODEL=<model> vitest run test/retrieval-eval` (fp32, pooling and prompt read from the model's own config: bge = CLS, no prompt; arctic-s = CLS + "Represent this sentence for searching relevant passages: "). One run each; floors fail for these models by construction, numbers are answer@1 / @3.
| split | MiniLM sem | bge-small sem | arctic-s sem | MiniLM hyb | bge-small hyb | arctic-s hyb |
|---|---|---|---|---|---|---|
| fixture train (57) | 42 / 53 | 39 / 51 | 40 / 53 | 43 / 55 | 40 / 52 | 41 / 53 |
| fixture held-out (36) | 25 / 31 | 21 / 29 | 24 / 31 | 26 / 30 | 23 / 30 | 25 / 30 |
| real train (27) | 19 / 23 | 12 / 18 | 12 / 18 | 22 / 25 | 20 / 25 | 18 / 22 |
| real held-out (27) | 12 / 16 | 6 / 11 | 7 / 12 | 17 / 24 | 13 / 17 | 13 / 20 |
- Neither model beats MiniLM on any split, with or without the right pooling/prompt. #53's premise (arctic is poor because of pooling and prompt) is only partly supported: with both applied arctic-s is within 1 to 3 on the fixture and still 5 to 7 behind on real semantic. No default change (as planned).
- Confound: `no_strong_match` thresholds are calibrated on MiniLM scores, so other models flag 0 negatives of 12 and 8 (MiniLM 11/12 and 8/8). Those flag counts say nothing about the models' ranking.
- Decay and code tiers pass fully for both models (10/10 and 9/9 per arm).
- nomic-embed-text-v1.5 was not measured (slow on CPU; it needs manual `search_query: ` / `search_document: ` prefixes).
- Unmeasured: the old no-pooling bge/arctic numbers (mean pooling, no prompt) were not re-run, so the gain from the fix itself is not quantified.

## Phase 9: review and validation (2026-11-07)
Review of `git diff main...HEAD`:
- Git calls: none at query time; build/reconcile runs one `git log --raw` and at most one `git cat-file --batch` (spawned only if some path has 2+ commits). New integration test with a PATH spy (decay-fallback.test.ts) counts 1 log, <=1 cat-file, 0 per query.
- Body dates across content change: a changed doc is re-parsed (new object, no gitDate) and re-dated only if its disk bytes equal the newest blob; otherwise penalty. Frontmatter split is the same exported `parseFrontmatter` as the indexer. Schema 6 -> 7 test: a stale newest-commit gitDate is replaced by the body date (399+ days).
- Query prompt: only `embedQuery` prepends it; `embed`/`embedBatch`/worker never do (test). All query callers use `embedQuery` (grep: no `embedder.embed(` on a query remains). Pooling/prompt/model change in meta forces reindex in context.ts and a mismatch error in cli/search.ts. MiniLM vectors byte-identical (test vs fixture).
- stripMarkdown (fixed in Phase 9, regression tests in strip-markdown.test.ts): `*` was stripped inside words (`2*3`, `a*b` became `23`, `ab`); now stripped only at word edges like `_`. Fence lines were only recognised with <=3 spaces of indent, so a fence inside a list kept its "```sh" text; now any indent, and a one-line "```cmd```" no longer loses its command. No schema bump needed (7 is unreleased).
- Floors: every lowered floor and every flipped it.fails is recorded in the plan under Errors Encountered (diff of baseline.json, docs-eval, real-corpus-eval matches the list).
- Left as is: `#` comment lines and a leading `>`/`|` inside fenced code lose that marker (harmless to tokens); `__init__` outside code loses underscores (documented shortcut); the 20-commit walk bound.
Gate proof: replacing the inline-code unwrap with a drop made 5 code-eval gates fail (train search_text/hybrid/semantic, held-out search_text/semantic); reverted.
Suite: lint, build, eval (56 passed, 6 expected fail) green. `npm test`: 908 passed, 1 failed (skill-eval concurrency, known flake, 22/22 alone).
Offline tarball (d361527, built before the Phase 9 stripMarkdown tweak, so it holds the older text rule): extracted, `install-offline.sh --prefix <scratch>` installed, `--verify` OK (9988 files match), `node dist/cli/index.js --version` prints 1.12.0, pooling configs present for bge/arctic. Must be rebuilt anyway (clean cache, from the merge commit).

### Acceptance answers
#51
- stale marker as a separate block: already true in 1.11.0 (content[0] is plain JSON); CHANGELOG wording fixed. Met.
- `s.toLowerCase` crash: root cause was a non-string `title` (number/Date); coerced in the indexer and skipped in bm25SelfTop; two regression tests that fail on the old code. The reporter's "bad state after a partial refresh" theory was not the cause. Met.
- search_hybrid description without graph boost (3 places + AGENTS.md): met. Background refresh errors now log the stack: met. Uncommitted-edit penalty note for the changelog: Phase 10.
- Not done (left in #51 by agreement): identifier-aware fusion/RRF, "#1 + related" metric, blind set as CI floor.
#52
- backtick-only `check_rls_coverage.py` found: met (code-vault: search_text/hybrid/semantic 10/10 train and held-out, was 2/10 text).
- env var only in a table cell found by search_hybrid and search_text: met (same eval, table tier).
- `snake_case_name` one token: met (strip-markdown test; snake tier).
- keyword @1 not regressing and paraphrase @1 within one question: NOT met. Keyword tiers held, but paraphrase @1 fell by 1 on fixture train semantic (18->17), by 2 on real held-out semantic (8->6), 1 on real train hybrid (5->4). Floors lowered and recorded. Also real-train hybrid "every negative flagged" fell 12/12 -> 9/12 (now a known failure): kept code tokens raise BM25 on off-topic queries. Not fixed. Cold index of a docs tree roughly doubled (noisy single runs).
- Embedded-text option (b) measured on train; (a) chosen (see Eval results: Phase 5).
#53
- CLS from the model's own config without flags: met (stub model dir test, offline) and unit tests; the real bge/arctic config files were fetched and used in the model comparison.
- Switching pooling forces a re-embed: met (integration test; meta records pooling and queryPrompt; CLI search refuses a mismatch).
- Re-measure bge-small/arctic-s vs MiniLM: done on our splits only (Phase 6 table; neither beats MiniLM); the reporter's blind set is theirs to run. No default change.
- Missed/open: nomic-embed (needs document prefixes) is documented, not handled; the embed-worker path has no CLS test; offline start without cached configs falls back to mean and reindexes at the next online start.
#54
- 400-day body + frontmatter-only commit today decays as 400 days: met (decay eval frontmatter-touch tier, plus the new integration test).
- A body edit resets the age: met (unit and integration tests).
- No per-query git calls, computed at index time: met (PATH-spy test). Caveat: a body unchanged for more than 20 commits is dated at the 20th.
