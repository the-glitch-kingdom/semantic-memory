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

## Tier 1: Per-vault derived indices

Lives inside the vault: `<vault>/.semantic-sidekick-index/`. Created on first `reindex` (or `serve --reindex`). Five files.

| File | Purpose | Source | Safe to delete? |
|---|---|---|---|
| `meta.json` | Index metadata: model name, dimensions, totalChunks, indexedAt timestamp. Used for freshness checks at startup. | `src/mcp/context.ts:208` (atomic write at end of `fullIndex()`) | Yes — rebuilds on next reindex |
| `hnsw.bin` | Binary hnswlib graph — the actual approximate-nearest-neighbor index | `src/core/vector.ts:73` | Yes — rebuilds |
| `hnsw-meta.json` | Per-chunk metadata sidecar for hnsw.bin: maps each vector ID back to `(docPath, chunkIndex, text)` | `src/core/vector.ts:75` | Yes — rebuilds |
| `embeddings.json` | Raw float32 embeddings keyed by `<docPath>:<chunkIndex>`. Lets `reindex` resume from a partial state without re-embedding chunks that haven't changed. **Largest file by far.** | `src/core/embedder.ts:476` | Yes — rebuilds (slow: full re-embed) |
| `graph.json` | Knowledge graph: nodes (notes), edges (wikilinks, related_docs, tag-based links). Used by `search_graph`, `search_hybrid`, `backlinks`, `forwardlinks`, `graph_path`, `graph_statistics`. | `src/core/graph.ts:197` | Yes — rebuilds |
| `docs.cache.json` | Verbatim JSON dump of the last `indexAll()` result. The vault-context.js hook reads this to avoid re-parsing every note on every UserPromptSubmit (the 9× speedup). | `src/core/indexer.ts:58` | Yes — rebuilds (fast) |

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

### Freshness: startup rebuild and the watcher (v1.5.2+)

On startup the server loads the cached index and compares `meta.json` `totalChunks` with the chunks of the notes now on disk. A mismatch marks the index `stale`, and since v1.5.2 a stale cache is rebuilt in the background while the stale copy keeps serving (`src/mcp/server.ts`). Before 1.5.2 a stale cache was served indefinitely — the issue #29 symptom: `meta.json` stuck at an old `totalChunks` / `indexedAt` while the folder kept growing.

While the server runs, the file watcher (`src/core/watcher.ts`) reindexes on every `.md` add / change / delete. It watches the notes folder and filters out `node_modules/`, `.semantic-sidekick-index/` and `.git/`; chokidar 4+ has no glob support, so the pre-1.5.2 `watch("**/*.md")` never fired.

Known gap: staleness at startup is detected by chunk count only. A note edited while no server was running that keeps its chunk count is not caught until the next edit or a manual `--reindex`.

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
