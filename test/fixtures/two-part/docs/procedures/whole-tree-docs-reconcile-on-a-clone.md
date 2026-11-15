---
title: Whole-tree docs reconcile on a clone
tier: guide
domains:
  - procedures
  - workflows
status: active
purpose: How to judge every active doc in .documentation/ against the code with
  hewtd reconcile, on a throwaway clone, with blind audits and a retrieval
  benchmark, before promoting the result.
audience:
  - all
tags: []
last_updated: '2026-11-10'
version: 1.0.0
estimated_read_time: 4 minutes
word_count: 661
last_validated: '2026-11-10'
backlinks: []
sources:
  - .documentation/
  - .documentation/vault.schema.yml
  - .claude/hit-em-with-the-docs.json
  - .claude/CLAUDE.md
  - .claude/rules/
  - .documentation/knowledge-base/facts/semantic-memory-index-lives-inside-the-docs-tree.md
  - .documentation/workflows/documentation-system-user-guide.md
  - .documentation/plans/documentation-accuracy-remediation.md
  - .gitignore
external_refs:
  - blocked_files
  - reports/
last_verified: '2026-11-11'
---

# Whole-tree docs reconcile on a clone

How the 2026-11 whole-tree reconcile was run: every active doc judged against the code it cites,
fixed through hewtd review files, audited, measured, and only then proposed for promotion. Use it
when docs have drifted far enough that patching them one at a time no longer works.

## Ground rules

- Work in a **clone** of the repo, on its own branch, with pushes disabled
  (`git remote set-url --push origin DISABLED-no-push`). The real `.documentation/` stays untouched until
  promotion, and doc-mutating tools never run in a tree other sessions use.
- Every doc change goes through a hewtd review file and `hewtd reconcile --apply`. No hand edits,
  no hand-set `last_verified`.
- No model sees a secret: run `hewtd reconcile --secrets` first and move values out to
  `.env.hewtd` with pointers; never open an entry's `blocked_files`.
- Keep `reconcile.schema_sources` in `.claude/hit-em-with-the-docs.json` pointed at the SQLAlchemy
  models (`backend/app/models/**/*.py`, `backend/app/database/*.py`) so table and column refs are
  checked, and `reconcile.related_repos` at the sibling repos so their paths resolve.

## One round

1. **Skeletons.** `hewtd reconcile <files> --serial --write-review --batch <N>` (one review file
   per batch of 6-10 docs). The batch number must be unused: an existing review file fails with
   EEXIST.
2. **Judges.** One agent per review file, working from a written brief: read the whole doc, check
   every checkable claim against the code, fill the JSON entry (`verify` with exact `patch`
   entries, `rewrite` with a full `draft`, `archive` with a reason and its active linkers,
   `unverifiable` with a reason). Every ref in the entry's `missing` list is either fixed or added
   to `external_refs` with a reason. Judges write only their review and notes files.
3. **Mechanical check.** JSON parses, every entry has a verdict, every patch `old` occurs exactly
   once in the doc body, every `sources` path exists.
4. **Rewrite checks.** A second agent checks each `rewrite` draft both ways: is every claim in the
   draft correct, and did it drop anything true and useful from the old doc. Fold its patches into
   the draft before applying.
5. **Blind audit.** A third agent re-judges a sample (one patched `verify` doc per review file plus
   the most-patched one) from the code, without seeing the judge's verdict. Fix every WRONG it
   finds before applying. In this reconcile the audits found wrong claims the judges missed in
   most rounds, often in about half the sampled docs (wrong commands, line refs, counts, links),
   so the audit is not optional.
6. **Apply.** Back up `.hewtd/reconcile.json` and the review files, tick the accepted verdicts,
   `hewtd reconcile --apply <review files>`. hewtd commits the docs and refreshes the indexes.
7. **Hold archives.** `archive` verdicts stay unticked until a human signs off and every active
   doc that links to the archived one has been repointed.

## Priorities and pacing

- Judge the docs the benchmark questions land on first; they are what retrieval quality measures.
- Never relaunch agents after a usage-limit pause until you have checked their output files: a
  paused agent resumes on its own.
- Log code bugs the judges notice in a findings file with `file:line`; do not fix code during the
  reconcile, and do not file issues until the whole list has been grouped and confirmed on `main`.

## Measure before promoting

Use the retrieval kit (outside the repo) on a full cold index build of a copy of the clone:
hybrid @1 and @3, keyword and paraphrase @1, result #1 plus its related links, negatives flagged,
top-3 docs verified and citing no missing refs, p95 latency. Compare against the same numbers on
the untouched original tree.

Keep one question set **blind**: written from code, git history and real queries by an agent that
never saw the docs. Fixing docs that a validation set's misses landed on makes that set no longer
blind, so write the blind set before such fixes, and check that its topics do not leak in from
files loaded into every agent's context (`CLAUDE.md`, `.claude/rules/`).

## Before promotion

Keep the original `.documentation/` working tree (including `archive/` and gitignored
`reports/`) as a frozen, read-only, dated copy, so the institutional history stays searchable after
the reconciled tree replaces it.

Since hewtd 3.2.0 the swap and that copy are one command, and you do not capture the tree by hand:

1. Move the semantic-memory docs index (`.documentation/.semantic-sidekick-index`, gitignored) out
   of the tree **before** staging, and recreate the empty folder plus reindex after the promote. It
   lives inside the docs tree, so it would otherwise be frozen into the cold generation, and moving
   it after `--stage` makes the promote refuse. See
   [the fact](../knowledge-base/facts/semantic-memory-index-lives-inside-the-docs-tree.md).
2. `hewtd reconcile --stage .hewtd/<name>` snapshots the live tree (archive and gitignored files
   included) into `.hewtd/<name>/docs`; run the round above with `--staged .hewtd/<name>`.
3. `hewtd reconcile --promote --staged .hewtd/<name>` prints the plan and changes nothing; add
   `--confirm` to swap the reconciled copy in as the live docs and keep the old tree as a
   committed, read-only, dated cold generation (`.documentation-cold/<date>/`, set by
   `reconcile.cold_root`).
4. `hewtd reconcile --generations` lists the cold generations with a checksum status;
   `hewtd reconcile --undo <generation> --confirm` restores one byte for byte.

## Related

- [hewtd docs system user guide](../workflows/documentation-system-user-guide.md)
- [Documentation accuracy remediation plan](../plans/documentation-accuracy-remediation.md)
