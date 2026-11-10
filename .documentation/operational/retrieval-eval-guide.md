---
title: Retrieval Eval Guide
tier: guide
domains:
  - operational
audience:
  - developers
  - admin
tags:
  - eval
  - retrieval
  - baseline
  - floors
  - question-sets
  - v1.13.0
status: active
last_updated: '2026-11-07'
version: 1.13.0
purpose: How to measure retrieval on your own vault with semantic-memory eval -
  question sets, generated questions, floors, the noise band, all versus clean.
load_priority: 5
estimated_read_time: 3 minutes
word_count: 448
last_validated: '2026-11-08'
backlinks: []
---

# Retrieval Eval Guide

`semantic-memory eval` (v1.13.0) measures retrieval on your own notes through the live search path. It is the same engine as this repo's `npm run eval` (`src/core/retrieval-eval/`). It never re-embeds your index and never writes search or selection logs: it refuses to run with no index (`run --reindex first`) and opens the server read-only with the model, pooling and query prompt recorded in `meta.json`. If notes changed since the last index, those files are indexed first, as on any server start.

One caveat: if the notes changed since the last index, opening the server reconciles them and updates the index for the changed files only.

## Run it

```bash
semantic-memory eval --notes <dir>                 # all *.jsonl in the eval dir
semantic-memory eval --notes <dir> --set a.jsonl   # chosen sets
semantic-memory eval --notes <dir> --json          # machine-readable
```

Arms: `search_hybrid`, `search_semantic`, `search_text` and a `grep` baseline. `eval` prints the settings (granularity, decay, `decay.code`) and, per arm, `related` per #1. Per arm and tier it prints answer @1/@3/@8, found@k, MRR, p50/p95 latency, and negatives flagged per kind. A question whose document no longer exists is skipped and reported as stale.

## MCP path (v1.22)

`eval --via mcp [--cwd <repo>] [--server <cli>] [--settle] [--wait-for-ready]` runs the same sets through the stdio server as the plugin launches it, querying as soon as it answers, so the first-answer state is scored. The report gains an `mcp` block (first answer time, `related` per #1, entity cards) and `probes` (top 3, related, entity per question). `--settle` retries answers marked `_meta.stale`. Long-section sets (`test/retrieval-eval/long-section*.jsonl`, fixtures in `test/fixtures/long-section*/`) are used by `scripts/eval-against-release.sh` and the gate, not by `npm run eval`.

**`eval-against-release.sh --cache`** (v1.25.1) keeps a published version's unpacked package, indexed clone and results in `$EVAL_CACHE` (default `~/.cache/semantic-memory-eval`), for measurements taken while choosing what to try.
- **Key:** version, `--export`, `--docs-only` and `--slow-git`; the committed tree (`HEAD^{tree}`, or the `.documentation` contents with `--docs-only`); the copied fixtures; and the set files.
- **What's reused:** the cli arm. The mcp arm is driven by this checkout's `dist/`, so it is also keyed on a hash of `dist/` and re-runs on the cached index when that changes.
- **`local`:** never cached.
- **Why counts are safe to reuse:** two fresh builds of the same release gave identical per-question results (0 of 144 differ, every arm, with and without the export).
- **What isn't same-run:** a cached row reads `(cached)`, and its p95, cold-index and first-answer times come from the run that filled it.
- The release gate and a plan's final comparison never use `--cache`.
- Without `--cache`, nothing is reused, even from a `GATE_TMP` you point at again.

## Question sets

The eval dir is `<project>/.claude/.semantic-memory/eval/` (override with `--dir`). It is gitignored, so floors there are personal; point `--dir` at a committed folder to share them.

One JSON object per line: `{id, tier, q, facets}`. `facets` are regexes the answer must match; `negative: true` marks a question the vault does not answer (scored as a negative; a row with neither tier nor facets is refused naming its id); optional `expected` (doc paths, enables found@k and MRR), `split` and `negative_kind`. Tiers: exact, paraphrase, symptom, nofield, multi.

## Absent-name sets (v1.23)

`test/retrieval-eval/absent-terms.jsonl` (train) and `absent-terms-heldout.jsonl` hold negatives that name a product or tool absent from the docs (three per file named only in passing) plus answerable controls. Tune on train only. Read "negatives flagged" with the false-flag count beside it. `gate:release` includes the held-out set. See [v1.23.0](../changelog/v1-23-0-abstention-product-names.md).

## Multi-hub sets and facet metrics (v1.24)

`test/retrieval-eval/multi-hub.jsonl` (train) and `multi-hub-heldout.jsonl` run on `test/fixtures/multi-hub/`: long hub docs, narrow one-facet docs and one-chunk broad docs. Each has `expected` docs and facets. `eval` and `eval --json` report `cov@k` (mean share of a multi question's facets found in the top k) and `dominance` (top-3 slots one doc takes on questions it does not answer). Read dominance against the previous release, not against 3: a real catch-all doc fills slots on every version. `gate:release` includes the held-out set. See [v1.24.0](../changelog/v1-24-0-multi-doc-recall.md).

## Generate questions

```bash
semantic-memory eval generate --notes <dir> [--docs 20] [--model <name>] [--dir <dir>]
```

The host agent (`claude`) writes blind questions from sampled documents: keyword, paraphrase, multi-doc and negative. Each is validated (the question must not copy the document's own title or rare terms, facets must match the document) and rejected otherwise. The result is `generated.jsonl`, with the document, its sha256 and the generator version and model recorded. Half the questions go to the `tune` split and half to held-out, by the parity of the first hex digit of sha256(question). Re-running overwrites the file; a real model gives different questions each time.

## Limit-stable ranking (v1.27)

`test/retrieval-eval/limit-stable.test.ts` checks that `search(q, k)` equals `search(q, 8).slice(0, k)` (paths equal, scores within 1e-6) for k = 1, 3, 5, on MCP `search_hybrid`, `search_semantic` and the CLI, over 10 queries on `.documentation`. `limit-edge.test.ts` covers limits 1, 8, 20, 50, a corpus smaller than the pool, filters, MCP vs CLI parity and build-twice. `reproducible-build.test.ts` builds twice and compares. Run them with `npx vitest run test/retrieval-eval/limit-stable.test.ts`.

## Floors and the noise band

```bash
semantic-memory eval --notes <dir> --baseline      # write baseline.json
semantic-memory eval --notes <dir> --check [--band 1]
```

`--check` exits 1 when answered @1/@3/@8 or negatives flagged drop by more than `--band` questions (default 1) on any arm. HNSW is random per build, so one question of drift is noise; the output prints the binomial SD and the flipped questions. `--baseline` and `--check` are separate runs. A changed corpus or question set only warns (the corpus hash uses mtimes, so a fresh checkout always warns). A missing baseline makes `--check` exit 1.

## All versus clean

`all` counts every question. `clean` leaves out the `tune` split, so it is the number to report; the two differ only when a set carries `split` values. Tune only on `tune`; read held-out as measured.

## Gotchas

- Generation needs `claude` on the PATH, or write a set by hand. CI uses the fake `test/bin/claude`.
- Generator thresholds (facet share 20 percent, rare term = df <= max(2, 10 percent of docs)) are untuned.
- `commander` options: `eval` has `enablePositionalOptions()`, so a root-level option must precede the subcommand name.

See also: [Retrieval tuning guide](./retrieval-tuning-guide.md), [CLI reference](../reference/cli-reference.md), [v1.13.0 changelog](../changelog/v1-13-0-builtin-eval.md).
