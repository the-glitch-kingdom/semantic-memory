---
title: Failure-time fact lookup — enabling it, writing findable facts, measuring it
tier: guide
domains:
  - operational
audience:
  - developers
  - admin
tags:
  - v1.6.0
  - PostToolUseFailure
  - failure-lookup
  - symptoms
  - eval-failures
  - gotcha
  - knowledge-base
  - v1.7.0
  - jev-mode
status: active
last_updated: '2026-10-25'
version: '1.7.0'
purpose: How to turn on the opt-in PostToolUseFailure fact lookup, what it
  injects and when, how to write gotcha facts it can find (symptoms with the
  literal error), how it coexists with other failure hooks, and how to measure
  it on your own failures with eval-failures.
load_priority: 7
estimated_read_time: 4 minutes
word_count: 775
last_validated: '2026-10-24'
backlinks: []
---

# Failure-time fact lookup

A knowledge-base fact pays off most at the moment a command fails the way it failed before — and that is exactly when it has usually been summarized out of context. Issue #29 found one gotcha (`pkill -f` killing its own shell, exit 144) missed 12 times over 5 days after the fact was written. v1.6 adds a hook that looks the fact up on the failure.

## Turning it on

It is **off by default**. Set the variable where Claude Code's hooks see it, e.g. `~/.claude/settings.json`:

```json
{ "env": { "SEMANTIC_MEMORY_FAILURE_HOOK": "1" } }
```

Optional: `SEMANTIC_MEMORY_FAILURE_MIN_SCORE` (default `0.50`).

## What it does

On a failed **Bash** or **`mcp__*`** call:

1. Builds a query from the failure with `failureQuery(error, command)`: the error lines, error class and exit code, plus the program and subcommand (`pkill -f vite: Exit code 144`). Paths become basenames; ids, timestamps, hex, URLs, long numbers and stack frames are dropped.
2. Searches every `semantic-*` notes path in `.mcp.json` (vault and docs).
3. Takes the first hit that is a **fact** (`…/facts/*.md`) with score ≥ 0.50 and adds it to the conversation:

```
<vault-fact source="tool-failure" score="0.77">
A knowledge-base fact may explain this failure. Check it applies before acting on it (measured: about 6 in 10 of these are on target).
- `knowledge-base/facts/pkill-f-self-match.md` (semantic-sidekick)
  > pkill -f <pattern> matches full command lines, including the shell…
</vault-fact>
```

One fact per failure, and the same fact at most once per session. It stays quiet for interrupts, user denials, other tools, and in `outage-silence` mode. Off, it costs ~30 ms per failure (it exits before any lookup); on, ~0.6 s.

## Why it is off by default

The plan was to ship it only above ~95% precision, with the threshold measured, not guessed. Measured on 553 real failures from 14 repos (1,214 judged failure/doc pairs):

| Setting | Top hit on target | Fires on |
|---|---|---|
| all docs, raw error text, ≥ 0.50 | 12% | 12% of failures |
| all docs, normalized query, ≥ 0.50 | 28% | 7% |
| **facts only, normalized, ≥ 0.50 (shipped)** | **61%** | **3.6%** |
| facts only, normalized, ≥ 0.60 | 67% (4/6) | 1% |

About 95% of failures have no doc that explains them, and embedding similarity barely separates "the answer" from "same topic". Blending in keyword matching made it worse at every weight. So it is useful but not trustworthy enough to be on for everyone.

## In jev mode (v1.7)

With [jev mode](jev-mode.md) on as well, Jev can veto the fact: a confident no (≤ 0.05) suppresses it, anything
else keeps it (marked `checked="jev"`); a timeout or error injects nothing. Measured on the same labelled set,
Jev's no's were 99.7% right but it never said yes at ≥ 0.95, so it can only remove facts, never confirm them.
Replayed on the Jev-scored candidates:

| Score ≥ | facts shown, no Jev | with the veto |
|---|---|---|
| 0.30 | 17 right of 65 | 17 of 53 (12 wrong removed) |
| 0.40 | 14 of 38 | 14 of 36 |
| 0.50 (shipped) | 5 of 12 (over all candidates, scored or not: 11 of 18, 61%) | 5 of 12 (no change) |

So jev mode makes the hook no noisier and, below 0.50, a little cleaner; it does not make it trustworthy enough to
turn on for everyone. `eval-failures --gate jev --jev-scores <judge output>` replays both gate shapes on your
own data.

## Writing facts it can find

The single biggest lever is **putting the literal error in `symptoms:`**. The indexer embeds each symptom as its own chunk, so a failure query that is mostly the error string matches it directly. Measured: a fact whose prose never says "144" scored **0.44** for `pkill -f: Exit code 144` (not injected); with the field it scored **0.75** (injected). None of the 341 facts measured had one.

```yaml
---
title: pkill -f with a pattern from your own command line kills the calling shell
tier: fact
tags: [gotcha]
symptoms:
  - "Exit code 144"
  - "pkill -f kills its own shell"
---
```

Good symptoms are the exact text an agent sees: the exit code line, the error class and message (`staged content different`, `PermissionError: [Errno 13]`, `ERR_MODULE_NOT_FOUND`), without paths or ids that change per run. Two or three per fact is plenty.

**In a hit-em-with-the-docs tree (`.documentation/`), don't use string `symptoms:` on facts.** There, `symptoms:` is hewtd's playbook field, a list of objects with `error_pattern` / `user_phrase` / `alert_name`, a `target` and `cites`. A string list fails `hewtd audit` with `symptoms.0: Expected object, received string`. semantic-memory 1.6.1 reads only string symptoms, so hewtd's objects are not symptom-keyed yet (a planned follow-up). Until then, put the literal error strings in the fact's `tags:` and in its title or first `## Claim` line. This repo's facts do that. It hasn't been measured separately: the 0.44 → 0.75 result above is for string `symptoms:`.

## Running it next to another PostToolUseFailure hook

Claude Code runs every registered hook for the event, so another failure hook (for example jev-loop's `tool_hook.py`, which shows usage notes) and this one can both add a note to the same failure. They answer different questions — "how is this tool used here" vs "what fact explains this failure" — so running both is fine. If the combined output is too much, turn this one off by unsetting `SEMANTIC_MEMORY_FAILURE_HOOK`.

## Measuring it on your own failures

`semantic-memory eval-failures` takes two generic JSONL files:

- `cases.jsonl` — `{id, notes, error, command}`, one failed tool call per line; `notes` is the (indexed) docs folder its repo searches.
- `judgments.jsonl` — `{case, path, relevant}`.

```bash
semantic-memory eval-failures --cases cases.jsonl --judgments judgments.jsonl \
  --query normalized --unjudged-out next.jsonl
```

It prints how often the right doc ranks first, precision and coverage of the top hit per score threshold, the lowest threshold that holds the target precision (default 95%) from there up, and writes unlabelled top hits to `next.jsonl`. Label those, add them to the judgments, re-run.

This repo's own data came from jev-loop logs with the scripts in `scripts/eval-failures/`:

1. `build-set.mjs` — failed Bash/MCP calls (jev-loop `sets/usage/episodes.jsonl` + `logs/tools-*.jsonl`) and each repo's facts with their first-commit time; redacts everything (broad set), maps home paths to `~`, drops excluded repos **by content**. Pairs each failure with facts committed within 6 h after it (set A).
2. Judge set A (does the fact answer the failure?), then run the eval and judge its top hits (set B) — `judge-pack.mjs` packs them, `make-cases.mjs` merges the verdicts into `cases.jsonl` / `judgments.jsonl`.
3. Index a **copy** of each repo's `.documentation` under the eval folder, so no index files are written into other repos.

The labelled set holds other repos' commands, errors and docs: keep it outside every repository (this repo uses `~/.semantic-memory/eval/failures/`) — never commit it, especially to a public repo. Judges' self-reported counts were unreliable; validate every judge output file against its input before using it.

## See also

- [injection-points.md](../architecture/injection-points.md) — every hook's injection
- [cli-reference.md](../reference/cli-reference.md#eval-failures-v16--measure-failure-time-fact-lookup)
- [v1-6-0-failure-lookup.md](../changelog/v1-6-0-failure-lookup.md)
