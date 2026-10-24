---
generated_by: semantic-memory
version: 1.5.2
last_generated: 2026-07-12T03:42:15.529Z
---

# Project Agent Contract
<!-- semantic-memory:begin contract -->

## Active Modes

- **vault-first** (default) — Project-scoped prose questions trigger vault consultation with cite-or-deflect.
- **research** — Every source introduced is filed via ingest_source; mandatory synthesize_note on exit.
- **outage-silence** — No proactive vault search. Terse responses. Postmortem synthesize_note on exit.

## Required Workflow

1. For multi-step work that needs verification, open a session: `session_start({task})`.
2. Use mode-aware retrieval: `search_hybrid`, `read_note`, `list_notes`, `backlinks`/`forwardlinks`.
3. Make durable updates via `apply_patch` or `synthesize_note` — never bypass the patch layer for multi-note edits.
4. Run verification commands inside a session: `session_run({cmd})`.
5. Close with `session_finish({summary})` — refused without verification unless explicitly waived.
6. Lint regularly: `lint_vault({checks: ['schema','provenance','stale','broken_links']})`.

## Tool Surface

- `search_semantic` — Vector similarity search — find notes similar to a query by meaning.
- `search_text` — Full-text keyword or regex search across all notes with optional filters.
- `search_graph` — Graph traversal — find notes connected to a concept via wikilinks, related_docs, and tags.
- `search_hybrid` — Combined semantic + graph search — vector results re-ranked by graph proximity and load_priority.
- `read_note` — Read the full content of a specific note by path.
- `list_notes` — List all indexed notes with metadata.
- `create_note` — Create a new markdown note.
- `update_note` — Edit note content — overwrite, append, prepend, or patch by heading.
- `delete_note` — Delete a note permanently.
- `move_note` — Move or rename a note — updates wikilinks across the vault.
- `apply_patch` — Atomic multi-note patch with rollback.
- `synthesize_note` — Turn a researched answer + sources into a new filed note with provenance frontmatter. Pass proposal:true for review-first workflows.
- `synthesize_promote` — Move a reviewed proposal note to its canonical destination, stripping proposal markers.
- `ingest_source` — Build + apply a ChangeSet that ingests a source and the notes extracted from it.
- `install_schema` — Bootstrap vault.schema.yml in the vault root with the default schema.
- `verify_note` — Stamp last_verified to today (content unchanged) to reset the confidence-decay clock; logs a verify event.
- `manage_lexicon` — Manage the learned human→artifact lexicon (add/lookup/list/remove/compile aliases).
- `manage_dossier` — Manage entity dossiers — per-component living notes (init/append_incident/set_state/get/list). Knowledge accretes in place.
- `manage_profile` — Manage the speaker profile — how this human communicates (init/get/update_section).
- `lint_vault` — Run lint rules across the vault. Pass `checks` to filter to specific rules.
- `log_event` — Append a structured event to the vault's log.md.
- `log_query` — Read structured log entries filtered by kind and/or date range.
- `regenerate_index` — Force regeneration of INDEX.md for one or more directories.
- `get_frontmatter` — Read parsed YAML frontmatter from a note as JSON.
- `update_frontmatter` — Set or delete YAML frontmatter keys.
- `manage_tags` — Add, remove, list, or rename tags on a note.
- `backlinks` — Find all notes that link TO a given note.
- `forwardlinks` — Find all notes linked FROM a given note.
- `graph_path` — Find the shortest path between two notes in the knowledge graph.
- `graph_statistics` — Knowledge graph stats — most connected nodes, orphans, density.
- `get_stats` — Vault and index statistics.
- `reindex` — Force a full reindex of the vault.
- `regenerate_contract` — Generate or refresh AGENTS.md at the project root with a managed-block contract.
- `inspect_contract` — Read-only inspection of AGENTS.md state.
- `session_start` — Open a verification-gated session for a multi-step task.
- `session_run` — Run a verification command inside the active session, capture exit and tail.
- `session_finish` — Close the active session — hard-gated on verifications unless explicitly waived.
- `session_status` — Read-only inspection of the active session.

### Deprecated (removed in v2.0.0)

- `read_multiple_notes` — Batch read multiple notes in one call.
- `find_schema_violations` — Scan for schema violations.
- `find_missing_provenance` — Scan for notes lacking sources/derived_from.
- `find_stale` — Scan for notes whose last_verified is older than the threshold.
- `find_broken_links` — Scan for [[wikilinks]] pointing to non-existent notes.
- `rename_tag` — Rename a tag across all notes.

## Memory Policy

- Markdown is canonical. The vault under `.claude/.vault/` (or wherever `--notes` points) is the source of truth.
- Indexes (vector / graph / FTS) are derived state — rebuildable via `reindex` without losing knowledge.
- Provenance frontmatter is required for `note`/`decision`/`gotcha` types — `sources` (external) or `derived_from` (internal).
- Mode router lives at `.claude/.semantic-memory/mode` (legacy `.claude/.sidekick-mode` still readable through v1.x); explicit `/mode` is ground truth.

<!-- semantic-memory:end contract -->

## Local Notes

_User-authored content lives here. Preserved across `regenerate_contract` runs._
