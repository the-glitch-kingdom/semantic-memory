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

`semantic-memory eval` (v1.13.0) measures retrieval on your own notes through the live search path. It is the same engine as this repo's `npm run eval` (`src/core/retrieval-eval/`). It never changes your index or logs: it refuses to run with no index (`run --reindex first`), opens the server read-only with the model, pooling and query prompt recorded in `meta.json`, and writes no search or selection log.

One caveat: if the notes changed since the last index, opening the server reconciles them and updates the index for the changed files only.

## Run it

```bash
semantic-memory eval --notes <dir>                 # all *.jsonl in the eval dir
semantic-memory eval --notes <dir> --set a.jsonl   # chosen sets
semantic-memory eval --notes <dir> --json          # machine-readable
```

Arms: `search_hybrid`, `search_semantic`, `search_text` and a `grep` baseline. Per arm and tier it prints answer @1/@3/@8, found@k, MRR, p50/p95 latency, and negatives flagged per kind. A question whose document no longer exists is skipped and reported as stale.

## Question sets

The eval dir is `<project>/.claude/.semantic-memory/eval/` (override with `--dir`). It is gitignored, so floors there are personal; point `--dir` at a committed folder to share them.

One JSON object per line: `{id, tier, q, facets}`. `facets` are regexes the answer must match; `negative: true` marks a question the vault does not answer; optional `expected` (doc paths, enables found@k and MRR), `split` and `negative_kind`. Tiers: exact, paraphrase, symptom, nofield, multi.

## Generate questions

```bash
semantic-memory eval generate --notes <dir> [--docs 20] [--model <name>] [--dir <dir>]
```

The host agent (`claude`) writes blind questions from sampled documents: keyword, paraphrase, multi-doc and negative. Each is validated (the question must not copy the document's own title or rare terms, facets must match the document) and rejected otherwise. The result is `generated.jsonl`, with the document, its sha256 and the generator version and model recorded. Half the questions go to the `tune` split and half to held-out, by the parity of the first hex digit of sha256(question). Re-running overwrites the file; a real model gives different questions each time.

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
