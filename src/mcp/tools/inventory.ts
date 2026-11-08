/**
 * Canonical inventory of MCP tools shipped by semantic-memory.
 *
 * This is the source of truth for tool naming, description, and deprecation
 * status. The AGENTS.md generator reads this list to render the Tool Surface
 * section. Phase 8 healthcheck cross-references this against the live MCP
 * server registration to detect drift.
 *
 * When you add or remove a tool registration in src/mcp/tools/*.ts, update
 * this list in the same commit. CI/Phase 8 will catch the drift.
 */

export interface ToolInventoryEntry {
  name: string;
  description: string;
  deprecated?: boolean;
  group: "search" | "read" | "write" | "patch" | "lint" | "log" | "metadata" | "graph" | "system" | "contract" | "session";
}

export const CURRENT_TOOL_INVENTORY: readonly ToolInventoryEntry[] = [
  // search
  { name: "search_semantic", description: "Vector similarity search — find notes similar to a query by meaning.", group: "search" },
  { name: "search_text", description: "Full-text keyword or regex search across all notes with optional filters.", group: "search" },
  { name: "search_graph", description: "Graph traversal — find notes connected to a concept via wikilinks, related_docs, and tags.", group: "search" },
  { name: "search_hybrid", description: "Combined semantic + lexical search — vector and BM25 scores fused, re-ranked by load_priority and decayed by age.", group: "search" },
  // read
  { name: "read_note", description: "Read the full content of a specific note by path.", group: "read" },
  { name: "read_multiple_notes", description: "Batch read multiple notes in one call.", group: "read", deprecated: true },
  { name: "list_notes", description: "List all indexed notes with metadata.", group: "read" },
  // write (CRUD)
  { name: "create_note", description: "Create a new markdown note.", group: "write" },
  { name: "update_note", description: "Edit note content — overwrite, append, prepend, or patch by heading.", group: "write" },
  { name: "delete_note", description: "Delete a note permanently.", group: "write" },
  { name: "move_note", description: "Move or rename a note — updates wikilinks across the vault.", group: "write" },
  // patch / synthesis
  { name: "apply_patch", description: "Atomic multi-note patch with rollback.", group: "patch" },
  { name: "synthesize_note", description: "Turn a researched answer + sources into a new filed note with provenance frontmatter. Pass proposal:true for review-first workflows.", group: "patch" },
  { name: "synthesize_promote", description: "Move a reviewed proposal note to its canonical destination, stripping proposal markers.", group: "patch" },
  { name: "ingest_source", description: "Build + apply a ChangeSet that ingests a source and the notes extracted from it.", group: "patch" },
  { name: "install_schema", description: "Bootstrap vault.schema.yml in the vault root with the default schema.", group: "patch" },
  { name: "verify_note", description: "Stamp last_verified to today (content unchanged) to reset the confidence-decay clock; logs a verify event.", group: "patch" },
  { name: "manage_lexicon", description: "Manage the learned human→artifact lexicon (add/lookup/list/remove/compile aliases).", group: "patch" },
  { name: "manage_dossier", description: "Manage entity dossiers — per-component living notes (init/append_incident/set_state/get/list). Knowledge accretes in place.", group: "patch" },
  { name: "manage_profile", description: "Manage the speaker profile — how this human communicates (init/get/update_section).", group: "patch" },
  // lint
  { name: "find_schema_violations", description: "Scan for schema violations.", group: "lint", deprecated: true },
  { name: "find_missing_provenance", description: "Scan for notes lacking sources/derived_from.", group: "lint", deprecated: true },
  { name: "find_stale", description: "Scan for notes whose last_verified is older than the threshold.", group: "lint", deprecated: true },
  { name: "find_broken_links", description: "Scan for [[wikilinks]] pointing to non-existent notes.", group: "lint", deprecated: true },
  { name: "lint_vault", description: "Run lint rules across the vault. Pass `checks` to filter to specific rules.", group: "lint" },
  // log
  { name: "log_event", description: "Append a structured event to the vault's log.md.", group: "log" },
  { name: "log_query", description: "Read structured log entries filtered by kind and/or date range.", group: "log" },
  { name: "regenerate_index", description: "Force regeneration of INDEX.md for one or more directories.", group: "log" },
  // metadata
  { name: "get_frontmatter", description: "Read parsed YAML frontmatter from a note as JSON.", group: "metadata" },
  { name: "update_frontmatter", description: "Set or delete YAML frontmatter keys.", group: "metadata" },
  { name: "manage_tags", description: "Add, remove, list, or rename tags on a note.", group: "metadata" },
  { name: "rename_tag", description: "Rename a tag across all notes.", group: "metadata", deprecated: true },
  // graph
  { name: "backlinks", description: "Find all notes that link TO a given note.", group: "graph" },
  { name: "forwardlinks", description: "Find all notes linked FROM a given note.", group: "graph" },
  { name: "graph_path", description: "Find the shortest path between two notes in the knowledge graph.", group: "graph" },
  { name: "graph_statistics", description: "Knowledge graph stats — most connected nodes, orphans, density.", group: "graph" },
  // system
  { name: "get_stats", description: "Vault and index statistics.", group: "system" },
  { name: "reindex", description: "Force a full reindex of the vault.", group: "system" },
  { name: "help", description: "How to use semantic-memory in task terms; no topic lists topics, a topic id or words returns steps and commands.", group: "system" },
  // contract (Phase 3)
  { name: "regenerate_contract", description: "Generate or refresh AGENTS.md at the project root with a managed-block contract.", group: "contract" },
  { name: "inspect_contract", description: "Read-only inspection of AGENTS.md state.", group: "contract" },
  // session (Phase 5)
  { name: "session_start", description: "Open a verification-gated session for a multi-step task.", group: "session" },
  { name: "session_run", description: "Run a verification command inside the active session, capture exit and tail.", group: "session" },
  { name: "session_finish", description: "Close the active session — hard-gated on verifications unless explicitly waived.", group: "session" },
  { name: "session_status", description: "Read-only inspection of the active session.", group: "session" },
];
