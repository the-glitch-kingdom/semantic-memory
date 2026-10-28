---
title: >-
  A worker started from a cron-launched Claude session inherits cron's PATH: no
  ~/.local/bin, so spawning `claude` fails with ENOENT
tier: fact
domains:
  - troubleshooting
status: active
last_updated: 2026-10-28T00:00:00.000Z
id: cron-sessions-start-workers-without-local-bin
confidence: high
last_verified: '2026-10-28'
verify_command: >
  cd "$(git rev-parse --show-toplevel)" && npm run build >/dev/null && npx
  vitest run test/integration/skill-loop-cron.test.ts
provenance:
  - >-
    reinvestorhub_marketing_workspace skill-loop.log, 2026-10-26 15:20Z — review
    failed with "could not start claude: spawn claude ENOENT" after its Monday
    08:00 cron session
  - >-
    fixed and re-run with PATH=/usr/bin:/bin on 2026-10-28 (1.7.1), reviewed in
    4 s
sources:
  - src/core/claude-run.ts
  - hooks/skill-loop.js
tags:
  - gotcha
  - cron
  - PATH
  - skill-loop
  - SessionEnd
invalidated_by:
  - cron jobs that set PATH to include ~/.local/bin
---

# A worker started from a cron-launched Claude session inherits cron's PATH

## Claim
Cron runs jobs with a minimal PATH (`/usr/bin:/bin`). The usual `claude` install, `~/.local/bin/claude`, is not
on it. A cron job that calls claude by its full path still works. But anything that session's hooks start, such
as the skill loop's detached worker, inherits that PATH. A bare `spawn("claude")` then fails with `ENOENT`.

## Instead
Resolve the binary before spawning: PATH first, then `~/.local/bin/claude` and `~/.claude/local/claude`. semantic-memory
1.7.1 does this in `claudeBin()`, and `SEMANTIC_MEMORY_CLAUDE_BIN` overrides it. Alternatively, export
`PATH="$HOME/.local/bin:$PATH"` in the cron line.
