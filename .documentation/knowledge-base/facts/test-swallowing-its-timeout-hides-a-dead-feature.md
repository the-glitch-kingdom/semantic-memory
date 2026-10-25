---
title: >-
  A test that treats its own timeout as "environment unsupported" passes while
  the feature is dead
tier: fact
domains:
  - testing
status: active
last_updated: 2026-10-24T00:00:00.000Z
id: test-swallowing-its-timeout-hides-a-dead-feature
confidence: high
last_verified: '2026-10-25'
verify_command: >
  cd "$(git rev-parse --show-toplevel)" && ! grep -rn "Skipping: filesystem
  events not available" test/
provenance:
  - 'https://github.com/the-glitch-kingdom/semantic-memory/issues/29'
sources:
  - test/integration/watcher.test.ts
tags:
  - gotcha
  - testing
  - flaky-test
  - 'Skipping: filesystem events not available in this environment'
---

# A test that treats its own timeout as "environment unsupported" passes while the feature is dead

## Claim
The pre-1.5.2 watcher tests caught their own `Watcher timeout` and returned with `console.warn("Skipping: filesystem events not available in this environment")`. The test then reports as passed, so a watcher that never fires looks identical to a slow filesystem. Each "passing" test took the full 5 s timeout, which is the only visible sign.

## Instead
Let the timeout fail the test. If a platform genuinely lacks the capability, skip on a check of that platform (e.g. `it.skipIf(onWslMount)`), never on the failure the test exists to detect. When auditing a suite, look for `catch` blocks that `return` and for tests whose run time equals their timeout (`vitest --reporter=verbose`).

## How to verify
`verify_command` asserts the swallow pattern is gone from `test/`. With the old code, `npx vitest run test/integration/watcher.test.ts --reporter=verbose` showed every event test at ~5000 ms and printed the "Skipping" line.

## Consequences
Issue #29's watcher bug shipped in every release since the chokidar 5 upgrade with a green suite.

## See also
- [chokidar-4-glob-is-a-literal-path](chokidar-4-glob-is-a-literal-path.md)
