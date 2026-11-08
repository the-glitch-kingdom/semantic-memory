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
2. **The fallback**, per doc the export does not cover: inline code spans and non-`.md` link targets (`codeRefs`, parsed at index time) are matched against `git ls-files`, and dates come from `git log`. A ref is dead only if it contains `/`, matches no file and its repo-root top folder exists. Symbol spans must look like identifiers and are not ALL_CAPS. Outside git there is no code data.

Export doc keys are docs-relative. They are mapped through the export's `docs_root`, then the config's `docs_root` / `docs_path`, then `.documentation`. If fewer than half the keys match a vault note, the docs table is ignored with one warning (symbols are kept).

## Graph

`code:<path>` and `symbol:<name>` nodes, with `cites_code` (doc to code or symbol) and `defined_in` (symbol to file) edges. They stay out of the default link walks, `graph_path`, `related` and link counts. `backlinks` and `forwardlinks` accept a vault path, a file path or a symbol name and, by default, return link and code edges; `types: ["cites_code"]` narrows them. Dead refs get no node. The graph is rebuilt when `.hewtd/graph.json` or `.git/logs/HEAD` changes (a `.git` that is a file never moves that stamp; reindex instead).

## Grounding

Drift: a cited file changed after max(the doc's body date, `last_verified`), so verifying a doc clears drift. Dead: a cited file ref that no longer exists. Each drifted file multiplies the score by `decay.code.drift_penalty`, each dead one by `dead_penalty`, at most 3 of each and never below `floor`. The hewtd verdict `archive-candidate` multiplies by `archive_candidate`; other verdicts add nothing.

```yaml
decay:
  code:
    enabled: true          # false = no grounding penalty and no grounding block
    drift_penalty: 0.97
    dead_penalty: 0.95
    floor: 0.8
    archive_candidate: 0.85
```

Search results carry a `grounding` block only when there is something to report: `{ source: "export" | "code-spans", verdict?, code_drift: [], dead_refs: [] }`. `decay.block.multiplier` still shows the age decay alone; the ranking score carries both.

## Entity cards and undocumented names

When the query names an identifier or a file that exists in code, result #1 carries an `entity` card ("defined in" when the export says `file_kind: definition`, otherwise "found in"; the citing docs, marked stale when grounded badly). A name found in code but in no doc goes to `undocumented: [{ entity, path }]` beside `missing_terms`, and `no_strong_match` stays true. Symbol cards have a file only when the export is present. The CLI loads code data only when the query has an identifier.

## Known limits

A prose route such as `api/v1/x` counts as dead in the fallback when `api/` is a top folder (damped). The export's `resolved: false` on symbols is noisy and is ignored for dead refs. The penalty is small by design (0.97 per file).

## See also

- [Confidence decay guide](../operational/decay-guide.md)
- [MCP tools reference](../reference/mcp-tools-reference.md)
- [What gets indexed](./what-gets-indexed.md)
- [v1.16.0 changelog](../changelog/v1-16-0-code-graph.md)
