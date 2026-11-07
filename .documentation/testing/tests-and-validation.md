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
npm test               # full vitest run
npm run lint           # tsc --noEmit typecheck
```

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
| `retrieval-eval/real-corpus.jsonl` + `scripts/retrieval-eval/real-corpus.mjs` | Own questions against this repo's `.documentation/` through the production launch; before/after benchmark, not a CI gate. |
| `scripts/retrieval-eval/stale-audit.mjs` | Re-embeds a sample of chunks and compares with stored vectors (stale %, missing, orphans, index vs disk). |
| `scripts/retrieval-eval/mine-selection.mjs` | Drafts eval questions from `selection.jsonl` (search then read follow-ups); output is for hand review. |
| `integration/freshness.test.ts`, `freshness-scale.test.ts` | Edit mid-session, edit while down, touch-all re-embeds nothing, schemaVersion bump, mixed commit recovery, zero inotify watches, two processes, edit during reconcile, 1,000-doc warm start under 1 s. |
| `unit/{reconcile,bm25,graph-links,graph-knowledge,path-class,reranker}.test.ts`, `unit/search-parity.test.ts` | Diff branches and throttle, BM25, link extraction and typed edges, archive globs, rerank fallback, CLI and MCP same order on the golden questions. |

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
