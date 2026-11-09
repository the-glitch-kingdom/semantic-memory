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
