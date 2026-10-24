# semantic-memory (formerly semantic-sidekick)

> A shelf is retrievable. A prosthesis is present.
> A vault is local. Memory is layered.

> **v1.0.0 rebrand** — `semantic-sidekick` → `semantic-memory`. The npm package, plugin name, MCP server name, and marketplace identity all change. **Internal storage layout (`.semantic-sidekick-index/`, `~/.semantic-sidekick/models/`) is preserved** — existing installs continue to read their indices and model caches without re-indexing or re-downloading. See [CHANGELOG.md](./CHANGELOG.md) for the full migration. The `bin/semantic-sidekick` command remains as an alias for `bin/semantic-memory` during the transition.

semantic-memory is the unified memory-layer plugin for Claude Code. **One MCP server, multiple typed corpora** (vault, code, plans, docs, research, project-map), a unified cross-corpus knowledge graph, conditional tool registration based on which corpora are active, in-process drift detection, and human↔code translation via the babel-fish glossary side-channel.

The original semantic-sidekick framing — activation / mode-routing / capture layer on top of [semantic-pages](https://github.com/TheGlitchKing/semantic-pages) — is preserved as the `vault` corpus's behavior. What's new in 1.0.0 is the multi-corpus architecture that absorbs documentation, code, plans, research, and babel-fish project-maps into the same MCP surface.

## Status

**Phases 1–4 shipped** (2026-04-22). Layers 2–5 fully implemented and committed to `feat/sidekick-layers`. Phase 5 (advanced calibration + contradiction detection) is explicitly gated per the plan ("only build when Phase 4 has been in use for ≥2 weeks and a specific failure demands it").

| Phase | What it adds | Commit |
|---|---|---|
| **1 — Activation** | `vault-first` skill + SessionStart/UserPromptSubmit hooks + CLAUDE.md cite-or-deflect rule | `c8f722f` |
| **2 — Structure + Capture** | schema, `apply_patch`, `synthesize_note`, lint (schema/provenance/stale), Stop-hook capture-on-close, parsed-doc cache (9x hook speedup) | `1807c58` |
| **3 — Ingest + Maintenance** | `ingest_source`, structured `log.md` + `log_event`/`log_query`, hierarchical index auto-regen, broken-link lint | `b8d4492` |
| **4 — Routing + Transitions** | `research-mode` + `outage-silence` skills, `/mode` + `/vault` commands, mode-aware hooks, transition-capture prompts | `75ee813` |

Per-phase design docs live in `.documentation/phase-{1..4}-*.md`.

## Quickstart as a Claude Code plugin

```bash
# Add the marketplace (from git)
/plugin marketplace add https://github.com/TheGlitchKing/semantic-sidekick

# Install the plugin
/plugin install semantic-sidekick
```

On install:
- `.mcp.json` is reconciled to point at `.claude/.vault` (or your `--notes <path>`).
- Skills (`vault-first`, `research-mode`, `outage-silence`) are linked into `.claude/skills/`.
- Hooks (`SessionStart`, `UserPromptSubmit`, `Stop`) register from `hooks/hooks.json`.
- Commands (`/mode`, `/vault`) become available.

First run: `semantic-sidekick --notes ./path/to/vault --reindex` to build the vector index (writes `.semantic-sidekick-index/`). Subsequent hook calls hit the cache in <1s.

## Using the modes

| Command | Effect |
|---|---|
| `/mode research` | Enter research-mode. Every source introduced gets filed via `ingest_source`; mandatory `synthesize_note` on exit. Visible `[research]` prefix. |
| `/mode outage-silence` | Enter outage-silence. No proactive vault search. Terse responses. Postmortem drafted as `synthesize_note` on exit. Visible `[outage]` prefix. |
| `/mode vault-first` | Return to default. Project-scoped prose questions trigger vault consultation with cite-or-deflect. |
| `/mode status` | Print the current mode. |
| `/vault <query>` | Explicit vault query. Always works, even in outage-silence. |

## 33 MCP tools shipped

Search (4): `search_semantic`, `search_text`, `search_graph`, `search_hybrid`  
Read (3): `read_note`, `read_multiple_notes`, `list_notes`  
Write (4): `create_note`, `update_note`, `delete_note`, `move_note`  
Metadata (4): `get_frontmatter`, `update_frontmatter`, `manage_tags`, `rename_tag`  
Graph (4): `backlinks`, `forwardlinks`, `graph_path`, `graph_statistics`  
System (2): `get_stats`, `reindex`  
**Patch/Synthesis (4):** `apply_patch`, `synthesize_note`, `ingest_source`, `install_schema`  
**Lint (4):** `find_schema_violations`, `find_missing_provenance`, `find_stale`, `find_broken_links`, `lint_vault`  
**Log/Maintenance (3):** `log_event`, `log_query`, `regenerate_index`

## Relationship to semantic-pages

- **Substrate** (retrieval, graph, MCP tools): inherited unchanged from semantic-pages.
- **Upstream remote** tracks semantic-pages for cherry-picking substrate fixes. Push is disabled; sidekick does not push back.
- **What's net-new in sidekick**: activation hooks, mode-routing skills, capture workflows (ingest/synthesize), lint suite, provenance + schema layer.

## Architecture (five layers)

1. **Substrate** — markdown vault + hybrid search + graph + MCP (inherited)
2. **Structure** — schema, provenance frontmatter, atomic `apply_patch`, structured log
3. **Workflows** — `ingest_source`, `synthesize_note`, lint suite
4. **Activation** — SessionStart / UserPromptSubmit / Stop hooks, `vault-first` skill, CLAUDE.md rules
5. **Routing** — mode skills (research / default / outage), signal weighting, transition capture

See the originating design discussion in `.planning/semantic-sidekick/` for rationale and phase-by-phase build plan.

## Privacy and secrets

Everything stays on your machine (local embedding model, no network telemetry). Since v1.5.3 every write masks API keys, tokens, passwords and private keys before they reach disk, and `lint_vault({ checks: ["secrets"] })` finds ones already in notes. Details and limits: [SECURITY.md](SECURITY.md#secret-redaction-v153).

## Development

```bash
npm install
npm run build
node dist/cli/index.js --version
```

## License

MIT
