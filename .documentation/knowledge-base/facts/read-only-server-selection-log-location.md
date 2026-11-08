---
title: A read-only server writes selection.jsonl under the index folder
tier: fact
domains:
  - troubleshooting
status: active
last_updated: '2026-11-07'
id: read-only-server-selection-log-location
confidence: high
last_verified: '2026-11-07'
verify_command: grep -n "indexSelectionLogPath" src/core/telemetry.ts
provenance:
  - 'https://github.com/the-glitch-kingdom/semantic-memory/issues/59'
sources:
  - src/core/telemetry.ts
tags:
  - gotcha
  - telemetry
  - selection-log
  - read-only
invalidated_by:
  - the read-only server writes its log elsewhere
---

# A read-only server writes selection.jsonl under the index folder

## Claim
A server started with `--read-only` logs to `<vault>/.semantic-sidekick-index/selection.jsonl`, not `.claude/.semantic-memory/selection.jsonl`, so the notes tree stays clean. `readSelectionLog` reads both. The usage log (`usage.jsonl`) is separate and always under `<repo>/.claude/.semantic-memory/`.

## Instead
When `selection-stats` looks empty for a read-only docs server, look under the index folder. Do not copy the file; use `gaps` for the hook's usage log.

## How to verify
`grep -n indexSelectionLogPath src/core/telemetry.ts`

## Consequences
`selection-stats` (server log) and `gaps` (hook log) report different numbers. They are two logs by design.
