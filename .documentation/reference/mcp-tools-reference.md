---
title: MCP Tools Reference (44 tools)
tier: reference
domains: [reference]
audience: [developers]
tags: [mcp, tools, api, reference, tools-catalog]
status: active
last_updated: '2026-07-11'
version: '1.5.0'
purpose: All 44 MCP tools by category with args, use-when/skip-when guidance. Includes v1.1+ contract + session tools, the v1.1 deprecation shims, the v1.3 confidence-decay verify_note tool, the v1.3.1 decay_candidates lint check, the v1.4.0 manage_lexicon tool, and the v1.5.0 manage_dossier + manage_profile tools plus the usage-feedback usage block and decoys lint check.
load_priority: 9
---

# MCP tools reference

> 44 tools served by the `semantic-memory` MCP server over stdio (write mode); 21 in `--read-only` mode (`verify_note`, `manage_lexicon`, `manage_dossier`, and `manage_profile` are write-gated, so read-only mode is unchanged at 21). When the plugin is installed and `.mcp.json` is wired, they appear in Claude's tool list as `mcp__semantic-vault__<name>` (the entry name in `.mcp.json` controls the prefix; `semantic-vault` is the convention).

Tools fall into 11 categories. Write tools are gated by the `--read-only` flag on the server; read tools are always available.

## Surface delta vs v0.x

This doc is current to v1.5.0. v0.x had 33 tools. v1.1.0 added 7:

- `regenerate_contract` + `inspect_contract` (Phase 3 — AGENTS.md)
- `synthesize_promote` (Phase 4 — proposal flow)
- `session_start` + `session_run` + `session_finish` + `session_status` (Phase 5)

v1.1.0 also marked 6 tools as deprecated; they remain callable through v1.x but will be removed in v2.0:

- `find_schema_violations` → use `lint_vault({checks: ["schema"]})`
- `find_missing_provenance` → use `lint_vault({checks: ["provenance"]})`
- `find_stale` → use `lint_vault({checks: ["stale"]})`
- `find_broken_links` → use `lint_vault({checks: ["broken_links"]})`
- `read_multiple_notes` → use `read_note` in a loop
- `rename_tag` → use `manage_tags({action: "rename", from, to})`

v1.3.0 added 1 tool: `verify_note` (confidence-decay Phase — resets a note's decay clock). No deprecations in v1.3.0.

v1.4.0 added 1 tool: `manage_lexicon` (resident-bridge Phase — the learned human→artifact lexicon). No deprecations in v1.4.0. v1.4.0 also extended three existing tools: `read_note` (new `section` param), `synthesize_note` (new `symptoms` param), and `lint_vault` (two new opt-in checks: `alias_conflicts`, alongside the existing `code_symbols`/`decay_candidates`).

v1.5.0 added 2 tools: `manage_dossier` (Phase 8 — entity dossiers: per-component living notes) and `manage_profile` (Phase 11 — the speaker profile). No deprecations in v1.5.0. v1.5.0 also extended `lint_vault` with one more opt-in check (`decoys`, alongside `code_symbols`/`decay_candidates`/`alias_conflicts`) and added a `usage` block to decay-affected search results (`search_semantic`/`search_hybrid`), the v1.5 usage-feedback ranking signal.

---

## Search (4) — always available

### `search_semantic`
Vector similarity search over chunk embeddings.
**Args:** `{ query, limit?=10, modifiedAfter?, modifiedBefore?, status?, tier?, domain? }`
**Use when:** conceptual/semantic queries ("authentication flows").
**Skip when:** looking for exact strings — prefer `search_text`.
**v1.3+ confidence decay:** results are down-weighted by time since `last_verified`. Decayed results carry a `decay: { multiplier, age_days, effective_half_life, reason }` block. See [configuration-reference.md](./configuration-reference.md#decay-vaultschemayml).
**v1.5+ usage-feedback ranking:** results cited (via `read_note`) after a prior search earn a bounded rank boost (composes multiplicatively with decay + path_class + load_priority). Boosted results carry a `usage: { citations, multiplier }` block. See [configuration-reference.md](./configuration-reference.md#usage_boost-vaultschemayml).

### `search_text`
BM25-ish keyword search over full note content.
**Args:** `{ pattern, regex?=false, caseSensitive?=false, pathGlob?, tagFilter?, limit?=20, modifiedAfter?, modifiedBefore?, status?, tier?, domain? }`
**Use when:** exact strings, regex patterns, or identifier searches.

### `search_graph`
Wikilink + `related_docs` traversal around a concept.
**Args:** `{ concept, maxDepth?=2, limit?=20 }`
**Use when:** "what's connected to this?" questions; end-to-end topic mapping.

### `search_hybrid` ⭐
Semantic + graph rerank. **The default for most queries.**
**Args:** `{ query, limit?=10, [date/status/tier/domain filters] }`
**Notes:** SessionStart vault-context hook calls this.
**v1.3+ confidence decay:** same decay down-weighting and `decay` block as `search_semantic`. `search_text`/`search_graph` are unaffected — decay only applies to the two ranked/semantic tools.
**v1.5+ usage-feedback ranking:** same `usage` block and boost behavior as `search_semantic`, applied at the same shared rank site.

## Read (3)

### `read_note`
**Args:** `{ path, section? }`. Returns full markdown content by default.
**v1.4+ `section`:** when a heading name is given, returns only that heading's section (content through the next same-or-higher heading) instead of the whole note — a token-saver for targeted reads.

### `read_multiple_notes` 🚫 deprecated (v2.0 removal)
**Args:** `{ paths: string[] }`. Batch fetch.
**Migration:** call `read_note` in a loop, or batch via MCP-level batching.

### `list_notes`
**Args:** `{ modifiedAfter?, modifiedBefore?, status?, tier?, domain? }`. Returns path + title + metadata + link counts.

## Write (4) — read-only disables these

### `create_note`
**Args:** `{ path, content, frontmatter? }`. Single-note creation with auto-stamps.

### `update_note`
**Args:** `{ path, content, mode: "overwrite"|"append"|"prepend"|"patch-by-heading", heading? }`. **Gotcha:** `overwrite` discards existing frontmatter.

### `delete_note`
**Args:** `{ path, confirm }`. `confirm: true` required to actually delete.

### `move_note`
**Args:** `{ from, to }`. Updates wikilinks across the vault.

## Patch / Synthesis (9) — Phase 2/3 + v1.1 + v1.3 + v1.4 + v1.5 additions

### `apply_patch` ⭐
Atomic multi-note ChangeSet with rollback.
**Args:**
```ts
{
  creates?: [{ path, content, frontmatter? }],
  updates?: [{ path, content, mode, heading? }],
  deletes?: [{ path }],
  moves?:   [{ from, to }],
  dry_run?=false,
  validate?=true,
  allow_lint_warnings?=true
}
```
**Returns:** `{ ok, applied, rolledBack, lint, errors, indexes_regenerated }`.
**Side effect:** auto-regens `INDEX.md` in affected directories. Auto-logs `kind=error` on failure. **v1.1+:** records touched paths to active session.notes_touched.

### `synthesize_note` ⭐
Turn an answer + sources into a filed note with provenance.
**Args:** `{ topic, answer, suggested_path, type?="note", sources?, derived_from?, related_notes?, status?="active", confidence?="medium", decision_maker?, decided_on?, severity?, symptoms?, dry_run?=false, proposal?=false, proposal_subdir? }`
**v1.1+ proposal mode:** when `proposal: true`, writes to `<proposal_subdir>/<YYYY-MM-DD>-<slug>.md` (default subdir `proposals/`) with `status: proposal` and `proposed_target` frontmatter recording the canonical destination. Use `synthesize_promote` to later move to canonical.
**v1.4+ `symptoms`:** `symptoms?: string[]` — verbatim symptom phrases, stored as `symptoms:` frontmatter and symptom-keyed at index time (each phrase indexed as its own chunk) so terse symptom-shaped queries match the note even when the note's prose doesn't use those exact words. See [frontmatter-spec.md](./frontmatter-spec.md).
**Side effect:** `kind=synthesis` entry on success, `kind=error` on failure.

### `synthesize_promote` 🆕 v1.1+
Move a reviewed proposal note to its canonical destination.
**Args:** `{ proposal_path, target_path?, dry_run?=false }`
**Behavior:** reads the proposal's frontmatter (must have `status: proposal`); strips proposal markers; restores `status: active`; atomically creates target + deletes proposal in one rollback-capable patch. `target_path` overrides the proposal's recorded `proposed_target`.
**Refuses when:** the proposal note doesn't have `status: proposal` frontmatter (defensive — only proposal-flagged notes are eligible).
**See:** [contract-guide.md / proposal flow](../operational/contract-guide.md), [sessions-guide.md](../operational/sessions-guide.md)

### `ingest_source`
Source + extracted units → atomic ingest.
**Args:** `{ source: {source_uri, source_title, source_type?, source_path?, source_summary?, source_tags?}, units: [{ path, content, title?, type?, extra_derived_from?, extra_frontmatter?, confidence? }], dry_run?=false, auto_apply?=true }`
**Side effect:** `kind=ingest` entry on success.

### `install_schema`
Writes default `vault.schema.yml` to the vault root.
**Args:** `{ force?=false }`.

### `verify_note` 🆕 v1.3+
Stamp a note as freshly re-confirmed, resetting its confidence-decay clock.
**Args:** `{ path: string }`
**Behavior:** stamps the note's `last_verified` frontmatter to today's date (`YYYY-MM-DD`) without touching content or any other frontmatter field. Logs a `verify` event to `log.md`.
**Returns:** `{ path, last_verified, decay_multiplier }`.
**Use when:** you've just re-confirmed a note is still true and want it to rank fresh again in `search_semantic`/`search_hybrid`.
**See:** [configuration-reference.md](./configuration-reference.md#decay-vaultschemayml).

### `manage_lexicon` 🆕 v1.4+
Manage the learned human→artifact lexicon — the alias mapping from human phrases to canonical vault/code targets.
**Args:** `{ action: "add"|"lookup"|"list"|"remove"|"compile", canonical?, phrases?: string[], query?, source?: "learned"|"authored" }`
**Behavior by action:**
- `add` — upserts a canonical target + human phrases; re-adding an existing canonical/phrase pair bumps `evidence_count` instead of duplicating.
- `lookup` — expands a `query` by matching it against stored alias phrases, returning the canonical target(s) it resolves to.
- `list` — lists all lexicon entries.
- `remove` — removes an entry by `canonical`.
- `compile` — rebuilds `.claude/.semantic-memory/lexicon-cache.json` from the vault's `alias`-type notes.
**Side effect:** writes/updates notes under `<vault>/lexicon/` (the `alias` note type). See [frontmatter-spec.md](./frontmatter-spec.md) for the `alias` type's fields.
**See:** [configuration-reference.md](./configuration-reference.md), [cli-reference.md](./cli-reference.md) for the equivalent `lexicon` CLI subcommand group.

### `manage_dossier` 🆕 v1.5+
Manage entity dossiers — per-component living notes that organize memory by entity instead of by file.
**Args:** `{ action: "init"|"append_incident"|"set_state"|"get"|"list", entity?, aliases?: string[], purpose?, seeded_from?, incident?, state? }`
**Behavior by action:**
- `init` — scaffolds a dossier for `entity` with the fixed Purpose / Failure modes / Knobs & commands / Incident log / Current state sections. No-op (returns the existing entry) if a dossier already exists for that entity or one of its aliases. `aliases`/`purpose`/`seeded_from` are init-only seed values.
- `append_incident` — appends a dated line to the Incident log (accretion, never a new note). Requires `entity` + `incident`. Refuses if no dossier exists yet for that entity.
- `set_state` — replaces the Current state section body. Requires `entity` + `state`. Refuses if no dossier exists yet.
- `get` — reads a dossier by entity name, alias, or path.
- `list` — recompiles the dossier cache and lists all dossiers with entity/aliases/current state.
**Side effect:** writes/updates notes under `<vault>/dossiers/` (the `dossier` note type); recompiles `.claude/.semantic-memory/dossier-cache.json` on every write. `init`/`append_incident`/`set_state` record touched paths to the active session.
**See:** [dossiers-guide.md](../operational/dossiers-guide.md), [frontmatter-spec.md](./frontmatter-spec.md) for the `dossier` type's fields.

### `manage_profile` 🆕 v1.5+
Manage the speaker profile — the model of how THIS human communicates.
**Args:** `{ action: "init"|"get"|"update_section", section?, text?, mode?: "append"|"replace" }`
**Behavior by action:**
- `init` — scaffolds `profile/speaker.md` with the fixed Severity calibration / Chronic omissions / Verbosity preference / Shorthand & terms sections. No-op if it already exists.
- `get` — reads the profile, returning its placeholder-stripped injection head alongside the full content.
- `update_section` — appends a line (`mode: "append"`, default) or replaces the whole body (`mode: "replace"`) of `section`. Requires `section` + `text`. Scaffolds the note first if absent.
**Use when:** the user corrects an interpretation ("no, when I say X I mean Y") — route the correction here instead of `synthesize_note`.
**Side effect:** writes `<vault>/profile/speaker.md` (singleton — one human, one profile). Records touched paths to the active session.
**See:** [session-paging-guide.md](../operational/session-paging-guide.md), [frontmatter-spec.md](./frontmatter-spec.md) for the `profile` type's fields.

## Lint (5)

### `lint_vault` ⭐
Run lint rules across the vault. Default returns the full report.
**Args:** `{ pathGlob?, checks? }`
**v1.1+ checks filter:** when `checks: ["schema"|"provenance"|"stale"|"broken_links"][]` is provided, only the requested rules are returned in `byRule` and `findings`. Subsumes the four `find_*` tools below.
**Returns:** `{ findings, byRule, counts, schemaPath }`.

**Opt-in checks — never included in the default (no-`checks`) report:**

- **`code_symbols`** (v1.2.3+) — flags inline-code file-path references in note content that no longer exist under the project root. Catches doc drift after refactors/renames. No-op outside a code repo. See [v1-2-3-hygiene-completion.md](../changelog/v1-2-3-hygiene-completion.md).
- **`decay_candidates`** (v1.3.1+) — cross-references the selection log (`.claude/.semantic-memory/selection.jsonl`) against each note's current decay multiplier, flagging notes retrieved frequently but decayed to ≤0.5 (e.g. "retrieved 7× recently but decayed to 0.42 — verify_note or revise"). Index-free — no embedder call. No-op when there's no selection log yet (fresh vault, or `telemetry.enabled: false`). Findings sorted most-retrieved first. See [v1-3-1-telemetry.md](../changelog/v1-3-1-telemetry.md), [configuration-reference.md](./configuration-reference.md#telemetry-vaultschemayml).
- **`alias_conflicts`** (v1.4+) — flags a lexicon phrase that maps to more than one canonical target (ambiguous alias). Reads the same `alias`-type notes / lexicon cache that `manage_lexicon` manages. Never included in the default report — always opt-in.
- **`decoys`** (v1.5+) — flags notes retrieved 3+ times (per the selection log) that were NEVER subsequently cited (`read_note`'d). Surfaced for human review only — usage-feedback ranking never auto-down-ranks on this ambiguous signal (a decoy might be noise, or a note the answers were wrong to skip). No-op with no selection log yet. Findings sorted most-retrieved first. See [v1-5-0-expert-character.md](../changelog/v1-5-0-expert-character.md), [usage-feedback-guide.md](../operational/usage-feedback-guide.md).
- **`secrets`** (v1.5.3+) — flags notes that already contain a secret: an API key or token (vendor prefixes like `sk-`, `ghp_`, `AKIA`, `npm_`), a JWT, a private key, `user:pass@` URL credentials, a secret-named `name=value` pair, or the exact value of a secret-named env var on this machine. Each finding is an **error** reading `line N: <kind> — rotate it…`: path, line and kind, never the value. Nothing is rewritten. Placeholders (`<your-key>`, `${API_TOKEN}`, `changeme`) are not flagged. Works on the read-only docs server. See [secret-redaction.md](../security/secret-redaction.md).

Request any of them via `checks: ["code_symbols"]` / `["decay_candidates"]` / `["alias_conflicts"]` / `["decoys"]` / `["secrets"]` (or combine with the standard four — the `checks` param's enum includes all nine: `schema`, `provenance`, `stale`, `broken_links`, `code_symbols`, `decay_candidates`, `alias_conflicts`, `decoys`, `secrets`).

**Write tools and redaction (v1.5.3+):** `create_note`, `update_note`, `update_frontmatter`, `apply_patch`, `synthesize_note`, `ingest_source`, `synthesize_promote`, `manage_dossier`, `manage_profile`, `manage_lexicon` and `log_event` mask secrets before writing. Text results end with `(N secrets redacted)`; JSON results carry `redacted: N` (per op in `apply_patch`'s `applied`). The values are never echoed.

### `find_schema_violations` 🚫 deprecated
**Migration:** `lint_vault({checks: ["schema"]})`

### `find_missing_provenance` 🚫 deprecated
**Migration:** `lint_vault({checks: ["provenance"]})`

### `find_stale` 🚫 deprecated
**Migration:** `lint_vault({checks: ["stale"]})`

### `find_broken_links` 🚫 deprecated
**Migration:** `lint_vault({checks: ["broken_links"]})`

All lint tools accept `{ pathGlob? }` to scope to a subset.

## Metadata (4)

### `get_frontmatter` — always available
`{ path }` — returns parsed YAML as JSON.

### `update_frontmatter` — read-only disables
`{ path, fields }` — set fields; `null` value deletes.

### `manage_tags` ⭐ — read-only disables
`{ path, action: "add"|"remove"|"list"|"rename", tags?, from?, to? }`.
**v1.1+ rename action:** when `action: "rename"`, requires `from` and `to` (no leading `#`); calls `tagManager.renameVaultWide`. `path` is ignored in rename mode.

### `rename_tag` 🚫 deprecated — read-only disables
**Migration:** `manage_tags({action: "rename", from, to})`

## Graph (4) — always available

### `backlinks` — `{ path, limit?=50 }` — notes that link TO this one.
### `forwardlinks` — `{ path, limit?=50 }` — notes this one links to.
### `graph_path` — `{ from, to }` — shortest path via wikilinks.
### `graph_statistics` — `{}` — most-connected nodes, orphans, density.

## Log / Maintenance (3)

### `log_event` — always available
Append to `log.md`.
**Args:** `{ kind, summary, payload? }`.
**Common kinds:** `ingest`, `synthesis`, `error`, `mode_change`, `decision`, `incident`, `session`, `verify`, `migration`.

### `log_query` — always available
Read + filter entries.
**Args:** `{ kind?, after?, before?, limit? }`.

### `regenerate_index` — read-only disables
Force `INDEX.md` regen.
**Args:** either `{ directory }` (single dir) or `{ paths: string[] }` (dedupe to affected dirs).

## System (2) — always available

### `get_stats`
Vault + index stats: note count, chunks, embedding dims, graph density, model, indexedAt, state (ready/stale/indexing/empty).

### `reindex` — actually a write op but no readOnly gate (rebuilds derived state)
Force full reindex. Blocks until ready.

## Contract (2) — 🆕 v1.1+ — read-only disables both

### `regenerate_contract`
Generate or refresh `<projectRoot>/AGENTS.md` with the managed-block contract.
**Args:** `{ projectRoot?, force?=false }`
**Behavior:** preserves Local Notes tail outside the markers. Refuses to overwrite hand-edits inside the managed block unless `force: true`. When AGENTS.md exists without managed-block markers, refuses with a clear error pointing to the recovery options.
**Returns:** `{ path, written, hand_edit_detected?, preserved_local_notes_chars?, reason? }`.
**See:** [contract-guide.md](../operational/contract-guide.md)

### `inspect_contract`
Read-only inspection of AGENTS.md state.
**Args:** `{ projectRoot? }`
**Returns:** `{ path, exists, has_managed_block, local_notes_chars }`.

## Session (4) — 🆕 v1.1+ — read-only disables all four

### `session_start`
Open a verification-gated session.
**Args:** `{ task: string }`
**Behavior:** refuses if a session is already open with a different task. Same-task call returns existing id (idempotent reentry).
**Returns:** `{ ok: true, id, reused? }` or `{ ok: false, error }`.
**State:** writes `<project>/.claude/.semantic-memory/session.json`.

### `session_run`
Run a verification command inside the active session, capturing exit/duration/tail.
**Args:** `{ cmd: string, timeout_ms?=300000 }`
**Behavior:** spawns the command via shell. Captures up to ~4KB of stdout+stderr tail. Records to `session.verifications`. Refuses without an active session.
**Returns:** `{ ok: true, record: { cmd, exit, signal, duration_ms, tail, at } }`.

### `session_finish` ⭐
Close the active session.
**Args:** `{ summary: string, verified?=true, reason? }`
**HARD GATE:** refuses without recorded verifications unless `verified: false` AND non-empty `reason`.
**Behavior:** removes `session.json` on success. Logs `kind: session` event with the closing summary.
**Returns:** `{ ok: true, closed: <full SessionState> }` or `{ ok: false, error }`.
**See:** [sessions-guide.md](../operational/sessions-guide.md)

### `session_status`
Read-only inspection of the active session.
**Args:** `{}`
**Returns:** `SessionState & { state: "active" | "stale" | "no_session" }`. The `state` label reports `stale` when `last_activity_at` is >24h old.

---

## Idiom: read before you write

Every tool that writes (create/update/delete/move/apply_patch/synthesize/ingest/promote) has a corresponding read or dry-run path. The canonical pattern:

1. **Read** — `search_hybrid` + `read_note` to verify what's there.
2. **Dry-run** — `apply_patch({..., dry_run: true})` or `synthesize_note({..., dry_run: true})` to preview. Returns the proposed lint findings without writing.
3. **Apply** — same call with `dry_run: false`.
4. **Verify** — `log_query({ kind: "error", limit: 5 })` to confirm nothing failed quietly.

## Idiom: cite what you read

Every tool that returns notes also returns `path`. Always include the paths in your response to the user. The `vault-first` skill enforces this as a hard contract.

## Idiom: session-bracketed work

For multi-step work that ends in verification:

1. `session_start({task})`
2. ... `read_note`, `apply_patch`, `synthesize_note` (auto-records to `session.notes_touched`) ...
3. `session_run({cmd: "npm test"})`, `session_run({cmd: "npm run lint"})`
4. `session_finish({summary})` — hard-gated; refuses without verifications unless explicit waiver
