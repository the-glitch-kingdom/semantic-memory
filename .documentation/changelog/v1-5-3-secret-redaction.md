---
title: v1.5.3 — secret redaction
tier: reference
domains: [changelog]
audience: [developers, admin]
tags: [v1.5.3, security, redaction, secrets, lint, secrets-check]
status: active
last_updated: '2026-10-24'
version: '1.5.3'
purpose: 'What v1.5.3 added: secrets masked at every write point (precise set for notes, broad set for logs and state), the opt-in lint_vault secrets check, and the NoteCrud return-shape change.'
load_priority: 6
---

# v1.5.3 — secret redaction

Before 1.5.3 nothing stopped an API key, token or password that passed through the plugin from being written to disk in the clear. Everything was local, but vault notes are usually committed to git — a token pasted during debugging could reach a session digest and then history.

## What changed

- **Every write masks secrets first.** One redactor, `src/core/redact.ts`, with two pattern sets: *precise* for notes (tuned so SHAs, UUIDs, paths and placeholders survive) and *broad* for logs and state. Full design, rule list and write-point table: [secret-redaction.md](../security/secret-redaction.md).
- **Write tools say so.** `Created: x.md (2 secrets redacted)`, or `redacted: N` in JSON results. Never the values.
- **`lint_vault({ checks: ["secrets"] })`** reports notes that already contain a secret (path, line, kind) and rewrites nothing. Rotate first.
- **The hook** redacts capture-pending excerpts using `dist/core/redact.js`, and withholds the excerpt if that module can't load.

## Decisions

| Question | Decision | Why |
|---|---|---|
| Mask secrets in search results at read time? | No — lint reports them | Read-time masking hides the problem instead of fixing it |
| Placeholders in how-to notes (`api_key: <your-key>`)? | Left alone | Masking them destroys useful docs for no security gain |
| Rewrite existing secrets automatically? | No — report only | A silent rewrite surprises, and can't remove the secret from git history |
| Depend on jev-loop's `redact.py`? | Port it | semantic-memory ships to machines without jev-loop |
| One pattern set everywhere? | Two | jev-loop's broad rules (long tokens, base64) would delete SHAs and hashes from notes |

## Compatibility

`NoteCrud.create()` returns `{ path, redacted }` (was the path string); `NoteCrud.update()` returns the same (was `void`). Only matters when using the package as a library. The default `lint_vault` report is byte-identical to 1.5.2.

## Tests

516 green (440 in 1.5.2). One integration test per write point through the real MCP tools — all 13 fail without the change — plus a sweep of the whole vault for the fake values; false-positive cases for ordinary note content; linear-time checks on 1 MB pathological inputs (a quadratic rule took 107 s before it was anchored — [regex-unanchored-prefix-is-quadratic](../knowledge-base/facts/regex-unanchored-prefix-is-quadratic.md)).
