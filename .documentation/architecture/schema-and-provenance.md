---
title: Schema and Provenance
tier: reference
domains: [architecture]
audience: [developers]
tags: [schema, provenance, frontmatter, lint, types]
status: active
last_updated: '2026-04-23'
version: '0.2.3'
purpose: vault.schema.yml, 4 types, lint rules, provenance frontmatter
load_priority: 7
---

# Schema and provenance

> The vault has a known shape. Every note declares its type; every claim carries provenance. Lint blocks violations at apply_patch time, warns on missing provenance, tells you when a note went stale.

## The default schema

Shipped in `src/core/schema-default.ts` as `DEFAULT_SCHEMA_YAML`. Install a per-vault copy with `semantic-sidekick install-schema --notes <path>` or the MCP `install_schema` tool.

```yaml
version: 1

provenance_fields:
  - sources
  - derived_from
  - last_verified
  - status
  - confidence

status_enum: [draft, active, stale, deprecated, archived]
confidence_enum: [high, medium, low]
severity_enum: [low, medium, high, critical]

types:
  note:
    description: Generic note — default type when `type` is absent
    required: [title, status]

  decision:
    description: Architectural or process decision with dated rationale
    required: [title, status, decided_on, decision_maker]

  gotcha:
    description: Compressed lesson from a past incident/bug/surprise
    required: [title, status, last_verified, severity]

  source:
    description: External reference (paper, blog, doc) used as provenance
    required: [title, status, source]

lint:
  missing_provenance:
    applies_to: [note, decision, gotcha]
    severity: warn
  stale:
    max_age_days: 180
    severity: warn
  schema_violations:
    severity: error
```

## The four types

### `note` (default)
Any factual/operational content that doesn't fit another type. Required: `title`, `status`. Provenance (one of `sources` / `derived_from`) expected but warns, not blocks.

### `decision`
Durable decisions with rationale. Required: `title`, `status`, `decided_on` (YYYY-MM-DD), `decision_maker`.
Use when: architectural choices, process changes, vendor selections. The decision note lives; future-you reads it to understand "why was it this way?"

### `gotcha`
Compressed lessons from incidents/bugs/surprises. Required: `title`, `status`, `last_verified`, `severity` ∈ `{low, medium, high, critical}`.
Use when: postmortems, "here's what bit us", "don't do X". Stale check auto-fires on `last_verified` → reread and re-verify.

### `source`
External references. Required: `title`, `status`, `source` (URI/identifier).
`ingest_source` auto-creates these. Manual creation also valid. Unit notes `derived_from` a source-note to preserve the provenance edge.

## Provenance fields

### `sources` — external URIs/paths
```yaml
sources:
  - https://example.com/rfc
  - /path/to/local/transcript.md
```
The answer to "where did this come from?" — external to the vault.

### `derived_from` — wikilinks to other vault notes
```yaml
derived_from:
  - sources/karpathy-llm-wiki.md
  - decisions/auth-migration.md
```
Creates a provenance edge in the graph. If you synthesized across multiple vault notes, list them.

**Either `sources` OR `derived_from` populated satisfies `missing_provenance`** — not both required.

### `last_verified` — ISO date
When the note was last confirmed true. Stale check fires if older than `lint.stale.max_age_days` (default 180). `synthesize_note` auto-sets this to today; update manually when you reread.

### `status` — lifecycle
One of `draft, active, stale, deprecated, archived`.
- `active` — in use, authoritative.
- `stale` — still correct but last-verified is old; verify before relying.
- `deprecated` — replaced but preserved for history; link to the replacement.
- `archived` — kept for archaeology; don't expect relevance.
- `draft` — WIP, not yet authoritative.

### `confidence` — how sure are we
One of `high, medium, low`.
- `high` — corroborated across multiple sources or directly tested.
- `medium` — single-source or partially verified.
- `low` — speculative, filed to preserve a hypothesis.

## Overriding the schema

Drop your own `vault.schema.yml` at the vault root. The schema loader prefers the file to the bundled default. Custom types, custom enums, custom lint thresholds all work — shape is identical.

Tips:
- Start with the default and add a type when a specific pattern repeats.
- Don't pre-emptively add types you don't yet need — grow from pain.
- `required` is load-bearing — adding fields retroactively means all existing notes of that type will fail `schema_violations` until updated.

## Lint rules

See also [mcp-tools-reference.md](../reference/mcp-tools-reference.md#lint-5) and [cli-reference.md](../reference/cli-reference.md#lint).

### `schema_violations` (error)
Missing required field, unknown type, value not in declared enum. Blocks apply_patch when `validate: true` (default).

### `missing_provenance` (warn)
Note of applicable type (`note`/`decision`/`gotcha`) with empty `sources` AND empty `derived_from`. Warns but doesn't block — some notes are genuinely self-contained.

### `stale` (warn)
`last_verified` older than `lint.stale.max_age_days` days. Disable by setting `max_age_days: 0`.

### `broken_links` (warn)
`[[wikilink]]` pointing to a note name that doesn't exist in the vault. Skips wikilinks inside fenced + inline code. New notes often reference planned-but-not-yet-filed targets — warns, doesn't block.

## apply_patch + lint interaction

Every apply_patch call runs lint on the *proposed* state (after the patch would have applied). Flow:

1. Build lint-input from creates + updates + current state.
2. Run `validateNote` on each.
3. Collect findings:
   - Any `schema_violations` at `severity: error` → block.
   - Warnings → carry in `result.lint`; block only if `allowLintWarnings: false`.
4. On block, `result.ok = false` + `result.errors[]` has human strings + `result.lint[]` has structured findings.

Bypass for exceptional cases (e.g., bulk migrations where you'll fix later): pass `validate: false`. Not recommended for normal writes.

## Pre-commit wiring

`scripts/pre-commit-lint.sh` is the drop-in template for vault repos:

```bash
cp /path/to/semantic-sidekick/scripts/pre-commit-lint.sh .git/hooks/pre-commit
chmod +x .git/hooks/pre-commit
```

Default: exits non-zero on errors (blocks commit), warns on provenance/stale. Pass `STRICT=1` to block on warnings too. `SKIP_VAULT_LINT=1` bypasses.

## Provenance as compounding error-correction

The deeper design intent: a gotcha note is *a compressed lesson with provenance*. When you can point at the source/derived_from that produced a claim, future-you can re-verify it when the ground truth changes. Lint catching stale last_verified is *error-correction that didn't happen*. The whole schema is an infrastructure for compounding updates across sessions.

Said differently: "my note says X" is weak. "my note says X, derived_from [sources/rfc-2.md, decisions/auth-migration.md], last_verified 2026-04-22, confidence high" is evidence. The second one compounds; the first erodes.
