---
title: corpora.json schema (preview, ships in 2.0.0b)
tier: standard
domains:
  - architecture
  - configuration
status: draft
last_updated: 2026-05-07
version: 1.0.0
audience:
  - developers
purpose: Preview the multi-corpus configuration file that semantic-memory will read in v2.0.0b. Documents the schema, defaults, and smart-middle activation contract before the implementation lands.
---

# `corpora.json` schema (preview)

> **Superseded, never implemented.** Federation (`federation.sources`) replaced this design; see the [federation guide](../.documentation/operational/federation-guide.md) to search extra corpora. babel-fish writes `.claude/project-map/sections/`, not `.babel-fish/`.

> **Original status (never shipped): planned for 2.0.0b.** This file documents the design of `corpora.json` so consumers and downstream plugins (persistent-planning, babel-fish) can plan against it. The implementation lands in the next release. v1.0.0 (this release) preserves the legacy single-vault behavior unchanged.

`corpora.json` is the configuration file that tells semantic-memory which corpora to index and how. It lives at `<project-root>/.semantic/corpora.json` and is auto-bootstrapped on first run by the **smart-middle activation** heuristic.

## Schema

```json
{
  "schema_version": "1.0",
  "corpora": [
    {
      "name": "vault",
      "root": "./.claude/.vault",
      "glob": "**/*.md",
      "chunker": "markdown",
      "enabled": true
    },
    {
      "name": "code",
      "root": "./src",
      "glob": "**/*.{ts,tsx,js,jsx}",
      "chunker": "tree-sitter-ts",
      "enabled": true
    },
    {
      "name": "plans",
      "root": "./.planning",
      "glob": "**/*.md",
      "chunker": "markdown",
      "enabled": true
    },
    {
      "name": "docs",
      "root": "./.documentation",
      "glob": "**/*.md",
      "chunker": "markdown",
      "enabled": true
    },
    {
      "name": "research",
      "root": "./.research",
      "glob": "**/*.md",
      "chunker": "markdown",
      "enabled": true
    },
    {
      "name": "project-map",
      "root": "./.babel-fish",
      "glob": "**/*.md",
      "chunker": "markdown",
      "enabled": true,
      "extras": {
        "glossary_extractor": "babel-fish-vocabulary"
      }
    }
  ]
}
```

## Field reference

### Top level

| Field | Type | Required | Description |
|---|---|---|---|
| `schema_version` | string | yes | Schema version of this file. Currently `"1.0"`. |
| `corpora` | array of corpus objects | yes | One entry per corpus to register. |

### Per corpus

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | yes | Corpus identifier. Used as the suffix for per-corpus search verbs (`search_<name>`). Reserved names: `vault`, `code`, `plans`, `docs`, `research`, `project-map`. Custom names allowed. |
| `root` | string | yes | Directory to scan for content. Relative to project root. |
| `glob` | string | yes | File pattern (glob syntax) for files to index within `root`. |
| `chunker` | string | yes | Chunker to use. Built-in: `markdown`, `tree-sitter-ts`, `fixed-window`. |
| `enabled` | boolean | no (default `true`) | If `false`, the corpus is registered but not indexed; search verbs return `{status: "no_index", results: []}`. |
| `extras` | object | no | Chunker-specific or corpus-specific configuration. E.g. `glossary_extractor: "babel-fish-vocabulary"` activates the babel-fish glossary side-channel for the project-map corpus. |

## Smart-middle activation

On first run (when `<project-root>/.semantic/` doesn't exist), semantic-memory scans the project root for known markers:

| Marker | Activates corpus |
|---|---|
| `.claude/.vault/` | `vault` |
| `src/` (or detected source dir) with TS/JS files | `code` |
| `.planning/` with `.meta/workspace.json` (lg mode) | `plans` |
| `.documentation/` | `docs` |
| `.research/` | `research` |
| `.babel-fish/` with `01-vocabulary.md` | `project-map` |

For each marker found, the corresponding corpus is added to `corpora.json` with `enabled: true`. Markers not found result in the corpus being omitted (or added with `enabled: false` for visibility — TBD).

A decision banner is printed on first activation listing what got enabled and why.

## Backwards compatibility

For projects that have an existing `.claude/.vault/` and never ran v1.0.0+ before, the smart-middle activation creates a `corpora.json` with just `vault` enabled, pointing at the existing `.claude/.vault/` directory. **The existing `.semantic-sidekick-index/` directory continues to be the index location** (preserved for backwards compatibility).

For projects that ARE v1.0.0a-only (no `corpora.json`), the legacy single-vault flow continues to work without any `corpora.json`. The auto-default reads `notes_path` from CLI args or environment, exactly as v0.x did.

## Per-corpus search verbs (planned for 2.0.0b)

Each registered corpus produces a corresponding `search_<name>` MCP verb:

- `search_vault(query, limit?, ...filters)` — equivalent to today's `search_semantic` for the vault corpus
- `search_code(query, language?, symbol_kind?, pathGlob?)` — when code corpus is active
- `search_plans(query, ...filters)` — when plans corpus is active
- `search_docs(query, ...filters)` — when docs corpus is active
- `search_research(query, ...filters)` — when research corpus is active
- `search_project_map(query, ...filters)` — when project-map corpus is active

Plus a cross-corpus verb:

- `search_all(query, corpus_filter?, limit?)` — searches across all enabled corpora and merges results

Empty / missing corpora always return `{status: "no_index", results: []}` rather than erroring (the `no_index` contract). This means the agent can always attempt a search and learn from the empty result.

## Conditional tool registration

Workflow tools register only when their target corpus has data:

- Plan workflow tools (`next_atom`, `update_atom_status`, ...) register iff `plans` corpus is active AND has data
- Drift detection tools (`detect_drift`) register iff `code` corpus + at least one doc-bearing corpus are both active
- Translation tools (`translate`, `reverse_translate`, `list_vocabulary`) register iff `project-map` corpus is active AND `glossary.json` is present

Search tools always register and use the `no_index` contract for empty corpora.

## See also

- `docs/smart-middle-activation.md` — full smart-middle resolution rules
- `docs/regression-snapshot.md` — the gate that protects existing tool surface during the multi-corpus refactor
- `~/workspace/the-glitch-kingdom/persistent-planning/.planning/layered-planning-with-mcp-and-hewtd-frontmatter/task_plan.md` — the meta-plan
