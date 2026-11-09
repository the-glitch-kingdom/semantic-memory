# Notes: semantic-first skill refresh (#81)

## Phase 1: verification (origin/main at v1.25.0, 2026-11-09)

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| — | skill unchanged since the rebrand | Mostly true | The last edit was c8327af, which added the broad-question lines; the server sections still describe semantic-sidekick. |
| 1 | stale server names | Half right | See below. |
| 2 | `top_k` | Confirmed | SKILL.md:47. The tool takes `limit` (`src/mcp/tools/search.ts:157`, default 10). |
| 3 | `create_note` as the default | Confirmed | SKILL.md:82. The server instructions say "Write research, decisions and gotchas here with synthesize_note" (`src/mcp/server.ts:106`). |
| 4 | "Indexing in progress" unhandled | Confirmed | The strings are at `src/mcp/context.ts:622` and `:624`: "Indexing in progress (N/M chunks)... Try again shortly." and "Indexing in progress... Try again shortly." The skill never mentions them. |
| 5 | docs server presence | Half right | The auto-added entry *is* tied to hit-em-with-the-docs (reconcile.js:10), but any read-only notes dir can be configured by hand. Say both. |
| 6 | abstention fields missing | Confirmed | No `missing_terms`, `passing_terms`, `undocumented` or `no_strong_match` in the skill. The server instructions cover three of them but not `passing_terms` (`src/mcp/server.ts:105`). |
| 7 | multi-part coverage | Confirmed | The skill has "read the top 3 … search each step separately" (also asserted by `test/unit/search-guidance.test.ts` on 4 surfaces), but no per-part coverage check. #76: one part's doc often sits at rank 4–8. |
| 8, 9, 10 | Grep for literals; docs vs code; `decay`; `related` and `entity` | Not in the skill | `related` and `entity` are on result #1 (`src/mcp/tools/search.ts:84-87`); `decay` is on decayed results (`:30`, `:78`). Step 4 only mentions forwardlinks and backlinks. |

### Item 1 in detail
- The skill hard-codes `mcp__semantic-sidekick__*` (docs) and `mcp__semantic-vault__*` (vault).
- Server names come from each project's `.mcp.json`, and the plugin manifest declares no `mcpServers`.
- Our SessionStart reconcile hook writes `semantic-vault`, plus a read-only `semantic-sidekick` for `.documentation` when hit-em-with-the-docs is enabled (`hooks/reconcile.js:33-34`, kept for backward compatibility).
- The reporter's install uses `semantic-memory` and `semantic-memory-docs`. Since v1.7.2 the hooks accept any `semantic-*` entry with `--notes` (installation-guide.md).
- **Conclusion:** neither pair is "the" name, so the fix is role-based wording, not a rename.

### Other stale files

| File | Stale content |
|---|---|
| `skills/semantic-first/evals/evals.json` | 1 hit (`semantic-sidekick__search_hybrid`) |
| `skills/semantic-first/references/vault-frontmatter.md` | 3 hits |
| `skills/vault-first/SKILL.md:35` | hard-codes `mcp__semantic-vault__search_hybrid` |
| `skills/research-mode/SKILL.md:36` | same |
| `skills/outage-silence/SKILL.md:23` | same |
| `hooks/vault-context.js:424, 888, 890, 915, 925, 947` | prints `mcp__semantic-vault__…` in messages, even for installs whose vault entry has another name |

### Docs that mention semantic-first
- `.documentation/architecture/indices-and-storage.md`, `.documentation/architecture/injection-points.md`
- `.documentation/operational/modes-guide.md`
- `.documentation/quickstart/installation-guide.md`, `.documentation/quickstart/sidekick-overview.md`
- `.documentation/reference/cli-reference.md`, `.documentation/reference/configuration-reference.md`
- `README.md`
- `.documentation/legacy/changelog.md` is historical; leave it.

## Phase 1b: the revised issue (2026-11-09)

The reporter rewrote #81. It now asks to:
1. replace SKILL.md with a 516-word draft (saved verbatim as `draft-SKILL.md`);
2. delete `references/vault-frontmatter.md`;
3. fix the old tool names in `vault-first`, `research-mode` and `outage-silence`.

Acceptance also includes a trigger-eval check of the shorter description.

### Verified on the branch (main at 0e732b1 merged in)

| Claim | Result |
|---|---|
| Tools the draft names exist: `search_hybrid`, `search_text`, `read_note`, `forwardlinks`, `backlinks`, `ingest_source`, `synthesize_note` | All registered in `src/mcp`. |
| Result fields exist: `missing_terms`, `undocumented`, `passing_terms`, `no_strong_match`, `decay`, `entity`, `related` | All in `src/mcp/tools/search.ts`. Phase 2 checks them on a live response. |
| The reference file is stale | It documents `tier`, `source` and `owner`. `synthesize_note` writes `title`, `type`, `status`, `last_verified`, `confidence`, `sources`, … (`src/core/synthesize.ts:67-80`). Only SKILL.md and evals.json reference it. |
| "wikilinks resolve only to other vault notes" | Wikilinks resolve within the indexed notes root (`src/core/graph.ts:84-90`, a pathLookup of that root's documents). True for the vault server. |
| Draft hard-codes `semantic-memory-docs` / `semantic-memory` | **Wrong for default installs.** `hooks/reconcile.js:33-34` writes `semantic-vault` / `semantic-sidekick`. Phase 3 keeps the draft but names servers by role, with both name pairs as examples. |

**Trigger eval tooling:** `semantic-memory skill-eval trigger <skill-md> --prompts <jsonl of {session,text}> [--json]`. It runs real claude sessions, so Phase 5 has an explicit budget.

## Eval results: Phase 2 (tests only, no ranking numbers)

Run on 1.25.0 skills (`test/unit/skill-surfaces.test.ts`, `test/e2e/skill-result-fields.test.ts`):

| Assertion | On 1.25.0 | With the draft SKILL.md |
|---|---|---|
| no `mcp__semantic-sidekick__` / `mcp__semantic-vault__` in skills/ | fails | still fails (siblings, evals.json: Phases 3-4) |
| no `top_k` | fails (SKILL.md:47) | passes |
| no `create_note` | fails (SKILL.md:82) | passes |
| every tool named is in CURRENT_TOOL_INVENTORY | fails (`read_time_min` in the reference file) | fails until the reference file is deleted |
| semantic-first names the 7 lookup/research tools | fails | passes |
| semantic-first names the 7 result fields | fails (5 missing) | passes |
| indexing string / "result 8" / "every part is covered" | fail | pass |
| reference file gone | fails | fails until deleted (Phase 3) |
| live `search_hybrid` carries all 7 fields; schema has `limit` | passes (8/8) | n/a |

9 cases are `it.fails`; they become plain `it` in Phases 3-4 (Phase 8 checks none is left).
The live fields come from one small git repo (src/TaskResponse.ts, DeadLetterSweeper.ts, 4 docs; `passing_terms` via a name in one non-top doc) on the built server.

## Eval results: Phase 3 (text only, no ranking numbers)

`diff draft-SKILL.md skills/semantic-first/SKILL.md` shows only the two-server lines (draft line 8 gains the `.mcp.json` names sentence with both name pairs; lines 10-11 say "The docs server" / "The vault server" instead of the hard-coded names). Everything else is verbatim.

Word count: SKILL.md 534 words (draft ~516, old skill ~1,968 plus a 1,099-word reference file, now deleted with `git rm`; `references/` is gone).

`evals.json`: `mcp__semantic-sidekick__search_hybrid` -> `search_hybrid`; the vault-frontmatter.md mention and "full frontmatter ... source: mixed" now say a note written through `synthesize_note`.

Tests: 8 of the 9 Phase 2 `it.fails` are plain `it` (verified passing). The no-tool-prefix case stays `it.fails` until Phase 4 (sibling skills).

## Eval results: Phase 4
No ranking change. Sibling skills now use bare tool names plus "on the vault server". `hooks/vault-context.js`: new `vaultTool(projectRoot, tool)` (writable semantic-* entry name, default semantic-vault) used in all six messages; test added in `test/phase5/stop-hook-session.test.ts`. Server instructions gain one clause naming `passing_terms`. The prefix case in skill-surfaces.test.ts is a plain `it`; no `it.fails` left there. Full lint/build/test/eval green (1144 + 148 tests).

## Eval results: Phase 5 (trigger check, NOT MEASURED)
- Prompt set: `trigger-prompts.jsonl`, 25 prompts (15 should-trigger incl. the 4 from evals.json, 10 should-not), all train. Written before the run.
- Driver: throwaway script in /tmp calling `runTrigger` directly (the CLI labels prompts by provenance session, which this skill has none of). Old skill from `git show main:skills/semantic-first/SKILL.md`; new from the branch. Sibling skills in the scratch dir are the branch's for both arms. Cache in /tmp, run sequentially.
- Runs: old 92, new 92 = 184 claude runs (budget was ~120; 25 prompts x up to 3 votes plus retries of errored runs). Runtime: old 140 s, new 156 s. Cost: not reported by the tool.
- Result: unusable. Prompts with a vote: old 7/25, new 6/25; the rest are `error_max_turns` (see Errors Encountered). The only recorded trigger was old/CRM (1 of 1). Pass rule not evaluated; no description change made.

## Eval results: Phase 8 (independent review of git diff main...HEAD)

Checks run: it.fails count in test/unit/skill-surfaces.test.ts = 0; grep of skills/ for mcp__semantic-sidekick__, mcp__semantic-vault__, top_k, create_note = no hits; link step in a scratch project (copied package with no references/ dir, ran scripts/link-skills.js): 4 skills linked, no dangling symlink, every SKILL.md resolves. Full validation: lint, build, npm test (1143 pass, freshness-scale warm start flaked once, passes alone), npm run eval (148 pass, 4 expected fail). No ranking code changed, so no ranking numbers.

#81 acceptance, item by item:
1. Replace SKILL.md with the draft: MET, with the one documented change (servers by role, both name pairs as examples). Not byte-identical to the draft by design.
2. Delete references/vault-frontmatter.md: MET (no reference to it remains in the repo apart from the test that asserts its absence).
3. Fix old tool names in vault-first, research-mode, outage-silence: MET.
4. No semantic-sidekick/semantic-vault tool names, top_k, or create_note-as-default in skills/: MET (grep empty).
5. Every tool and field the skill names exists in the release: MET (unit test over CURRENT_TOOL_INVENTORY; e2e test on a live search_hybrid response shows all 7 fields and `limit`, no `top_k`).
6. Shorter description still triggers on the same questions: NOT MEASURED. The trigger eval discards runs that call the Skill (error_max_turns), so Phase 5 has no usable counts. The description text is identical to the draft's, which is the reporter's own text; there is no evidence either way.

Not covered by the acceptance list, left as is:
- commands/vault.md, commands/mode.md, commands/contract.md (allowed-tools frontmatter needs exact names) and one CLI help string still say mcp__semantic-vault__. Not under skills/.
- vaultTool() prints the .mcp.json key; a plugin-launched server may be exposed under a different mcp__ name. Unchecked.
- Only the Stop hook's session_finish message has a test, not the other five.
Fix made in this phase: evals.json em dash restored (cosmetic diff noise).
