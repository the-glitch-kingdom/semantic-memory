---
title: v1.6.0 — failure-time fact lookup (opt-in) and the failure eval
tier: reference
domains: [changelog]
audience: [developers, admin]
tags: [v1.6.0, PostToolUseFailure, failure-lookup, eval-failures, failureQuery, symptoms, issue-29]
status: active
last_updated: '2026-10-24'
version: '1.6.0'
purpose: 'What v1.6.0 shipped from the issue #29 proposal: an opt-in PostToolUseFailure fact lookup, the eval-failures command and failureQuery normalizer, what the measurement on 553 real failures showed, and what was deferred.'
load_priority: 6
---

# v1.6.0 — failure-time fact lookup (opt-in) and the failure eval

From [issue #29](https://github.com/the-glitch-kingdom/semantic-memory/issues/29)'s proposal: look facts up when the agent is stuck, and **measure accuracy before tuning**.

## Shipped

- **Opt-in `PostToolUseFailure` hook** (`SEMANTIC_MEMORY_FAILURE_HOOK=1`): the first fact scoring ≥ 0.50 for a normalized failure query, once per session. Details: [failure-lookup-guide.md](../operational/failure-lookup-guide.md).
- **`semantic-memory eval-failures`** and `src/core/failure-eval.ts`: rank, precision and coverage per threshold, recommended threshold, unlabelled hits.
- **`failureQuery()`** (`src/core/failure-query.ts`), also a standalone build entry for the hook.
- **`openSearch()`**: load a corpus once, search many times, same scoring as the hook's CLI search.
- **`scripts/eval-failures/`**: build a local labelled set from jev-loop failure logs and repo fact history; pack and merge judge verdicts.

## What the measurement said

553 real failures across 14 repos; set A (144 failures paired with facts written within 6 h after them, 13 answered) and set B (589 top search hits, 28 relevant), judged by Claude subagents.

| Finding | Number |
|---|---|
| right fact ranked first, raw vs normalized query | 19/38 vs **32/38** |
| keyword blend 0.3 (normalized) | 19/38 — worse; not shipped |
| top hit relevant, by doc class | facts 26%, troubleshooting 10%, other 1.6%, archive 0% |
| first fact in top 5, ≥ 0.50 | **61%** (11/18), fires on 3.6% of failures |
| `symptoms:` on a prose fact | 0.44 → **0.75** for its own error |

No setting reached the 95% target, so the hook is opt-in.

## Decisions

| Question | Decision | Why |
|---|---|---|
| Commit the labelled set as a fixture? | No — kept under `~/.semantic-memory/eval/` | This repo is public; the set holds other repos' commands, errors and docs |
| Who judges? | Claude subagents (Sonnet) | User's choice over Jev or hand labelling |
| Ship the hook? | Opt-in | ~61% precision is useful but below the bar |
| Keyword blend? | Dropped | Worse at every weight measured |
| Post-compaction page-in? | Deferred | No data to measure it |

## Found along the way

- jev-loop's daily `usage.py --extract` has crashed since 2026-10-15 (`KeyError: 'bash'`, `usage.py:212`), so its mined history stops at 2026-10-13; its live failure log was unaffected.
- Kentro (58 facts) and wealth-management were excluded from all data by content, not only by repo name.
