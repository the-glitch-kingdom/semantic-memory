---
title: hewtd archive overwrites a file already at the archive path, e.g. archiving README.md replaces archive/README.md
tier: fact
domains:
  - troubleshooting
status: active
last_updated: 2026-10-24
id: hewtd-archive-overwrites-an-existing-archive-file
confidence: high
last_verified: 2026-10-24
provenance:
  - observed in the v1.6.1 release audit (hit-em-with-the-docs 2.10.0)
sources:
  - .documentation/archive/README.md
  - .documentation/archive/scaffold-readme.md
tags:
  - gotcha
  - hit-em-with-the-docs
  - archive
  - "Archived via fs"
  - "M .documentation/archive/README.md"
invalidated_by:
  - hewtd archive refuses or renames on a destination collision
---

# hewtd archive overwrites a file already at the archive path, e.g. archiving README.md replaces archive/README.md

## Claim
`hewtd archive <file>` moves the doc to `archive/<same path>` without checking whether a file is already there. In hit-em-with-the-docs 2.10.0, archiving `.documentation/README.md` replaced the tracked `.documentation/archive/README.md` (the archive folder's own guide). It printed `✓ Archived via fs` with no warning. The only sign was `git status` showing the existing archive file as modified.

## Instead
Before archiving, check the destination: `ls .documentation/archive/<same path>`. If a file is there, rename the doc first, then archive it:

```bash
git mv .documentation/README.md .documentation/scaffold-readme.md
npx hewtd archive .documentation/scaffold-readme.md -r "... (was README.md)"
```

If it already happened: `hewtd unarchive` the doc (it moves back to where it came from), restore the overwritten file with `git checkout HEAD -- .documentation/archive/<path>`, then rename the doc and archive it again.

## How to verify
After any `hewtd archive`, `git status --short .documentation/archive/` must show only `A` (added) or `R` (renamed) entries. An `M` on a file that existed before means it was overwritten.

## Consequences
Archived files are excluded from every hewtd scan, so nothing else notices the overwrite. Without git, the overwritten file is gone.
