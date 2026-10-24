---
title: What gets indexed where and why
tier: reference
domains: [architecture]
audience: [developers, admin]
tags: [indexing, content, vault, search, graph, glob, ignore]
status: active
last_updated: '2026-05-09'
version: '1.2.0'
purpose: Content-perspective view of the index pipeline. For each kind of content semantic-memory sees, what it does with it and which tools query the result. Read this if you wonder "is this file indexed?" or "why isn't my note showing up in search?"
load_priority: 8
---

# What gets indexed where and why

Companion to [indices-and-storage.md](./indices-and-storage.md). That doc is **storage-perspective** — for each file on disk, what's in it. This doc is **content-perspective** — for each kind of content, where it ends up and which tools surface it.

If you're asking "is X searchable?" or "why isn't this note showing up?", read this.

## Indexing scope: what lives inside the vault

The indexer walks **only** the directory passed via `--notes`. `src/core/indexer.ts:30`:

```ts
const files = await glob("**/*.md", { cwd: this.notesPath, follow: true });
```

That single line is the source of truth for "what gets indexed." Everything follows from it:

- ✅ **Files inside `<vault>` ending in `.md`** → indexed
- ✅ **Files in subdirectories of `<vault>`** → indexed (recursive glob)
- ✅ **Symlinked files** → indexed (`follow: true`)
- ❌ **Files outside `<vault>`** → not indexed (e.g. `.planning/`, `node_modules/`, source code, anything in your project root unless your project root IS the vault)
- ❌ **Files NOT ending in `.md`** → not indexed (no `.txt`, `.org`, `.rst`, `.pdf`, `.json`, `.yaml`, etc.)
- ❌ **Files inside `<vault>/.semantic-sidekick-index/`** → not indexed (excluded by lint glob; would create circular reference if included)
- ❌ **`<vault>/vault.schema.yml`** → not indexed by the search indexer (it's the schema definition, read separately by `lintVault`)

If your file isn't `*.md` inside `<vault>`, it does not exist as far as `search_*` tools are concerned.

### Files that fail to parse (v1.5.2+)

One bad file no longer takes the whole corpus down. Before 1.5.2, `indexAll()` ran every file through one `Promise.all`, so a single doc with invalid YAML frontmatter made the whole build fail and left the corpus unindexed.

- **Invalid frontmatter** (most often an unquoted colon in a value, e.g. `purpose: Substrate-level: …`) — the body is indexed with empty frontmatter, so the note is still searchable but its `status` / `tier` / `load_priority` etc. are ignored. stderr: `Invalid frontmatter in <file>, indexing body only: …`. Fix: quote the value.
- **Any other per-file error** (e.g. a dangling symlink) — the file is skipped. stderr: `Skipping <file>: …`.

### What the file watcher reacts to

The same scope: `.md` files anywhere under `<vault>`, except inside `node_modules/`, `.semantic-sidekick-index/` and `.git/`.

## What semantic-memory does with each `.md` file

For every markdown file the indexer finds, it extracts and indexes multiple distinct kinds of content:

| Content extracted | Where it goes | Which tools surface it |
|---|---|---|
| **Title** (from frontmatter `title` field, or first H1, or filename) | `docs.cache.json` (per-doc), `graph.json` (graph node label) | `list_notes` (returns title field), `search_*` (results are scored against full-text search-text only includes title in match scope) |
| **Body text — chunked** | Each chunk → vector via embedder → `embeddings.json` + `hnsw.bin` + `hnsw-meta.json` | `search_semantic`, `search_hybrid` |
| **Body text — raw** | `docs.cache.json` (per-chunk text array, kept verbatim for snippet rendering) | `search_text` (regex/keyword over chunks), `read_note`, `read_multiple_notes`, `list_notes` |
| **Frontmatter (YAML)** | Parsed into `IndexedDocument` fields (status, tier, domains, tags, last_verified, sources, derived_from, load_priority, purpose, etc.) | `list_notes` (filters by status/tier/domain), `search_*` (filters by status/tier/domain), `get_frontmatter`, `find_schema_violations`/`lint_vault({checks:["schema"]})`, `find_missing_provenance`/`lint_vault({checks:["provenance"]})` |
| **Wikilinks `[[target]]`** | Edges in `graph.json` (out-edges from this note → target notes) | `search_graph`, `search_hybrid` (rerank), `backlinks`, `forwardlinks`, `graph_path`, `graph_statistics`, `find_broken_links`/`lint_vault({checks:["broken_links"]})` |
| **Tags `#tag`** (frontmatter `tags` array AND inline `#tag` markers) | Tag nodes in `graph.json`, edges from notes to tags | `search_graph` (concept matching), `search_hybrid`, `manage_tags({action: "list"})`, `rename_tag` (deprecated), `manage_tags({action: "rename"})` |
| **`related_docs` frontmatter** | Edges in `graph.json` (explicit related-link edges) | `search_graph`, `search_hybrid`, `backlinks`, `forwardlinks` |
| **`load_priority` frontmatter (1-10)** | Stored on `IndexedDocument`; used as score multiplier | `search_semantic`, `search_hybrid` (boosts results +20% / -18% based on priority) |
| **`mtime`** (file modification time) | `docs.cache.json` per-doc; used for date filters | `search_*` (modifiedAfter / modifiedBefore filters), `list_notes` (modifiedAfter / modifiedBefore) |
| **Frontmatter `last_verified`** | Stored on `IndexedDocument` | `find_stale`/`lint_vault({checks:["stale"]})`. **In v1.3+, this drives confidence decay re-ranking in search.** |

## Chunking strategy

Body text is split into chunks before embedding. Each chunk becomes one vector in the index. Splits happen at:

1. **Section boundaries** — markdown `##` and `###` headings
2. **Token-count caps** — chunks too large for the embedding model's context window get split
3. **Code-block respect** — chunks try not to split fenced code blocks

Result: a typical 500-line note produces 3–8 chunks. Each chunk → 384-dim vector → indexed independently.

This is why `search_semantic` returns chunks, not whole notes — the chunk that matched, with its parent note path. Multiple chunks from the same note can appear in results.

## What the graph looks at

`src/core/graph.ts` builds a directed multi-graph:

| Node type | Source | Why |
|---|---|---|
| `note` nodes | One per indexed `.md` file | Vertex for every searchable note |
| `tag` nodes | Created lazily when first encountered | Lets `search_graph` traverse "all notes with tag X" |

| Edge type | Source | Why |
|---|---|---|
| `wikilink` | Each `[[target]]` in body text | Direct authored connection |
| `related_doc` | Each entry in frontmatter `related_docs` array | Explicit cross-reference |
| `tag` | Each tag mentioned (frontmatter or inline) | Concept clustering |
| `derived_from` | Each entry in frontmatter `derived_from` array | Provenance chain (note → source note) |

The graph is **derived** — rebuilt fresh from markdown via `graph.buildFromDocuments()` on every full reindex. The watcher rebuilds incrementally on file changes.

## What the lint pass looks at

`lintVault` (`src/core/lint.ts`) walks the same `**/*.md` glob (with one extra ignore for `vault.schema.yml`) and runs four checks per file:

| Check | What it inspects | Surfaces via |
|---|---|---|
| `schema_violations` | Frontmatter against `vault.schema.yml` rules (required fields, type unions, enum values) | `find_schema_violations` (deprecated) / `lint_vault({checks:["schema"]})` |
| `missing_provenance` | Notes of types `note`/`decision`/`gotcha` that lack BOTH `sources` and `derived_from` | `find_missing_provenance` (deprecated) / `lint_vault({checks:["provenance"]})` |
| `stale` | `last_verified` older than `schema.stale.max_age_days` (default 180) | `find_stale` (deprecated) / `lint_vault({checks:["stale"]})` |
| `broken_links` | `[[wikilinks]]` whose target name doesn't match any known note basename | `find_broken_links` (deprecated) / `lint_vault({checks:["broken_links"]})` |

Lint is read-only — it never modifies notes. Findings appear in:
- The full `lint_vault` report
- `apply_patch` validation (warnings allowed by default; errors block writes when `validate: true`)

## What's indexed but NOT searchable as a single unit

Some content is indexed but only retrievable via specific tools:

| Content | Indexed where | NOT searchable via | Searchable via |
|---|---|---|---|
| `log.md` events | Parsed by `logQuery` on demand; NOT in the vector index | `search_*` does not match log events as such | `log_query({kind, after, before, limit})` — direct structured access |
| `vault.schema.yml` | Read by `loadSchema` on lint runs; NOT in the vector index | `search_*` (excluded from glob) | Direct file read; no MCP tool returns it |
| Auto-generated `index.md` files | Indexed normally as regular markdown notes | Same as any note | `search_*`, `read_note`, `regenerate_index` |
| Frontmatter alone (without body) | Searchable structurally via filters; not embedded as a chunk by itself | Free-text frontmatter content (e.g. `purpose`) is not a separate vector | `list_notes` filter args, `search_*` filter args, `get_frontmatter`, `update_frontmatter` |

## Files explicitly NOT indexed

The lint pass uses this ignore list (`src/core/lint.ts:30`):

```ts
ignore: ["node_modules/**", ".semantic-sidekick-index/**", "vault.schema.yml"]
```

The indexer's glob is the same `**/*.md` but without explicit ignore — it relies on the convention that:

- `node_modules/` rarely contains markdown (and shouldn't be inside a vault)
- `.semantic-sidekick-index/` only contains JSON, no `.md` files
- `vault.schema.yml` doesn't end in `.md` so doesn't match the glob

In practice, the indexer never sees these files because the convention holds. If you put markdown inside `<vault>/.semantic-sidekick-index/` for some reason, it WOULD be indexed (and then the next reindex would re-include the indexed-then-deleted markdown — so don't do that).

## Special files inside the vault

These are vault-managed and behave specially:

| Path pattern | Behavior |
|---|---|
| `<vault>/log.md` | Indexed as a regular markdown note BUT the structured machine-readable YAML blocks inside are also parseable via `log_query` separately. Don't manually edit log.md — use `log_event`. |
| `<vault>/index.md` and `<vault>/<dir>/index.md` | Indexed as regular notes. Auto-regeneratable via `regenerate_index`. Hand-edits are PRESERVED outside auto-regenerated sections. |
| `<vault>/proposals/<date>-<slug>.md` (v1.1+) | Indexed as regular notes BUT `status: proposal` frontmatter signals these are review-pending. Filter them out via `list_notes({status: "active"})` or `search_*({status: "active"})`. Use `synthesize_promote` to move them to canonical destinations. |
| `<vault>/sources/<slug>.md` | Indexed as regular notes. `type: source` from `ingest_source`. Should have `source_uri`, `source_title`, etc. frontmatter. |

## What's outside the vault and therefore invisible

These all live OUTSIDE the vault and are NOT searchable:

| Path | Why not indexed |
|---|---|
| `<project>/.planning/*` | Outside the `--notes` path. Per-developer transient state, gitignored. |
| `<project>/AGENTS.md` | At project root, not in vault. Canonical contract; `inspect_contract` reads it directly. |
| `<project>/CLAUDE.md` | Claude Code's. Not vault content. |
| `<project>/.claude/skills/**` | Skill bundles managed by claude-plugin-runtime. Not vault content. |
| Source code (`src/`, `lib/`, etc.) | Outside vault. Future work: `code` corpus (not yet wired in v1.x). |
| Comments in source code | Same. |
| Git commit messages | Same. |
| Issue tracker content | Same. |

If you want any of these searchable today, you have two options:

1. **Put them inside the vault** — symlink (the indexer follows symlinks) or copy. Trades vault hygiene for searchability.
2. **Run a second MCP server** — `node ./dist/cli/index.js --notes ./.planning --read-only` exposes them via a sibling MCP server. Adds tool-name collisions (clients see two `search_semantic` tools), so use distinct server names in `.mcp.json`.

## Per-corpus future (v1.4+)

The README at v1.0 announced six corpora: `vault`, `code`, `plans`, `docs`, `research`, `project-map`. **Only the `vault` corpus is wired in v1.x.** The plumbing for multi-corpus is conceptual placeholder — the `--corpus` flag doesn't exist, tools aren't conditional on which corpora are active, and there's only one index.

When multi-corpus lands (v1.4 candidate per ROADMAP), each corpus will:
- Have its own indexer config (chunking strategy varies by content type)
- Write to its own index dir (e.g. `<project>/.claude/.semantic-memory/index/vault/`, `index/code/`, ...)
- Register conditional tools (`search_code`, `read_code_symbol`, etc.)
- Cross-reference via the unified knowledge graph

Until then, "the corpus" === "the vault."

## Verifying what's indexed

Two diagnostic tools:

**`get_stats`** — high-level: total notes, total chunks, embedding dimensions, graph density, index state:

```json
{
  "totalNotes": 1247,
  "totalChunks": 4831,
  "totalEmbeddings": 4831,
  "embeddingDimensions": 384,
  "embeddingModel": "all-MiniLM-L6-v2",
  "embeddingRuntime": "native",
  "graphNodes": 1289,           // notes + tag nodes
  "graphEdges": 7234,
  "indexState": "ready",
  "lastIndexed": "2026-05-09T03:18:14Z"
}
```

**`list_notes`** — exact count of indexed notes; can filter:

```
list_notes()                              → all indexed notes
list_notes({status: "active"})           → all non-deprecated/non-draft
list_notes({domain: "architecture"})     → only domain-tagged
list_notes({modifiedAfter: "2026-01-01"}) → recent
```

If a file is in the vault but doesn't appear in `list_notes`, possibilities:

1. The indexer hasn't seen it yet — the watcher catches it on save, full reindex catches it on next run
2. Its filename doesn't end in `.md` (extensions are case-sensitive too — `.MD` doesn't match)
3. It's actually outside the vault (check what `--notes` points at)
4. Index is `"empty"` or `"loading"` — `get_stats` reveals state

## See also

- [indices-and-storage.md](./indices-and-storage.md) — storage-perspective companion (every file on disk)
- [architecture-layers.md](./architecture-layers.md) — substrate layer — where the indexer sits
- [schema-and-provenance.md](./schema-and-provenance.md) — frontmatter schema details
- [frontmatter-spec.md](../reference/frontmatter-spec.md) — full frontmatter field reference
- [mcp-tools-reference.md](../reference/mcp-tools-reference.md) — every tool that queries these indices
