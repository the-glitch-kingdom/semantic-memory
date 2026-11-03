---
title: openSync(path, "wx") then write is not atomic — readers can see an empty lock file
tier: fact
domains:
  - troubleshooting
status: active
last_updated: 2026-11-03T00:00:00.000Z
id: exclusive-create-then-write-is-not-atomic-for-readers
confidence: high
last_verified: '2026-11-03'
verify_command: >
  cd "$(git rev-parse --show-toplevel)" && npx vitest run test/unit/claude-run.test.ts -t "no pid yet"
provenance:
  - skill-eval concurrency test saw 7 of 5 claude runs at once under full-suite load (2026-11-03)
sources:
  - src/core/claude-run.ts
  - test/unit/claude-run.test.ts
tags:
  - gotcha
  - locking
  - node-fs
  - skill-loop
invalidated_by:
  - acquireSlot goes back to openSync "wx" + writeSync
---

# openSync(path, "wx") then write is not atomic — readers can see an empty lock file

## Claim
Creating a lock file with `openSync(path, "wx")` and then writing the owner's pid takes two steps. A
concurrent reader can open the file between them and read nothing. Lock code that treats "no pid" as "holder is
dead" then deletes a live lock. In `acquireSlot` this let 7 `claude` runs through a cap of 5 under load. Run
alone, the test always passed.

## Instead
Write the pid to a unique temp file, then `linkSync(tmp, path)`: the link fails with `EEXIST` if the lock
exists, and when it succeeds the file already holds the pid. Unlink the temp file either way. Treat an empty
lock file left by older code as live until its mtime is clearly stale (60 s in `acquireSlot`).
