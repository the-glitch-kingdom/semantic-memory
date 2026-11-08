---
title: Architecture Documentation Index
tier: reference
domains: [architecture]
status: active
last_updated: '2026-11-08'
version: '1.0.0'
generated: true
purpose: Complete listing of architecture documentation
---

# Architecture Documentation

> System design, AI coach, project registry, patterns

## Overview

- **Total Documents:** 8
- **Domain:** `architecture/`
- **Category:** development
- **Load Priority:** 7/10

## Documents

### References

| Document | Status | Updated | Words | Purpose |
|----------|--------|---------|-------|---------|
| [Architecture — the Five Layers](architecture-layers.md) | active | 2026-10-25 | 1,758 | Each of the 5 layers with responsibilities, key files, contracts, gotchas, plus the opt-in v1.7 skill loop layer and the Jev bridge |
| [Code graph - code nodes, grounding and entity cards](code-graph.md) | active | 2026-11-08 | 502 | How semantic-memory puts code into the graph (v1.16.0, issue 58) - the hit-em-with-the-docs graph export it reads, the fallback from code spans, the grounding penalty, entity cards and undocumented names. |
| [Indices and storage — every file semantic-memory writes](indices-and-storage.md) | active | 2026-10-25 | 2,410 | Comprehensive map of every file and directory semantic-memory creates on disk. Use for backup planning, gitignore decisions, disk-usage forensics, and v2.0 migration prep. |
| [Injection Points](injection-points.md) | active | 2026-10-28 | 2,157 | Every place semantic-sidekick touches Claude's context — symptom→check table |
| [MCP server internals — composition, context, per-domain tool modules](mcp-internals.md) | active | 2026-10-24 | 1,641 | How the MCP server is structured internally — composition root, shared context, per-domain tool modules. Read this if you're adding a new MCP tool or debugging tool registration. |
| [Schema and Provenance](schema-and-provenance.md) | active | 2026-04-23 | 878 | vault.schema.yml, 4 types, lint rules, provenance frontmatter |
| [v1 stack overview — what v1.0 / v1.1 / v1.2 added](v1-stack-overview.md) | active | 2026-10-24 | 1,330 | Single doc covering everything v1.0 / v1.1 / v1.2 added on top of the v0.x five-layer substrate. Read this BEFORE the per-version changelog entries; it's the architectural narrative, they're the bullet lists. |
| [What gets indexed where and why](what-gets-indexed.md) | active | 2026-05-09 | 2,272 | Content-perspective view of the index pipeline. For each kind of content semantic-memory sees, what it does with it and which tools query the result. Read this if you wonder "is this file indexed?" or "why isn't my note showing up in search?" |

## Keywords

This domain covers: architecture, design, system, system-design, pattern, patterns, microservices, monolith, serverless, event-driven

## Related Domains

- [Testing](../testing/) - Test strategies, fixtures, patterns, integration/e2e
- [Changelog](../changelog/) - Release notes per version and phase

---

*Last updated: 2026-11-08*
