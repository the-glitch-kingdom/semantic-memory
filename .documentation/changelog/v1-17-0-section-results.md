---
title: v1.17.0 - section results
tier: reference
domains:
  - changelog
audience:
  - developers
  - admin
tags:
  - v1.17.0
  - sections
  - fold
  - issue-60
status: active
last_updated: '2026-11-08'
version: 1.17.0
purpose: What v1.17.0 changed (issue 60), the measured results on the section
  fixture, and the targets that were missed.
load_priority: 5
estimated_read_time: 3 minutes
word_count: 568
last_validated: '2026-11-08'
backlinks: []
sources:
  - src/core/indexer.ts
  - src/core/sections.ts
  - src/core/fold.ts
---

# v1.17.0 - section results

Issue #60. A result now names the section that matched, and a copy or pointer folds under its owner.

## What changed

- **Section chunks** (index schema 9). Chunks split at headings and carry an `A > B > C` trail in the embedded text. A section under 100 characters is carried into the next chunk (`MIN_SECTION_CHARS`, chosen on train: the fixture's sections are about 250 characters and anchors collapse at 250 or more). Anchor rules are copied from hit-em-with-the-docs into `src/core/sections.ts` and parity-tested.
- **Result fields**: `section` (trail, H1 dropped when it equals the title), `anchor` and `code` (at most 3 refs of that section, not resolved against the code graph). The excerpt no longer starts with the trail line.
- **`granularity`**: `"section"` (default) or `"doc"` on `search_semantic`, `search_hybrid` and the CLI. `"doc"` keeps the v1.16.0 field set and excerpt, and folds nothing. It cannot match v1.16.0 byte for byte on notes with headings, because the chunks differ; it is proven on a heading-free vault.
- **Folding** (`src/core/fold.ts`), after rerank and before the limit. The owner is found from the export's `duplicates` (same anchor or same section hash), from `points_to` (a section under 300 characters, `FOLD_MIN_CHARS`, whose doc links to the target), or from identical section text of 300 or more characters (the higher-ranked result owns it). The owner takes the best score and position; the folded paths go in `also_in: ["b.md#anchor"]`. A result folds only when its owner is itself in the ranked list.
- **`read_note`** `section` accepts `#anchor`; a heading whose own text starts with `#` still reads by name.
- `content[0]` of every search response stays a plain JSON array; the new fields ride on the items.

## Upgrade

Schema 9 changes every chunk of a note with headings, so the first start after upgrade re-embeds once (the search answers meanwhile, with `_meta.stale` set). Later starts re-embed only changed chunks. Not measured: the time of a real 8 to 9 re-embed on a large vault.

## Measured

Section set (our own questions, held-out never used to choose anything): hybrid and semantic doc@1 12/12 on train and held-out; anchor@1 3/12 (train) and 4/12 (held-out) before, 12/12 on both after. Fold cases: owner first 4/4 train and 2/2 held-out, no copy or pointer in the top 3 (was 0/4). Payload: docs-eval hybrid 4383 B (ceiling 4750); real corpus 7.4-7.8 KB, about +5%.

## Missed targets

- **Existing @1/@3 did drop.** Floors were lowered to measured values: fixture-train semantic multi@1 4 to 2 and hybrid multi 5/11 to 4/10; fixture-held-out hybrid all@1 25 to 24, hybrid paraphrase@1 13 to 11, semantic paraphrase@1 13 to 12, symptom@3 3 to 2 (semantic) and 4 to 3 (hybrid). Gains: real train answer@1 14/17 to 18/21, real held-out hybrid 13 to 18.
- **Abstention is weaker.** Real held-out negatives flagged by `no_strong_match` fell from 7-8/8 to 5/8; off-topic queries get higher cosines against short, trail-prefixed chunks. The slack went from 1 to 3.
- **A pointer is folded only with an export** (`points_to` plus a link). With no `.hewtd`, only identical text folds, and a pointer can still rank above its target. A pointer whose target is outside the top `limit*3` candidates stays.
- A short section carried into the next chunk reports the later section's anchor.
- `code` per section is raw (dead or non-file spans can appear).
- The section eval imports hit-em-with-the-docs' `anchors.js` from `node_modules` (tests only).
- The offline tarball is built at release, not on this branch.
