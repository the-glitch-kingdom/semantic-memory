# semantic-memory (formerly semantic-sidekick)

> A shelf is retrievable. A prosthesis is present.
> A vault is local. Memory is layered.

> **v1.0.0 rebrand** — `semantic-sidekick` → `semantic-memory`. The npm package, plugin name, MCP server name, and marketplace identity all change. **Internal storage layout (`.semantic-sidekick-index/`, `~/.semantic-sidekick/models/`) is preserved** — existing installs continue to read their indices and model caches without re-indexing or re-downloading. See [CHANGELOG.md](./CHANGELOG.md) for the full migration. The `bin/semantic-sidekick` command remains as an alias for `bin/semantic-memory` during the transition.

semantic-memory is the unified memory-layer plugin for Claude Code. **One MCP server, multiple typed corpora** (vault, code, plans, docs, research, project-map), a unified cross-corpus knowledge graph, conditional tool registration based on which corpora are active, in-process drift detection, and human↔code translation via the babel-fish glossary side-channel.

The original semantic-sidekick framing — activation / mode-routing / capture layer on top of [semantic-pages](https://github.com/TheGlitchKing/semantic-pages) — is preserved as the `vault` corpus's behavior. What's new in 1.0.0 is the multi-corpus architecture that absorbs documentation, code, plans, research, and babel-fish project-maps into the same MCP surface.

## Status

**v1.7.2** (2026-10-28), on npm as `@theglitchking/semantic-memory`. Per-version notes are in [CHANGELOG.md](./CHANGELOG.md) and `.documentation/changelog/`. Recent releases:

| Version | What it adds |
|---|---|
| **1.7.2** | Sessions use the indexed docs: the prompt hook searches any `semantic-*` server and skips notifications and archived docs, a grep of an indexed folder is redirected once to the MCP search, `search_hybrid` skips tool search |
| **1.7.1** | Skill-loop queue fixes: temp-directory sessions skipped, `claude` found from cron, resumed sessions re-reviewed |
| **1.7.0** | The skill loop (learned skills between sessions) and jev mode, both opt-in |
| **1.6.1** | Release-audit fixes: invalid frontmatter stays body-only on every reindex, frontmatter `api_key:` values are masked, `--read-only` servers no longer expose `log_event` |
| **1.6.0** | Opt-in fact lookup on failed commands (`PostToolUseFailure`), `eval-failures` |
| **1.5.3** | Secret redaction at every write point, `lint_vault({checks: ["secrets"]})` |
| **1.5.2** | Docs stay fresh: a stale cache is rebuilt at startup, the file watcher works, one bad doc no longer stops indexing, hooks search every `semantic-*` server, capture prompts per session |

## Quickstart as a Claude Code plugin

```bash
# Add the marketplace (from git)
/plugin marketplace add https://github.com/TheGlitchKing/semantic-memory

# Install the plugin
/plugin install semantic-memory@semantic-memory-marketplace
```

On install:
- `.mcp.json` is reconciled at every session start: `semantic-vault` points at `.claude/.vault`. When hit-em-with-the-docs is installed and `.documentation/` exists, `semantic-sidekick` serves that folder `--read-only`.
- Skills (`vault-first`, `research-mode`, `outage-silence`, `semantic-first`) and commands (`/mode`, `/vault`, `/healthcheck`, `/contract`, `/status`, `/update`, `/policy`, `/relink`, `/normalize-config`) become available.
- Hooks register from `hooks/hooks.json`: `SessionStart`, `UserPromptSubmit` and `Stop`, plus `PostToolUseFailure`, which does nothing unless `SEMANTIC_MEMORY_FAILURE_HOOK=1`, and `PreToolUse` (Grep, Bash), which redirects a grep of an indexed docs folder to the MCP search once (`SEMANTIC_MEMORY_DOC_SEARCH_REDIRECT=0` turns it off).

The first server start builds the vector index (`.semantic-sidekick-index/` in each notes folder). To build it ahead of time, run `semantic-memory --notes <folder> --reindex`. After that, the hooks read the cache in under a second, and a running server reindexes when a note changes.

Update an existing install with `claude plugin update semantic-memory@semantic-memory-marketplace` and restart Claude Code.

## Using the modes

| Command | Effect |
|---|---|
| `/mode research` | Enter research-mode. Every source introduced gets filed via `ingest_source`; mandatory `synthesize_note` on exit. Visible `[research]` prefix. |
| `/mode outage-silence` | Enter outage-silence. No proactive vault search. Terse responses. Postmortem drafted as `synthesize_note` on exit. Visible `[outage]` prefix. |
| `/mode vault-first` | Return to default. Project-scoped prose questions trigger vault consultation with cite-or-deflect. |
| `/mode status` | Print the current mode. |
| `/vault <query>` | Explicit vault query. Always works, even in outage-silence. |

## 44 MCP tools

Search (4): `search_semantic`, `search_text`, `search_graph`, `search_hybrid`
Read (3): `read_note`, `read_multiple_notes`, `list_notes`
Write (4): `create_note`, `update_note`, `delete_note`, `move_note`
Metadata (4): `get_frontmatter`, `update_frontmatter`, `manage_tags`, `rename_tag`
Graph (4): `backlinks`, `forwardlinks`, `graph_path`, `graph_statistics`
System (2): `get_stats`, `reindex`
Patch/Synthesis (9): `apply_patch`, `synthesize_note`, `synthesize_promote`, `ingest_source`, `install_schema`, `verify_note`, `manage_lexicon`, `manage_dossier`, `manage_profile`
Lint (5): `lint_vault`, plus the deprecated `find_schema_violations`, `find_missing_provenance`, `find_stale`, `find_broken_links`
Log/Maintenance (3): `log_event`, `log_query`, `regenerate_index`
Contract (2): `regenerate_contract`, `inspect_contract`
Sessions (4): `session_start`, `session_run`, `session_finish`, `session_status`

A `--read-only` server (the docs folder) exposes 20: search, read, graph, system, lint, `get_frontmatter` and `log_query`. Full reference: [.documentation/reference/mcp-tools-reference.md](.documentation/reference/mcp-tools-reference.md).

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

How the layers fit: [.documentation/architecture/architecture-layers.md](.documentation/architecture/architecture-layers.md).

## Fact lookup on failed commands (opt-in, v1.6+)

Set `SEMANTIC_MEMORY_FAILURE_HOOK=1` (e.g. in `~/.claude/settings.json` → `env`) and a failed Bash/MCP call gets the knowledge-base fact that most likely explains it, when one scores high enough. Measured on real failures it is right about 6 times in 10, so it is off by default. Facts with the literal error in `symptoms:` are found far more reliably (in a hit-em-with-the-docs tree, read the guide first: hewtd uses `symptoms:` for something else). If you already run another `PostToolUseFailure` hook, both can add a note to the same failure — see [the guide](.documentation/operational/failure-lookup-guide.md).

## The skill loop (opt-in, v1.7+)

`semantic-memory skill-loop on` (or `/skill-loop on`). After a session that failed a command and found the fix, or
was corrected, a background review drafts a skill — a short playbook Claude Code loads the next time the same
thing happens. The session never waits; the reviewer is a fenced, read-only `claude -p`; nothing lands until you
approve it in `/skill-loop review`; unused learned skills go stale at 14 days and are archived at 30. Off (the
default) changes nothing. See [the guide](.documentation/operational/skill-loop.md).

## Jev mode (opt-in, v1.7+)

`semantic-memory jev-mode on` (or `/jev-mode on`) lets semantic-memory use Jev, TypeSafe's yes/no model, through
[jev-loop](https://github.com/the-glitch-kingdom/jev-loop) for closed-set decisions — whether a fact fits a
failure before the failure hook shows it, whether a learned skill could be general, whether two skills are
duplicates. Needs jev-loop, `TYPESAFE_API_KEY` and python3. See [the guide](.documentation/operational/jev-mode.md).

## Privacy and secrets

Everything stays on your machine (local embedding model, no network telemetry). Since v1.5.3 every write masks API keys, tokens, passwords and private keys before they reach disk, and `lint_vault({ checks: ["secrets"] })` finds ones already in notes. Details and limits: [SECURITY.md](SECURITY.md#secret-redaction-v153).

## Development

```bash
npm install
npm run build
node dist/cli/index.js --version
```

## License

MIT. The skill-eval prompts in `src/core/skill-eval/prompts/` are adapted from Anthropic's skill-creator
(Apache License 2.0): see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and [LICENSES/Apache-2.0.txt](LICENSES/Apache-2.0.txt).
