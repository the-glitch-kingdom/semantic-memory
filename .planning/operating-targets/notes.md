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

## Eval results: Phase 2 (acceptance tests, no src change)

- `test/retrieval-eval/operating-targets.test.ts`: 19 tests. 14 `it.fails` (init x2, defaults line, Targets table, edited met, malformed file, not validated, blind judged, diagnosis labels + blind coverage, ranking grep flag, `--no-oracle`, `--gaps-out`, `writeGenerated` blind:false, generate summary). 5 plain guards, pass today (loadSets ignores `.example`, non-blind stale unchanged, `--json` fields, `--baseline`/`--check` + first report lines, gate scripts read only kept fields).
- `test/unit/optimize-search.test.ts`: 8 `it.fails` (SKILL.md frontmatter, `package.json` files, surfaces list, commands exist, hard rules, guide ships in `npm pack`, guide commands, guide deny-list).
- Each `it.fails` was also run as plain `it` and fails for the stated reason: `error: too many arguments for 'eval'` (no `eval init`), `unknown option '--no-oracle'` / `'--gaps-out'`, no `targets`/`diagnosis` keys, `blind` undefined on generated rows, no "not blind" in the summary, SKILL.md and the guide missing.
- The fixture sets are 12 `golden-docs` rows (plain) and 8 rows marked blind plus one blind case with an unmatched facet; hybrid is 12/12 on the plain set, so Phase 4's diagnosis test relies on the coverage case only, not on a constructed ranking or grounding miss.
- Not covered yet (Phase 3-4 add real cases): grounding miss labels (needs a doc fixture with a dead ref), `--via mcp` parity, the Phase 10 edge-case list.

## Eval results: Phase 3 (no ranking change)

- `src/core/retrieval-eval/targets.ts` (defaults, `loadTargets`, `writeDefaults`, template, guide), `FacetCase.blind`, `eval init`, defaults written by `eval`. Turned into plain `it`: init x2, defaults line, malformed targets.json (operating-targets.test.ts: 9 pass, 10 expected fail left for Phase 4+). New `test/unit/targets.test.ts`.

## Eval results: Phase 4 (no ranking change)

- `src/core/retrieval-eval/report.ts` (Targets judging, diagnosis, section text), `facetIssue` in metrics.ts shared with `findStale`, `grounding` on `ArmResponse`, `eval --no-oracle` / `--gaps-out`, `writeGenerated` blind:false. All 19 tests in operating-targets.test.ts are plain `it` now; new `test/unit/eval-report.test.ts` covers verified window, diagnosis labels (coverage, ranking with grep, grounding), target judging and the sections.
- No ranking numbers moved: today's report lines are unchanged and the sections are appended. Full validation numbers are below if the run completed.
- Full validation: lint and build green; `npm test` 1328 passed, 8 expected fail, 1 flake (stdin-eof SIGTERM, passed alone); `npm run eval` 245 passed, 6 expected fail (the remaining Phase 5-6 it.fails).

## Eval results: Phase 5 (no ranking change)

- Trigger eval for `skills/optimize-search` (10 should-trigger, 10 near-miss prompts, split 12 train / 8 held-out by hash): 40 claude runs, no tuning needed (description unchanged from the first draft).
  - train: positives 100%, false triggers 0% (n=12); held-out: positives 100%, false triggers 0% (n=8). Precision 100%, recall 100%.
- Link check: a temp install ran `scripts/link-skills.js`; 5 skills linked, including `optimize-search`.
- `test/unit/optimize-search.test.ts` skill cases (5) are plain `it` now; 3 guide cases remain `it.fails` for Phase 6.
- Full validation: lint, build green; npm test 1334 passed, 3 expected fail (Phase 6 guide cases), 1 skipped; npm run eval 245 passed, 6 expected fail.

## Eval results: Phase 6 (no ranking change, docs and help only)

- `docs/measure-and-tune.md` (ships via `files: docs`), new help topic `optimize-search`, links from the skill, `eval` topic, README and the eval guide. The 3 guide `it.fails` in `test/unit/optimize-search.test.ts` are plain `it`.
- Full validation: lint, build green; npm test 1337 passed, 1 skipped; npm run eval 245 passed, 6 expected fail (unchanged, not guide cases).

## Eval results: Phase 7

Gate: `BAND=1 bash scripts/gate-release.sh 1.30.1` (3m41s) PASS, every count identical to 1.30.1 on cli and mcp, plain and with the export: hybrid @1 91/139 (94 with export), @3 115, multi @1/3/8 20/28/31 of 41 (32 with export), cov@3 0.82, dominance 34 (26), negatives flagged 43/47, false flags 7, mcp vs cli 0 of 186 differ.

Guide walked on this repo (corpus 60b3399, cold reindex 7s, local build 1.30.1):
- `eval init` with `--notes .documentation` and no `--dir` wrote into `.documentation/.claude/.semantic-memory/eval/` (deriveProjectRoot returns the notes path), which git does not ignore. Guide, SKILL.md and the `optimize-search` help topic now pass `--dir .claude/.semantic-memory/eval` on every eval command. Left the derivation alone: moving it would orphan existing baselines.
- `eval` with an eval dir holding no `.jsonl` stops with "No question sets". Guide step 1 now says to add a set (template, `eval generate`, or `--set`).
- Shipped real-corpus train+heldout sets (96 cases, no blind): Targets table all `not validated`; hybrid @1 0.63, @3 0.93, exact @1 0.57, paraphrase @1 0.68, related @1 0.83, verified_top3 0.12, no_missing_refs 0.89, negatives flagged 0.92, false flags 0.07, p95 20ms; diagnosis coverage 0, ranking 20, grounding 29.
- Hand-written blind set (8 cases from the code, leakage-grepped against CLAUDE.md/AGENTS.md/rules; scratch, deleted): met judged on 8 blind cases. Blind hybrid @1 0.33, @3 0.50, negatives flagged 1.00 (yes), false flags 0.17, p95 yes, rest no. Diagnosis labelled every miss: b01, b02, b06 coverage (the docs do not yet describe the new flags; Phase 11), b03 and b05 grounding, b04 ranking.
- `--gaps-out` wrote gaps.v1 with 3 entries; `hewtd reconcile --gaps <file> --json` accepted it (3 questions, no errors) on both the repo's installed 2.21.0 and 3.4.1. 3.4.1 is published as `@theglitchking/hit-em-with-the-docs`, not `hewtd` (use `npx -p <pkg>@3.4.1 hewtd`). `hewtd audit` Targets section exists only in 3.4.1 (2.21.0 prints none), as the guide says. npx runs relinked `.claude/skills/documentation-lifecycle`; reverted with git checkout. `hewtd maintain --quick` modified changelog/INDEX.md (stale already); reverted, belongs to the docs phase.
- `--baseline` then `--check` on the eval dir: pass. `gaps`, `usage-set`, `help tune-ranking` exist as the guide says.
- Run time: oracle 2.97/3.48/2.93s vs `--no-oracle` 4.22/2.74/3.01s on 96 cases (embedder warm, index built): no measurable difference here; the oracle is a grep over ~130 docs.
