---
title: openSync(path, "wx") then write is not atomic — readers can see an empty
  lock file
tier: fact
domains:
  - troubleshooting
audience:
  - all
tags:
  - gotcha
  - locking
  - node-fs
  - skill-loop
status: archived
last_updated: '2026-11-03T00:00:00.000Z'
version: 1.0.0
estimated_read_time: 1 minute
word_count: 132
last_validated: '2026-11-03'
backlinks: []
archived_on: '2026-11-03'
archived_from: troubleshooting/exclusive-create-then-write-is-not-atomic-for-readers.md
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
