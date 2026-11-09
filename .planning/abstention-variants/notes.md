# Notes: abstention-variants (#78)

## Phase 1: verification (main @ 2ab171c, v1.23.0)

Fixtures are in the scratchpad only (`r78/t`, `r78/t2`): a git repo holding `.documentation/api/{INDEX,REGISTRY,rest-endpoints}.md`, a `package-lock.json` naming `graphql`, and `scripts/autofill.js` (`autoFill`). The CLI `search` from the v1.23.0 build was run on it.

### 1. GraphQL flagged with the export, not without it: reproduced. The export is not the cause.
- INDEX.md and REGISTRY.md **without** `generated: true` mention GraphQL. Result: `missing_terms` is empty; `no_strong_match` comes only from low confidence. This matches the reporter's d0.
- After running `hewtd index` (the step that writes `.hewtd/graph.json`), both files are rewritten **with** `generated: true`. After a re-index: `missing_terms: ["GraphQL"]`. This matches d1b.
- Cause:
  - A doc with `generated: true` is `hidden` (`src/core/indexer.ts:140`), so it has no chunks and no field text, and BM25 never sees its body.
  - Without the flag, the hub is a normal doc, so `index.has("graphql")` is true.
  - Yet INDEX.md and REGISTRY.md are never returned by a search either way (`DEFAULT_EXCLUDE_HUBS` in `resultsExclude`, `src/core/path-class.ts:39`). Presence and results disagree.
- With `generated: true` already present, GraphQL was flagged both with and without the export (fixture `r78/t`).
- Lock files and config: the code-graph fallback (`fallbackCode`, `gitFiles`) reads only file names and doc-cited symbols, never file contents. A name in `package-lock.json` or a TOML is not presence, and `knownToCode` only affects the `missing` / `undocumented` split.

### 2. `autofill` false flag: cause confirmed
- `identifiers(q, known, true)` returns `["autofill"]`: lowercase and not in the word list.
- The docs write `auto-fill`, and `tokenize` splits it into `auto` and `fill`, so `index.has("autofill")` is false and the name is missing.
- Code: `knownToCode` matches symbols exactly and file basenames. `autoFill` does not equal `autofill`, so it only rescues the name when a file is named `autofill.*`. In our fixture the file `scripts/autofill.js` moved it to `undocumented`, but `no_strong_match` stayed true.

### Not asked (APNs)
`APNs` collides with an in-tree plural. Leaving it unflagged is correct; no change.
