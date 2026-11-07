---
title: chokidar holds one inotify watch per file plus one per directory, and
  counts differ between processes
tier: fact
domains:
  - troubleshooting
audience:
  - all
tags:
  - gotcha
  - chokidar
  - inotify
  - watcher
  - too many open files
  - ENOSPC inotify watch limit
status: active
last_updated: '2026-11-06'
version: 1.0.0
estimated_read_time: 1 minute
word_count: 187
last_validated: '2026-11-07'
backlinks: []
---

# chokidar holds one inotify watch per file plus one per directory, and counts differ between processes

## Claim
On Linux chokidar adds an inotify watch for every file and every directory it watches. A live server on a 537-file tree held 629 watches (537 files + 92 directories). Two servers on the same `.documentation` tree held 662 and 1,185, and two on one vault held 2 and 77, so the count also depends on timing. `fs.inotify.max_user_watches` is shared by every process of the user, so a few servers on large trees can exhaust it and break unrelated tools (`ENOSPC: System limit for number of file watchers reached`).

## Instead
Do not keep a resident watcher. semantic-memory 1.9.0 reconciles on demand: before a search it stats the tree (throttled to once per 2 s), hashes only files whose stat changed, and re-indexes those. It holds zero inotify watches, and a stat pass over 1,000 files takes about 25 ms.

## How to verify
Count a process's inotify watches: `grep -c '^inotify' /proc/<pid>/fdinfo/*` (sum over fds). `freshness.test.ts` asserts `createServer` holds none.

## Consequences
The `Watcher` class and `--no-watch` flag remain as deprecated no-ops until v2.0.0. A server started on 1.8.0 or earlier still holds the watches until restarted.
