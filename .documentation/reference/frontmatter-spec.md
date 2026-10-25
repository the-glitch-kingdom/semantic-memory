---
title: Frontmatter spec — every field, what it does, who reads it
tier: reference
domains: [reference]
audience: [developers, admin]
tags: [frontmatter, schema, yaml, fields, spec, provenance]
status: active
last_updated: '2026-10-24'
version: '1.6.1'
purpose: Authoritative field-by-field spec for note frontmatter. Covers every field the indexer / lint / search tools read, what types they expect, what defaults apply, and which tools surface them. Includes the v1.4.0 symptoms field and alias note type, plus the v1.5.0 entity/aliases fields and the dossier + profile note types, how invalid YAML is handled (v1.5.2/v1.6.1), and the measured effect of symptoms on failure lookup (v1.6).
load_priority: 9
---

# Frontmatter spec

Every markdown note in the vault SHOULD have YAML frontmatter at the top. The frontmatter is parsed by [`gray-matter`](https://github.com/jonschlinkert/gray-matter) and stored on the `IndexedDocument` for that note. Many fields drive search ranking, filter behavior, lint findings, and graph edges — so getting them right matters more than they look.

This doc is the authoritative reference. The schema definition that the linter validates against lives in `<vault>/vault.schema.yml` (install via `install_schema`); fields below describe both the standard schema and how the indexer interprets each field.

## Frontmatter format

```markdown
---
title: My Note Title
type: decision
status: active
last_verified: 2026-05-09
sources:
  - https://example.com/source
related_docs:
  - other-note.md
tags:
  - architecture
  - auth
load_priority: 8
---

# My Note Title

Body text here. The `# Heading` line typically matches `title` but the frontmatter title is canonical.
```

Frontmatter sits between two `---` lines at the very top of the file. Anything after the closing `---` is body content.

### Invalid YAML (v1.5.2+, fixed for re-parses in v1.6.1)

A value with an unquoted `: ` is invalid YAML, for example `purpose: Use this: when it breaks`. A note whose frontmatter does not parse is still indexed: its frontmatter is treated as empty, its body is searchable, and the server logs `Invalid frontmatter in <path>, indexing body only: <reason>` to stderr. Before 1.6.1, only the first parse in a process dropped the YAML block. Later parses (the startup rebuild, the watcher, `reindex`) indexed it as a heading. Write tools refuse to change such a note's frontmatter (`update_frontmatter` throws) instead of writing a second block. To fix the note, quote the value: `purpose: "Use this: when it breaks"`.

Write tools mask secrets in frontmatter values before writing (v1.5.3+). Since 1.6.1, a value under a secret-named key (`api_key`, `client_secret`, `password`, ...) is masked even when the value alone doesn't look like a known key format. See [secret-redaction.md](../security/secret-redaction.md).

## Field reference (alphabetical)

### `audience`
- **Type:** `string[]`
- **Required:** No
- **Used by:** Documentation organization (HEWTD-flavored docs use this); not currently used by search filters
- **Schema rule:** None
- **Example:** `audience: [developers, admin]`

### `aliases` (v1.5+, `type: dossier` only)
- **Type:** `string[]`
- **Required:** No (recommended — this is how a dossier gets found by two-hop retrieval)
- **Used by:** `resolveDossierForPrompt`/`resolveDossierForQuery` (longest normalized match against the dossier cache) and the lexicon compiler — a dossier's aliases fold into `.claude/.semantic-memory/lexicon-cache.json` as authored entries pointing at the dossier's path, so Tier-1 query expansion (v1.4) also routes through them.
- **Note:** Distinct from the `alias` note *type* (v1.4) and its `phrases` field. `aliases` is a field on `type: dossier` notes; `phrases` is a field on `type: alias` notes. Both feed query expansion, but from different note shapes.
- **Example:**
  ```yaml
  aliases:
    - "the gateway"
    - "stripe proxy"
  ```

### `canonical` (v1.4+, `type: alias` only)
- **Type:** `string`
- **Required:** Yes, for `type: alias` — the path or symbol that the note's alias phrases resolve to.
- **Used by:** `manage_lexicon({action: "add"|"remove"|"lookup"})` and the `semantic-memory lexicon compile` CLI command key `.claude/.semantic-memory/lexicon-cache.json` on this field. See [mcp-tools-reference.md](./mcp-tools-reference.md), [cli-reference.md](./cli-reference.md).
- **Example:** `canonical: src/core/schema-default.ts`

### `confidence`
- **Type:** `string` — typically one of `low`, `medium`, `high`
- **Required:** No (defaults to `medium` when set by `synthesize_note`)
- **Used by:** No search re-ranking. (v1.3 confidence-decay ranks by `last_verified`, not by this field — a `confidence`-multiplier was scoped but deferred.) Lint surfaces it as informational. Set by `synthesize_note` automatically.
- **Schema rule:** None by default; you can constrain to enum in your `vault.schema.yml`
- **Example:** `confidence: high`

### `decided_on`
- **Type:** `string` — ISO date `YYYY-MM-DD`
- **Required:** Recommended for `type: decision`
- **Used by:** Surfaced in `list_notes` output; used by some lint configurations
- **Example:** `decided_on: '2026-04-22'`

### `decision_maker`
- **Type:** `string`
- **Required:** Recommended for `type: decision`
- **Used by:** Set by `synthesize_note` if provided; informational
- **Example:** `decision_maker: tom`

### `derived_from`
- **Type:** `string[]` — paths/names of other vault notes
- **Required:** Required for `type: note`/`decision`/`gotcha` (alongside or instead of `sources`) — see `missing_provenance` lint rule
- **Used by:**
  - Graph: each entry creates a `derived_from` edge in the knowledge graph
  - Lint: `missing_provenance` rule fires if both this and `sources` are absent
  - `synthesize_note({from_session: true})` (planned v1.3) defaults this to `session.notes_touched`
- **Schema rule:** Listed in `provenance` config in vault.schema.yml
- **Example:**
  ```yaml
  derived_from:
    - decisions/auth-migration.md
    - gotchas/keycloak-token-refresh.md
  ```

### `domains`
- **Type:** `string[]` — content domains (free-form tags, but conventional)
- **Required:** No
- **Used by:**
  - `list_notes({domain: "X"})` filter
  - `search_*({domain: "X"})` filter (across all search modes)
  - HEWTD doc organization
- **Convention:** Use lowercase, dash-separated. Examples: `architecture`, `api`, `security`, `frontend`.
- **Example:** `domains: [architecture, api]`

### `entity` (v1.5+, `type: dossier` only)
- **Type:** `string`
- **Required:** Yes, for `type: dossier` — the canonical entity/component name the dossier tracks.
- **Used by:** `manage_dossier` (all actions resolve by exact `entity` match or via `aliases`), the dossier cache (`dossier-cache.json`), two-hop retrieval in the hook, and the CLI `dossier init`/`dossier list`.
- **Example:** `entity: payment-gateway`

### `evergreen` (v1.3+)
- **Type:** `boolean`
- **Required:** No
- **Used by:** The v1.3 confidence-decay engine. When `true` AND `last_verified` is within 365 days, the decay multiplier is pinned at 1.0. When `last_verified` is > 365 days old, the evergreen claim is treated as expired and normal decay applies (so evergreen status must be re-affirmed via `verify_note`).
- **Status:** Shipped in v1.3.0. Ignored by v1.2 and earlier (forward-compatible). See [decay-guide](../operational/decay-guide.md).

### `evidence_count` (v1.4+, `type: alias` only)
- **Type:** `number`
- **Required:** No (auto-managed)
- **Used by:** `manage_lexicon({action: "add"})` — bumped each time an existing canonical/phrase pair is re-added instead of being duplicated. Informational signal for how often a phrase mapping has been reinforced.
- **Example:** `evidence_count: 3`

### `extra_frontmatter`
- **Type:** `Record<string, unknown>` — passed through `synthesize_note` calls into the resulting note's frontmatter
- **Required:** No
- **Used by:** This is a `synthesize_note` INPUT field, not a frontmatter FIELD. Lets callers attach arbitrary frontmatter to the synthesized note.

### `is_proposal` / `proposed_target` (v1.1+)
- **Type:** automatically set by `synthesize_note({proposal: true})`
- **Used by:**
  - Notes with `status: proposal` are written under `proposals/<date>-<slug>.md`
  - `proposed_target` records the canonical destination path
  - `synthesize_promote` reads `proposed_target` to know where to move the proposal
- **Direct manual editing not recommended.**

### `last_modified` (planned — not shipped)
- **Type:** ISO date `YYYY-MM-DD` or full ISO timestamp
- **Required:** No
- **Status:** **Not implemented as of v1.3.** The original plan added `last_modified` as an auto-stamped edit timestamp to formally separate "file edited" from "knowledge re-verified." A v1.3 audit found the separation was already effectively true — `last_verified` is stamped only at creation and by `verify_note`, and **no edit path bumps it** — so `last_modified` was unnecessary for correct decay and was deferred. It may return later for edit-recency use cases. Do not rely on it yet.

### `last_verified`
- **Type:** ISO date `YYYY-MM-DD` (quoted or unquoted — v1.3 normalizes YAML `Date` values)
- **Required:** Recommended for `type: note`/`decision`/`gotcha`
- **Used by:**
  - `find_stale` / `lint_vault({checks: ["stale"]})` rule (default threshold: 180 days)
  - **v1.3 confidence-decay** — the primary decay signal. `multiplier = 0.5^(age_days / half_life)` where `age_days` is measured from this date. See [decay-guide](../operational/decay-guide.md).
  - Set by `synthesize_note` / `ingest_source` at note creation
  - **Only updated by:** the `verify_note` tool (shipped v1.3) OR initial creation. **Never bumped by edits** — this is what makes decay track verification, not editing.
- **Schema rule:** `stale.max_age_days` controls when staleness is flagged
- **Example:** `last_verified: '2026-04-15'`

### `load_priority`
- **Type:** `number` — integer 1–10
- **Required:** No
- **Used by:**
  - `search_semantic` and `search_hybrid` apply a score boost: `score × (1 + (load_priority - 5) × 0.04)`
  - load_priority 10 → +20% boost
  - load_priority 5 → no change (default)
  - load_priority 1 → -16% reduction
  - HEWTD docs use this for "load order" preference when domain docs are loaded together
- **Convention:** Reserve 9-10 for top-tier reference docs (compat matrix, root indices). Reserve 1-3 for verbose tutorials / examples that shouldn't dominate search.
- **Example:** `load_priority: 8`

### `phrases` (v1.4+, `type: alias` only)
- **Type:** `string[]`
- **Required:** No (recommended for `type: alias` — the whole point of the note)
- **Used by:** `manage_lexicon({action: "lookup"})` matches a query against these phrases to expand it to the note's `canonical` target.
- **Example:**
  ```yaml
  phrases:
    - "the vault"
    - "the notes folder"
  ```

### `purpose`
- **Type:** `string` — one-paragraph "why this exists / what it covers"
- **Required:** No (recommended for HEWTD-flavored docs)
- **Used by:** Surfaced in `list_notes` output, HEWTD `list` / `search` results
- **Convention:** 1-3 sentences. The "if I only read this, what do I know?" summary.
- **Example:**
  ```yaml
  purpose: Defines the schema fields and lint rules for vault notes.
    Read this when authoring or reviewing notes.
  ```

### `related_docs`
- **Type:** `string[]` — paths/names of related vault notes
- **Required:** No
- **Used by:**
  - Graph: each entry creates a `related_doc` edge
  - Surfaced in `forwardlinks` and similar graph queries
  - HEWTD navigation
- **Difference from `derived_from`:** `derived_from` implies "this note builds on those." `related_docs` implies "consider reading these together." Both create graph edges; lint treats them differently (`missing_provenance` only counts `derived_from` and `sources`).
- **Example:**
  ```yaml
  related_docs:
    - architecture/auth-flow.md
    - operational/auth-troubleshooting.md
  ```

### `severity`
- **Type:** `string` — typically one of `low`, `medium`, `high`, `critical`
- **Required:** Recommended for `type: gotcha`
- **Used by:** Set by `synthesize_note` when provided; surfaced in `list_notes` output; can be schema-constrained
- **Example:** `severity: high`

### `source` (v1.4+, `type: alias` only — not the `source_*` family below)
- **Type:** `string` — `learned` or `authored`
- **Required:** No (defaults to `learned` unless set explicitly, or `--authored` is passed to `lexicon add`)
- **Used by:** `manage_lexicon` / `semantic-memory lexicon add --authored`. Distinguishes lexicon entries the system inferred (`learned`) from ones a human explicitly authored (`authored`).
- **Note:** Distinct from `source_uri`, `source_summary`, `source_tags`, `source_title`, `source_type` below, which apply to `type: source` notes, not `type: alias` notes.
- **Example:** `source: authored`

### `source_summary` (only inside `sources/<slug>.md` notes)
- **Type:** `string`
- **Used by:** Set by `ingest_source`. One-line summary of the external source.

### `source_tags` (only inside `sources/<slug>.md` notes)
- **Type:** `string[]`
- **Used by:** Set by `ingest_source`. Tags applied to the source note.

### `source_title` (only inside `sources/<slug>.md` notes)
- **Type:** `string`
- **Used by:** Set by `ingest_source`. Human-readable source title.

### `source_type`
- **Type:** `string` — typically `article`, `paper`, `documentation`, `video`, `code`, `personal-communication`
- **Used by:** Set by `ingest_source`. Helps categorize the type of external source.

### `source_uri`
- **Type:** `string` — URL
- **Used by:** Set by `ingest_source`. Canonical address of the external source.

### `sources`
- **Type:** `string[]` — URLs or external paths
- **Required:** Required for `type: note`/`decision`/`gotcha` (alongside or instead of `derived_from`) — see `missing_provenance` lint rule
- **Used by:** Lint `missing_provenance`. Surfaced in `list_notes` output.
- **Schema rule:** Listed in `provenance` config in vault.schema.yml
- **Example:**
  ```yaml
  sources:
    - https://example.com/rfc-1
    - "Conversation with Alice 2026-04-15"
  ```

### `status`
- **Type:** `string` — typically `active`, `draft`, `deprecated`, `archived`, `proposal`
- **Required:** Yes (default in schema)
- **Used by:**
  - `list_notes({status: "X"})` filter
  - `search_*({status: "X"})` filter
  - `proposal` is the v1.1+ marker for review-pending notes (auto-set by `synthesize_note({proposal: true})`)
- **Schema rule:** Schema can constrain to an enum
- **Example:** `status: active`

### `symptoms` (v1.4+)
- **Type:** `string[]`
- **Required:** No
- **Used by:** Verbatim symptom phrases, settable on any note type but especially useful for `gotcha`. Each phrase is symptom-keyed at index time — indexed as its own chunk — so a terse symptom-shaped query (e.g. "connection refused on port 5432") matches the note even when its prose never uses those exact words.
- **Set by:** `synthesize_note({ symptoms: [...] })` — see [mcp-tools-reference.md](./mcp-tools-reference.md).
- **Example:**
  ```yaml
  symptoms:
    - "connection refused on port 5432"
    - "ECONNREFUSED during migration"
  ```
- **Measured effect (v1.6):** with the literal error text in `symptoms:`, the failure-lookup query for a real failure scored the right fact 0.75 instead of 0.44, above the 0.50 injection threshold of the opt-in `PostToolUseFailure` hook. Write symptoms as the exact strings a tool prints (`Exit code 144`, `ERR_MODULE_NOT_FOUND`, `Watcher timeout`), not paraphrases. See [failure-lookup-guide.md](../operational/failure-lookup-guide.md).
- **Clash with hit-em-with-the-docs:** in a hewtd-managed `.documentation/`, `symptoms:` is hewtd's playbook schema (objects with `error_pattern`, `target`, `cites`), and a string list fails `hewtd audit`. semantic-memory ignores non-string entries. In a hewtd tree, put the error strings in `tags:` and the title instead (see the failure-lookup guide).

### `tags`
- **Type:** `string[]`
- **Required:** No
- **Used by:**
  - Graph: each tag becomes a tag node; notes get edges to their tags
  - `manage_tags({action: "list"})` returns these (combined with inline `#tag` markers)
  - `search_text({tagFilter: ["X"]})` filters
- **Convention:** Lowercase, no leading `#`. The leading `#` is for inline body text only.
- **Example:**
  ```yaml
  tags:
    - architecture
    - decision-record
  ```

### `tier`
- **Type:** `string` — one of `guide`, `standard`, `example`, `reference`, `admin` (HEWTD convention)
- **Required:** No (HEWTD docs use it; vault notes typically don't)
- **Used by:** HEWTD doc organization; not currently used by search ranking.
- **Convention:** Vault notes typically don't carry `tier`. Use it in `.documentation/` if your project uses HEWTD-style frontmatter.

### `title`
- **Type:** `string`
- **Required:** Yes (effectively — many tools fall back to filename if missing)
- **Used by:**
  - `list_notes` output
  - Search snippet rendering
  - Graph node label
- **Convention:** Match the body's `# H1` line.

### `type`
- **Type:** `string` — typically `note`, `decision`, `gotcha`, `source`, `alias` (v1.4+), `dossier` (v1.5+), `profile` (v1.5+) (default schema)
- **Required:** Yes (in default schema)
- **Used by:**
  - Schema: each type can have type-specific required fields and rules
  - Lint: `missing_provenance` only fires for `note`/`decision`/`gotcha`, NOT `source`/`alias`/`dossier`/`profile`
  - **v1.3 confidence-decay** uses type to look up per-type half-life (decision: 365d, gotcha: 180d, etc.)
  - `synthesize_note` accepts this as input
  - `type: alias` notes are managed by `manage_lexicon` rather than `synthesize_note` — see [The `alias` note type](#the-alias-note-type-v14) below
  - `type: dossier` notes are managed by `manage_dossier` — see [The `dossier` note type](#the-dossier-note-type-v15) below
  - `type: profile` notes are managed by `manage_profile` — see [The `profile` note type](#the-profile-note-type-v15) below
- **Schema rule:** `types` map in `vault.schema.yml` declares valid types and their per-type rules
- **Example:** `type: decision`

### `version`
- **Type:** `string`
- **Required:** No
- **Used by:** HEWTD docs use this; informational

## The `alias` note type (v1.4+)

`alias` notes back the learned human→artifact lexicon — the mapping from human phrases to canonical vault/code targets used by `manage_lexicon` and the `semantic-memory lexicon` CLI subcommands. They live under `<vault>/lexicon/`.

- **`type`:** `alias`
- **Required field:** `canonical` — the path/symbol the note's phrases resolve to.
- **Optional fields:** `phrases` (string[]), `confidence`, `evidence_count`, `source` (`learned` | `authored`).
- **Written by:** `manage_lexicon({action: "add"})` (see [mcp-tools-reference.md](./mcp-tools-reference.md)) and `semantic-memory lexicon add` (see [cli-reference.md](./cli-reference.md)).
- **Compiled to:** `.claude/.semantic-memory/lexicon-cache.json` via `manage_lexicon({action: "compile"})` / `semantic-memory lexicon compile` (see [configuration-reference.md](./configuration-reference.md) for the state-file entry).
- **Lint:** the opt-in `alias_conflicts` check on `lint_vault` flags a phrase that maps to more than one `canonical` target across `alias` notes.

Example:

```yaml
---
title: "alias: the vault"
type: alias
canonical: src/core/schema-default.ts
phrases:
  - "the vault"
  - "the notes folder"
confidence: high
evidence_count: 3
source: learned
---
```

## The `dossier` note type (v1.5+)

`dossier` notes are entity-centric living notes — one per critical component — that back `manage_dossier` and the `semantic-memory dossier` CLI subcommands. They live under `<vault>/dossiers/`.

- **`type`:** `dossier`
- **Required field:** `entity` — the canonical component name.
- **Optional fields:** `aliases` (string[]).
- **Fixed body sections (in order):** Purpose / Failure modes / Knobs & commands / Incident log / Current state. `dossier init` scaffolds all five as placeholders; content accretes in place (`manage_dossier` actions `append_incident`/`set_state`) rather than spawning new notes per event.
- **Written by:** `manage_dossier({action: "init"|"append_incident"|"set_state"})` (see [mcp-tools-reference.md](./mcp-tools-reference.md)) and `semantic-memory dossier init` (see [cli-reference.md](./cli-reference.md)).
- **Compiled to:** `.claude/.semantic-memory/dossier-cache.json` on every write — read by the `UserPromptSubmit` hook for two-hop retrieval (an utterance naming the entity or an alias gets the dossier's Purpose + Current state injected ahead of semantic search hits).
- **Feeds:** the lexicon compiler — a dossier's `aliases` fold in as authored lexicon entries pointing at the dossier path, so Tier-1 query expansion (v1.4) also routes through dossier aliases.

Example:

```yaml
---
title: payment-gateway
type: dossier
entity: payment-gateway
aliases:
  - "the gateway"
  - "stripe proxy"
status: active
last_verified: 2026-07-11
confidence: medium
---
```

## The `profile` note type (v1.5+)

`profile` notes model how THIS human communicates — severity calibration, chronic omissions, verbosity preference, non-entity shorthand. Unlike other types, this is a **singleton**: exactly one instance, always at `<vault>/profile/speaker.md`.

- **`type`:** `profile`
- **Required fields:** none beyond the standard `title`/`status` (default schema requires `title`, `status`).
- **Fixed body sections (in order):** Severity calibration / Chronic omissions / Verbosity preference / Shorthand & terms.
- **`evergreen: true`** by default at creation — the profile is meant to be a durable, continuously-corrected model, not something that decays like a point-in-time note.
- **Written by:** `manage_profile({action: "init"|"update_section"})` (see [mcp-tools-reference.md](./mcp-tools-reference.md)) and `semantic-memory profile init` (see [cli-reference.md](./cli-reference.md)). `update_section` is typically triggered by a speaker-correction capture cue ("when I say X I mean Y"), not called directly by the user.
- **Injected:** at `SessionStart`, a capped, placeholder-stripped head — silent (no injection) when every section is still an unfilled placeholder.

Example:

```yaml
---
title: Speaker profile
type: profile
status: active
last_verified: 2026-07-11
confidence: medium
evergreen: true
---
```

## Schema enforcement

The default schema (installed via `install_schema`) enforces:

- `type` must be one of: `note`, `decision`, `gotcha`, `source`, `alias`, `dossier`, `profile`
- `status` must be one of: `active`, `draft`, `deprecated`, `archived`, `proposal`
- `last_verified` must parse as ISO date when present
- For `type` ∈ `{note, decision, gotcha}`: at least one of `sources` or `derived_from` must be non-empty (warning, not error)
- For `type: decision`: `decision_maker` is recommended (warning if absent)
- For `type: alias`: `canonical` is required
- For `type: dossier`: `entity` is required
- `stale.max_age_days` defaults to 180 — `last_verified` older than this triggers `find_stale`

Customize `<vault>/vault.schema.yml` to add types, fields, or stricter rules. The lint suite re-runs against the live schema.

## Conflicts and disambiguation

A few fields look similar but mean different things:

| Pair | Meaning |
|---|---|
| `last_modified` vs `last_verified` | `last_verified` = "I confirmed this knowledge is still correct" — set at creation and by `verify_note` only, never bumped by edits; it drives confidence decay. `last_modified` (a separate auto-stamped edit timestamp) was planned but **not shipped** — the distinction it would formalize already holds because `last_verified` is edit-immune. |
| `derived_from` vs `related_docs` | `derived_from` = "this note builds on those" (provenance). `related_docs` = "consider these alongside" (cross-reference). Lint `missing_provenance` only counts `derived_from`. |
| `sources` vs `derived_from` | `sources` = external (URLs, papers, conversations). `derived_from` = internal (other vault notes). Both satisfy the provenance lint. |
| `tags` vs `domains` | `tags` are content-classification labels (often inline-friendly). `domains` are broader content areas (e.g. "architecture", "api"). Both are filterable; tags drive graph edges, domains don't. |
| `type` vs `tier` | `type` = vault-content classification (note / decision / gotcha / source). `tier` = HEWTD doc-tier classification (guide / reference / etc.). Vault notes use `type`; documentation uses `tier`. |

## Legacy / deprecated fields

| Field | Status | Replacement |
|---|---|---|
| `tags: "single-string"` | Was tolerated by some early callers | Use `string[]` always |
| `provenance:` (object form) | Was experimental | Use top-level `sources` and `derived_from` |
| `sidekick_*` prefixes | Never made it to v1.x | n/a |

## What you SHOULD always include

Minimum viable frontmatter for a vault note:

```yaml
---
title: "..."
type: note   # or decision, gotcha, source
status: active
last_verified: 2026-05-09  # today's date at creation
sources:
  - https://example.com/source
# OR (whichever is appropriate)
derived_from:
  - other-vault-note.md
---
```

For a `decision` add `decision_maker`, `decided_on`, `confidence`. For a `gotcha` add `severity`. For a `source` add `source_uri`, `source_title`, `source_type`.

## See also

- [schema-and-provenance.md](../architecture/schema-and-provenance.md) — substrate-level schema architecture
- [what-gets-indexed.md](../architecture/what-gets-indexed.md) — content perspective: where each frontmatter field ends up in the indices
- [mcp-tools-reference.md](./mcp-tools-reference.md) — every tool that reads or writes frontmatter
