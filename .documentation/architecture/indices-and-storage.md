---
title: Indices and storage — every file semantic-memory writes
tier: reference
domains: [architecture]
audience: [developers, admin]
tags: [storage, indices, paths, files, gitignore, backup, disk, v1.7.0]
status: active
last_updated: '2026-10-25'
version: '1.7.0'
purpose: Comprehensive map of every file and directory semantic-memory creates on disk. Use for backup planning, gitignore decisions, disk-usage forensics, and v2.0 migration prep.
load_priority: 7
---

# Indices and storage

semantic-memory writes to three distinct locations with different lifecycles (plus, since v1.7 with the skill loop on, a machine-wide state folder: see below). This doc maps every file, what it's for, what creates it, and how to safely delete it.

## The three storage tiers

```
┌─────────────────────────────────────────────────────────────────────┐
│  Tier 1: Per-vault DERIVED indices                                  │
│  Location: <vault>/.semantic-sidekick-index/                        │
│  Lifecycle: rebuilt from markdown via `reindex`                     │
│  Safe to delete: YES (rebuilds on next start, costs CPU + time)     │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  Tier 2: Per-machine MODEL CACHE                                    │
│  Location: ~/.semantic-sidekick/models/                             │
│  Lifecycle: downloaded once per model                               │
│  Safe to delete: YES (re-downloads ~90 MB on next start)            │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  Tier 3: Per-project RUNTIME STATE                                  │
│  Location: <project>/.claude/.semantic-memory/ (v1.2+)              │
│            <project>/.claude/.sidekick-* (legacy, v1.x readable)    │
│  Lifecycle: ephemeral, replaced as the plugin runs                  │
│  Safe to delete: YES with caveats (see per-file notes below)        │
└─────────────────────────────────────────────────────────────────────┘
```

## Exact search (v1.27)

`VectorIndex.search` (`src/core/vector.ts`) scores every live chunk by cosine against unit-length copies kept in memory when the index holds at most `EXACT_MAX_VECTORS = 100_000` live chunks. Ties break by doc path, then label (code-unit order, not locale), so the order is total. Above the threshold it uses HNSW, unchanged. `hnsw.bin` is still built and saved either way, and a loaded index past the threshold keeps no unit copies. Cost grows with the vault: a median 7 ms per query at 13k x 384.

Why: HNSW is approximate and sensitive to insertion order. `reconcile` used to push files to `parse` in stat/read completion order, so the same files indexed in an order that changed with I/O timing, and two builds ranked differently (#85, second comment). `src/core/reconcile.ts` now sorts `parse`, which also makes HNSW above 100k reproducible. Embeddings were not the cause: two builds on one machine produced identical vectors. Rebuilds on different CPUs can still differ in the last float digits (batched ONNX output is not bit-exact), so tests compare scores with a tolerance. See the [KB fact](../knowledge-base/facts/approximate-hnsw-plus-insertion-order-makes-rebuilds-rank-differently.md).

## Tier 1: Per-vault derived indices

Lives inside the vault: `<vault>/.semantic-sidekick-index/`. Created on first `reindex` (or `serve --reindex`). Five files.

| File | Purpose | Source | Safe to delete? |
|---|---|---|---|
| `meta.json` | Index metadata: model name, dimensions, totalChunks, indexedAt timestamp, and (v1.9.1) `bm25SelfTop`, the per-index BM25 abstention threshold base. Used for freshness checks at startup. | `src/mcp/context.ts:208` (atomic write at end of `fullIndex()`) | Yes — rebuilds on next reindex |
| `hnsw.bin` | Binary hnswlib graph — the actual approximate-nearest-neighbor index | `src/core/vector.ts:73` | Yes — rebuilds |
| `hnsw-meta.json` | Per-chunk metadata sidecar for hnsw.bin: maps each vector ID back to `(docPath, chunkIndex, text)` | `src/core/vector.ts:75` | Yes — rebuilds |
| `embeddings.json` | Raw float32 embeddings keyed by `<docPath>:<chunkIndex>`. Lets `reindex` resume from a partial state without re-embedding chunks that haven't changed. **Largest file by far.** | `src/core/embedder.ts:476` | Yes — rebuilds (slow: full re-embed) |
| `graph.json` | Knowledge graph: nodes (notes), edges (wikilinks, related_docs, tag-based links). Used by `search_graph`, `search_hybrid`, `backlinks`, `forwardlinks`, `graph_path`, `graph_statistics`. | `src/core/graph.ts:197` | Yes — rebuilds |
| `docs.cache.json` | Verbatim JSON dump of the last `indexAll()` result. The vault-context.js hook reads this to avoid re-parsing every note on every UserPromptSubmit (the 9× speedup). | `src/core/indexer.ts:58` | Yes — rebuilds (fast) |

### Federated sources (v1.19.0+)

Each federation source gets its own index under `<vault>/.semantic-sidekick-index/sources/<label>-<hash8>/` (same files, built with the primary's model); the source folder is never written. Memory is about +16 MB heap and +40 MB RSS per 183-doc source. See the [federation guide](../operational/federation-guide.md).

### Typical sizes (1000-note vault, ~10 KB average note)

```
.semantic-sidekick-index/
  meta.json                   ~ 200 B
  hnsw.bin                    ~ 4–15 MB     (depends on chunk count + ef_construction)
  hnsw-meta.json              ~ 1–3 MB
  embeddings.json             ~ 30–50 MB    (dominant — float32 × 384 dims × N chunks)
  graph.json                  ~ 100–500 KB
  docs.cache.json             ~ 5–15 MB
                              ─────────────
  Total                       ~ 40–80 MB
```

`embeddings.json` dominates. If you're tight on disk, this is the file to watch. The model dimension (384 for `all-MiniLM-L6-v2`) and total chunk count are the levers.

### Freshness: pull-based reconcile (v1.9.0+)

Nothing watches the tree. Before a search (at most once per 2 s, `reconcileThrottleMs`) and once after load, the server walks the notes folder and compares each file's `fs.stat` (mtime, size, inode) with `manifest.json`. A file whose stat is unchanged is skipped without being read; one whose stat changed is hashed: same bytes (a `touch`, a `git checkout`) only refreshes the manifest, different bytes or a new file is re-parsed, a missing file is dropped. Frontmatter dates (`last_updated`) are never used. Vectors are keyed by a hash of the chunk text, so only chunks whose text changed are embedded, and HNSW is updated in place (`markDelete` + `addPoint`), compacted by a rebuild past 30% deleted nodes. The graph and BM25 index are rebuilt whole after a change (11-14 ms for 1,000 docs). A search that arrives while the first reconcile is still running is answered from the loaded index with `_meta.stale: true`; an edit made during a reconcile is picked up by the next call.

**Code graph (v1.16).** `graph.json` also holds `code:` and `symbol:` nodes, and `docs.cache.json` holds each doc's `codeRefs` and `grounding` (schema 8, a re-parse only). The optional `.hewtd/graph.json` is read, never written; see [code-graph.md](./code-graph.md).

**Index files and commit.** `hnsw.bin`, `hnsw-meta.json`, `graph.json`, `docs.cache.json` and `manifest.json` must come from one commit. `meta.json` records `schemaVersion` (the parser), `chunker`, the ignore-glob hash, a `generation` counter and the size and mtime of each commit file, and is written last, so it is the commit marker. Each file is written to a temp name and renamed. A reader that finds files not matching `meta.json` (a crash or a second process mid-save) treats the index as unusable for that part and rebuilds only what it must. `embeddings.json` is exempt: it is keyed by chunk text, so any version is valid. **Chunk size (v1.22, schema 11).** Body chunks are at most 1000 characters (about 256 tokens, MiniLM's trained window; characters stand in for tokens) with one sentence of overlap, each keeping its section. Upgrading re-embeds once. Bumping `INDEX_SCHEMA_VERSION` re-parses everything and re-embeds nothing whose chunk text is unchanged. **Upgrade (v1.9.1):** an index with an older schema, including v1.7.2/v1.8 ones with no manifest, is served with `_meta.stale: true` while the first reconcile rebuilds. Old positional `path:chunkIndex` vectors in `embeddings.json` are re-keyed to `sha256(model \0 text)` through the text in `hnsw-meta.json`; only chunks whose text changed are re-embedded. `meta.ignoreGlobs` hashes the ignore list plus the effective `path_class.exclude`, so editing the exclude list re-parses once.

**State-dir files.** The selection log (`selection.jsonl`) of a `--read-only` server is written to `.semantic-sidekick-index/` (`ctx.telemetryDir`), never into the notes tree; usage boost reads the legacy `.claude/.semantic-memory/` location first, then this one.

**One writer.** `index.lock` (`{pid, at}`, created exclusively) in the index folder gives one writer per index; a holder that is dead or older than 10 minutes is taken over, and a process that cannot get the lock skips its save and adopts the other's commit on the next reconcile. The CLI `search` path only reads.

**Lexical index.** The BM25 index behind `search_hybrid` is held in memory only and rebuilt from the parsed docs at load (about 1 ms per 100 docs); nothing is stored for it on disk.

Pre-1.9 behaviour (chokidar watcher, chunk-count staleness check, full reindex on any change) is described in the [v1.9.0 changelog](../changelog/v1-9-0-retrieval-graph-quality.md) and the [KB fact on inotify watches](../knowledge-base/facts/chokidar-holds-one-inotify-watch-per-file.md).

### Resume-on-crash semantics

`embeddings.json` is saved every 100 chunks during `fullIndex()` (`src/mcp/context.ts:181`). If a reindex is interrupted, the next `fullIndex()` reads `embeddings.json`, picks up where it left off, and only embeds chunks that don't yet have entries. This means:

- Killing a reindex mid-run is safe — no corrupted state, just resume work
- A long initial reindex on a large vault can be paused / restarted across sessions
- If you've never seen a complete reindex, `embeddings.json` may already have most of the work — keep it

### v2.0 migration

`<vault>/.semantic-sidekick-index/` will move to `<project>/.claude/.semantic-memory/index/` in v2.0. Atomic move-with-verify; no re-index required (the data is the same, just relocated). The path retains the `semantic-sidekick` legacy name through all of v1.x via the storage promise.

### Gitignore

The directory is gitignored by default (line 8 in `.gitignore`):

```
.semantic-sidekick-index/
```

Never commit this directory — it's per-machine derived state, can be MB-to-GB depending on vault size, and rebuilds in seconds-to-minutes.

## Tier 2: Per-machine model cache

Lives outside the project: `~/.semantic-sidekick/models/`. Created on first server start when the embedding model is downloaded.

```
~/.semantic-sidekick/models/
└── sentence-transformers--all-MiniLM-L6-v2/      (default model, ~90 MB)
    ├── tokenizer.json
    ├── tokenizer_config.json
    ├── config.json
    ├── special_tokens_map.json
    └── onnx/
        └── model.onnx          # ONNX weights — the actual neural net
```

### Shared across projects

Multiple vaults on the same machine all use the same model cache. This is why `npm install @theglitchking/semantic-memory` doesn't trigger a 90 MB download — the model isn't in `node_modules`. It's downloaded on first `serve` if not already present.

### Multiple models

If you switch embedding models (`--model nomic-ai/nomic-embed-text-v1.5`), each cached separately:

```
~/.semantic-sidekick/models/
├── sentence-transformers--all-MiniLM-L6-v2/   ~ 90 MB
└── nomic-ai--nomic-embed-text-v1.5/           ~ 550 MB (much larger model)
```

Switching the active model invalidates the existing index (different dimensions). v1.x's `meta.json` stores `model` and `dimensions` — startup detects the mismatch and forces a reindex.

### Safe to delete?

Yes — the model re-downloads on next start. Costs ~90 MB of bandwidth and the time to fetch from HuggingFace.

If you're working offline, removing this cache is irreversible until you have network again. The offline tarball flow (`scripts/build-offline-tarball.sh`) bundles this cache so air-gapped installs work.

### v2.0 migration

`~/.semantic-sidekick/models/` will rename to `~/.semantic-memory/models/` in v2.0. One-time atomic rename on first v2.0 run.

## Tier 3: Per-project runtime state

Lives at `<project>/.claude/.semantic-memory/` (v1.2+) and `<project>/.claude/.sidekick-*` (legacy, readable through v1.x). All gitignored.

| File | Purpose | Source | Lifecycle |
|---|---|---|---|
| `mode` | Active mode router: `vault-first`, `research`, or `outage-silence`. Single-line plain text. | `hooks/vault-context.js` writeMode | Persists across sessions until `/mode` changes it; SessionStart resets to `vault-first` if missing or invalid |
| `fingerprints.json` | sha1 fingerprints of recent UserPromptSubmit prompts. Suppresses re-firing of the vault-context block on re-issued prompts. | `hooks/vault-context.js` saveFingerprints | Trimmed periodically; cap on size in normalizeFingerprint |
| `capture-pending.json` | Queue of capture-cue-detected prompts that the Stop hook will surface as transition prompts | `hooks/vault-context.js` addCapturePending | Cleared at Stop in vault-first mode |
| `session.json` | Active session state: id, task, started_at, last_activity_at, verifications, notes_touched, optionally closed_at + closed_summary | `src/core/session.ts` (v1.1+) | Removed on `session_finish` |
| `healthcheck-cache.json` | Cached healthcheck result to avoid re-running fast-tier on every SessionStart within 5min | `src/core/healthcheck.ts` (v1.1+) | Auto-expires after 5min |

### Skill-loop state (v1.7+, only with the skill loop on)

More files in the same folder. Evidence logs are redacted before they are written and rotate to `<file>.1` past 5 MB (`SEMANTIC_MEMORY_SKILL_LOOP_EVIDENCE_MB`). Full detail: [configuration-reference.md](../reference/configuration-reference.md#v17-skill-loop-and-jev-mode-state).

| File | Purpose | Safe to delete? |
|---|---|---|
| `skill-usage.jsonl` | Learned-skill uses (tool or `/name`). The curator reads it. | Yes; skills then look unused to the curator |
| `failures.jsonl`, `corrections.jsonl` | Evidence for reviews | Yes; pending evidence is lost |
| `skill-drafts/` | Drafts awaiting review | Yes, but the drafts are lost. Use `skill-loop review --reject` to keep the ledger right. |
| `skill-ledger.jsonl`, `skill-ledger-blobs/` | Every change to a learned skill, with exact bytes | **No.** `skill-loop rollback` needs them. |
| `skills-archive/` | Archived learned skills | **No.** `skill-loop restore` needs them. Never auto-deleted. |
| `curator.json` | Last curator run | Yes; the curator then runs when next due |
| `skill-loop.log`, `skill-loop.lock` | Worker and curator log; one-worker-per-repo lock | Yes (not the lock while a worker runs) |
| `config` | Repo overrides (`skill_loop:`, `skill_loop_consolidate:`) | It is your setting; commit it if you want it shared |

**Machine-wide, `~/.semantic-memory/` (v1.7+, base `SEMANTIC_MEMORY_STATE_HOME`):** `review-queue/` (+ `done/`, `failed/`), `skill-loop-runs.jsonl` (the daily cap's count), `skill-index.jsonl` (learned skills across repos, for promotion; private repos are never indexed), `claude-slots/` (concurrency slots), `skill-eval-cache.jsonl`. All safe to delete; the queue loses unreviewed jobs. Learned skills themselves live in `<repo>/.claude/skills/` (or a directory's `.claude/skills/`, or `~/.claude/skills/` when promoted): they are **content, commit them**.

### Legacy paths (still readable through v1.x)

| Legacy path | New path | Status |
|---|---|---|
| `.claude/.sidekick-mode` | `.claude/.semantic-memory/mode` | Read-fallback in v1.x; removed in v2.0 |
| `.claude/.sidekick-fingerprints.json` | `.claude/.semantic-memory/fingerprints.json` | Read-fallback in v1.x; removed in v2.0 |
| `.claude/.sidekick-capture-pending.json` | `.claude/.semantic-memory/capture-pending.json` | Read-fallback in v1.x; removed in v2.0 |

`bin/semantic-memory migrate-state` does the explicit move. Idempotent.

### Safe to delete?

Each file has different consequences:

- **`mode`** — deletion resets mode to `vault-first` on next read. Safe.
- **`fingerprints.json`** — deletion makes prior prompts re-fire vault-context (extra context injection). Mild noise, not a bug. Safe.
- **`capture-pending.json`** — deletion drops queued capture cues. Lost session work but not durable knowledge. Safe.
- **`session.json`** — deletion abandons the session. Verifications lost; notes_touched lost. Use `session_finish` instead unless the session is genuinely abandoned.
- **`healthcheck-cache.json`** — deletion forces the next healthcheck call to re-run. Safe.

Deleting the entire `.claude/.semantic-memory/` directory is equivalent to "fresh install" — the next session starts with default state.

## Other plugin-adjacent files

These exist near the vault but are NOT created by semantic-memory:

| Path | Source | Status |
|---|---|---|
| `<project>/AGENTS.md` | `regenerate_contract` MCP tool (v1.1+) — opt-in | Canonical contract document; commit to git |
| `<vault>/vault.schema.yml` | `install_schema` MCP tool — opt-in | Canonical schema definition; commit to git |
| `<vault>/log.md` | `log_event` MCP tool, automatic on synthesis/ingest/error events | Append-only event log; commit to git |
| `<vault>/proposals/<date>-<slug>.md` | `synthesize_note({proposal: true})` (v1.1+) | Review-first proposal notes; commit when reviewed |
| `<vault>/index.md`, subdirectory `index.md` files | `regenerate_index` MCP tool | Navigational notes; commit to git |
| `<project>/.claude/skills/` | `claude-plugin-runtime` postinstall — manages symlinks for Claude | Symlinked, not files; commit `.gitkeep` only |
| `<project>/.mcp.json` | `hooks/reconcile.js` writes the semantic-vault entry on SessionStart | Project config; commit to git |

## Recommended `.gitignore`

The shipping `.gitignore` already covers everything. For a fresh repo using semantic-memory:

```gitignore
# Vault index — derived, rebuilds on demand
.semantic-sidekick-index/

# Sidekick legacy state files (readable through v1.x)
.claude/.sidekick-mode
.claude/.sidekick-fingerprints.json
.claude/.sidekick-capture-pending.json

# v1.2: state files consolidated under .claude/.semantic-memory/
.claude/.semantic-memory/
.claude/semantic-memory.json
.claude/semantic-sidekick.json

# Other-plugin runtime caches (postinstall artifacts from any plugin)
.claude/.*-update-cache.json

# Stale semantic-first symlink
.claude/skills/semantic-first

# npm publish auth token (never commit)
.npmrc
```

## Backup planning

If you're backing up a project:

**Always include:**
- The vault itself (`<vault>/*.md`) — canonical content
- `<vault>/vault.schema.yml`, `log.md`, `proposals/` — vault-managed files
- `<project>/AGENTS.md` if present — canonical contract
- `<project>/.mcp.json` — MCP server config

**Skip (rebuilds on demand):**
- `<vault>/.semantic-sidekick-index/` — derived
- `<project>/.claude/.semantic-memory/` — runtime state
- `<project>/.claude/.sidekick-*` — legacy runtime state
- `~/.semantic-memory/` — queue and caches (v1.7)

**Never skip with the skill loop on:** `skill-ledger*` and `skills-archive/` under `.claude/.semantic-memory/` (rollback and restore need them), and the learned skills in `.claude/skills/`.
- `~/.semantic-sidekick/models/` — re-downloadable

## Disk forensics

If a project is consuming unexpected disk:

```bash
# Vault index size
du -sh <vault>/.semantic-sidekick-index/

# Model cache (shared across projects)
du -sh ~/.semantic-sidekick/models/

# Runtime state (should be tiny — < 1 MB)
du -sh <project>/.claude/.semantic-memory/

# Combined per-project
du -sh <vault>/.semantic-sidekick-index/ <project>/.claude/.semantic-memory/

# Compare to vault itself
du -sh <vault> --exclude=.semantic-sidekick-index/
```

Index size should be ~0.5× to 2× the vault size for a typical markdown vault. If it's 10× the vault, you have an unusually high embedding-to-text ratio (e.g. very short notes) and `embeddings.json` is the culprit.

## See also

- [architecture-layers.md](./architecture-layers.md) — the substrate that produces these indices
- [mcp-internals.md](./mcp-internals.md) — how the indexer state is exposed to tools
- [state-migration.md](../operational/state-migration.md) — operational guide for v1.2 state migration
- [drift-detection.md](../operational/drift-detection.md) — `/healthcheck` checks index freshness
