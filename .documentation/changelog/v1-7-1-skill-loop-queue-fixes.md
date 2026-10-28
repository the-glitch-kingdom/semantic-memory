---
title: v1.7.1 — skill loop queue fixes
tier: reference
domains:
  - changelog
audience:
  - developers
  - admin
tags:
  - v1.7.1
  - skill-loop
  - review-queue
  - cron
status: active
last_updated: '2026-10-28'
version: 1.7.1
purpose: The three skill-loop queue bugs that the first days of real use showed, how each was fixed, and how
  the fixes were validated.
load_priority: 6
---

# v1.7.1 — skill loop queue fixes

These fixes come from checking the [skill loop](../operational/skill-loop.md) in real repos (RE-InvestorHub,
glitch-stock-trading-rig) on 2026-10-28, three days after 1.7.0.

| Seen | Cause | Fix |
|---|---|---|
| On 2026-10-27 all 10 daily reviews went to `/tmp/tmp…/work-on` and `work-off`; real sessions waited a day; 10 more such jobs were queued | jev-loop's speed and usage checks run real `claude -p` sessions in `mkdtemp` repos, and every session with signal was queued | A repo under the temp directory is never queued (`SEMANTIC_MEMORY_SKILL_LOOP_ALLOW_TMP=1` for tests) |
| A marketing-workspace job stuck since 2026-10-26 with `spawn claude ENOENT` | Its session was started by cron, and the worker inherited cron's PATH, which has no `~/.local/bin` ([fact](../knowledge-base/facts/cron-sessions-start-workers-without-local-bin.md)) | `claude` is looked up on PATH, then `~/.local/bin`, then `~/.claude/local` |
| A correction typed after `--resume` was never reviewed (RE-InvestorHub, glitch-stock-trading-rig) | A session was reviewed once and never again | A resumed session with new failures or corrections gets a follow-up review on only what happened after its review |

The 10 queued temp-directory jobs were moved into `review-queue/done/` by hand, each with a note.

## Validation

- **New tests:**
  - unit: the temp-directory skip, the `claudeBin` lookup order, re-review and the follow-up brief;
  - integration: the real SessionEnd hook with PATH `/usr/bin:/bin` starts a detached worker that finds a fake
    claude in `~/.local/bin`, then a resumed session gets exactly one follow-up review. This test fails on 1.7.0's
    lookup.
- **Full suite:** 669 tests in 80 files.
- **Golden eval:** unchanged (recall@1 86%, MRR 0.929).
- **Real run:** the stuck marketing job, run through the 1.7.1 worker with PATH `/usr/bin:/bin`, was reviewed in
  4 s for $0.16.
- **Test isolation:** the developer's own switches (`SEMANTIC_MEMORY_JEV=1` and `TYPESAFE_API_KEY` in
  `~/.claude/settings.json` `env`) had reached the tests, and the 1.6 failure-hook tests made one real 400-token
  Jev call. `test/clean-env.ts` now removes them in every test worker.
