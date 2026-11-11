---
title: A checksum we defined ourselves did not match the one
  hit-em-with-the-docs writes, so every real generation read as tampered
tier: fact
domains:
  - troubleshooting
status: active
last_updated: '2026-11-11'
purpose: Why was every rotated cold generation reported as checksum-mismatch and
  skipped, although nothing had changed?
symptoms:
  - cold-notice says a registered generation's checksum no longer matches the
    manifest
  - search --source long-term finds nothing for a freshly rotated generation
  - a test built with our own checksum helper passes while a real rotation fails
id: a-checksum-defined-on-our-side-must-be-checked-against-the-producer
confidence: high
last_verified: '2026-11-11'
verify_command: >
  cd "$(git rev-parse --show-toplevel)" && grep -n "export function
  coldChecksum\|export function coldMatches" src/core/cold.ts && npx vitest run
  test/unit/long-term-checksum.test.ts
provenance:
  - Phase 9 of the long-term memory plan (#93): read hewtd 3.2.0
      src/core/reconcile/rotation.ts and ran a real rotation in a temp repo
sources:
  - src/core/cold.ts
  - test/unit/long-term-checksum.test.ts
  - test/long-term-fixture.ts
tags:
  - gotcha
  - long-term-memory
  - contract
invalidated_by:
  - hit-em-with-the-docs changes its cold_storage checksum definition
audience:
  - all
version: 1.0.0
estimated_read_time: 1 minute
word_count: 183
last_validated: '2026-11-11'
backlinks: []
---

# A checksum we defined ourselves did not match the one hit-em-with-the-docs writes

## Claim
Our first `coldChecksum` joined its lines with a trailing newline, skipped symlinks and hashed every file. hit-em-with-the-docs 3.2.0 joins with `\n` and no trailing newline, hashes a symlink as `link:sha256(target)`, and covers only git-tracked files in `checksum` (the whole tree is in `disk_checksum`). Fixtures written with our own helper agreed with our code, so the tests passed while every real rotated generation read `checksum-mismatch`.

## Instead
Take the definition from the producer's shipped code (`compute_tree_checksum`), not from the issue text or from our own helper. `coldChecksum` now equals it, and `coldMatches` accepts the full tree against `disk_checksum` or the `git ls-files` subset against `checksum`.

## How to verify
`npx vitest run test/unit/long-term-checksum.test.ts` (includes a `coldMatches` case on a git repo). For the real thing, stage and promote a rotation with hewtd in a temp repo and check that `coldGenerations` reports `registered`.

## Consequences
Any value we compare against a manifest another tool writes needs one test that uses that tool's real output, not a fixture built with our own helper. Limit: when only the tracked files match, an edit to a gitignored file is not caught.
