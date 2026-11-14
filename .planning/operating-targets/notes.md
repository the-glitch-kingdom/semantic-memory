# Notes: operating targets (#96) and the optimize-search skill

## What exists on 1.30.0 (2026-11-14)

- **Eval CLI:** `src/cli/retrieval-eval.ts`. It has `eval` (`--notes`, `--set`, `--dir`, `--baseline`, `--check`, `--band`, `--via mcp`, `--json`) and `eval generate` (`--docs`, `--model`, `--dir`).
- **Suite:** `src/core/retrieval-eval/suite.ts`:
  - `evalDir` = `<session dir>/eval`, i.e. `.claude/.semantic-memory/eval`;
  - `loadSets` reads every `*.jsonl` there;
  - `normalizeCase`;
  - `findStale` (:27) skips cases whose facet matches no doc, has a bad regex, or whose expected doc is gone;
  - `runSuite` (:91) runs four arms: `search_hybrid` (with probes, related and top-1 fields), `search_semantic`, `search_text`, and `grep`, which is `search_text` with `grepPattern(q)` = the question's content words as one regex alternation (`metrics.ts:307`);
  - `formatSuite` (:153).
- **Metrics:** `src/core/retrieval-eval/metrics.ts`:
  - `FacetCase` (:119): `{id, tier: exact|paraphrase|symptom|nofield|multi|negative, q, qtype?, facets?, expected?, split?, negative_kind?}`;
  - `ArmMetrics` (:155): tiers with at@1/3/8, negativesFlagged, answeredFlagged, answerableFlagged, `relatedPerTop` (a ratio), foundAt/MRR, latency p50/p95, cov, dominance.
- **No `init` command** at the top level. `init` exists only under `dossier` and `profile`. Setup is postinstall (`scripts/link-skills.js` → claude-plugin-runtime) plus hooks.
- **gaps.v1:** `toGapsV1` in `src/core/usage-log.ts:195`: `{version: 1, source, gaps: [{query, used_doc, suggested, count, last_seen}]}`. `semantic-memory gaps --json` emits it; hewtd `reconcile --gaps <file>` reads it (3.4.1 `commands/reconcile.md` §4b).
- **Shipped skills:** `skills/{semantic-first, vault-first, research-mode, outage-silence}`, each listed one by one in `package.json` `files`. `semantic-first/evals/evals.json` is the trigger-eval shape. `test/unit/skill-surfaces.test.ts:30` pins the shipped list. The `skill-eval` CLI is `src/cli/skill-eval.ts`.
- **hit-em-with-the-docs 3.4.x:**
  - `audit` has an advisory Targets section (3.4.0, #109 closed): purpose, verified, missing refs, unreviewed, secrets, flows, held;
  - `commands/help.md` says the "retrieval-eval coverage import is deferred";
  - `/reconcile` modes: `--secrets`, triage lanes, `--next N`, `--changed`, `--overview`, `--gaps`, staged runs and rotation.

## #96 asks (summary)
- **Metrics:** found @1/@3, keyword @1, paraphrase @1, multi-doc @1/@3, #1 + related, top-3 verified %, top-3 no missing refs %, negatives flagged / false flags, p95.
- **Default targets:** see task_plan.md.
- **Diagnosis:** coverage / ranking / grounding / abstention.
- **Method rules:** a blind set; the leakage check (16 of 35 questions on the reporter's first "blind" draft came from instruction files); a fixed set becomes non-blind; a cold build, recording the commit, version and config; 1/n is noise.
- **Worked example:** the non-blind set went 0.64 → 0.91 @1 after a docs reconcile, while the blind set went 0.27 → 0.30. The grep oracle reached only 0.35 @1 on the blind set, so most misses were coverage.

## Skill request (user, 2026-11-14)
"can we also plan a skill to accompany /reconcile so that we maintain our standards and process / procedures for optimizations?" → `optimize-search`, Phase 5.
