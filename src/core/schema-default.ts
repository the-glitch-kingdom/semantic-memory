// Default vault schema shipped with semantic-sidekick.
// Intentionally minimal — the plan is to grow from pain, not preempt it.
// Users can override with a vault.schema.yml at the vault root.

export const DEFAULT_SCHEMA_YAML = `# semantic-sidekick vault schema (minimal starter).
# Override by placing a vault.schema.yml at the vault root.

version: 1

# Provenance fields — apply to all types, enforced by lint.find_missing_provenance.
# sources:         URLs or filesystem paths the note was derived from
# derived_from:    wikilinks to other notes this one synthesizes
# last_verified:   ISO date this note was last confirmed true (YYYY-MM-DD).
#                  Set at creation and by verify_note; NOT bumped on ordinary edits.
#                  Drives confidence decay (see the decay: block below).
# evergreen:       true → the note is pinned against decay while last_verified is
#                  within 365 days; after that it decays normally (re-affirm to reset).
# status:          one of: draft | active | stale | deprecated | archived
# confidence:      one of: high | medium | low
provenance_fields:
  - sources
  - derived_from
  - last_verified
  - status
  - confidence

# Allowed status values (enforced by schema_violations lint).
status_enum: [draft, active, stale, deprecated, archived]
confidence_enum: [high, medium, low]

# Note types. Each type declares its required frontmatter.
# Any field not listed as required is allowed but not enforced.
types:
  note:
    description: Generic note — default type when \`type\` frontmatter is absent
    required: [title, status]

  decision:
    description: Architectural or process decision with dated rationale
    required: [title, status, decided_on, decision_maker]

  gotcha:
    description: Compressed lesson from a past incident/bug/surprise
    required: [title, status, last_verified, severity]

  source:
    description: External reference (paper, blog post, doc) used as provenance
    required: [title, status, source]

  alias:
    description: Learned human→artifact vocabulary entry (v1.4 lexicon). Maps the human's phrasing to a concrete path/symbol.
    required: [canonical]

  dossier:
    description: Entity-centric living note (v1.5). One per critical component — purpose, failure modes, knobs, incident log, current state. Accretes in place.
    required: [title, status, entity]

  profile:
    description: Speaker profile (v1.5). Models how THIS human communicates — severity calibration, chronic omissions, verbosity, shorthand. One human, one profile.
    required: [title, status]

# Severity values for gotcha type.
severity_enum: [low, medium, high, critical]

# Lint policy. Each rule has a default severity that pre-commit/CI consumes.
lint:
  missing_provenance:
    # Triggers when a note type in this list has no sources AND no derived_from.
    applies_to: [note, decision, gotcha]
    severity: warn
  stale:
    # Triggers when last_verified is older than this many days (0 = disabled).
    max_age_days: 180
    severity: warn
  schema_violations:
    # Triggers on missing required fields, unknown type, or enum mismatch.
    severity: error

# Confidence decay (v1.3). Down-weights search results by time since last_verified.
# Composes multiplicatively with load_priority — it never removes notes, only ranks
# them lower (floored). Set enabled: false for byte-identical pre-v1.3 ranking.
decay:
  enabled: true
  default_half_life_days: 365   # multiplier = 0.5 ^ (age_days / half_life)
  per_type:
    decision: 365
    note: 365
    gotcha: 180
    source: null                # null = never decays
    proposal: 14
  floor: 0.1                     # notes never drop below this multiplier
  hotness_boost:
    enabled: false              # extend half-life for heavily-backlinked notes (opt-in)
    cap: 2.0

# Path-class ranking (v1.4). Down-weights whole regions of the vault by path glob
# (composes multiplicatively with decay + load_priority). First matching rule wins.
# The default down-weights archived notes so retired docs stop dominating results,
# and "exclude" drops them from search results entirely (set exclude: [] to keep them,
# down-weighted). Globs match with dot: true, so .documentation/archive/ is covered.
path_class:
  enabled: true
  rules:
    - glob: "**/archive/**"
      multiplier: 0.3
  exclude:
    - "**/archive/**"

# Index and search results (v1.9.1). path_class.exclude docs are not indexed: they are graph nodes
# only (frontmatter and links, no chunks, vectors or BM25), so "supersedes" edges still resolve.
# results.exclude docs are indexed and linked but never returned by a search.
results:
  exclude:
    - "**/INDEX.md"
    - "**/REGISTRY.md"
    - "**/reports/link-check-*.md"

# Knowledge graph (v1.9). Generated hub files link to everything, which makes every
# note a neighbour of every other: they are left out of the graph.
graph:
  exclude_hubs:
    - "**/INDEX.md"
    - "**/REGISTRY.md"

# Frontmatter fields authors write to be found (v1.10). "lexical" fields join the text every BM25 chunk
# of a note is also indexed under; "vector" fields become extra metadata chunks (the first of purpose /
# summary / description a note has, plus every symptom phrase). Object-form symptoms are read from
# symptom_keys (error_pattern is regex text: BM25 only). A note's vector score is max(best body cosine,
# meta_weight x best metadata cosine). Notes with "generated: true" are never indexed or returned.
index_fields:
  lexical: [title, purpose, summary, description, keywords, tags, symptoms]
  vector: [purpose, summary, description, symptoms]
  symptom_keys: [user_phrase, error_pattern, alert_name]
  meta_weight: 0.8

# Whole-doc coverage and link prior on the fused search_hybrid candidates (v1.10), applied after fusion:
# score *= 1 + coverage_weight * (idf-weighted share of the query's terms found anywhere in the note), and
# score *= link_prior for a note with >= link_prior_min_links outgoing links. Off by default: on the train
# splits neither gained an answer (retrieval tuning guide). Try coverage_weight 0.3 / link_prior 1.1 and measure.
ranking:
  coverage_weight: 0
  link_prior: 1
  link_prior_min_links: 5

# Cross-encoder rerank of the top 30 fused search_hybrid results (v1.9). Off by default: it
# adds ~0.7 s per search on CPU and the model (~90 MB) downloads on first use. See the
# retrieval-tuning guide for the measured trade-off. Falls back to the fused order if the model is unavailable.
rerank:
  enabled: false
  model: "Xenova/ms-marco-MiniLM-L-6-v2"

# Usage-feedback ranking (v1.5). Boosts notes that get CITED after retrieval (per
# the local selection log) so load-bearing knowledge floats up. Bounded by cap to
# stop a feedback runaway; composes multiplicatively with decay + path_class +
# load_priority. A no-op until the selection log has citations. The complementary
# signal (retrieved-but-never-cited "decoys") is surfaced by lint_vault, NEVER
# auto-down-ranked. Set enabled: false for byte-identical pre-v1.5 ranking.
usage_boost:
  enabled: true
  cap: 1.5            # max multiplier a note can earn from citations
  per_citation: 0.1   # multiplier += per_citation × citation_count, then capped

# Token-frugal tool surface (v1.4). When enabled, the server registers a reduced
# tool set in modes that don't need the full surface (outage-silence → search/read
# only). DEFAULT OFF — mid-session mode switches don't re-register, so opt in and
# dogfood before relying on it.
tools:
  conditional: false

# Selection-logging telemetry (v1.3.1). Records what search returned and which
# note the answer used, to a LOCAL append-only JSONL at
# .claude/.semantic-memory/selection.jsonl (gitignored). Never leaves the machine.
# Feeds the decay_candidates lint and (later) usage-feedback ranking. Set
# enabled: false to disable all logging.
telemetry:
  enabled: true
`;
