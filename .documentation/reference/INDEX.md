---
title: Reference Documentation Index
tier: reference
domains: [reference]
status: active
last_updated: '2026-11-11'
version: '1.0.0'
generated: true
purpose: Complete listing of reference documentation
---

# Reference Documentation

> Tool, CLI, configuration and frontmatter reference

## Overview

- **Total Documents:** 7
- **Domain:** `reference/`
- **Category:** core
- **Load Priority:** 7/10

## Documents

### References

| Document | Status | Updated | Words | Purpose |
|----------|--------|---------|-------|---------|
| [CLI Reference](cli-reference.md) | active | 2026-11-08 | 4,333 | Every semantic-memory subcommand + flags + env vars + exit codes. Covers v1.1 skills tree, v1.2 migrate-state, v1.3 confidence-decay (healthcheck --fix, decay-config, decay-trace), v1.3.1 selection-stats telemetry introspection, the v1.4.0 lexicon subcommand group, the v1.5.0 dossier + profile subcommand groups, and the v1.7.0 skill-loop, jev-mode, skills lint and skill-eval commands. |
| [Configuration Reference](configuration-reference.md) | active | 2026-11-07 | 4,905 | Every config file, env var, schema field, and tunable. Includes v1.2 .gitignore additions, v1.1+ runtime state files, the v1.3 decay schema block, the v1.3.1 telemetry block, the v1.4.0 path_class + tools.conditional schema blocks, the SEMANTIC_MEMORY_INJECT_MIN_SCORE env var, the lexicon-cache.json state file, the v1.5.0 usage_boost schema block + dossier-cache.json state file, the v1.5.2 per-session capture-pending format and multi-path hook discovery, the v1.6 failure-hook env vars and failure-shown.json, the v1.7 skill-loop and jev-mode env vars, repo config file and state files, and the v1.7.2 server-name rule, doc-search redirect switch and doc-search-redirect.json. |
| [Frontmatter spec — every field, what it does, who reads it](frontmatter-spec.md) | active | 2026-10-24 | 3,309 | Authoritative field-by-field spec for note frontmatter. Covers every field the indexer / lint / search tools read, what types they expect, what defaults apply, and which tools surface them. Includes the v1.4.0 symptoms field and alias note type, plus the v1.5.0 entity/aliases fields and the dossier + profile note types, how invalid YAML is handled (v1.5.2/v1.6.1), and the measured effect of symptoms on failure lookup (v1.6). |
| [gaps.v1 export - what semantic-memory fills](gaps-format.md) | active | 2026-11-07 | 251 | How does `semantic-memory gaps --json` fill hewtd's gaps.v1 format, and how are used_doc, clustering, redaction and dropped queries decided? |
| [Hooks Reference](hooks-reference.md) | active | 2026-10-25 | 2,205 | SessionStart / UserPromptSubmit / Stop / PostToolUseFailure / PostToolUse (Skill) / SessionEnd hook contracts + state files (current to v1.7.0) |
| [MCP Tools Reference (45 tools)](mcp-tools-reference.md) | active | 2026-11-08 | 4,268 | All 45 MCP tools by category with args, use-when/skip-when guidance. Includes v1.1+ contract + session tools, the v1.1 deprecation shims, the v1.3 confidence-decay verify_note tool, the v1.3.1 decay_candidates lint check, the v1.4.0 manage_lexicon tool, and the v1.5.0 manage_dossier + manage_profile tools plus the usage-feedback usage block and decoys lint check, the v1.7 opt-in `skills` lint check, and the v1.7.2 server instructions and always-loaded `search_hybrid`. |
| [Learned skill format — the skill_loop frontmatter block and its lint rules](skill-format.md) | active | 2026-11-03 | 560 | The contract every skill the skill loop writes follows — frontmatter fields, body sections, what stays out of the file — and every rule `skills lint` and `lint_vault({checks:["skills"]})` enforce. |

## Keywords

This domain covers: reference, cli, tools, configuration, frontmatter

## Related Domains

- [Security](../security/) - Security, auth, Vault, Keycloak, RLS
- [Deployment](../deployment/) - Publishing and offline packaging

---

*Last updated: 2026-11-11*
