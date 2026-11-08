---
title: v1.20.0 - user help
tier: reference
domains:
  - changelog
audience:
  - developers
  - admin
tags:
  - v1.20.0
  - help
status: active
last_updated: '2026-11-08'
version: 1.20.0
purpose: What v1.20.0 changed (the help command, tool and slash command, and
  search --paths), what was verified, and what is still open.
load_priority: 5
estimated_read_time: 1 minute
sources:
  - src/core/help/topics.ts
  - src/cli/search.ts
  - src/mcp/tools/system.ts
  - commands/help.md
  - package.json
  - src/cli/index.ts
  - test/unit/help-coverage.test.ts
  - test/integration/help-topics-e2e.test.ts
word_count: 200
last_validated: '2026-11-08'
backlinks: []
---

# v1.20.0 - user help

One place to ask "how do I do X with semantic-memory". The same 15 topics answer from the CLI, the MCP server and a slash command.

## What changed

- `semantic-memory help [topic...]`, the MCP tool `help({ topic? })` (45 tools; 21 in read-only mode) and `/help` render the topics in `src/core/help/topics.ts`. No topic lists every topic; an unknown one lists up to 3 closest.
- `semantic-memory search --paths` prints unique vault-relative doc paths, one per line, for hit-em-with-the-docs `reconcile` (`search_command: npx semantic-memory search --notes .documentation --paths {query}`). In a scratch copy with hewtd 2.21.0, all 3 members came via search; without the config there were 0.
- Tests keep the topics honest: `test/unit/help-coverage.test.ts` (every CLI command, MCP tool and schema key is covered or exempted with a reason; every command, flag, slash command, script, doc file and tool param a topic names exists) and `test/integration/help-topics-e2e.test.ts` (add-index and federated-search followed step by step).

## Measured

No retrieval code changed. `npm run eval`: 132 passed, 5 expected fail. `npm test`: 1154 passed, 5 expected fail.

## Missed targets

- Topic commands that are pseudo-calls (`search_hybrid {...}`, `<hf-model-id>`) and `npx hewtd` commands are not run by the drift test.
- The offline tarball is built at release, not on this branch.
- `printToolList` in `src/cli/index.ts` (the `tools` command's intro) is a stale hand-kept list and does not mention `help`.
