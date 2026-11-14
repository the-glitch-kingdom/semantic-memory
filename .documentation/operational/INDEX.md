---
title: Operational Documentation Index
tier: reference
domains: [operational]
status: active
last_updated: '2026-11-14'
version: '1.0.0'
generated: true
purpose: Complete listing of operational documentation
---

# Operational Documentation

> Day-to-day operating guides for the plugin

## Overview

- **Total Documents:** 20
- **Domain:** `operational/`
- **Category:** features
- **Load Priority:** 6/10

## Documents

### Guides

| Document | Status | Updated | Words | Purpose |
|----------|--------|---------|-------|---------|
| [Capture Workflows](capture-workflows.md) | active | 2026-10-24 | 1,288 | synthesize_note, ingest_source, Stop-hook capture, /mode transitions — golden path |
| [AGENTS.md contract guide](contract-guide.md) | active | 2026-05-09 | 1,430 | Operational guide to the AGENTS.md contract artifact. When to generate it, what it contains, how managed blocks work, what stays vs. regenerates, and how it interacts with CLAUDE.md. |
| [Confidence Decay — Operating Guide](decay-guide.md) | active | 2026-11-10 | 1,118 | How to operate confidence decay day to day — read decay state, re-verify notes, tune half-lives, mark evergreen, and disable it. |
| [Entity Dossiers — Operating Guide](dossiers-guide.md) | active | 2026-07-11 | 1,114 | How to operate v1.5.0 entity dossiers day to day — create them, accrete incidents and current state in place, understand two-hop retrieval, feed the lexicon via aliases, seed from babel-fish, and troubleshoot resolution misses. |
| [Drift detection — SessionStart auto-check + /healthcheck deep audit](drift-detection.md) | active | 2026-10-28 | 1,605 | Operational guide to drift detection. The fast-tier auto-check that fires on every SessionStart, the manual /healthcheck deep audit, what each finding means, and how to fix them. |
| [Failure-time fact lookup — enabling it, writing findable facts, measuring it](failure-lookup-guide.md) | active | 2026-10-25 | 775 | How to turn on the opt-in PostToolUseFailure fact lookup, what it injects and when, how to write gotcha facts it can find (symptoms with the literal error), how it coexists with other failure hooks, and how to measure it on your own failures with eval-failures. |
| [Federation guide](federation-guide.md) | active | 2026-11-11 | 387 | How to search other vaults and sibling docs trees from one search_hybrid call, what it costs, and its limits. |
| [Jev mode — closed-set decisions through jev-loop](jev-mode.md) | active | 2026-10-25 | 728 | What jev mode does, what it needs, what is sent to TypeSafe and how, what it costs, the measured judge agreement and failure-hook results, the skill-loop questions it answers, and how to turn it off. |
| [Lexicon & Query Expansion — Operating Guide](lexicon-guide.md) | active | 2026-07-10 | 988 | How to operate the v1.4.0 human-to-LLM bridge day to day — add and inspect lexicon aliases, resolve alias_conflicts, capture verbatim symptoms, and understand Tier-1/Tier-2 query expansion. |
| [Long-term memory guide](long-term-memory-guide.md) | active | 2026-11-11 | 723 | How to search old docs generations (long-term memory) on request, what is never searched by default, how to rebuild a frozen generation, and what the session-start notice means. |
| [Modes Guide](modes-guide.md) | active | 2026-10-28 | 1,113 | vault-first / research / outage-silence entry signals, behavior, misroute recovery |
| [Retrieval Eval Guide](retrieval-eval-guide.md) | active | 2026-11-07 | 448 | How to measure retrieval on your own vault with semantic-memory eval - question sets, generated questions, floors, the noise band, all versus clean. |
| [Retrieval Tuning Guide](retrieval-tuning-guide.md) | active | 2026-11-07 | 606 | How search_hybrid ranks, how frontmatter fields are indexed, what confidence and no_strong_match mean, which knobs exist (index_fields, ranking, path_class.exclude, graph.exclude_hubs, rerank), what lost, and how to run and extend the retrieval eval. |
| [Search gaps - reading gaps and handing it to hewtd](search-gaps-guide.md) | active | 2026-11-07 | 258 | How do I find the questions my docs failed to answer, read the gaps report, and hand it to `hewtd reconcile --gaps`? |
| [Session Paging & Speaker Profile — Operating Guide](session-paging-guide.md) | active | 2026-07-11 | 1,110 | How to operate v1.5.0 session paging (Stop digest-as-proposal, SessionStart curated digest) and the speaker profile (init, sections, correction-cue updates, injection) — the session-lifecycle pair. |
| [Sessions guide — verification-gated work units](sessions-guide.md) | active | 2026-05-09 | 1,375 | Operational guide to the v1.1 session loop. When to open a session, how to run verification commands, how `session_finish`'s hard gate works, what session_state contains, and how the Stop hook surfaces open sessions. |
| [The skill loop — learned skills between sessions](skill-loop.md) | active | 2026-11-03 | 1,427 | What the skill loop does, how to turn it on and off, how drafts are made, deduplicated, scoped, reviewed, landed, evaluated and retired, what auto mode applies by itself, how hand-written skills get suggestions, what the background reviewer can and cannot touch, what it costs, and what turning it off leaves behind. |
| [State migration — moving legacy .sidekick-* files to .semantic-memory/](state-migration.md) | active | 2026-10-24 | 1,443 | Operational guide for v1.2's state-file consolidation. What's moving, when to run migrate-state, what conflicts mean, and what's deferred to v2.0. |
| [Usage-Feedback Ranking & Decoys — Operating Guide](usage-feedback-guide.md) | active | 2026-07-11 | 995 | How to operate v1.5.0 usage-feedback ranking day to day — how citations become a bounded rank boost, how it composes with decay and path-class, reading the usage block, running the decoys lint, and disabling the feature. |

### References

| Document | Status | Updated | Words | Purpose |
|----------|--------|---------|-------|---------|
| [Logs and Events (log.md)](logs-and-events.md) | active | 2026-04-23 | 964 | log.md format, auto-kinds, state-delta preload, future-Claude usage |

## Keywords

This domain covers: operational, guide, operate, sessions, dossier

## Related Domains

- [Quickstart](../quickstart/) - Setup guides, dev workflow, onboarding

---

*Last updated: 2026-11-14*
