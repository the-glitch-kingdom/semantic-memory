---
title: Confidence Decay — Operating Guide
tier: guide
domains: [operational]
audience: [developers, admin]
tags: [decay, confidence, verify_note, evergreen, ranking, last_verified]
status: active
last_updated: '2026-07-10'
version: '1.3.0'
purpose: How to operate confidence decay day to day — read decay state, re-verify notes, tune half-lives, mark evergreen, and disable it.
load_priority: 6
---

# Confidence Decay — Operating Guide

Confidence decay (v1.3+) down-weights search results by how long it's been since a note was last *verified*. It runs automatically on `search_semantic` and `search_hybrid`. This guide covers operating it; for the model and rationale see the [v1.3 changelog](../changelog/v1-3-confidence-decay.md).

## The one thing to know

Decay keys on the `last_verified` frontmatter date. That date is set at note creation and by `verify_note` — **ordinary edits do not touch it**. So a note you edit constantly but never re-verify will still decay. When you re-confirm a note is true, call `verify_note` to reset its clock.

## Reading decay state

**In search results.** Any result down-weighted by decay carries a `decay` block:

```json
{ "path": "gotchas/flaky-indexer.md", "score": 0.28,
  "decay": { "multiplier": 0.35, "age_days": 300, "effective_half_life": 180, "reason": "type=gotcha" } }
```

Fresh notes have no block. Since v1.11 a note with no usable `last_verified` also carries a compact block `{ multiplier, age_days, source }` even at multiplier 1; `source` is `last_verified`, `git`, `mtime`, `penalty` or `fresh`. A low `multiplier` on a note that's still relevant is your signal to re-verify.

**For one note, on demand:**

```bash
semantic-memory decay-trace gotchas/flaky-indexer.md --notes ./.claude/.vault
```

prints `{ type, last_verified, evergreen, multiplier, age_days, effective_half_life, reason }`. This is the fastest way to answer "why is this note ranking low?"

**The active config:**

```bash
semantic-memory decay-config --notes ./.claude/.vault
```

tells you whether decay is on, the per-type half-lives, and whether the config is defaults or a `vault.schema.yml` override.

## Re-verifying a note

When you've re-checked a note and it's still correct:

```
verify_note({ path: "decisions/auth.md" })
```

This stamps `last_verified` to today (content untouched), logs a `verify` event, and returns the new multiplier (≈1.0). The note ranks fresh again. Use this liberally — it is the intended maintenance ritual for a living knowledge base.

## Marking a note evergreen

For notes that stay true for a long time (a glossary entry, a stable convention), add `evergreen: true` to the frontmatter. It pins the note at full weight **while** `last_verified` is within 365 days.

Important: evergreen is not permanent immunity. Once `last_verified` is older than a year, the evergreen claim is treated as expired and the note decays normally — forcing you to re-affirm it with `verify_note`. This keeps "evergreen" honest (an evergreen note referencing an obsolete framework name should not rank forever).

## Tuning

Edit the `decay:` block in `<vault>/vault.schema.yml` (see [configuration-reference](../reference/configuration-reference.md) for the full block):

- **Too aggressive** (useful notes dropping): raise `default_half_life_days` or the per-type value, or raise `floor`.
- **Not aggressive enough** (stale notes still surfacing): lower the relevant half-life.
- **A type should never decay:** set its `per_type` entry to `null` (this is the default for `source`).

Change the config, then re-run a couple of representative searches (or `decay-trace` a known-old note) to confirm the new curve behaves. Ranking changes deserve a soak — tighten half-lives gradually.

## Disabling decay

One line in `vault.schema.yml`:

```yaml
decay:
  enabled: false
```

restores byte-identical pre-v1.3 ranking. Everything else about the vault is unchanged.

## Notes with no `last_verified` (v1.11+)

A missing, unparseable or future `last_verified` no longer ranks at full weight. The note is aged by `decay.missing_last_verified` (default `git`: the date of its last commit, read once per index build or reconcile). `mtime` uses the stored `last_updated` chain, then the file mtime; `penalty` applies the flat `decay.missing_penalty` (0.85); `fresh` restores the old no-decay behaviour. `git` and `mtime` fall back to the penalty when they have no date (non-git vault, untracked or edited-since-commit file). `last_validated` is not verification (hewtd stamps it for frontmatter checks) and is never read. `lint_vault` reports how many notes lack `last_verified` (`counts.noLastVerified`). Switching a vault to `git` needs a `--reindex`. See the [v1.11.0 changelog](../changelog/v1-11-0-boost-decay-fallback.md).

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| A note isn't decaying at all | `missing_last_verified: fresh`, a vault older than v1.11, or a git date under a day old | Add a `last_verified` date, or set `missing_last_verified: git` and `--reindex` |
| Every note without `last_verified` dropped after upgrading to v1.11 | The `git` age fallback is the new default | Intended; `verify_note` them, or set `decay.missing_last_verified: fresh` |
| `decay-trace` says "no last_verified (fail open)" but the note has one | (Pre-1.3.0 only) unquoted YAML date parsed as a non-string | Upgrade to ≥1.3.0 — `normalizeVerifiedDate` handles Date objects |
| A note decays despite `evergreen: true` | `last_verified` is >365 days old (evergreen expired) | `verify_note` it to re-affirm |
| Everything decayed at once after import | Bulk-imported notes share one old `last_verified` | `verify_note` the ones you've confirmed, or raise half-lives |
| Decay isn't applying to keyword search | By design — decay is a semantic signal | It applies to `search_semantic`/`search_hybrid` only, not `search_text`/`search_graph` |

## See also

- [v1.3 changelog](../changelog/v1-3-confidence-decay.md) — the model and what shipped
- [configuration-reference](../reference/configuration-reference.md) — the `decay:` block
- [mcp-tools-reference](../reference/mcp-tools-reference.md) — `verify_note`
- [frontmatter-spec](../reference/frontmatter-spec.md) — `last_verified`, `evergreen`
- [`REGISTRY.md`](./REGISTRY.md) — tabular metadata view
