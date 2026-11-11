---
title: Code graph - code nodes, grounding and entity cards
tier: reference
domains:
  - architecture
audience:
  - developers
  - admin
tags:
  - code-graph
  - grounding
  - drift
  - hewtd-export
  - entity-card
  - undocumented
status: active
last_updated: '2026-11-08'
version: 1.16.0
purpose: How semantic-memory puts code into the graph (v1.16.0, issue 58) - the
  hit-em-with-the-docs graph export it reads, the fallback from code spans, the
  grounding penalty, entity cards and undocumented names.
load_priority: 6
estimated_read_time: 3 minutes
word_count: 502
last_validated: '2026-11-08'
backlinks: []
sources:
  - test/fixtures/code-graph-vault/.hewtd/graph.json
---

# Code graph

Since v1.16.0 the graph holds the code that docs cite. Everything here is optional input: with no export and no resolvable reference, or outside a git repo, behaviour is the doc-only graph.

## Where the data comes from

1. **The export**: `.hewtd/graph.json` version 1, written by `npx hewtd index` (hit-em-with-the-docs 2.21.0+). It is untrusted input. A missing file is silent; bad JSON or another `version` warns once on stderr and is ignored; unknown fields are skipped and malformed entries dropped; the file is capped at 64 MB. Only `file` and `symbol` refs are read. `resolved: null` is never dead.
2. **The fallback**, per doc the export does not cover: inline code spans and non-`.md` link targets (`codeRefs`, parsed at index time) are matched against `git ls-files`, and dates come from `git log`. `:line`, `:Name` and `#L` suffixes and a trailing `/` are dropped first, so `src/core/vector.ts:73` matches the file and `src/` the folder; globs (`*.ts`) and `<placeholders>` are skipped. A ref is dead only if it contains `/`, matches no file or folder, its repo-root top folder exists, and git does not ignore it (gitignored runtime paths such as `.claude/.semantic-memory/` are state, not code; one `git check-ignore` call per build). Symbol spans must look like identifiers and are not ALL_CAPS. Outside git there is no code data. Dates come from one `git log --since=365.days` (`CODE_DATE_WINDOW_DAYS`, v1.22); a file untouched for longer is undated and never counts as drifted.

**Load order (v1.22).** The code graph never delays doc metadata: the server installs docs, titles, filters and the doc-only graph together with the vector index, then loads code in the background (`applyCode`, skipped if a newer swap replaced the docs). Until it lands, responses carry `_meta.stale` and grounding, code edges and the entity card are absent. `get_stats` reports `codeGraph: { source: export|fallback|none, loadMs }` (v1.30.0 adds `export_commit`, `behind_head` and `files_changed_since` when an export was loaded).

## Stale exports (v1.30.0)

The export describes the tree at its `source_commit`. After the next commit it silently describes an older tree, so on load the server compares that commit with HEAD (`patchStale` in `src/core/code-graph.ts`): one `git diff --name-only --no-renames -z <commit>` (working tree included, so an uncommitted deletion counts) and one `git rev-list --count <commit>..HEAD`. Only refs to changed files, or refs the export recorded as dead, are re-checked with `existsSync` under the git root; `..` and absolute paths are skipped. A doc with a patched ref reads `source: "export+live"` and `stale: true`; other docs keep the export's data and `source: "export"`. An unknown or null `source_commit` re-checks every file ref. Dates for patched refs come from `git log` only when needed.

The server never refreshes the export: a search must not write tracked files. Refresh it with `npx hewtd index`. The `code-graph-stale` healthcheck finding warns when the export is more than `CODE_GRAPH_STALE_COMMITS` (20) behind HEAD or its commit is unknown to git.

**Locked sources skip the code graph.** A locked source (a cold generation) is a frozen tree; grading its refs against today's repo would be wrong, so its `codeGraph.source` is `none` and its hits carry no grounding. Opt-in sources that are not locked keep their own export.

Known limits: the symbol table is not re-derived; a changed file with no commit in the 365-day window keeps the export's date; an uncommitted edit marks the doc stale without a drift date; a running server reloads only on a commit or a `graph.json` change.

Export doc keys are docs-relative. They are mapped through the export's `docs_root`, then the config's `docs_root` / `docs_path`, then `.documentation`. If fewer than half the keys match a vault note, the docs table is ignored with one warning (symbols are kept).

## Graph

`code:<path>` and `symbol:<name>` nodes, with `cites_code` (doc to code or symbol) and `defined_in` (symbol to file) edges. They stay out of the default link walks, `graph_path`, `related` and link counts. `backlinks` and `forwardlinks` accept a vault path, a file path or a symbol name and, by default, return link and code edges; `types: ["cites_code"]` narrows them. Dead refs get no node. The graph is rebuilt when `.hewtd/graph.json` or `.git/logs/HEAD` changes (a `.git` that is a file never moves that stamp; reindex instead).

## Grounding

Drift: a cited file changed after max(the doc's body date, `last_verified`), so verifying a doc clears drift. Dead: a cited file ref that no longer exists. Since v1.21 only dead refs rank: each dead file multiplies the score by `dead_penalty`, at most 3, never below `floor`. Drift is still reported in `grounding.code_drift` but ranks only when `drift_penalty` < 1 (opt-in, per file, at most 3; 0.97 restores v1.20). The hewtd verdict `archive-candidate` multiplies by `archive_candidate`; other verdicts add nothing.

```yaml
decay:
  code:
    enabled: true          # false = no grounding penalty and no grounding block
    drift_penalty: 1       # < 1 opts drift back into ranking (v1.20 used 0.97)
    dead_penalty: 0.95
    floor: 0.8
    archive_candidate: 0.85
```

Search results carry a `grounding` block only when there is something to report: `{ source: "export" | "export+live" | "code-spans", stale?: true, verdict?, code_drift: [], dead_refs: [] }`. `decay.block.multiplier` still shows the age decay alone; the ranking score carries both.

## Entity cards and undocumented names

When the query names an identifier or a file that exists in code, result #1 carries an `entity` card ("defined in" when the export says `file_kind: definition`, otherwise "found in"; the citing docs, marked stale when grounded badly). A name found in code but in no doc goes to `undocumented: [{ entity, path }]` beside `missing_terms`, and `no_strong_match` stays true. Symbol cards have a file only when the export is present. The CLI loads code data only when the query has an identifier.

## Known limits

A prose route such as `api/v1/x` counts as dead in the fallback when `api/` is a top folder (damped). The export's `resolved: false` on symbols is noisy and is ignored for dead refs. The dead penalty is small by design (0.95 per file). Inputs are filtered: export refs that are not path-shaped are dropped (so are `import.meta.env`-style member chains), a bare filename next to its full path counts once, a doc never counts itself, and bare names with no `/` and no extension (`Makefile`) never count as dead or drifted. Schemas installed by v1.16 to v1.20 hold `drift_penalty: 0.97` explicitly: set `drift_penalty: 1` or `code: false` there to get the v1.21 default.

## See also

- [Confidence decay guide](../operational/decay-guide.md)
- [MCP tools reference](../reference/mcp-tools-reference.md)
- [What gets indexed](./what-gets-indexed.md)
- [v1.16.0 changelog](../changelog/v1-16-0-code-graph.md)
- [v1.30.0 changelog](../changelog/v1-30-0-stale-code-graph.md)
