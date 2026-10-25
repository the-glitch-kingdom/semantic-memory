---
title: Capture Workflows
tier: guide
domains: [operational]
audience: [developers]
tags: [capture, synthesis, ingest, workflow, provenance]
status: active
last_updated: '2026-10-24'
version: '1.6.1'
purpose: synthesize_note, ingest_source, Stop-hook capture, /mode transitions — golden path
load_priority: 9
---

# Capture workflows — how knowledge becomes durable

> Three paths from ephemeral (chat history) to durable (vault note): `synthesize_note` for answered questions, `ingest_source` for external sources, capture-on-close for session-boundary prompts.

## The capture hierarchy

```
      ephemeral (disappears at session end)
           │
      captured-cue  ← Stop hook nudge
           │
      synthesize_note / ingest_source (dry-run)
           │
      apply_patch with validate=true
           │
      filed note with provenance + lint-clean
           │
      log_event (auto — kind: synthesis / ingest)
           │
      durable (readable by next session's SessionStart state-delta preload)
```

Every durable artifact is both a filed note AND a log entry. The note is the answer; the log entry is the record-of-event.

---

## Workflow A — `synthesize_note`

**When:** you just answered a project question by consulting the vault + (optionally) external research. The answer is worth keeping.

**Call shape:**
```ts
mcp__semantic-vault__synthesize_note({
  topic: "Auth migration rationale",
  answer: "We moved from Passport to Keycloak because [reasoning]...",
  suggested_path: "decisions/auth-migration.md",
  type: "decision",
  decided_on: "2026-03-15",
  decision_maker: "alice",
  sources: ["https://internal.example.com/rfc-1"],
  derived_from: ["security/keycloak-declarative-config.md"],
  related_notes: ["security/keycloak-declarative-config.md", "architecture/auth-overview.md"],
  confidence: "high",
  dry_run: true   // ← preview first
})
```

**What happens:**
1. `buildSynthesizeChangeSet` shapes a ChangeSet with:
   - One `create` at `suggested_path`.
   - Frontmatter: title, type, status, last_verified (today), confidence, sources, derived_from, decision_maker, decided_on.
   - Body: `# <topic>` + trimmed answer + auto-inserted `[[wikilinks]]` for each `related_notes` entry (first whole-word occurrence) + `## Related` section listing all related_notes.
2. Routes through `apply_patch`.
3. Pre-checks collision, validates against schema (required fields, enums, provenance).
4. If `dry_run: true` — returns the preview + lint findings without writing.
5. If `dry_run: false` — writes atomically, regens directory INDEX.md, logs `kind=synthesis`.

**Contract:**
- If validation blocks (schema error), `result.ok = false`, `result.lint` has the findings. Auto-logs `kind=error` with those findings.
- `related_notes` names or paths both work. Path segments are stripped, `.md` suffix removed — `security/keycloak-declarative-config.md` becomes `[[keycloak-declarative-config]]`.
- Code-block content is preserved — auto-wikilink skips inside fenced and inline code.

**When to dry-run:** always on the first pass. Review the frontmatter block and the wikilinks. If something's off, rebuild and re-dry-run; file only when clean.

---

## Workflow B — `ingest_source`

**When:** you're processing a source (paper, blog post, doc, transcript) and want to file *both* the source record AND the extracted findings atomically.

**Call shape:**
```ts
mcp__semantic-vault__ingest_source({
  source: {
    source_uri: "https://example.com/karpathy-llm-wiki",
    source_title: "Karpathy — LLM Wiki pattern",
    source_summary: "Incrementally build and maintain a persistent wiki rather than re-retrieving raw docs each query. Three operations: ingest / query / lint.",
    source_tags: ["knowledge-architecture", "llm"]
  },
  units: [
    {
      path: "notes/karpathy-ingest-loop.md",
      title: "The ingest loop — sources become wiki pages",
      content: "Every source processed → 10-15 wiki pages updated atomically. Key is atomic: per-note writes risk corrupting graph mid-ingest.",
    },
    {
      path: "notes/karpathy-query-loop.md",
      title: "The query loop — search, synthesize, file results",
      content: "Queries the wiki rather than raw sources. The answer + cited sources become a new filed wiki entry. Closes the loop.",
    },
    {
      path: "notes/karpathy-lint-loop.md",
      title: "The lint loop — contradictions, orphans, stale claims",
      content: "Without lint, the wiki drifts. Critical in long-running accumulation. Contradiction detection is the expensive part.",
    }
  ],
  dry_run: true
})
```

**What happens:**
1. `buildIngestChangeSet` produces one `create` for the source-note (at `sources/<slug>.md` by default, or your `source_path`) with `type: source` + the source body.
2. One `create` per unit, each stamped with `derived_from: [<source-note-path>, ...extra_derived_from]` — provenance is automatic.
3. Same `apply_patch` pipeline: pre-check, validate, execute, regen indexes.
4. On success, logs `kind=ingest` with payload `{ source_path, unit_paths, source_uri }`.

**Contract:**
- The source-note is the *anchor*. Every unit derives from it; lint's `missing_provenance` never fires on ingest output.
- Source content is your summary/distillation, not the raw source text. Put raw source elsewhere (or don't — the URI points to it).
- `auto_apply: false` forces dry-run regardless of `dry_run` — useful for "review this proposal before deciding."

**Ingest vs. synthesize split:** use synthesize when the answer is *yours, synthesized from multiple inputs*. Use ingest when you're *propagating a specific external source* into the vault's knowledge base.

---

## Workflow C — capture-on-close (Stop hook)

**When:** session is ending. The Stop hook decides whether to block Claude and prompt for capture.

**Sources of capture-pending:**
- UserPromptSubmit hook's cue detection. Each prompt containing one of the 5 cue regexes appends `{ts, cue, excerpt, session_id}` to `.claude/.semantic-memory/capture-pending.json` (legacy `.claude/.sidekick-capture-pending.json`). The excerpt is redacted first (v1.5.3+). Each session's Stop hook asks only about its own items (v1.5.2+), so two sessions in one project don't see each other's cues.

**Triggering paths:**

### In `vault-first` mode (default)
If pending > 0, Stop emits:
```
<vault-capture-prompt count="N">
This session surfaced N capture-worthy moment(s) ...
- cue `\bbecause\b`: "the fix was to restart keycloak because config was cached"
...
Before ending: for each still-unsynthesized item above, either call
mcp__semantic-vault__synthesize_note to file it with provenance, or
explicitly acknowledge that it was already captured / not worth capturing.
</vault-capture-prompt>
```
`decision: "block"` — Claude Code reopens the turn so the model can address each item.

### In `research` mode
Uses `<vault-transition-capture mode="research">`. The instruction is stronger: dry-run `synthesize_note` is *mandatory*, not optional.

### In `outage-silence` mode
Uses `<vault-transition-capture mode="outage-silence">`. Fires regardless of pending (the whole session was vault-silent; exit is the only capture opportunity). Drafts a postmortem-as-`synthesize_note` with `type: gotcha` or `decision`.

### After Claude responds to the block
`CLAUDE_STOP_HOOK_ACTIVE=1` is set. Hook short-circuits to no-op `{}`. Pending is cleared. Session ends normally.

---

## Workflow D — transition capture on `/mode` exit

The `/mode` command (not the hook) also emits transition prompts when exiting research or outage. This is belt-and-suspenders: either the `/mode`-level prompt OR the Stop-hook-level prompt (if the user just ends the session instead of running `/mode`) gets Claude to the synthesis step.

Flow when user runs `/mode vault-first` while in research:

1. `/mode` command reads current mode → `research`.
2. Emits research-exit synthesis prompt to Claude in the same turn.
3. Waits for user confirmation / actual synthesize_note call.
4. Writes new mode to `.claude/.sidekick-mode`.
5. Reports transition: `mode: research → vault-first`.

---

## Failure modes

| Problem | Cause | Fix |
|---|---|---|
| synthesize_note rejects with `schema_violations` | Missing `title`/`status`, bad status value, or missing provenance | Check the result's `lint` array. Add missing fields and re-dry-run. |
| synthesize_note wrote a note but wikilinks weren't auto-inserted | `related_notes` names didn't match plain text in the body | Auto-linking does first-whole-word match. Use the exact note basename or add them manually. |
| ingest_source complains source-note already exists | Prior ingest with same title | Pass `source.source_path` explicitly to a new path, or delete the old source-note first. |
| Stop hook doesn't fire capture prompt | No cue matched any prompt | Normal — session had no capture-worthy moments. Or the user talked about a decision in words the regex doesn't match (tune `CAPTURE_CUES` in the hook file). |
| Stop hook fires but pending is wrong items | Cue regex is permissive ("because" fires on many benign prompts) | Known. Stop hook prompt is advisory; Claude's judgment is the filter. Phase 5 calibration would tighten. |
| Transition-capture block appears but Claude skips past it | The `decision: "block"` was respected but Claude declined synthesis or the user dismissed it | Pending is reset after emit — no retry. Next session starts fresh. Lossy case; acceptable for Phase 4. |

---

## The golden path

1. **Read the vault** — `search_hybrid` + `read_note` on relevant hits.
2. **Do the work** — answer, research, fix.
3. **Capture** — `synthesize_note` (for answers) or `ingest_source` (for sources), always with `dry_run: true` first.
4. **Apply** — `dry_run: false` once the preview looks right.
5. **Cite** — tell the user the path of the note you just filed.
6. **Log verifies** — `log_query({ kind: "synthesis", limit: 5 })` shows what you filed in the last few sessions.
