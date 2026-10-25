---
title: >-
  chokidar 4+ treats a glob as a literal path, so a "**/*.md" watcher never
  fires
tier: fact
domains:
  - troubleshooting
status: active
last_updated: 2026-10-24T00:00:00.000Z
id: chokidar-4-glob-is-a-literal-path
confidence: high
last_verified: '2026-10-25'
verify_command: >
  cd "$(git rev-parse --show-toplevel)" && npx vitest run
  test/integration/watcher.test.ts
provenance:
  - 'https://github.com/the-glitch-kingdom/semantic-memory/issues/29'
sources:
  - src/core/watcher.ts
  - test/integration/watcher.test.ts
tags:
  - gotcha
  - chokidar
  - watcher
  - Watcher timeout
  - watcher reports ready but never emits add/change/unlink
invalidated_by:
  - chokidar restores glob support in a future major
---

# chokidar 4+ treats a glob as a literal path, so a "**/*.md" watcher never fires

## Claim
chokidar removed glob support in v4. `watch("**/*.md", { cwd })` under chokidar 4 or 5 watches a path literally named `**/*.md`, which never exists, so the watcher reports `ready` and then emits no events at all. There is no error or warning.

## Instead
Watch the folder and filter with an `ignored` function, and also filter in the event handler, because chokidar calls `ignored` without stats for some events (e.g. `unlink`):

```ts
watch(".", {
  cwd: notesPath,
  ignored: (path, stats) => IGNORED_DIRS.test(path) || (stats?.isFile() === true && !path.endsWith(".md")),
});
// in the add/change/unlink handler: if (!path.endsWith(".md")) return;
```

## How to verify
The watcher integration test writes, edits and deletes files (including in a subfolder) with polling and native events, and fails on a 5 s timeout. It fails against a `watch("**/*.md")` watcher and passes against the folder form.

## Consequences
semantic-memory 1.5.1 and earlier (chokidar `^5.0.0`) never reindexed edits made during a session. Any other code that upgraded chokidar past 3 with glob targets is silently dead the same way.

## See also
- [test-swallowing-its-timeout-hides-a-dead-feature](test-swallowing-its-timeout-hides-a-dead-feature.md) — why CI stayed green
