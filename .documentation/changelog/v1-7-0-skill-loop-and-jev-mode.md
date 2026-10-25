---
title: v1.7.0 — the skill loop and jev mode
tier: reference
domains:
  - changelog
audience:
  - developers
  - admin
tags:
  - v1.7.0
  - skill-loop
  - jev-mode
  - skill-eval
  - validation
status: active
last_updated: '2026-10-25'
version: 1.7.0
purpose: What 1.7.0 adds (two opt-in features), what was decided while building
  it and why, how it was validated, and what the measurements showed.
load_priority: 6
estimated_read_time: 4 minutes
word_count: 691
last_validated: '2026-10-25'
backlinks: []
---

# v1.7.0 — the skill loop and jev mode

Two features, each **off by default** with its own switch. With both off, every hook's output is byte-for-byte
1.6.1's (checked event by event against a 1.6.1 build on the same fixture project), and nothing new is written
or started.

- **[The skill loop](../operational/skill-loop.md)** (`SEMANTIC_MEMORY_SKILL_LOOP`): semantic-memory learns
  procedures. Evidence (failures, corrections, skill use) → a SessionEnd job → a detached worker → one fenced,
  read-only `claude -p` → linted drafts → `/skill-loop review` → landed skills, with a ledger and single-change
  rollback; scope by rule, global only by promotion; a deterministic curator; opt-in merges; skill evals.
- **[Jev mode](../operational/jev-mode.md)** (`SEMANTIC_MEMORY_JEV`): Jev answers semantic-memory's closed-set
  questions through jev-loop's `router.ask` only.

## Decisions made while building it

- **The reviewer gets no write tool.** It answers JSON; semantic-memory writes the draft after redaction and
  lint. Verified flag by flag: `--tools` alone left claude.ai connectors (Drive, Docs) loaded, so every run also
  passes `--strict-mcp-config`. `--bare` was not usable: it needs an API key.
- **SessionEnd only writes and spawns** (its hooks get 1.5 s); a `setsid`/detached child survives the session.
- **Nothing lands without a person**, and once evals ran, a draft the gate did not adopt needs `--override`.
- **Task evals run a model-written Verify command**, so only on request (`--task`), after review shows it.
- **The curator spends no tokens** (deterministic); evals run on request.
- **Jev in the failure hook is a veto, not a confirmation** — see the measurements.
- **Private repos** (`SEMANTIC_MEMORY_PRIVATE_PATHS`, default `~/workspace/kentro`) keep project scope, stay out
  of the cross-repo index and never reach Jev.
- Skill-loop runs default to `sonnet`; at most 5 at once on the machine; at most 10 reviews a day.

## Measurements

**Jev as judge and gate** (1,171 of the 1,214 Claude-labelled pairs, ~0.5M Jev tokens): Jev's confident no's were
727 of 729 right; it never said yes at ≥ 0.95 to a relevant pair (max 0.89). Judge verdict: hybrid. A yes-gate on
the failure hook would inject nothing; the veto removed only wrong facts below 0.50 (12 wrong, 0 right at 0.30)
and none at the shipped 0.50 (61%), so jev mode does not turn the hook on. Details: [jev mode](../operational/jev-mode.md#measured-2026-10-25).

**The skill loop, end to end with real Claude** (scratch repo, project hooks pointing at the build):
- a session that swallowed its own failure (`cmd; echo $?`) → no signal, no job (correct)
- a failed `./scripts/build.sh` (exit 3) → evidence → job → detached worker → review in 14 s, $0.03 → a correct
  draft (project scope; steps, pitfalls and a Verify command from the evidence)
- `--eval --task`: 4 runs in 32 s, at most 2 of 5 slots used; gate `keep-draft` (one session gives no held-out
  set, and the repo's docs already explained the fix: the task passed with and without the skill)
- approved with `--override` → Claude Code lists it → a later session used it (usage line) → curator: keep
- with both switches on: a dirty-tree release failure → a second correct draft, $0.026
- with the skill loop off: the same kind of failing session left no evidence, no job, no worker

Three bugs the real run found, fixed before release: broad redaction of the whole reviewer brief masked the
session id (the reviewer copied `[REDACTED]` into provenance); approval ignored a failing eval gate; the curator's
dry run reported a fresh, used skill as "no learned skills".

## Validation

- 664 tests in 79 files (545 in 1.6.1; unit, integration, the hooks as real processes, fake `claude` and fake Jev in CI); new suites for
  the switches, the bridge (fake router, and the real router copied with the network faked: fake secrets never
  reach the request), the judge, the gate, schema and lint, evidence, queue and worker, reviewer, evals and the
  5-process cap, scope, landing, ledger and rollback, curator and merge, and a fake-secret drive over every new
  write point.
- Golden retrieval eval unchanged (recall@1 86%, MRR 0.929); failure eval unchanged (32/38).
- Offline tarball 557.7 MB, installs and verifies (10,663 files).
- jev-loop: a separate PR names callers (`JEV_CALLER`) and counts `semantic-memory-hook` as live.
