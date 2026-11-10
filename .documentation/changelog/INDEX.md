---
title: Changelog Documentation Index
tier: reference
domains: [changelog]
status: active
last_updated: '2026-11-10'
version: '1.0.0'
generated: true
purpose: Complete listing of changelog documentation
---

# Changelog Documentation

> Release notes per version and phase

## Overview

- **Total Documents:** 41
- **Domain:** `changelog/`
- **Category:** development
- **Load Priority:** 5/10

## Documents

### References

| Document | Status | Updated | Words | Purpose |
|----------|--------|---------|-------|---------|
| [Phase 1 — Activation Layer](phase-1-activation.md) | active | 2026-04-23 | 1,084 | What the Phase 1 activation layer shipped: hooks, vault-first skill, CLAUDE.md rule |
| [Phase 2 — Structure + Capture](phase-2-structure.md) | active | 2026-04-23 | 1,431 | Schema, apply_patch, synthesize_note, lint, Stop capture, parsed-doc cache |
| [Phase 3 — Ingest + Maintenance](phase-3-ingest.md) | active | 2026-04-23 | 1,092 | ingest_source, structured log.md, hierarchical index auto-regen, broken-link lint |
| [Phase 4 — Routing + Transitions](phase-4-routing.md) | active | 2026-04-23 | 1,208 | research-mode + outage-silence skills, /mode, /vault, mode-aware hooks, transition capture |
| [v1.0 — Rebrand to semantic-memory](v1-0-rebrand.md) | active | 2026-05-09 | 510 | What v1.0.0 actually changed. Public-facing rename; internal wiring partly left for v1.1.1 to clean up. Storage paths preserved. |
| [v1.1 — brain-absorption](v1-1-brain-absorption.md) | active | 2026-05-09 | 862 | What v1.1.0 added (brain-absorption — AGENTS.md, sessions, skill bundler, drift detection) and what v1.1.1 fixed (the rebrand wiring v1.0 left half-finished). |
| [v1.10.0 — retrieval-ready fields](v1-10-0-retrieval-fields.md) | active | 2026-11-07 | 772 | What v1.10.0 changed so the frontmatter fields authors write to be found are searchable (issues 44 and 45), with measured before/after per split and tier, and the targets that were missed. |
| [v1.11.0 — graph boost removed, decay age fallback, stale marker](v1-11-0-boost-decay-fallback.md) | active | 2026-11-07 | 633 | What v1.11.0 changed (issues 48 and 49) with measured before/after per split, the decay default change and how to opt out, and the targets that were missed. |
| [v1.12.0 — code stays in the indexed text, pooling and query prompt from the model config, git decay by body change](v1-12-0-index-text-pooling-body-dates.md) | active | 2026-11-07 | 1,047 | What v1.12.0 changed (issues 51 to 54) with measured before/after per split, the one-time re-embed on upgrade, the body-date decay rule, measured model results, and the targets that were missed. |
| [v1.13.0 - built-in retrieval eval](v1-13-0-builtin-eval.md) | active | 2026-11-07 | 276 | What v1.13.0 changed (issue 56), the measured acceptance results, and the targets that were missed. |
| [v1.14.0 - identifier abstention](v1-14-0-identifier-abstention.md) | active | 2026-11-07 | 386 | What v1.14.0 changed (issue 57), the measured acceptance results, and the targets that were missed. |
| [v1.15.0 - usage capture and search gaps](v1-15-0-usage-capture-gaps.md) | active | 2026-11-07 | 291 | What v1.15.0 changed (issue 59, plan A), the measured acceptance results, and the targets that were missed. |
| [v1.16.0 - code graph](v1-16-0-code-graph.md) | active | 2026-11-08 | 200 | What v1.16.0 changed (issue 58), the measured results on the code-graph fixture, and the targets that were missed. |
| [v1.17.0 - section results](v1-17-0-section-results.md) | active | 2026-11-08 | 568 | What v1.17.0 changed (issue 60), the measured results on the section fixture, and the targets that were missed. |
| [v1.18.0 - query routing](v1-18-0-query-routing.md) | active | 2026-11-08 | 525 | What v1.18.0 changed (issue 61), the measured results against v1.17.0, and the targets that were missed. |
| [v1.19.0 - federated search](v1-19-0-federated-search.md) | active | 2026-11-08 | 300 | What v1.19.0 changed (issue 62), the measured results, and the targets that were missed. |
| [v1.2.3 — hygiene line completed (--fix, code_symbols, CI smoke)](v1-2-3-hygiene-completion.md) | active | 2026-07-10 | 613 | What v1.2.3 added — the three v1.2 roadmap items that slipped past 1.2.0/1.2.1/1.2.2 (healthcheck --fix, code_symbols lint, fresh-install CI smoke). |
| [v1.2 — state consolidation under .claude/.semantic-memory/](v1-2-state-consolidation.md) | active | 2026-05-09 | 671 | What v1.2.0 changed — three transient state files moved from .claude/.sidekick-* to .claude/.semantic-memory/. Read-with-fallback through v1.x. |
| [v1.20.0 - user help](v1-20-0-user-help.md) | active | 2026-11-08 | 200 | What v1.20.0 changed (the help command, tool and slash command, and search --paths), what was verified, and what is still open. |
| [v1.21.0 - hub doc ranking](v1-21-0-hub-doc-ranking.md) | active | 2026-11-08 | 467 | What v1.21.0 changed for issue |
| [v1.22.0 - MCP metadata gap and long sections](v1-22-0-mcp-metadata-gap-long-sections.md) | active | 2026-11-09 | 461 | What v1.22.0 changed for issue |
| [v1.23.0 - abstention for product and tool names](v1-23-0-abstention-product-names.md) | active | 2026-11-09 | 583 | What v1.23.0 changed (issue 74), the measured results against 1.15.0 and 1.22.0, the false flags, and the targets that were missed. |
| [v1.24.0 - multi-doc recall measurement](v1-24-0-multi-doc-recall.md) | active | 2026-11-09 | 507 | What v1.24.0 changed (issue 76), the same-run numbers against 1.15.0, 1.22.0 and 1.23.0, the changes tried and withdrawn, and the targets missed. |
| [v1.25.0 - abstention counts searchable docs and spelling variants](v1-25-0-abstention-variants.md) | active | 2026-11-09 | 370 | What v1.25.0 changed (issue 78), the same-run flag numbers against 1.23.0 and 1.24.0, and the targets that could not be measured. |
| [v1.25.1 - semantic-first skill refresh](v1-25-1-semantic-first-refresh.md) | active | 2026-11-09 | 255 | What v1.25.1 changed (issue 81), what the tests now pin, and the trigger check that could not be measured. |
| [v1.26.0 - default server names](v1-26-0-default-server-names.md) | active | 2026-11-09 | 229 | What v1.26.0 changed about the server names written to .mcp.json, why existing projects need no action, and how to rename an old pair by hand. |
| [v1.27.0 - limit-stable ranking](v1-27-0-limit-stable-ranking.md) | active | 2026-11-09 | 421 | What v1.27.0 changed about ranking and limit, why two builds now rank the same, and the measured effect of exact search against 1.26.0. |
| [v1.3.1 — selection-logging telemetry](v1-3-1-telemetry.md) | active | 2026-07-10 | 653 | What v1.3.1 added — local, opt-out selection-logging telemetry that observes retrieval and citation, a decay_candidates lint that cross-references it against decay state, and a selection-stats CLI. Precursor to v1.4 usage-feedback ranking. |
| [v1.3 — confidence decay (age-aware retrieval ranking)](v1-3-confidence-decay.md) | active | 2026-07-10 | 753 | What v1.3.0 added — smooth, type-aware confidence decay that down-weights stale notes in search ranking, verify_note to reset the clock, evergreen opt-out, and decay CLI introspection. |
| [v1.4.0 — resident-expert bridge (lexicon, symptom capture, query expansion)](v1-4-0-resident-bridge.md) | active | 2026-07-10 | 961 | What v1.4.0 added — a golden eval harness, archive path-class down-weighting, injection hygiene for the vault-context block, a learned human-to-artifact lexicon with propose-and-confirm capture, verbatim symptom capture, two-tier query expansion, and a token-frugal tool surface. Tool count 41→42 (manage_lexicon). |
| [v1.5.0 — the expert-character layer (dossiers, usage-feedback ranking, session paging, speaker profile)](v1-5-0-expert-character.md) | active | 2026-07-11 | 2,127 | What v1.5.0 added — entity dossiers with two-hop retrieval and lexicon-alias fold-in, usage-feedback ranking that consumes the v1.3.1 selection log plus a decoys lint, Stop/SessionStart session paging (digest-as-proposal), and a speaker profile learned via correction cues. Tool count 42→44 (manage_dossier, manage_profile). |
| [v1.5.2 — docs index freshness (issue](v1-5-2-docs-index-freshness.md) | active | 2026-10-24 | 521 | What v1.5.2 fixed: stale cached index rebuilt at startup, watcher working under chokidar 5, one bad doc no longer failing the whole index, hooks searching every semantic-* notes path, capture-pending kept per session, and the dependency audit. |
| [v1.5.3 — secret redaction](v1-5-3-secret-redaction.md) | active | 2026-10-24 | 366 | What v1.5.3 added: secrets masked at every write point (precise set for notes, broad set for logs and state), the opt-in lint_vault secrets check, and the NoteCrud return-shape change. |
| [v1.6.0 — failure-time fact lookup (opt-in) and the failure eval](v1-6-0-failure-lookup.md) | active | 2026-10-24 | 387 | What v1.6.0 shipped from the issue #29 proposal: an opt-in PostToolUseFailure fact lookup, the eval-failures command and failureQuery normalizer, what the measurement on 553 real failures showed, and what was deferred. |
| [v1.6.1 — release audit of 1.5.2 → 1.6.0](v1-6-1-release-audit.md) | active | 2026-10-24 | 717 | What the full validation of 1.5.2, 1.5.3 and 1.6.0 found through the published packages and real entry points, the seven defects 1.6.1 fixes, and what was checked and left as it is. |
| [v1.7.0 — the skill loop and jev mode](v1-7-0-skill-loop-and-jev-mode.md) | active | 2026-10-25 | 691 | What 1.7.0 adds (two opt-in features), what was decided while building it and why, how it was validated, and what the measurements showed. |
| [v1.7.1 — skill loop queue fixes](v1-7-1-skill-loop-queue-fixes.md) | active | 2026-10-28 | 317 | The three skill-loop queue bugs that the first days of real use showed, how each was fixed, and how the fixes were validated. |
| [v1.7.2 — sessions use the indexed docs](v1-7-2-vault-context-sources.md) | active | 2026-10-28 | 485 | Why sessions rarely used semantic-memory's indexed docs, the three fixes (prompt hook sources, the doc-search redirect, server instructions with an always-loaded search tool), and how they were measured. |
| [v1.8.0 — skill loop auto mode, dedup, and retiring old entries](v1-8-0-skill-loop-auto.md) | active | 2026-11-03 | 565 | What 1.8.0 adds to the skill loop (the reviewer judges existing skills too, rejects duplicates, retires dead entries and whole skills, applies its own changes in opt-in auto mode, and only suggests changes to hand-written skills), the slot race it fixes, and how it was validated. |
| [v1.9.0 — retrieval and graph quality, index freshness](v1-9-0-retrieval-graph-quality.md) | active | 2026-11-06 | 735 | What v1.9.0 changed in search ranking, the link graph and index freshness, with the measured before/after tables. |
| [v1.9.1 — ranking regression fix](v1-9-1-ranking-regression.md) | active | 2026-11-06 | 785 | What v1.9.1 fixed after issue 43 (hybrid worse than semantic at @1), with measured before/after tables per split and the targets that were missed. |

## Keywords

This domain covers: changelog, release, version, shipped

## Related Domains

- [Architecture](../architecture/) - System design, AI coach, project registry, patterns
- [Testing](../testing/) - Test strategies, fixtures, patterns, integration/e2e
- [Deployment](../deployment/) - Publishing and offline packaging

---

*Last updated: 2026-11-10*
