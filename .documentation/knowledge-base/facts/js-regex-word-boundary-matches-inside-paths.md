---
title: JS regex \b treats - / and . as word boundaries, so a whole-word match fires inside paths
tier: fact
domains:
  - troubleshooting
audience:
  - developers
tags:
  - gotcha
  - regex
  - wikilink
status: active
last_updated: '2026-11-14'
version: 1.0.0
estimated_read_time: 1 minute
last_validated: '2026-11-14'
backlinks: []
id: js-regex-word-boundary-matches-inside-paths
confidence: high
last_verified: '2026-11-14'
verify_command: >
  cd "$(git rev-parse --show-toplevel)" && npx vitest run
  test/unit/synthesize-autolink.test.ts
provenance:
  - 'https://github.com/the-glitch-kingdom/semantic-memory/issues/36'
sources:
  - src/core/synthesize.ts
invalidated_by:
  - autoWikilink stops matching names by regex
---

# JS regex \b treats - / and . as word boundaries, so a whole-word match fires inside paths

## Claim
`\b` sits between a word character (`[A-Za-z0-9_]`) and anything else, so `-`, `/` and `.` count as boundaries. `\bkeycloak-custom-image\b` matches inside `devops/keycloak-custom-image-workflow.md`. In semantic-memory 1.30.0 `synthesize_note` auto-linked such names and produced `.documentation/devops/[[keycloak-custom-image]]-workflow.md`.

## Instead
Use explicit lookarounds over the path characters: `(?<![\w./\\-])name(?![\w/\\-]|\.\w)`. Trailing sentence punctuation still matches; `.md` and `-suffix` do not. Escape regex characters in the name, and skip inline code spans separately.

## How to verify
The `verify_command` runs the autolink tests, which fail on the `\b` version.
