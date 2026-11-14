# Measure and tune search on your docs

One loop across two tools: `semantic-memory` measures what search returns, and hit-em-with-the-docs (`hewtd`, `/reconcile`) fixes the docs. The `optimize-search` skill walks Claude through the same steps.

```
measure -> diagnose -> route each miss -> fix -> re-measure -> hold the gain
```

## 1. Setup

- semantic-memory 1.31.0 or later (the Targets table, the diagnosis and `eval init`).
- hit-em-with-the-docs 3.4.0 or later for the Targets section of `hewtd audit` (a project pinned to 2.x does not print it: check `npx hewtd --version` and update the package), and 3.x for `/reconcile --gaps`.
- Pass `--dir .claude/.semantic-memory/eval` (gitignored) on every `eval` command below, as written. Without it the eval dir is derived from `--notes` and lands inside the notes folder (`.documentation/.claude/...`), which git does not ignore.
- A full cold index build before you measure: `semantic-memory serve --reindex --notes .documentation`. An index built up by incremental edits can differ from a cold build.
- For every run, write down the corpus commit (`git rev-parse HEAD`), the semantic-memory and hewtd versions, and the config (`semantic-memory eval` prints the settings it ran with). A number without these cannot be compared later.

## 2. The targets

`semantic-memory eval init --notes .documentation --dir .claude/.semantic-memory/eval` writes `targets.json` into the eval dir. Edit the values; the eval reads the file on every run. A value of `null` means "shown, not judged". A file that is not valid JSON stops the run and names the file. Rates are 0 to 1; `p95_ms` is milliseconds.

| metric | default | why it matters |
|---|---|---|
| `hybrid_at1` | 0.75 | below this an agent re-searches or guesses on a quarter of questions |
| `hybrid_at3` | 0.95 | the answer should be on the first screen almost always |
| `exact_at1` | 0.90 | keyword questions should be near-solved |
| `paraphrase_at1` | 0.75 | harder than keyword, but where users and agents actually live |
| `related_at1` | 0.85 | the top hit plus its linked neighbours should cover the answer |
| `verified_top3` | 0.80 | the returned docs should have been checked against the code |
| `no_missing_refs_top3` | 0.90 | the returned docs should not point at things that no longer exist |
| `negatives_flagged` | 0.85 | say "no strong match" when the answer is not in the docs |
| `false_flags` | 0.03 | a false "no match" on an answerable question costs more than a missed abstention |
| `p95_ms` | 100 | interactive budget |

Which tool owns which metric: the first five and the two negatives rows are search quality, measured by `semantic-memory eval`. `verified_top3` and `no_missing_refs_top3` are doc health seen through search; you fix them in the docs. The docs-wide version (purpose, verified, missing refs, unreviewed, secrets, flows) is the advisory Targets section of `npx hewtd audit`. `p95_ms` is machine speed.

## 3. Question sets

A set is a `.jsonl` file in the eval dir, one object per line: `{id, tier, q, facets, blind}`, with optional `expected` doc paths.

- `tier` is `exact` (keyword), `paraphrase`, `multi` (the answer spans docs) or `negative` (the docs do not answer it; mark it `negative: true`).
- `facets` are regexes the answering text must match.
- `blind: true` marks a question the docs did not write.

**Targets are only validated against a blind set.** With no case marked blind the report prints `not validated` and judges nothing.

Writing a blind set:

1. Take questions from outside the docs: the code, git history, issues, and queries people or agents actually typed (`semantic-memory gaps --root . --json` and `usage-set` show real ones).
2. Write the facets from the answer you know is right, as regexes.
3. Run the leakage check. An agent that writes "blind" questions has already read `CLAUDE.md`, `AGENTS.md` and `.claude/rules/`. Grep each question's distinctive terms in those files and rewrite any that came from them. On one real first draft, 16 of 35 questions did.
4. Mark the file `"blind": true` on each case.

Two rules follow:

- **Fixing a set's misses makes it non-blind.** Once you edit the docs those misses land on, the set has been used to tune the docs. Write a fresh held-out set before each docs pass, and flip the old one to `"blind": false`.
- **`eval generate` output is not blind.** It samples the docs, so the questions are written from them. It writes `blind: false`. Use it for a floor, not for validating targets.

## 4. The loop

1. `semantic-memory eval init --notes .documentation --dir .claude/.semantic-memory/eval` writes `targets.json`, `BLIND-SETS.md` and a question template. Existing files are left alone. The eval needs at least one `.jsonl` set in the eval dir (or `--set <file>`); with none it stops with `No question sets`. Copy the template to a `.jsonl` file and write your blind set (section 3), and for a floor add `semantic-memory eval generate --notes .documentation --dir .claude/.semantic-memory/eval` (not blind).
2. `semantic-memory eval --notes .documentation --dir .claude/.semantic-memory/eval`. Read the Targets table. The `all` column covers every set; `blind` covers only blind cases, and `met` is judged on that column. A metric the blind set has no case for shows `-`. The noise line says `1/n`: a change of one question is not a signal, so do not celebrate or revert on it.
3. Read the Diagnosis section. Every miss gets one label, with a grep oracle result (`grep finds it at 8` or `grep misses it too`):
   - **coverage**: no doc answers it.
   - **grounding**: a doc answers it at #1, but the top docs are unverified or cite things that no longer exist.
   - **ranking**: a doc answers it but is not first.
   `--no-oracle` skips the grep oracle and the diagnosis when you only want the table.
4. Route each label:
   - coverage: `semantic-memory eval --notes .documentation --dir .claude/.semantic-memory/eval --gaps-out gaps.json`, then `/reconcile --gaps gaps.json` (it proposes docs and phrases; nothing is applied without your acceptance), or write the doc. Real-usage gaps come from `semantic-memory gaps --root . --json`.
   - grounding: `/reconcile --changed`, or `/reconcile --next 10`.
   - ranking: the settings in `semantic-memory help tune-ranking`, chosen on your train split only; or report it (section 6).
   - docs-wide health: `npx hewtd audit`.
   Never hand-edit `INDEX.md` or `REGISTRY.md`; `npx hewtd maintain --quick` regenerates them.
5. Re-measure on a fresh blind set, with a cold build, and compare with the recorded run. Ignore changes of `1/n` or less.
6. Hold the gain: `semantic-memory eval --notes .documentation --dir .claude/.semantic-memory/eval --baseline` once the change holds, and `semantic-memory eval --notes .documentation --dir .claude/.semantic-memory/eval --check` afterwards to fail on a regression.

Never choose a setting, a threshold or a docs fix from the held-out questions. Choose from the train split and the misses, and report held-out as measured.

## 5. A worked example

One real docs tree, before and after a docs reconcile pass:

| set | @1 before | @1 after |
|---|---|---|
| non-blind (written from the docs) | 0.64 | 0.91 |
| blind (written from outside) | 0.27 | 0.30 |

The non-blind set improved by 27 points because the pass fixed exactly its misses. The blind set moved by 3 points, about one question in the set. The grep oracle found only 0.35 @1 on the blind set too, which says most blind misses were coverage: the docs did not hold the answer, so no ranking change could surface it. Without a blind set and the oracle, the first table reads as victory.

## 6. Reporting a ranking problem

If a ranking miss is not fixed by the settings, file an issue with an anonymised repro: a few docs that show the problem (names and content you are happy to share) and the questions as `{id, tier, q, facets}` JSONL, plus the Targets table and Diagnosis section from `semantic-memory eval --notes .documentation --dir .claude/.semantic-memory/eval --json`. Include the versions and the commit from step 1. File it on the semantic-memory GitHub repository.
