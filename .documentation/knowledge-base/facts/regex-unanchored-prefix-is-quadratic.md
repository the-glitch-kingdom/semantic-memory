---
title: A regex with an unanchored start and a greedy class is quadratic on long runs
tier: fact
domains:
  - security
status: active
last_updated: 2026-10-24
id: regex-unanchored-prefix-is-quadratic
confidence: high
last_verified: 2026-10-24
verify_command: |
  cd "$(git rev-parse --show-toplevel)" && npx vitest run test/unit/redact.test.ts -t "stays linear"
provenance:
  - src/core/redact.ts (v1.5.3 development)
sources:
  - src/core/redact.ts
  - test/unit/redact.test.ts
tags:
  - gotcha
  - regex
  - performance
  - redos
---

# A regex with an unanchored start and a greedy class is quadratic on long runs

## Claim
A pattern like `/(--?[\w-]*token[ =])(\S{8,})/g` can start a match at every hyphen of a long `[\w-]` run, and from each start `[\w-]*` consumes to the end of the run and backtracks the whole way. On 1 MB of `a1-a1-…` the redactor's flag rule took **107 s**. Lookahead-heavy rules (`(?=[\w-]*\d)…[\w-]{32,}`) behave the same: each attempt re-scans the rest of the run.

## Instead
Make every attempt start only at the beginning of a run, and bound optional prefixes:

```ts
/((?<![\w-])--?[\w-]{0,64}?token[ =])(…)/gi              // lookbehind + bounded lazy prefix
/(?<![A-Za-z0-9+/])(?=[A-Za-z0-9+/]*\d)…[A-Za-z0-9+/]{40,}/g  // lookbehind before lookaheads
/\b(?:[\w.]{0,64}[_.-])?token/                            // bounded prefix (a.b.c… runs give a \b per letter)
```

Then test it: `test/unit/redact.test.ts` runs every rule over 1 MB hyphen, dash, underscore, dot and base64 runs in both modes with a 2 s ceiling.

## How to verify
`verify_command` runs the linear-time cases; each finishes in milliseconds. Reverting any of the three anchors makes the matching case time out.

## Consequences
The redactor runs on every note write and inside the prompt hook, so one quadratic rule turns a large pasted log or a markdown file full of `-----` rules into a hung tool call. Any new rule in `src/core/redact.ts` needs the same anchoring and a 1 MB test.
