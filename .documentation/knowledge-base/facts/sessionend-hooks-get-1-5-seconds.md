---
title: >-
  SessionEnd hooks get 1.5 seconds by default, then Claude Code moves on: start
  long work detached
tier: fact
domains:
  - troubleshooting
status: active
last_updated: 2026-10-25T00:00:00.000Z
id: sessionend-hooks-get-1-5-seconds
confidence: high
last_verified: '2026-10-25'
verify_command: >
  cd "$(git rev-parse --show-toplevel)" && npx vitest run test/unit/skill-queue.test.ts
provenance:
  - Claude Code hooks docs (SessionEnd), checked while building the v1.7 skill loop
  - a setsid child started by a SessionEnd hook wrote its file 8 s after claude -p exited (2.1.310)
sources:
  - hooks/skill-loop.js
  - src/core/skill-worker.ts
tags:
  - gotcha
  - SessionEnd
  - hooks
  - skill-loop
  - CLAUDE_CODE_SESSIONEND_HOOKS_TIMEOUT_MS
invalidated_by:
  - the SessionEnd default timeout changes
---

# SessionEnd hooks get 1.5 seconds by default, then Claude Code moves on: start long work detached

## Claim
Claude Code gives `SessionEnd` hooks a default timeout of 1.5 s (`CLAUDE_CODE_SESSIONEND_HOOKS_TIMEOUT_MS`, or a
per-hook `timeout` up to 60 s). A review, an upload or any model call started inline is cut off. `SessionEnd`
also fires for `claude -p` (reason `other`). `Stop` is not a substitute: it fires after every turn.

## Instead
Do only fast I/O in the hook, then start the work as a detached process:
`spawn(process.execPath, [cli, …], { detached: true, stdio: "ignore" }).unref()` (or `setsid … &`). The child
survives the session exiting. The skill loop's SessionEnd writes one job file and starts its worker this way;
the verify_command runs the test that the hook writes the job in under 100 ms.

## How to verify
A SessionEnd hook that runs `setsid bash -c 'sleep 8; date > /tmp/x' &` and exits: `/tmp/x` appears 8 s after
`claude -p` returns.
