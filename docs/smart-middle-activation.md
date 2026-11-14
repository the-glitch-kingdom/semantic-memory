---
title: Smart-middle corpus activation (preview, ships in 2.0.0b)
tier: standard
domains:
  - architecture
  - configuration
status: draft
last_updated: 2026-05-07
version: 1.0.0
audience:
  - developers
purpose: Document the first-run heuristic semantic-memory uses to auto-detect which corpora to enable. Designed to give zero-friction onboarding for solo users and full-stack visibility for teams.
---

# Smart-middle activation

> **Superseded, never implemented.** Federation (`federation.sources`) replaced this design; see the [federation guide](../.documentation/operational/federation-guide.md) to search extra corpora. babel-fish writes `.claude/project-map/sections/`, not `.babel-fish/`.

> **Status: planned for 2.0.0b.** This document describes the auto-detection heuristic that runs the first time `semantic-memory` is invoked in a project (i.e., when `<project-root>/.semantic/corpora.json` doesn't exist). The implementation lands with the multi-corpus refactor.

## The three approaches considered

When this design was being scoped, three default-corpora strategies were on the table:

1. **All-on**: enable all six corpora (vault, code, plans, docs, research, project-map) by default. Heavy footprint; lots of empty `no_index` returns for projects that don't have all six markers.
2. **Vault-only**: enable just `vault` by default; require explicit opt-in for everything else. Lightest footprint; requires manual config for any non-trivial project.
3. **Smart-middle**: scan the project for known markers (`.planning/`, `src/`, etc.) and auto-enable corresponding corpora. Friction-free onboarding without paying for empty corpora.

The user picked smart-middle. This doc specifies the resolution.

## Marker → corpus mapping

| Marker (file or directory) | Activates | Default `root` | Default `chunker` |
|---|---|---|---|
| `.claude/.vault/` | `vault` | `./.claude/.vault` | `markdown` |
| `.planning/.meta/workspace.json` with `mode: "lg"` | `plans` | `./.planning` | `markdown` |
| `.planning/` (without lg-mode workspace.json) | (skipped — sm-mode plans aren't multi-corpus material) | — | — |
| `.documentation/` | `docs` | `./.documentation` | `markdown` |
| `.research/` | `research` | `./.research` | `markdown` |
| `.babel-fish/01-vocabulary.md` | `project-map` (with glossary extractor enabled) | `./.babel-fish` | `markdown` |
| Detected source dir with TS/JS files | `code` | `<detected>` | `tree-sitter-ts` |

### Source-dir detection for `code`

The `code` corpus is the only one that requires content sniffing rather than a single marker. The detection logic:

1. If `package.json` exists at project root: read `main` / `module` / `exports` to find canonical source paths
2. If `tsconfig.json` exists: read `compilerOptions.rootDir` and `include`
3. If `src/` directory exists at project root with at least one `.ts` / `.tsx` / `.js` / `.jsx` file: use `src/`
4. If multiple candidates: pick the one with the most TS/JS files; tie-break by depth (shallower wins)
5. If none found: skip the `code` corpus (don't activate)

When activated, the default `glob` is `**/*.{ts,tsx,js,jsx}` (Python deferred to a future minor; see Phase 3.2.0 in the meta-plan).

## Decision banner

After scanning, semantic-memory prints a decision banner to stderr explaining what it activated and why:

```
[semantic-memory] First-run corpus activation:
[semantic-memory]   ✓ vault         from .claude/.vault/  (markdown chunker)
[semantic-memory]   ✓ plans         from .planning/        (markdown chunker, lg-mode workspace detected)
[semantic-memory]   ✓ code          from src/              (tree-sitter-ts chunker, 47 files)
[semantic-memory]   - docs          (no .documentation/ found)
[semantic-memory]   - research      (no .research/ found)
[semantic-memory]   - project-map   (no .babel-fish/01-vocabulary.md found)
[semantic-memory]
[semantic-memory] Generated .semantic/corpora.json. Edit to override.
```

Banner intent: NO MAGIC. The user sees what got turned on, what didn't, and why. Editing `corpora.json` directly is always the override path.

## Override and force-rerun

After the first run, `corpora.json` is the source of truth. To re-run smart-middle activation (after adding new markers, for example), delete `<project-root>/.semantic/corpora.json` and re-invoke semantic-memory.

A `--re-detect` CLI flag may be added in a later minor for the case where the user wants to merge new markers into an existing `corpora.json` without losing manual customizations. (TBD — design open.)

## Why this design

- **Solo devs win**: a fresh project with just `.claude/.vault/` gets the legacy semantic-sidekick experience. No new config to learn.
- **Teams win**: a project with `.planning/` (lg mode) + `src/` + `.babel-fish/` gets all three corpora wired automatically — no need to read a multi-page config doc to get value out of the new architecture.
- **Banner is the trust mechanism**: users see what got auto-activated and can disable corpora they don't want by editing `corpora.json`. The decision is never invisible.
- **Backwards compatibility is free**: projects without ANY of the markers fall back to legacy single-vault behavior (which is what semantic-sidekick 0.2.5 does today). No `corpora.json` is even written in that case.

## Inter-corpus interactions (when multiple corpora are active)

- **Unified knowledge graph**: nodes from all active corpora share one graph. A `related_docs:` edge in a vault note can resolve to a code symbol in the `code` corpus.
- **Cross-corpus search**: `search_all` queries all enabled corpora and merges results.
- **Drift detection**: registered iff `code` + at least one doc-bearing corpus (vault, plans, docs) are both active.
- **Translation**: registered iff `project-map` corpus is active AND its `glossary.json` was extracted successfully.

These behaviors are detailed in `docs/corpora-json.md` (the schema reference).

## See also

- `docs/corpora-json.md` — `corpora.json` schema reference
- `docs/regression-snapshot.md` — the gate that protects existing single-vault behavior during the refactor
- `~/workspace/the-glitch-kingdom/persistent-planning/.planning/layered-planning-with-mcp-and-hewtd-frontmatter/task_plan.md` — meta-plan; smart-middle activation is decision C3
