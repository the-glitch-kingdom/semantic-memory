---
title: Tests and Validation
tier: guide
domains: [testing]
audience: [developers]
tags: [tests, validation, ci, vitest]
status: active
last_updated: '2026-04-23'
version: '0.2.3'
purpose: Test layout, per-file coverage, Phase 1 activation suite, fresh-install validation
load_priority: 6
---

# Tests and validation

> How to run the test suite, what each file covers, and how to validate a fresh install behaves as designed.

## Test suite overview

186 tests across 24 files, covering all five layers + Phase 4.5 auto-logging.

```bash
npm test               # every test file except test/retrieval-eval/
npm run eval           # test/retrieval-eval/ only (retrieval floors)
npm run lint           # tsc --noEmit typecheck
```

`npm test` and `npm run eval` split the files between them, so each file runs once (v1.25.1; before, `npm test` also ran the 16 eval files and CI ran them twice). Run both for a full validation. To run one eval file, name it: `npx vitest run test/retrieval-eval/<file>.test.ts`.

Four tests retry twice by themselves (`{ retry: 2 }`), because they time real processes and failed only under the full parallel suite or a loaded CI runner:
- the freshness-scale warm start;
- the hook-failure Jev hang;
- the stdin-eof SIGTERM exit;
- the skill-queue SessionEnd job.

A real failure still fails all three attempts. Don't add a retry to any other test; a new load flake goes into the plan or an issue first.

## Test layout

```
test/
├── setup.ts              # creates + cleans up temp vaults from fixtures/vault/
├── global-setup.ts       # vitest global hooks
├── fixtures/vault/       # canonical fixture vault (~10 notes, used by most unit tests)
├── unit/                 # per-module unit tests
│   ├── crud.test.ts              # inherited — note CRUD
│   ├── frontmatter.test.ts       # inherited — FrontmatterManager
│   ├── graph.test.ts             # inherited — GraphBuilder
│   ├── indexer.test.ts           # inherited — Indexer + parsed-doc cache
│   ├── search-text.test.ts       # inherited — TextSearch
│   ├── schema.test.ts            # Phase 2 — schema loader + validateNote
│   ├── patch.test.ts             # Phase 2 — applyPatch atomic semantics
│   ├── synthesize.test.ts        # Phase 2 — buildSynthesizeChangeSet
│   ├── lint.test.ts              # Phase 2 + Phase 3 — lintVault (+ broken links)
│   ├── ingest.test.ts            # Phase 3 — buildIngestChangeSet + integration
│   ├── log.test.ts               # Phase 3 — logEvent/logQuery round-trip
│   ├── index-regen.test.ts       # Phase 3 — regenDirectoryIndex
│   └── phase-4-5-auto-logging.test.ts  # Phase 4.5 — auto-logging shapes
├── integration/
│   └── mcp-server.test.ts        # MCP JSON-RPC: tools/list returns 33
├── e2e/
│   ├── stdio-server.test.ts      # stdio transport
│   └── lazy-startup.test.ts      # lazy index on connect
├── phase1/                       # Phase 1 activation hypothesis test
│   ├── prompts.json              # 10 real-shape prompts (8 positive, 2 negative)
│   └── run.js                    # runner — invokes hook, asserts expected hits
└── phase4/                       # Phase 4 + 4.5 hook behavior
    ├── mode-hook.test.ts         # mode-aware hook branching (5 cases)
    └── state-delta.test.ts       # Phase 4.5 SessionStart state-delta (3 cases)
```

## The Phase 1 activation suite (`test/phase1/`)

**The hypothesis test.** Validates that the hook mechanism produces relevant top hits for natural-language project questions.

```bash
node test/phase1/run.js
```

Output:
```
▶ pos-01-mfa-enforcement: how does MFA enforcement work in this project?
  ✓ (737ms) hit: features/authentication/mfa-enforcement-overview.md, ...
...
Positive cases (vault must hit expected note):  7/8
Negative cases (advisory):                       2/2
Overall:                                         9/10
✓ PHASE 1 ACTIVATION: PASS
```

**Pass criterion:** ≥7/10 overall (plan's success bar). Current state: **9/10**.

The suite points at `/home/tmarlette/workspace/the-glitch-kingdom/sidekick-test-vault/` by default (set in `prompts.json`). To run against a different vault:
1. Edit `vaultPath` in `prompts.json`.
2. Update the `mustIncludePath` substrings to match notes that actually exist there.
3. `node test/phase1/run.js`.

## What each test file covers

### Phase 1 — activation

| File | Covers |
|---|---|
| `phase1/run.js` | The 10-prompt conversational test. Hook mechanism produces relevant top hits. |

### Phase 2 — structure + capture

| File | Covers |
|---|---|
| `unit/schema.test.ts` | Default schema load, custom override, installDefaultSchema, validateNote (required fields, enums, provenance, stale). |
| `unit/patch.test.ts` | applyPatch create+update+delete atomic, rollback on mid-patch failure, dry-run, validate=true blocks, validate=false allows. |
| `unit/synthesize.test.ts` | Frontmatter population, auto-wikilinks (including code-block skip), defaults. |
| `unit/lint.test.ts` | Grouped findings, format output, broken-link detection. |

### Phase 3 — ingest + maintenance

| File | Covers |
|---|---|
| `unit/ingest.test.ts` | buildIngestChangeSet shape, atomic apply_patch integration, derived_from wiring. |
| `unit/log.test.ts` | logEvent creates + appends; logQuery filters by kind, date range, limit. |
| `unit/index-regen.test.ts` | regenDirectoryIndex lists notes + summaries, idempotent on unchanged, multi-dir dedup. |

### Phase 4 — routing

| File | Covers |
|---|---|
| `phase4/mode-hook.test.ts` | SessionStart mode reset, UserPromptSubmit outage-silence suppression, Stop branching per mode (research synthesis / outage postmortem / vault-first generic). |

### Phase 4.5 — auto-logging

| File | Covers |
|---|---|
| `unit/phase-4-5-auto-logging.test.ts` | kind=error round-trip, 14-day window filter, apply_patch + synthesize + ingest failure shapes. |
| `phase4/state-delta.test.ts` | SessionStart injects state-delta block (empty + populated), logs mode_change on prior-mode drift. |

### Integration + e2e

| File | Covers |
|---|---|
| `integration/mcp-server.test.ts` | MCP JSON-RPC `tools/list` returns 33 tools. |
| `e2e/stdio-server.test.ts` | Server connects over stdio, lists tools. |
| `e2e/lazy-startup.test.ts` | Index is lazy by default — tools list returns before indexing completes. |

### Retrieval and freshness (v1.9.0)

| File | Covers |
|---|---|
| `retrieval-eval/docs-eval.test.ts` (`npm run eval`) | Three arms (`search_semantic`, `search_hybrid`, `search_text`) over `test/fixtures/docs-vault` with `golden.jsonl` (answer facets, negatives, archive hits, payload bytes), graph precision/recall vs `docs-graph-truth.json`; fails below the floors in `baseline.json`. Also its own CI step. |
| `retrieval-eval/golden-docs-heldout.jsonl`, `real-corpus-heldout.jsonl`, `real-corpus-eval.test.ts`, `gates.ts` (v1.9.1) | Held-out splits (fixture and `.documentation/`), never used to tune. Shared gates per split: hybrid @1 >= semantic @1 - 1, paraphrase hybrid >= semantic, all negatives flagged, answerable false flags <= 10%, HNSW recall@k >= 0.97 vs exact cosine. Gates still missed run as `it.fails` (`KNOWN` in the test files) and flip red when fixed. |
| `retrieval-eval/real-corpus.jsonl` + `scripts/retrieval-eval/real-corpus.mjs` | Own questions against this repo's `.documentation/` through the production launch; before/after benchmark, not a CI gate. |
| `scripts/retrieval-eval/stale-audit.mjs` | Re-embeds a sample of chunks and compares with stored vectors (stale %, missing, orphans, index vs disk). |
| `integration/freshness.test.ts`, `freshness-scale.test.ts` | Edit mid-session, edit while down, touch-all re-embeds nothing, schemaVersion bump, mixed commit recovery, zero inotify watches, two processes, edit during reconcile, 1,000-doc warm start under 1 s. |
| `unit/{vector-ef,confidence}.test.ts`, `integration/{index-upgrade,read-only-clean-tree,links-exclude}.test.ts`, `unit/{search-text,graph-links}.test.ts` (v1.9.1) | `setEf`, `fuseScores`, confidence without margin, per-index BM25 threshold, v1.7.2 and v1.9.0 index upgrade (re-embeds only the edited chunk, serves stale), read-only server leaves `git status` clean, excluded notes in links and `graph_path`, `search_text` order, `graph_path` directions. |
| `unit/{fields,rank,search-guidance}.test.ts`, `integration/retrieval-fields.test.ts` (v1.10.0) | Field-text builder (every field, string and list `user_phrase`, excluded keys), meta chunks and `meta_weight`, `index_fields` parsing, `generated: true` exclusion, coverage stats; coverage score and link prior; the guidance strings in the tool description, server instructions and both skills; acceptance: a symptom-only doc in the top 3 with `matched`, frontmatter title, object symptoms indexed, generated never returned, a symptom edit embeds only the new phrase, v1.9.1-shaped index upgrade embeds only metadata. |
| `retrieval-eval/*` tiers (v1.10.0) | Tiers `exact`, `paraphrase`, `symptom`, `nofield`, `multi`; per-tier @1/@3 floors in `baseline.json` `tiers` for both arms on all four splits. `nofield` is the coverage-bias check: the answer doc has no indexed fields and competes with a purpose-carrying neighbour. |
| `src/core/retrieval-eval/*`, `retrieval-eval/{facet-metrics,runner,suite,generate}.test.ts` (v1.13.0) | The shipped eval engine (moved from `test/retrieval-eval/eval.ts`, which re-exports it): side-effect-free runner (no index or log changes, refuses with no index), the `eval` CLI (needs `npm run build` first), `--baseline` / `--check` with the noise band and the refusal of both together, a 40-case run under 120 s, and the question generator (validation, provenance, reproducibility) on the fake `test/bin/claude`. |
| `unit/{reconcile,bm25,graph-links,graph-knowledge,path-class,reranker}.test.ts`, `unit/search-parity.test.ts` | Diff branches and throttle, BM25, link extraction and typed edges, archive globs, rerank fallback, CLI and MCP same order on the golden questions. |

### v1.18 query routing

`unit/graph-walk.test.ts` (walk, caps, 5k-node benchmark), `unit/reading-path.test.ts`, `integration/search-payload.test.ts` (label, `mode`, no reordering), `integration/reading-path-filter.test.ts` (filters, no export), `retrieval-eval/qtype-labels.test.ts` (labels and classifier accuracy). The eval gates forced-flow `#1+path` on the train splits.

### v1.19 federation

`unit/federation.test.ts` (config parse, hewtd siblings, containment), `unit/federation-merge.test.ts`, `integration/federation-sources.test.ts` (read-only, shared embedder, missing and unreadable paths), `integration/federated-search.test.ts`, `integration/federation-notes.test.ts` (stale note, telemetry, no hewtd config), `integration/single-source-snapshot.test.ts` (single-source output equals v1.18.0), and `retrieval-eval/federation-eval.test.ts` (relative gates on train and held-out).

## Running subsets

```bash
# One file
npx vitest run test/unit/schema.test.ts

# One describe block
npx vitest run test/unit/patch.test.ts -t "applyPatch"

# Watch mode
npm run test:watch
```

## Adding a test

### For a new MCP tool
1. Unit test in `test/unit/` for the underlying core module.
2. Update `test/integration/mcp-server.test.ts` + `test/e2e/*.test.ts` — bump tool count assertions from 33 → 34.

### For a new hook behavior
1. Compact case in `test/phase4/mode-hook.test.ts` — invokes the hook as a subprocess, asserts on stdout JSON.
2. If it's stateful (reads/writes `.claude/.sidekick-*`), set up + tear down temp dirs.

### For new activation behavior
1. Add a case to `test/phase1/prompts.json` with a realistic project-shape prompt.
2. Verify `mustIncludePath` is a substring that will only match the expected note.

## CI integration

None yet in this repo. To add GitHub Actions:

```yaml
# .github/workflows/test.yml
name: test
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
      - run: npm run lint
      - run: npm test
```

The Phase 1 activation suite needs a vault path — skip it in CI or provide a checked-in minimal vault.

## Validating a fresh install

After installing the plugin into a new project:

```bash
# 1. Hooks registered
cat .claude/settings.json | jq '.hooks | keys'
# expected: ["SessionStart", "Stop", "UserPromptSubmit"]

# 2. Skills linked
ls -la .claude/skills/ | grep -E '(vault-first|research-mode|outage-silence)'
# expected: three symlinks

# 3. MCP wired
cat .mcp.json | jq '.mcpServers."semantic-vault"'
# expected: { command: "node", args: [... "--notes", <path>] }

# 4. Binary works
node node_modules/@theglitchking/semantic-sidekick/bin/semantic-sidekick --version
# expected: version string

# 5. Vault indexed
ls <vault>/.semantic-sidekick-index/
# expected: hnsw.bin, graph.json, meta.json, docs.cache.json, ...

# 6. Lint clean (or at least runs)
semantic-sidekick lint --notes <vault> --json | jq '.counts'

# 7. Slash commands
ls commands/
# expected: mode.md, vault.md (from installed plugin)
```

Fresh session test:
1. Start `claude`.
2. Check `ctrl+o` on the SessionStart hook — should see `<vault-state-since>` + `<vault-context>` blocks.
3. `/mode status` → "current mode: vault-first".
4. Ask a project question → Claude should call `mcp__semantic-vault__search_hybrid`.
5. `/mode research` → prefix becomes `[research]`.
6. `/mode vault-first` → synthesis prompt should fire before exit (if session had substantive content).

If all 6 work, the installation is validated end-to-end.
