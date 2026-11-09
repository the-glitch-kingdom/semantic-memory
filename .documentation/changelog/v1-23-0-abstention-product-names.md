---
title: v1.23.0 - abstention for product and tool names
tier: reference
domains:
  - changelog
audience:
  - developers
  - admin
tags:
  - v1.23.0
  - abstention
  - missing_terms
  - passing_terms
  - issue-74
status: active
last_updated: '2026-11-09'
version: 1.23.0
purpose: What v1.23.0 changed (issue 74), the measured results against 1.15.0
  and 1.22.0, the false flags, and the targets that were missed.
load_priority: 5
estimated_read_time: 3 minutes
backlinks: []
word_count: 583
last_validated: '2026-11-09'
sources:
  - src/core/common-words.ts
  - THIRD_PARTY_NOTICES.md
  - scripts/eval-against-release.sh
---

# v1.23.0 - abstention for product and tool names

Issue #74. Fields: [MCP tools reference](../reference/mcp-tools-reference.md). Reading them: [retrieval tuning guide](../operational/retrieval-tuning-guide.md#reading-the-result). Earlier step: [v1.14.0](v1-14-0-identifier-abstention.md).

## What changed
- **`missing_terms` now covers names**, not only snake_case, camelCase, paths and dotted names. A hyphen part that is capitalized and not sentence-initial (`Hotjar`), mixed case (`tRPC`, `FullStory`), has a digit and a letter (`k8s`), or is lowercase and not a common word (`kubelet`) is a candidate when no doc, path or BM25 token has it. The common-word check is `src/core/common-words.ts` (SCOWL via Debian wamerican, 31,676 words, notice in `THIRD_PARTY_NOTICES.md`); it is a dictionary, not a frequency list.
- **`passing_terms`** (new): a name that is in at most 1 doc and in none of the top 3 results' docs. It also sets `no_strong_match`. Ranking is unchanged.
- **Same answer on every path**: stdio MCP, the CLI and federation. A federated page keeps a name only if every answering source lacks it.
- **`gate:release`** adds the held-out absent-terms set and fails when negatives flagged drop, or false flags rise, by more than 1.
- Response shapes are unchanged: `content[0]` is still a plain JSON array; the fields ride on result items.

## Measured
Same run, `scripts/eval-against-release.sh`, clones of 1.15.0, 1.22.0 and this branch; cli and mcp identical; with and without export identical. "false" is answerable questions flagged.

| set | 1.15.0 flagged / false | 1.22.0 flagged / false | 1.23.0 flagged / false |
|---|---|---|---|
| absent-terms train (29 negatives, 23 controls) | 13 / 2 | 7 / 0 | 26 / 0 |
| absent-terms held-out (27 negatives, 22 controls) | 15 / 1 | 7 / 0 | 27 / 0 |
| real-corpus, hub, golden-docs/code held-out (answerable questions) | 51 / 14 | 49 / 13 | 52 / 15 |

The last row has no negatives to count: every flag there is a question the docs answer, flagged by low confidence or by a name, so the base is high. 1.23.0 adds two over 1.22.0 (two plain compound words); a third is flagged in golden-decay. They are listed in `test/unit/identifiers.test.ts`, not here, because naming them in the docs would make them present. `gate:release` against 1.22.0 passes: negatives 42 vs 20, false flags 3 vs 2 (band 1), hybrid @1 unchanged, mcp vs cli 0 of 129 differ.

Passing-mention negatives (names in a doc but never the subject): 1 of 3 on train, 3 of 3 held-out. The held-out figure overstates it.

## Missed targets
- **Reporter's targets are not measured.** A+B >= 6/7 with <= 1/34 false flags and C >= 9/10 with 0/25 need their questions and tree. Our proxies show 0 false flags on 45 controls and about 1% on plain compound words, so 0/25 is not guaranteed.
- **Misses on our train set**: `react-query`, `sharding`, `ingress` are dictionary words or in the docs, so they stay unflagged by design.
- **`passing_terms` N is 1**, not the reporter's 3: train is flat from 1 to 30. Pinecone and Weaviate share a top-3 doc and are missed.

## Known limits
- A name that opens a query or sentence is not a candidate (`Hotjar session replay` is not flagged; `Hotjar or FullStory` flags only `FullStory`).
- A capitalized weekday or month absent from the docs would be flagged. Unmeasured.
- Federation cannot tell a source that is weak for another reason from one that has the term, so a term absent everywhere can lose its flag.
- The gate's false-flag count is at the band edge: one more false flag fails it. The gate's failure path was never run with a broken build.
