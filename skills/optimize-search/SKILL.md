---
name: optimize-search
description: Improve or tune search quality on the project's docs by running the retrieval eval and acting on it. Use for "why does search miss X", raising eval numbers, meeting the operating targets, reading the eval's Targets table or per-miss diagnosis, and re-measuring after a /reconcile pass. Not for answering a single search question (that is semantic-first) and not for a plain docs edit.
---

# optimize-search

One loop: measure, diagnose, route each miss to the tool that fixes it, re-measure. Follow the full guide, `docs/measure-and-tune.md` inside the installed semantic-memory package (`node_modules/@theglitchking/semantic-memory/docs/` or the plugin's install dir; not the user's repo). `/reconcile` (hit-em-with-the-docs) edits the docs; this skill decides what to edit and proves it helped.

## Hard rules

- Never call targets met without a blind set. A set whose misses you have fixed is no longer blind; the eval shows `not validated` without one.
- Never tune on held-out questions. Choose settings and docs fixes from the train split and the misses only; report held-out as measured.
- Never apply `/reconcile` proposals without the user's acceptance (its own rule).
- Never hand-edit INDEX.md or REGISTRY.md; use `npx hewtd maintain --quick`.
- Ignore changes of 1/n or less (n = cases in the set): one case is noise.

## The loop

1. **Prepare.** A blind set exists: `semantic-memory eval init --notes <docs>` writes `targets.json` and `BLIND-SETS.md` (read it for the leakage check: no question taken from instruction files or the docs themselves). Run on a cold index build. Record the commit, plugin version and config.
2. **Measure.** `semantic-memory eval --notes <docs>`. Read the Targets table and the noise line.
3. **Diagnose.** Read the per-miss labels: coverage (no doc answers it), grounding (answered, but the top docs are unverified or cite missing refs), ranking (a doc answers it but is not first).
4. **Route each label.**
   - coverage: `semantic-memory eval --notes <docs> --gaps-out gaps.json`, then `/reconcile --gaps gaps.json` (proposes docs and phrases, applied only on acceptance), or write the doc. Each coverage line ends with `nearest: <path> k/n` (the non-archive doc holding the most facets, k of n) or `nearest: none`: a high k/n means extend that doc, none means write a new doc. Real-usage gaps come from `semantic-memory gaps --json`.
   - grounding: `/reconcile --changed`, or `/reconcile --next 10`.
   - ranking: the settings in `semantic-memory help tune-ranking`, measured on the train split only; or file an issue with an anonymised repro (`{id, tier, q, facets}` JSONL).
   - docs-wide health: the Targets in `npx hewtd audit`.
5. **Re-measure.** Write a fresh held-out blind set before the docs fix. Compare with the previous run. Run `semantic-memory eval --notes <docs> --baseline` only when the change holds.
6. **Record.** Save the round's numbers and decisions as a vault note with `synthesize_note` (dry-run first).
