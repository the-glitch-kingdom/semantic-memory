---
title: Jev mode — closed-set decisions through jev-loop
tier: guide
domains:
  - operational
audience:
  - developers
  - admin
tags:
  - v1.7.0
  - jev-mode
  - jev-loop
  - failure-lookup
  - skill-loop
  - eval-failures
status: active
last_updated: '2026-10-25'
version: 1.7.0
purpose: What jev mode does, what it needs, what is sent to TypeSafe and how,
  what it costs, the measured judge agreement and failure-hook results, the
  skill-loop questions it answers, and how to turn it off.
load_priority: 6
estimated_read_time: 4 minutes
word_count: 728
last_validated: '2026-10-25'
backlinks: []
---

# Jev mode

Jev (TypeSafe's typed-decision model) answers yes/no questions with a calibrated probability: no text
generation. Jev mode lets semantic-memory ask it the closed-set questions it would otherwise answer with a rule
or a Claude call, and acts only on an answer at jev-loop's bar (≥ 0.95 for yes, ≤ 0.05 for no).

It is **off by default**. Off, 1.7.0 behaves exactly like 1.6.1.

## Turning it on and off

```bash
semantic-memory jev-mode on       # SEMANTIC_MEMORY_JEV=1 in ~/.claude/settings.json env (applies next session)
semantic-memory jev-mode off
semantic-memory jev-mode status   # on / off / on but unavailable (and why), and today's Jev spend
```

`/jev-mode on|off|status` runs the same. There is no per-repo override; excluded paths are handled by jev-loop.

**Requirements:** jev-loop at `~/.claude/jev-loop` (`JEV_LOOP_DIR`), `TYPESAFE_API_KEY` in the environment or in
`~/.claude/settings.json` `env`, and `python3`. If one is missing, `status` says "on but unavailable", and jev
mode behaves as off.

## How it reaches Jev

Only through jev-loop. `hooks/jev-bridge.py` imports jev-loop's `router` and calls `router.ask_all`, so:

- **Redaction:** the state and every question go through jev-loop's `redact.py` before anything is sent.
- **Exclusions:** a cwd under jev-loop's `[paths] excluded` (`~/workspace/kentro`) is refused before anything is
  imported or sent.
- **Cache and ledger:** answers are cached (batch callers), and every call is in jev-loop's usage ledger under
  its caller's name. `python3 ~/.claude/jev-loop/router.py --spend 1` shows them.
- **Budget:** batch callers share jev-loop's daily batch cap (`[jev] batch_tokens_per_day`, 5M).

| Caller | Class | Used by |
|---|---|---|
| `semantic-memory-hook` | batch in jev-loop today (capped, cached) until jev-loop lists it as live; capped by the bridge at `SEMANTIC_MEMORY_JEV_DAILY_TOKENS` (500,000/day) either way | the failure hook |
| `semantic-memory-judge` | batch | `scripts/eval-failures/judge-jev.mjs` |
| `semantic-memory-skill-loop` | batch | the skill loop's scope and merge questions, prose Verify grading |

Each failure becomes `{scores: {}, error}`: an empty answer, treated as "no decision", never as a yes.

## What it decides

### The failure hook: a veto

With `SEMANTIC_MEMORY_FAILURE_HOOK=1` and jev mode on, the hook picks its fact as usual (first fact at ≥ 0.50),
then asks Jev "does this document explain the cause of this failure, or how to fix or avoid it — the same
specific problem?". A confident **no (≤ 0.05) suppresses** it; a yes or an unsure answer lets it through, marked
`checked="jev"`. An error, a timeout (the hook's whole budget is 1.5 s, `SEMANTIC_MEMORY_JEV_HOOK_BUDGET_MS`) or
the daily ceiling injects nothing; so does jev-loop's batch cap being used up, while jev-loop counts the hook as a
batch caller. Jev mode never turns the hook on by itself.

### The skill loop

- **Scope:** a draft that names nothing in its repo is asked "would these steps work unchanged in any
  repository?". A yes at ≥ 0.95 marks it a *global candidate*; it still lands as project, and goes global only by
  promotion (another repo with the same lesson, plus your approval). Otherwise: project.
- **Merges (opt-in):** a candidate pair must get a yes (same procedure, or one contains the other) before Claude
  is asked to draft the merge.
- **Prose Verify** in a task eval is graded by Jev at ≥ 0.95.

### The failure-eval judge

`scripts/eval-failures/judge-jev.mjs <batch.json>…` judges failure/document pairs (both batch formats), one call
per failure, resumable, with `--max-tokens`. `calibrate-jev.mjs` compares it with the Claude labels, and
`eval-failures --gate jev --jev-scores …` replays the hook's gate.

## Measured (2026-10-25)

On the v1.6 labelled set (553 real failures, 1,214 Claude-judged failure/doc pairs; 1,171 answered by Jev):

| | Jev yes (≥ 0.95) | Jev no (≤ 0.05) | unsure |
|---|---|---|---|
| Claude: relevant (33) | 0 | 2 | 31 |
| Claude: not relevant (1,138) | 0 | 727 | 411 |

- Jev's **no** picks were 727 of 729 right (99.7%): they meet the bar. Its **yes** picks: none. It ranks well
  (relevant pairs: median 0.53, max 0.89; irrelevant: median 0.04) but never says yes at 0.95 to this question.
- **Judge verdict: hybrid** — a pair Jev scores ≤ 0.05 needs no Claude judgment (about 62% of pairs here); the
  rest go to Claude.
- **Failure hook:** a yes-gate would inject nothing at any threshold. The veto, replayed on the same candidates,
  removed only wrong facts below the shipped threshold (at 0.30: 12 wrong, 0 right) and none at 0.50, where
  precision stays 61% (11/18). That is far below the 95% bar, so the hook stays opt-in.
- Cost: the 1,171 pairs took about 0.5M tokens (≈ $0.03 at jev-loop's provisional $0.065/M). One hook call or one
  scope question: about 400 tokens. Batch runs count toward jev-loop's 5M/day cap shared with its own jobs —
  give a large run `--max-tokens` and leave room for jev-loop's optimizer.

## Turning it off

`semantic-memory jev-mode off`. Nothing is left to clean: the cache and ledger are jev-loop's.

## See also

- [The skill loop](skill-loop.md)
- [Failure-time fact lookup](failure-lookup-guide.md)
- [Hooks reference](../reference/hooks-reference.md)
- jev-loop: `~/.claude/jev-loop/.documentation/quickstart/jev-loop-start-here.md`
