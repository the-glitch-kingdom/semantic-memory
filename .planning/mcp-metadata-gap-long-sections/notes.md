# Notes: mcp-metadata-gap-long-sections (#73)

## Phase 1: verification against main @ 0ec988d (v1.21.0)

### Claim 1: metadata lost without `.hewtd/graph.json`. Reproduced; the cause is timing.
- `loadFromDisk` in `src/mcp/context.ts` sets `vectorIndex = tempVector` and `resetBm25(docs)`, then runs `setDocuments(docs, await loadCode(docs))`.
  - The argument is evaluated first, so `docByPath`, `documents`, text search and the graph stay empty (on first load) or stale (on reload) until `loadCode` returns.
  - The reconcile path does the same: `vectorIndex = next; setDocuments(docs, await loadCode(docs))`.
- `search_hybrid` only checks `ctx.getVectorIndex()`, so it answers during the gap. In that window:
  - `enrichResult` misses, so the title is the path and `load_priority`, `status`, `tier` and `domains` are absent.
  - `applyPriorityBoost` and `applyDecay` do nothing.
  - `filterPathClass`'s `generated` check and the status/tier/domain filters pass everything through.
  - `relatedTo` has no graph.
- Without an export, `loadCode` runs `fallbackCode`, which calls:
  - `gitFiles`
  - `gitIgnored`
  - `gitLastChanged`: one `git log --name-only --no-renames` over full history per 500 pathspecs, with a 60 s timeout each.

  With an export covering every doc, `fallbackCode` has almost nothing to do, which is why d1b keeps titles.
- On this repo `loadCodeData` takes 85 ms (135 docs), so the gap is invisible here.
- Repro: a PATH shim makes `git log` sleep 20 s, then the stdio `--read-only` server is queried 2 s after start, with `full: true`:

  | | #1 | #3 | lp / status | related |
  |---|---|---|---|---|
  | in the gap | title = `deployment/release-process.md` (0.728) | `legacy/changelog.md` (should be excluded) | none | 0 |
  | after | Release Process (0.745) | KB fact | 6 / active | 1 |

- Scripts are in the session scratchpad (`r73/q.mjs`, `r73/shim/git`). Phase 2 turns them into a repo test.
- Paths key consistently: `docs.cache.json` paths equal the result paths. The reporter's "keys differ" guess is not the cause.

### Claim 2: long multi-topic sections. Plausible, not measured.
- `CHUNK_TARGET_CHARS = 2000` (src/core/indexer.ts).
- The embedder truncates at `max_length: 512` tokens (src/core/embedder.ts, embed-worker.ts), so the reporter's "back half never reaches the vector" is not literally true.
- MiniLM-L6-v2 was trained at 128–256 tokens and mean-pools, so a 2000-char chunk (about 450–500 tokens) dilutes any one fact.
- The 1.21 doc summary chunk is title + purpose + up to 40 headings + 500 chars, and can also exceed 256 tokens.
- To measure in Phase 2: rank against fact offset and chunk token count.

### Claim 3: eval cannot see claim 1. Confirmed.
- The CLI `eval` and `search` (src/cli/search.ts) build `docByPath` from the loaded docs before the first query. They never run while an MCP server is serving mid-load.
- `scripts/lib/eval-probe.mjs` (1.21) already drives stdio, but only after the index is ready, and it reports field counts, not ranking.

### Reporter's numbers (external kit, 919-doc tree), for reference
- d0 (no export), hybrid: set C @1 0.57 (1.15), 0.47 (1.20), 0.47 (1.21); A+B @1 0.79, 0.68, 0.65; A+B multi 0.85, 0.43, 0.43.
- d1b (export): 1.21 set C 0.46, A+B 0.68, multi 0.43.
- Built-in eval on d0: hybrid @1 32 → 27 → 26; multi 5 → 1 → 1; negatives 4/17 → 3/17 → 3/17.
  The built-in eval has no load gap, so this loss is separate from claim 1 and is likely claim 2 or the 1.16+ ranking changes.
