# Task Plan: operating targets, blind sets and a per-miss diagnosis in the eval, plus an `optimize-search` skill (#96), release 1.31.0

## Goal
#96: a user who runs `semantic-memory eval` today gets numbers, but nothing says what good looks like, what to fix first, or whether the numbers mean anything. Ship the method as defaults plus a report:

1. **Targets.**
   - A `targets.json` with default targets for each metric and a one-line reason each.
   - A question template with a `blind` field.
   - A guide to writing a blind set, including the leakage check.
   All live in the eval dir.
2. **Report.**
   - The eval prints metric / value / target / met, and the noise threshold (1/n).
   - It labels every miss: coverage, ranking or grounding.
   - It refuses to say "met" without a blind set.
3. **Skill.** A shipped skill, `optimize-search`, that runs the improvement loop. Measure, diagnose, then route each miss:
   - coverage → write docs, or hand the coverage misses to hit-em-with-the-docs' `/reconcile --gaps`;
   - grounding → `/reconcile`;
   - ranking → tune or file an issue.
   Then re-measure, under the method rules (blind set, leakage, fresh held-out set after a docs fix, 1/n noise, cold build). It accompanies `/reconcile` (user, 2026-11-14) so the standards and procedures for optimization stay the same every time.

Release as **1.31.0** (minor: new subcommand, new eval output, new skill).

### Scope decisions (user, 2026-11-14)
- **The grep oracle is always on.** The diagnosis is the point; `--no-oracle` skips it.
- **Grounding is top-3 only.** The eval measures grounding of the returned top 3 against targets, and points at `npx hewtd audit` (its Targets section, hewtd 3.4.0, #109) for docs-wide health.
- **Where targets live, and who writes them.**
  - `targets.json` (plus the template and the guide) live in `.claude/.semantic-memory/eval/`, next to the question sets.
  - The CLI has no top-level `init`, so a new **`eval init`** subcommand writes them, and `eval` writes the default `targets.json` when it's missing, so existing installs get it too.
- **Blind sets.** Every question gets a `blind` field (default false). `eval generate` writes `blind: false` and says why: it samples the docs, so its output isn't blind by #96's rule. There's no blind generator.

**Out of scope.**
- A blind-question generator (from code and git history), and an automated leakage scanner. The guide describes the leakage check by hand.
- Docs-wide targets (purpose coverage, verified share, missing refs, unreviewed, secrets): they live in hit-em-with-the-docs 3.4 `audit`.
- Any ranking change. The gate against 1.30.x must be identical.
- Changing hit-em-with-the-docs. The skill calls its commands as they are (3.4.1).

## Phases
- [x] Phase 1: Verify and plan (notes.md)
- [ ] Phase 2: Acceptance as failing tests first (`it.fails` until fixed)
  - [ ] `eval init --notes <dir>` writes `targets.json`, `questions.template.jsonl.example` and `BLIND-SETS.md` into the eval dir.
    - Each target has `value` and `why`.
    - A second run leaves edited files untouched and says so; `--force` rewrites.
    - The template isn't picked up as a question set: `loadSets` reads `*.jsonl`, so the template has a non-`.jsonl` extension. Assert that `loadSets` ignores it.
  - [ ] `eval` with no `targets.json` writes the defaults and prints one line saying where.
  - [ ] `eval` prints a **Targets** table: metric, value (all), value (blind), target, met. The metrics and default targets are the issue's:

    | metric | target |
    |---|---|
    | hybrid @1 / @3 | 0.75 / 0.95 |
    | keyword (`exact`) @1 | 0.90 |
    | paraphrase @1 | 0.75 |
    | #1 + related | 0.85 |
    | top-3 verified | 80% |
    | top-3 no missing refs | 90% |
    | negatives flagged | 6 of 7, scaled: ≥ 0.85 |
    | false flags | ≤ 1 of 34, scaled: ≤ 0.03 |
    | p95 | ≤ 100 ms |

    It also prints `noise: 1/n = …` for the answerable count. The same data appears under `--json` as `targets`.
  - [ ] An edited `targets.json` value changes the met column. A malformed file fails with a clear error naming the file, and never silently uses the defaults.
  - [ ] **No blind case measured:** every met cell reads `not validated` and a loud line says `not validated: no blind set (mark a set blind: true, see BLIND-SETS.md)`. **With blind cases:** met is judged on the blind subset.
  - [ ] **Per-miss diagnosis**, for each answerable case of the hybrid arm:
    - not answered @1, and some facet matches no doc in the corpus → `coverage`;
    - not answered @1, every facet matches some doc → `ranking`, with whether the grep arm answered it @8;
    - answered @3, but an answering top-3 doc is unverified or cites a missing ref → `grounding`.
    The labels are shown per case (id, label, one-line why), and counted per label.
  - [ ] **Blind coverage misses are counted, not skipped.** Today `findStale` skips a case whose facet matches no doc, and so drops exactly the coverage misses. For `blind: true` cases they count as misses labelled `coverage`. For non-blind cases the `stale` behaviour is unchanged (byte-identical report lines).
  - [ ] `--no-oracle` gives no diagnosis section.
  - [ ] `eval --gaps-out <file>` writes the coverage misses as `gaps.v1` (`toGapsV1`, `src/core/usage-log.ts:195`), so `hewtd reconcile --gaps <file>` reads them. Assert the shape against `toGapsV1`'s output.
  - [ ] `eval generate` writes `blind: false` on every row, and its summary says the set isn't blind.
  - [ ] Guards (plain `it`, pass today):
    - `eval --json` keeps every existing field;
    - `eval --baseline` / `--check` behave as today;
    - `scripts/gate-release.sh` and `scripts/eval-against-release.sh` still parse the report (run them, or the parts that read the JSON).
  - [ ] The `optimize-search` skill (unit, next to `test/unit/skill-surfaces.test.ts`):
    - `skills/optimize-search/SKILL.md` exists with frontmatter `name` and `description`;
    - it is listed in `package.json` `files`;
    - the surfaces test's shipped-skill list includes it;
    - every command it names exists: `semantic-memory eval`, `eval init`, `eval --gaps-out`, `gaps --json`, `/reconcile …`, `npx hewtd audit`.
- [ ] Phase 3: Targets file and `eval init`
  - [ ] `src/core/retrieval-eval/targets.ts`:
    - default targets with reasons, from the table above (reasons from #96's table);
    - `loadTargets(dir)`: read, validate, merge over the defaults for missing keys, refuse a malformed file;
    - `writeDefaults(dir, {force})`;
    - the template and the guide text.
  - [ ] `FacetCase` gains `blind?: boolean` (`src/core/retrieval-eval/metrics.ts:119`). `normalizeCase` keeps it; `loadSets` ignores `*.example`.
  - [ ] The `eval init` subcommand in `src/cli/retrieval-eval.ts`; `eval` writes the defaults when missing.
  - [ ] `BLIND-SETS.md`, the guide, covers:
    - writing blind questions from code, git history, issues and real queries, never from the docs;
    - the leakage check: grep each question's distinctive terms in `CLAUDE.md`, `AGENTS.md` and `.claude/rules/`, and rewrite any that came from them;
    - a docs fix driven by a set's misses makes that set non-blind, so write a fresh held-out set first;
    - measure on a full cold index build, and record the corpus commit, version and config;
    - treat a 1/n change as noise.
- [ ] Phase 4: Report and diagnosis
  - [ ] Compute the metrics from what `runSuite` already has.
    - **#1 + related:** hybrid's `relatedPerTop` is a ratio, not a coverage. Define "#1 + related answers it" as the case's facets all matching the top result plus its `related` docs. Add it in `runFacetEval` from `ArmResponse.related`, and record the definition.
    - **Top-3 verified:** a top-3 doc counts as verified when its frontmatter `last_verified` is within the staleness window hit-em-with-the-docs 3.4 uses (read its definition, read-only; record it), or its grounding verdict is `verify`/`verified`.
    - **Top-3 no missing refs:** the result's `grounding.dead_refs` is empty.
    - **p95** is the hybrid arm's.
  - [ ] **Diagnosis** as in Phase 2. The corpus-wide facet check reuses `findStale`'s facet matching, not a second implementation. Count grep @1/@3 as the "grep oracle" line, as #96's worked example does.
  - [ ] `formatSuite` gains a Targets section and a Diagnosis section. Both are added *after* today's lines, which stay byte-identical, so the gate scripts and any parsers are unaffected. `--json` adds `targets` and `diagnosis` keys.
  - [ ] `--gaps-out <file>` (coverage misses → `gaps.v1`, with the question as `query` and no `used_doc`). `--no-oracle`.
  - [ ] `eval generate` writes `blind: false` (`src/core/retrieval-eval/generate.ts` `writeGenerated`).
- [ ] Phase 5: The `optimize-search` skill
  - [ ] `skills/optimize-search/SKILL.md`. Its description triggers on: improving or tuning search quality on these docs; "why does search miss X"; raising eval numbers; meeting targets; running the eval and acting on it; after a `/reconcile` pass, re-measuring. It is not for a single search question (that's semantic-first) and not for a plain docs edit.
  - [ ] The body is the procedure, one loop:
    1. **Prepare:** a blind set exists (`eval init`, `BLIND-SETS.md`), the leakage check is done, and the run is on a cold index build. Record the commit, version and config.
    2. **Measure:** `semantic-memory eval --notes <docs>`; read the Targets table and the noise line.
    3. **Diagnose:** read the per-miss labels.
    4. **Route each label:**
       - coverage → `eval --gaps-out gaps.json`, then `/reconcile --gaps gaps.json` (hit-em-with-the-docs proposes new docs and phrases, applied only on acceptance), or write the doc;
       - grounding → `/reconcile --changed`, or `/reconcile --next N`;
       - ranking → `.documentation/operational/retrieval-tuning-guide.md` settings, measured on the train split only, or an issue with an anonymised repro (`{id, tier, q, facets}` JSONL);
       - docs-wide health → `npx hewtd audit` Targets.
    5. **Re-measure:**
       - write a fresh held-out blind set before the docs fix, because fixing a set's misses makes it non-blind;
       - compare against the previous run and ignore changes under 1/n;
       - `eval --baseline` only when the change holds.
    6. **Record:** the round's numbers and decisions, as a vault note via `synthesize_note` (dry-run first).
  - [ ] Hard rules in the skill:
    - never call targets met without a blind set;
    - never tune on held-out questions;
    - never apply reconcile proposals without the user's acceptance (`/reconcile`'s own rule);
    - never hand-edit INDEX.md or REGISTRY.md.
  - [ ] Ship it:
    - `package.json` `files`;
    - `test/unit/skill-surfaces.test.ts` shipped list;
    - check that `scripts/link-skills.js` / the plugin runtime links it like the other four (by hand in a temp install);
    - the AGENTS.md contract, if it lists skills.
  - [ ] **Trigger eval:** `skills/optimize-search/evals/evals.json` in the semantic-first shape, about 10 should-trigger and 10 should-not prompts (a plain search question, a docs edit, `/reconcile` on its own). Run it with the existing `skill-eval` trigger tooling, capped at about 60 runs. Record the precision and recall. Tune the description at most twice, on the train prompts only.
- [ ] Phase 6: Measure
  - [ ] Fresh `BAND=1 bash scripts/gate-release.sh <previous release>`: every count identical (no ranking change; the report additions sit after the gated lines).
  - [ ] By hand on this repo's `.documentation`:
    - `eval init`, then `eval` with the shipped sets (no blind set) shows `not validated`;
    - mark a small hand-written blind set and re-run: met is judged, and every miss is labelled;
    - `--gaps-out` output is accepted by `npx hewtd reconcile --gaps <file> --json` (hewtd 3.4.1, read-only use; never modify the hewtd repo).
    Record the numbers.
  - [ ] Eval run time with the oracle versus without it (`--no-oracle`), on this repo.
- [ ] Phase 7: Release prep
  - [ ] Bump all five version fields to 1.31.0, plus the lockfile.
- [ ] Phase 8: Cleanup -- remove junk and unused code this work created: scratch/test scripts, debug files, probe logging, one-off test functions, commented-out code, dead code from abandoned approaches (MANDATORY)
- [ ] Phase 9: Validate success through comprehensive testing (MANDATORY)
  - [ ] Every Phase 2 test passes as plain `it`.
  - [ ] Edge cases:
    - a set with 0 answerable cases (noise line, no division by zero);
    - all cases blind;
    - a mix of blind and non-blind in one file;
    - `targets.json` with unknown keys (warn, ignore);
    - a target set to `null` (metric shown, not judged);
    - a negative-only set;
    - `--via mcp` runs carry the same Targets and Diagnosis;
    - a case with `expected` but no facets (diagnosis falls back to the expected docs: no expected doc exists → coverage);
    - `--gaps-out` with no coverage misses (writes an empty `gaps.v1`);
    - Windows line endings in a set.
  - [ ] Failure paths: unwritable eval dir on `eval init`; a malformed `targets.json`; an unreadable set file.
  - [ ] Lint, build, `npm test`, `npm run eval`, `npm run gate:release` (fresh, BAND=1).
  - [ ] Independent review of `git diff main...HEAD` (`claude -p`, given the code, not our conclusions). Fix what it confirms; record rejections.
- [ ] Phase 10: Documentation pass with hit-em-with-the-docs; no secrets (MANDATORY)
  - [ ] `.documentation/operational/retrieval-eval-guide.md`:
    - targets (file, defaults, reasons, editing);
    - blind sets and the leakage check;
    - the diagnosis labels and what to do for each;
    - `eval init`, `--no-oracle` and `--gaps-out`;
    - "not validated";
    - the noise threshold;
    - the worked example's lesson from #96, numbers only.
  - [ ] `.documentation/operational/retrieval-tuning-guide.md`: start from the diagnosis; tune only for `ranking` misses.
  - [ ] A doc for the `optimize-search` skill (or a section in the eval guide) and its link to hit-em-with-the-docs `/reconcile` and `audit` targets.
  - [ ] Plugin help (`src/core/help/topics.ts`):
    - the `eval` topic gains targets, blind sets, the diagnosis and `eval init`;
    - add an `optimize-search` topic (or alias) that points at the skill.
    `test/unit/help-coverage.test.ts` and `test/unit/cli-help.test.ts` pass. The `eval` and `eval init` `--help` text is accurate.
  - [ ] KB gotcha fact: a question set stops being blind once you fix the docs its misses land on. `## Instead`: write a fresh held-out blind set before any docs fix driven by an eval.
  - [ ] `CHANGELOG.md` 1.31.0 and `.documentation/changelog/v1-31-0-operating-targets.md`.
  - [ ] AGENTS.md (`regenerate_contract`) if the skill list or tool surface it shows changed.
  - [ ] `npx hewtd maintain --quick`; never hand-edit INDEX.md or REGISTRY.md. Re-run `npm run eval` after the docs.

## Key Questions
1. Where is "init"? There's no top-level `init` (setup runs through postinstall), so it's `eval init`, and `eval` writes the defaults when missing (user chose "init + first eval").
2. Should met be judged on all cases or on blind cases? On blind cases, with all cases shown next to them: #96's worked example shows a non-blind set meeting every target while the blind set didn't move.
3. A blind case whose facet matches no doc: skipped (today's `stale`) or a coverage miss? A coverage miss. That is what #96's diagnosis is for. Non-blind cases keep today's behaviour.
4. How should coverage misses reach hit-em-with-the-docs? As `gaps.v1`, which `/reconcile --gaps` already reads (hewtd 3.4.1). hewtd's own "retrieval-eval coverage import" is listed as deferred on its side.

## Decisions Made
- Version 1.31.0. Runs after 1.30.1 (Plan A, `small-fixes-1301`) ships; merge main into this branch first (don't rebase), and archive `small-fixes-1301` here.
- Scope decisions: see Goal (user, 2026-11-14).
- The skill is named `optimize-search` and ships in semantic-memory; it drives hit-em-with-the-docs' `/reconcile` and `audit` without changing them.

## Errors Encountered
(none yet)

## Status
**Phase 2 next** (after Plan A ships and main is merged in). Phase 1 done: see notes.md.
