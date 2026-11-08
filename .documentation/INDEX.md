---
title: Documentation Index
tier: reference
domains: [root]
status: active
last_updated: '2026-11-08'
version: '1.0.0'
generated: true
purpose: Navigation hub for all documentation
---

# Documentation Index

> Complete listing of all documentation organized by domain.

## Overview

| Domain | Documents | Description |
|--------|-----------|-------------|
| [Agents](#agents) | 0 | Expert agent documentation, specialty matrix |
| [API](#api) | 0 | API endpoints, routes, specifications, contracts |
| [Architecture](#architecture) | 8 | System design, AI coach, project registry, patterns |
| [Backups](#backups) | 0 | Backup/restore guides, disaster recovery |
| [Database](#database) | 0 | Schema, migrations, RLS, queries, procedures |
| [DevOps](#devops) | 0 | Deployment, CI/CD, Docker, environments, infrastructure |
| [Features](#features) | 0 | Feature implementation guides, admin docs |
| [Plans](#plans) | 0 | Planning documents, roadmaps, proposals |
| [Procedures](#procedures) | 0 | Step-by-step operational procedures (SOP) |
| [Quickstart](#quickstart) | 2 | Setup guides, dev workflow, onboarding |
| [Security](#security) | 1 | Security, auth, Vault, Keycloak, RLS |
| [Standards](#standards) | 0 | Coding standards (backend, frontend, database, devops, security) |
| [Testing](#testing) | 1 | Test strategies, fixtures, patterns, integration/e2e |
| [Troubleshooting](#troubleshooting) | 1 | Debug guides, common issues, solutions |
| [Workflows](#workflows) | 0 | Process documentation, multi-step operations |
| [Changelog](#changelog) | 31 | Release notes per version and phase |
| [Operational](#operational) | 18 | Day-to-day operating guides for the plugin |
| [Reference](#reference) | 7 | Tool, CLI, configuration and frontmatter reference |
| [Legacy](#legacy) | 5 | Pre-rebrand substrate docs, kept for history |
| [Deployment](#deployment) | 1 | Publishing and offline packaging |

---

## Agents

> Expert agent documentation, specialty matrix

**Path:** `agents/`

*No documents yet.*

---

## API

> API endpoints, routes, specifications, contracts

**Path:** `api/`

*No documents yet.*

---

## Architecture

> System design, AI coach, project registry, patterns

**Path:** `architecture/`

| Document | Tier | Status | Updated | Purpose |
|----------|------|--------|----------|---------|
| [Architecture — the Five Layers](architecture/architecture-layers.md) | reference | active | 2026-10-25 | Each of the 5 layers with responsibilities, key files, contracts, gotchas, plus the opt-in v1.7 skill loop layer and the Jev bridge |
| [Code graph - code nodes, grounding and entity cards](architecture/code-graph.md) | reference | active | 2026-11-08 | How semantic-memory puts code into the graph (v1.16.0, issue 58) - the hit-em-with-the-docs graph export it reads, the fallback from code spans, the grounding penalty, entity cards and undocumented names. |
| [Indices and storage — every file semantic-memory writes](architecture/indices-and-storage.md) | reference | active | 2026-10-25 | Comprehensive map of every file and directory semantic-memory creates on disk. Use for backup planning, gitignore decisions, disk-usage forensics, and v2.0 migration prep. |
| [Injection Points](architecture/injection-points.md) | reference | active | 2026-10-28 | Every place semantic-sidekick touches Claude's context — symptom→check table |
| [MCP server internals — composition, context, per-domain tool modules](architecture/mcp-internals.md) | reference | active | 2026-10-24 | How the MCP server is structured internally — composition root, shared context, per-domain tool modules. Read this if you're adding a new MCP tool or debugging tool registration. |
| [Schema and Provenance](architecture/schema-and-provenance.md) | reference | active | 2026-04-23 | vault.schema.yml, 4 types, lint rules, provenance frontmatter |
| [v1 stack overview — what v1.0 / v1.1 / v1.2 added](architecture/v1-stack-overview.md) | reference | active | 2026-10-24 | Single doc covering everything v1.0 / v1.1 / v1.2 added on top of the v0.x five-layer substrate. Read this BEFORE the per-version changelog entries; it's the architectural narrative, they're the bullet lists. |
| [What gets indexed where and why](architecture/what-gets-indexed.md) | reference | active | 2026-05-09 | Content-perspective view of the index pipeline. For each kind of content semantic-memory sees, what it does with it and which tools query the result. Read this if you wonder "is this file indexed?" or "why isn't my note showing up in search?" |

---

## Backups

> Backup/restore guides, disaster recovery

**Path:** `backups/`

*No documents yet.*

---

## Database

> Schema, migrations, RLS, queries, procedures

**Path:** `database/`

*No documents yet.*

---

## DevOps

> Deployment, CI/CD, Docker, environments, infrastructure

**Path:** `devops/`

*No documents yet.*

---

## Features

> Feature implementation guides, admin docs

**Path:** `features/`

*No documents yet.*

---

## Plans

> Planning documents, roadmaps, proposals

**Path:** `plans/`

*No documents yet.*

---

## Procedures

> Step-by-step operational procedures (SOP)

**Path:** `procedures/`

*No documents yet.*

---

## Quickstart

> Setup guides, dev workflow, onboarding

**Path:** `quickstart/`

| Document | Tier | Status | Updated | Purpose |
|----------|------|--------|----------|---------|
| [Installation Guide](quickstart/installation-guide.md) | guide | active | 2026-10-28 | Three install routes (plugin / npm / dev), what a fresh install gets, updating, post-install housekeeping, uninstall |
| [semantic-sidekick — Overview](quickstart/sidekick-overview.md) | guide | active | 2026-10-24 | Value proposition, five-layer summary, firing timeline, design principles |

---

## Security

> Security, auth, Vault, Keycloak, RLS

**Path:** `security/`

| Document | Tier | Status | Updated | Purpose |
|----------|------|--------|----------|---------|
| [Secret redaction — design, write points, and how to add a pattern](security/secret-redaction.md) | reference | active | 2026-10-25 | How semantic-memory keeps API keys, tokens and passwords off disk: the redactor (src/core/redact.ts), its precise and broad pattern sets, every write point it covers, the lint_vault secrets check, its limits, and how to add a pattern safely. |

---

## Standards

> Coding standards (backend, frontend, database, devops, security)

**Path:** `standards/`

*No documents yet.*

---

## Testing

> Test strategies, fixtures, patterns, integration/e2e

**Path:** `testing/`

| Document | Tier | Status | Updated | Purpose |
|----------|------|--------|----------|---------|
| [Tests and Validation](testing/tests-and-validation.md) | guide | active | 2026-04-23 | Test layout, per-file coverage, Phase 1 activation suite, fresh-install validation |

---

## Troubleshooting

> Debug guides, common issues, solutions

**Path:** `troubleshooting/`

| Document | Tier | Status | Updated | Purpose |
|----------|------|--------|----------|---------|
| [Troubleshooting](troubleshooting/troubleshooting.md) | guide | active | 2026-10-28 | Symptom / cause / fix across all 5 layers + v1.x additions (sessions, AGENTS.md, drift, state migration). Each entry has a symptom, a likely cause, and a specific diagnostic command. |

---

## Workflows

> Process documentation, multi-step operations

**Path:** `workflows/`

*No documents yet.*

---

## Changelog

> Release notes per version and phase

**Path:** `changelog/`

| Document | Tier | Status | Updated | Purpose |
|----------|------|--------|----------|---------|
| [Phase 1 — Activation Layer](changelog/phase-1-activation.md) | reference | active | 2026-04-23 | What the Phase 1 activation layer shipped: hooks, vault-first skill, CLAUDE.md rule |
| [Phase 2 — Structure + Capture](changelog/phase-2-structure.md) | reference | active | 2026-04-23 | Schema, apply_patch, synthesize_note, lint, Stop capture, parsed-doc cache |
| [Phase 3 — Ingest + Maintenance](changelog/phase-3-ingest.md) | reference | active | 2026-04-23 | ingest_source, structured log.md, hierarchical index auto-regen, broken-link lint |
| [Phase 4 — Routing + Transitions](changelog/phase-4-routing.md) | reference | active | 2026-04-23 | research-mode + outage-silence skills, /mode, /vault, mode-aware hooks, transition capture |
| [v1.0 — Rebrand to semantic-memory](changelog/v1-0-rebrand.md) | reference | active | 2026-05-09 | What v1.0.0 actually changed. Public-facing rename; internal wiring partly left for v1.1.1 to clean up. Storage paths preserved. |
| [v1.1 — brain-absorption](changelog/v1-1-brain-absorption.md) | reference | active | 2026-05-09 | What v1.1.0 added (brain-absorption — AGENTS.md, sessions, skill bundler, drift detection) and what v1.1.1 fixed (the rebrand wiring v1.0 left half-finished). |
| [v1.10.0 — retrieval-ready fields](changelog/v1-10-0-retrieval-fields.md) | reference | active | 2026-11-07 | What v1.10.0 changed so the frontmatter fields authors write to be found are searchable (issues 44 and 45), with measured before/after per split and tier, and the targets that were missed. |
| [v1.11.0 — graph boost removed, decay age fallback, stale marker](changelog/v1-11-0-boost-decay-fallback.md) | reference | active | 2026-11-07 | What v1.11.0 changed (issues 48 and 49) with measured before/after per split, the decay default change and how to opt out, and the targets that were missed. |
| [v1.12.0 — code stays in the indexed text, pooling and query prompt from the model config, git decay by body change](changelog/v1-12-0-index-text-pooling-body-dates.md) | reference | active | 2026-11-07 | What v1.12.0 changed (issues 51 to 54) with measured before/after per split, the one-time re-embed on upgrade, the body-date decay rule, measured model results, and the targets that were missed. |
| [v1.13.0 - built-in retrieval eval](changelog/v1-13-0-builtin-eval.md) | reference | active | 2026-11-07 | What v1.13.0 changed (issue 56), the measured acceptance results, and the targets that were missed. |
| [v1.14.0 - identifier abstention](changelog/v1-14-0-identifier-abstention.md) | reference | active | 2026-11-07 | What v1.14.0 changed (issue 57), the measured acceptance results, and the targets that were missed. |
| [v1.15.0 - usage capture and search gaps](changelog/v1-15-0-usage-capture-gaps.md) | reference | active | 2026-11-07 | What v1.15.0 changed (issue 59, plan A), the measured acceptance results, and the targets that were missed. |
| [v1.16.0 - code graph](changelog/v1-16-0-code-graph.md) | reference | active | 2026-11-08 | What v1.16.0 changed (issue 58), the measured results on the code-graph fixture, and the targets that were missed. |
| [v1.17.0 - section results](changelog/v1-17-0-section-results.md) | reference | active | 2026-11-08 | What v1.17.0 changed (issue 60), the measured results on the section fixture, and the targets that were missed. |
| [v1.18.0 - query routing](changelog/v1-18-0-query-routing.md) | reference | active | 2026-11-08 | What v1.18.0 changed (issue 61), the measured results against v1.17.0, and the targets that were missed. |
| [v1.2.3 — hygiene line completed (--fix, code_symbols, CI smoke)](changelog/v1-2-3-hygiene-completion.md) | reference | active | 2026-07-10 | What v1.2.3 added — the three v1.2 roadmap items that slipped past 1.2.0/1.2.1/1.2.2 (healthcheck --fix, code_symbols lint, fresh-install CI smoke). |
| [v1.2 — state consolidation under .claude/.semantic-memory/](changelog/v1-2-state-consolidation.md) | reference | active | 2026-05-09 | What v1.2.0 changed — three transient state files moved from .claude/.sidekick-* to .claude/.semantic-memory/. Read-with-fallback through v1.x. |
| [v1.3.1 — selection-logging telemetry](changelog/v1-3-1-telemetry.md) | reference | active | 2026-07-10 | What v1.3.1 added — local, opt-out selection-logging telemetry that observes retrieval and citation, a decay_candidates lint that cross-references it against decay state, and a selection-stats CLI. Precursor to v1.4 usage-feedback ranking. |
| [v1.3 — confidence decay (age-aware retrieval ranking)](changelog/v1-3-confidence-decay.md) | reference | active | 2026-07-10 | What v1.3.0 added — smooth, type-aware confidence decay that down-weights stale notes in search ranking, verify_note to reset the clock, evergreen opt-out, and decay CLI introspection. |
| [v1.4.0 — resident-expert bridge (lexicon, symptom capture, query expansion)](changelog/v1-4-0-resident-bridge.md) | reference | active | 2026-07-10 | What v1.4.0 added — a golden eval harness, archive path-class down-weighting, injection hygiene for the vault-context block, a learned human-to-artifact lexicon with propose-and-confirm capture, verbatim symptom capture, two-tier query expansion, and a token-frugal tool surface. Tool count 41→42 (manage_lexicon). |
| [v1.5.0 — the expert-character layer (dossiers, usage-feedback ranking, session paging, speaker profile)](changelog/v1-5-0-expert-character.md) | reference | active | 2026-07-11 | What v1.5.0 added — entity dossiers with two-hop retrieval and lexicon-alias fold-in, usage-feedback ranking that consumes the v1.3.1 selection log plus a decoys lint, Stop/SessionStart session paging (digest-as-proposal), and a speaker profile learned via correction cues. Tool count 42→44 (manage_dossier, manage_profile). |
| [v1.5.2 — docs index freshness (issue](changelog/v1-5-2-docs-index-freshness.md) | reference | active | 2026-10-24 | What v1.5.2 fixed: stale cached index rebuilt at startup, watcher working under chokidar 5, one bad doc no longer failing the whole index, hooks searching every semantic-* notes path, capture-pending kept per session, and the dependency audit. |
| [v1.5.3 — secret redaction](changelog/v1-5-3-secret-redaction.md) | reference | active | 2026-10-24 | What v1.5.3 added: secrets masked at every write point (precise set for notes, broad set for logs and state), the opt-in lint_vault secrets check, and the NoteCrud return-shape change. |
| [v1.6.0 — failure-time fact lookup (opt-in) and the failure eval](changelog/v1-6-0-failure-lookup.md) | reference | active | 2026-10-24 | What v1.6.0 shipped from the issue #29 proposal: an opt-in PostToolUseFailure fact lookup, the eval-failures command and failureQuery normalizer, what the measurement on 553 real failures showed, and what was deferred. |
| [v1.6.1 — release audit of 1.5.2 → 1.6.0](changelog/v1-6-1-release-audit.md) | reference | active | 2026-10-24 | What the full validation of 1.5.2, 1.5.3 and 1.6.0 found through the published packages and real entry points, the seven defects 1.6.1 fixes, and what was checked and left as it is. |
| [v1.7.0 — the skill loop and jev mode](changelog/v1-7-0-skill-loop-and-jev-mode.md) | reference | active | 2026-10-25 | What 1.7.0 adds (two opt-in features), what was decided while building it and why, how it was validated, and what the measurements showed. |
| [v1.7.1 — skill loop queue fixes](changelog/v1-7-1-skill-loop-queue-fixes.md) | reference | active | 2026-10-28 | The three skill-loop queue bugs that the first days of real use showed, how each was fixed, and how the fixes were validated. |
| [v1.7.2 — sessions use the indexed docs](changelog/v1-7-2-vault-context-sources.md) | reference | active | 2026-10-28 | Why sessions rarely used semantic-memory's indexed docs, the three fixes (prompt hook sources, the doc-search redirect, server instructions with an always-loaded search tool), and how they were measured. |
| [v1.8.0 — skill loop auto mode, dedup, and retiring old entries](changelog/v1-8-0-skill-loop-auto.md) | reference | active | 2026-11-03 | What 1.8.0 adds to the skill loop (the reviewer judges existing skills too, rejects duplicates, retires dead entries and whole skills, applies its own changes in opt-in auto mode, and only suggests changes to hand-written skills), the slot race it fixes, and how it was validated. |
| [v1.9.0 — retrieval and graph quality, index freshness](changelog/v1-9-0-retrieval-graph-quality.md) | reference | active | 2026-11-06 | What v1.9.0 changed in search ranking, the link graph and index freshness, with the measured before/after tables. |
| [v1.9.1 — ranking regression fix](changelog/v1-9-1-ranking-regression.md) | reference | active | 2026-11-06 | What v1.9.1 fixed after issue 43 (hybrid worse than semantic at @1), with measured before/after tables per split and the targets that were missed. |

---

## Operational

> Day-to-day operating guides for the plugin

**Path:** `operational/`

| Document | Tier | Status | Updated | Purpose |
|----------|------|--------|----------|---------|
| [Capture Workflows](operational/capture-workflows.md) | guide | active | 2026-10-24 | synthesize_note, ingest_source, Stop-hook capture, /mode transitions — golden path |
| [AGENTS.md contract guide](operational/contract-guide.md) | guide | active | 2026-05-09 | Operational guide to the AGENTS.md contract artifact. When to generate it, what it contains, how managed blocks work, what stays vs. regenerates, and how it interacts with CLAUDE.md. |
| [Confidence Decay — Operating Guide](operational/decay-guide.md) | guide | active | 2026-07-10 | How to operate confidence decay day to day — read decay state, re-verify notes, tune half-lives, mark evergreen, and disable it. |
| [Entity Dossiers — Operating Guide](operational/dossiers-guide.md) | guide | active | 2026-07-11 | How to operate v1.5.0 entity dossiers day to day — create them, accrete incidents and current state in place, understand two-hop retrieval, feed the lexicon via aliases, seed from babel-fish, and troubleshoot resolution misses. |
| [Drift detection — SessionStart auto-check + /healthcheck deep audit](operational/drift-detection.md) | guide | active | 2026-10-28 | Operational guide to drift detection. The fast-tier auto-check that fires on every SessionStart, the manual /healthcheck deep audit, what each finding means, and how to fix them. |
| [Failure-time fact lookup — enabling it, writing findable facts, measuring it](operational/failure-lookup-guide.md) | guide | active | 2026-10-25 | How to turn on the opt-in PostToolUseFailure fact lookup, what it injects and when, how to write gotcha facts it can find (symptoms with the literal error), how it coexists with other failure hooks, and how to measure it on your own failures with eval-failures. |
| [Jev mode — closed-set decisions through jev-loop](operational/jev-mode.md) | guide | active | 2026-10-25 | What jev mode does, what it needs, what is sent to TypeSafe and how, what it costs, the measured judge agreement and failure-hook results, the skill-loop questions it answers, and how to turn it off. |
| [Lexicon & Query Expansion — Operating Guide](operational/lexicon-guide.md) | guide | active | 2026-07-10 | How to operate the v1.4.0 human-to-LLM bridge day to day — add and inspect lexicon aliases, resolve alias_conflicts, capture verbatim symptoms, and understand Tier-1/Tier-2 query expansion. |
| [Logs and Events (log.md)](operational/logs-and-events.md) | reference | active | 2026-04-23 | log.md format, auto-kinds, state-delta preload, future-Claude usage |
| [Modes Guide](operational/modes-guide.md) | guide | active | 2026-10-28 | vault-first / research / outage-silence entry signals, behavior, misroute recovery |
| [Retrieval Eval Guide](operational/retrieval-eval-guide.md) | guide | active | 2026-11-07 | How to measure retrieval on your own vault with semantic-memory eval - question sets, generated questions, floors, the noise band, all versus clean. |
| [Retrieval Tuning Guide](operational/retrieval-tuning-guide.md) | guide | active | 2026-11-07 | How search_hybrid ranks, how frontmatter fields are indexed, what confidence and no_strong_match mean, which knobs exist (index_fields, ranking, path_class.exclude, graph.exclude_hubs, rerank), what lost, and how to run and extend the retrieval eval. |
| [Search gaps - reading gaps and handing it to hewtd](operational/search-gaps-guide.md) | guide | active | 2026-11-07 | How do I find the questions my docs failed to answer, read the gaps report, and hand it to `hewtd reconcile --gaps`? |
| [Session Paging & Speaker Profile — Operating Guide](operational/session-paging-guide.md) | guide | active | 2026-07-11 | How to operate v1.5.0 session paging (Stop digest-as-proposal, SessionStart curated digest) and the speaker profile (init, sections, correction-cue updates, injection) — the session-lifecycle pair. |
| [Sessions guide — verification-gated work units](operational/sessions-guide.md) | guide | active | 2026-05-09 | Operational guide to the v1.1 session loop. When to open a session, how to run verification commands, how `session_finish`'s hard gate works, what session_state contains, and how the Stop hook surfaces open sessions. |
| [The skill loop — learned skills between sessions](operational/skill-loop.md) | guide | active | 2026-11-03 | What the skill loop does, how to turn it on and off, how drafts are made, deduplicated, scoped, reviewed, landed, evaluated and retired, what auto mode applies by itself, how hand-written skills get suggestions, what the background reviewer can and cannot touch, what it costs, and what turning it off leaves behind. |
| [State migration — moving legacy .sidekick-* files to .semantic-memory/](operational/state-migration.md) | guide | active | 2026-10-24 | Operational guide for v1.2's state-file consolidation. What's moving, when to run migrate-state, what conflicts mean, and what's deferred to v2.0. |
| [Usage-Feedback Ranking & Decoys — Operating Guide](operational/usage-feedback-guide.md) | guide | active | 2026-07-11 | How to operate v1.5.0 usage-feedback ranking day to day — how citations become a bounded rank boost, how it composes with decay and path-class, reading the usage block, running the decoys lint, and disabling the feature. |

---

## Reference

> Tool, CLI, configuration and frontmatter reference

**Path:** `reference/`

| Document | Tier | Status | Updated | Purpose |
|----------|------|--------|----------|---------|
| [CLI Reference](reference/cli-reference.md) | reference | active | 2026-10-25 | Every semantic-memory subcommand + flags + env vars + exit codes. Covers v1.1 skills tree, v1.2 migrate-state, v1.3 confidence-decay (healthcheck --fix, decay-config, decay-trace), v1.3.1 selection-stats telemetry introspection, the v1.4.0 lexicon subcommand group, the v1.5.0 dossier + profile subcommand groups, and the v1.7.0 skill-loop, jev-mode, skills lint and skill-eval commands. |
| [Configuration Reference](reference/configuration-reference.md) | reference | active | 2026-11-07 | Every config file, env var, schema field, and tunable. Includes v1.2 .gitignore additions, v1.1+ runtime state files, the v1.3 decay schema block, the v1.3.1 telemetry block, the v1.4.0 path_class + tools.conditional schema blocks, the SEMANTIC_MEMORY_INJECT_MIN_SCORE env var, the lexicon-cache.json state file, the v1.5.0 usage_boost schema block + dossier-cache.json state file, the v1.5.2 per-session capture-pending format and multi-path hook discovery, the v1.6 failure-hook env vars and failure-shown.json, the v1.7 skill-loop and jev-mode env vars, repo config file and state files, and the v1.7.2 server-name rule, doc-search redirect switch and doc-search-redirect.json. |
| [Frontmatter spec — every field, what it does, who reads it](reference/frontmatter-spec.md) | reference | active | 2026-10-24 | Authoritative field-by-field spec for note frontmatter. Covers every field the indexer / lint / search tools read, what types they expect, what defaults apply, and which tools surface them. Includes the v1.4.0 symptoms field and alias note type, plus the v1.5.0 entity/aliases fields and the dossier + profile note types, how invalid YAML is handled (v1.5.2/v1.6.1), and the measured effect of symptoms on failure lookup (v1.6). |
| [gaps.v1 export - what semantic-memory fills](reference/gaps-format.md) | reference | active | 2026-11-07 | How does `semantic-memory gaps --json` fill hewtd's gaps.v1 format, and how are used_doc, clustering, redaction and dropped queries decided? |
| [Hooks Reference](reference/hooks-reference.md) | reference | active | 2026-10-25 | SessionStart / UserPromptSubmit / Stop / PostToolUseFailure / PostToolUse (Skill) / SessionEnd hook contracts + state files (current to v1.7.0) |
| [MCP Tools Reference (44 tools)](reference/mcp-tools-reference.md) | reference | active | 2026-11-07 | All 44 MCP tools by category with args, use-when/skip-when guidance. Includes v1.1+ contract + session tools, the v1.1 deprecation shims, the v1.3 confidence-decay verify_note tool, the v1.3.1 decay_candidates lint check, the v1.4.0 manage_lexicon tool, and the v1.5.0 manage_dossier + manage_profile tools plus the usage-feedback usage block and decoys lint check, the v1.7 opt-in `skills` lint check, and the v1.7.2 server instructions and always-loaded `search_hybrid`. |
| [Learned skill format — the skill_loop frontmatter block and its lint rules](reference/skill-format.md) | reference | active | 2026-11-03 | The contract every skill the skill loop writes follows — frontmatter fields, body sections, what stays out of the file — and every rule `skills lint` and `lint_vault({checks:["skills"]})` enforce. |

---

## Legacy

> Pre-rebrand substrate docs, kept for history

**Path:** `legacy/`

| Document | Tier | Status | Updated | Purpose |
|----------|------|--------|----------|---------|
| [Legacy Changelog (semantic-pages)](legacy/changelog.md) | reference | active | 2026-04-23 | semantic-pages version history prior to the fork |
| [Embedder Guide (substrate)](legacy/embedder-guide.md) | reference | active | 2026-10-24 | ONNX embedder options, model choices, quality/speed tradeoffs |
| [Frontmatter Guide (substrate)](legacy/frontmatter-guide.md) | reference | active | 2026-10-24 | Indexer-consumed frontmatter fields (title, tags, load_priority, etc.) |
| [How Semantic Pages Works (substrate)](legacy/how-it-works.md) | reference | active | 2026-04-23 | Substrate-level: MCP server startup, indexer, embedder internals |
| [Performance Tuning (substrate)](legacy/performance-tuning.md) | guide | active | 2026-04-23 | ONNX workers, batch size, quantization tradeoffs |

---

## Deployment

> Publishing and offline packaging

**Path:** `deployment/`

| Document | Tier | Status | Updated | Purpose |
|----------|------|--------|----------|---------|
| [Release Process](deployment/release-process.md) | guide | active | 2026-10-24 | How a semantic-memory release goes out — version fields, PR, npm publish, the plugin marketplace, the offline tarball, and the checks after each |

---

## Maintenance

- **Last generated:** 2026-11-08
- **Run maintenance:** `npx hit-em-with-the-docs maintain`
- **Regenerate index:** `npx hit-em-with-the-docs index`
