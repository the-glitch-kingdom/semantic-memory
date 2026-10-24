---
title: Secret redaction — design, write points, and how to add a pattern
tier: reference
domains:
  - security
audience:
  - developers
tags:
  - security
  - redaction
  - secrets
  - lint
  - v1.5.3
status: active
last_updated: '2026-10-24'
version: 1.5.3
purpose: 'How semantic-memory keeps API keys, tokens and passwords off disk: the
  redactor (src/core/redact.ts), its precise and broad pattern sets, every write
  point it covers, the lint_vault secrets check, its limits, and how to add a
  pattern safely.'
load_priority: 7
estimated_read_time: 4 minutes
word_count: 767
last_validated: '2026-10-24'
backlinks: []
---

# Secret redaction

Since v1.5.3 every write semantic-memory makes masks secrets first. Everything was already local (local embedder, no network telemetry), but vault notes are usually committed to git, so a token pasted during debugging could end up in a session digest and then in history.

## The redactor (`src/core/redact.ts`)

`redact(text, mode)` returns `{ text, count }`; `redactDeep(value, mode)` does the same for every string inside an object; `findSecrets(text)` returns `{ line, kind }[]` for lint. Values are never returned or logged.

Two layers, in order:

1. **Known values** — the exact values of env vars whose name contains `key`, `token`, `secret`, `passw`, `pwd` or `credential`, from the process env and `~/.claude/settings.json` `env`. Only values ≥ 12 chars with no whitespace that are not a path or URL. Longest first. Cached; `resetRedactCache()` re-reads.
2. **Patterns**, each with a name used in lint findings:

| Name | Shape |
|---|---|
| private key | `-----BEGIN … PRIVATE KEY-----` block, even if the END line was cut off |
| URL credentials | `scheme://user:pass@` (skipped when the password is a placeholder) |
| authorization header | `Bearer` / `Basic` + a 16+ char token containing a digit |
| secret-named value | `name=value`, `name: value`, `"name": "value"` where the name's last segment is key / token / secret / password / passwd / pwd / credential(s), optionally `api`-prefixed |
| secret flag | `--token VALUE`, `--api-key=VALUE` |
| vendor API key | `sk-`/`pk-`/`rk-`, `whsec_`, `gh[pousr]_`, `github_pat_`, `glpat-`, `xox[abprs]-`, `re_`, `hf_`, `npm_`, `AKIA`/`ASIA`, `AIza` |
| JWT | `eyJ….….…` |
| base64 blob (broad only) | 40+ chars mixing upper, lower and digits |
| long token (broad only) | 32+ `[\w-]` chars mixing letters and digits |

### Precise vs broad

- **precise** — notes, frontmatter, dossiers, profile, lexicon, `log.md`. A false positive here is data loss, so the rules are tuned to leave ordinary content alone:
  - the secret word must *start* a name segment (`api_key`, `DB_PASSWORD`; not `monkey`, `max_tokens`, `tokenizer`);
  - vendor prefixes with word-shaped bodies need a digit in the body (`pk_customer_orders`, `npm_package_version` stay);
  - name=value needs an 8+ char value;
  - placeholders stay: `<your-key>`, `${API_TOKEN}`, `$VAR`, `process.env.X`, `os.environ…`, `changeme`, `example`, `xxxx…`, `****`, bare `password`/`secret`/`token`, and `[REDACTED]` (so redaction is idempotent).
- **broad** — search queries, session state, capture-pending. Adds the base64 and long-token rules; name=value needs only 4 chars. Over-redaction is fine in logs.

## Write points

| Where | Set | Notes |
|---|---|---|
| `NoteCrud.create` / `update` (`src/core/crud.ts`) | precise | The funnel for `create_note`, `update_note`, `apply_patch`, `synthesize_note`, `ingest_source`, `synthesize_promote`. `create` redacts body and frontmatter; `update` only the incoming text. |
| `FrontmatterManager.update` | precise | `update_frontmatter` field values |
| dossiers (`initDossier` purpose, `appendIncident`, `setCurrentState`) | precise | |
| speaker profile (`updateProfileSection`) | precise | |
| lexicon alias notes (`writeAliasNote`) | precise | phrases come from user utterances |
| `log.md` (`logEvent` summary + payload) | precise | a vault note; precise keeps paths and ids in payloads readable |
| `selection.jsonl` (`appendEvent`) | broad, `query` only | `note_path` / `results` feed usage-boost citation counts and must stay intact |
| `session.json` (task, `session_run` cmd and output tail) | broad | |
| hook capture-pending excerpt (`hooks/vault-context.js`) | broad | whole prompt redacted before the 200-char cut; imports `dist/core/redact.js` (a standalone tsup entry, fs/os/path only). If the import fails the excerpt is **withheld**, never stored raw. |

Not covered, by design: derived caches (docs cache, embeddings, graph, vector, `meta.json`, generated INDEX files) only re-store note text, and config writers (`.mcp.json`) only rewrite existing config.

Tool results report the count: `Created: x.md (2 secrets redacted)`, or `redacted: N` in JSON results (per op in `apply_patch`'s `applied`).

## Finding secrets already in notes

`lint_vault({ checks: ["secrets"] })` — opt-in, so the default report is unchanged. Each finding is an error: `line N: <kind> — rotate it if it is real, then remove it from the note`. Nothing is rewritten, deliberately: a silent rewrite would surprise, and it would not remove the secret from git history anyway. **Rotate first.**

## Limits

- A secret written as plain prose ("the password is hunter2") is not caught.
- A secret whose name doesn't start a segment (`secretKey: …` in camelCase) is caught only if its value has a vendor shape or matches a known env value.
- Search *results* are not masked at read time; a note that already holds a secret shows up in lint instead.

## Adding a pattern

1. Add a named rule to `rules()` in `src/core/redact.ts`: precise only if ordinary notes essentially never match it; otherwise broad.
2. Keep it linear: anchor the start (lookbehind or `\b`) and bound any optional prefix (`{0,64}`). An unanchored optional prefix with a greedy class took 107 s on a 1 MB hyphen run during v1.5.3 development (see [regex-unanchored-prefix-is-quadratic](../knowledge-base/facts/regex-unanchored-prefix-is-quadratic.md)).
3. Tests in `test/unit/redact.test.ts`: a fake sample built at runtime (split literals so scanners don't flag the file), a false-positive case, and the existing 1 MB linear-time cases must still pass.

## See also

- [SECURITY.md](../../SECURITY.md) — user-facing summary
- [v1-5-3-secret-redaction.md](../changelog/v1-5-3-secret-redaction.md)
- [mcp-tools-reference.md](../reference/mcp-tools-reference.md) — `lint_vault` checks
