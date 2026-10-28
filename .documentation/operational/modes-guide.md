---
title: Modes Guide
tier: guide
domains: [operational]
audience: [developers]
tags: [modes, routing, vault-first, research, outage-silence]
status: active
last_updated: '2026-10-28'
version: '1.7.2'
purpose: vault-first / research / outage-silence entry signals, behavior, misroute recovery
load_priority: 9
---

# Modes guide — vault-first / research / outage-silence

Three modes compete as the top-level router. Mode is ground-truth behavior scaffolding; skills describe the fine-grained contracts within each mode.

## Quick reference

| Mode | Default? | Autoprobes vault? | Visible prefix | Forces capture on exit? |
|---|---|---|---|---|
| `vault-first` | yes | yes (hooks + skill) | none | yes (generic capture-pending) |
| `research` | no | yes, aggressively | `[research]` | yes (synthesis) |
| `outage-silence` | no | **no** (mode suppresses auto-search) | `[outage]` | yes (postmortem) |

Mode is persisted in `.claude/.semantic-memory/mode` (single-line text; legacy `.claude/.sidekick-mode` is read as a fallback). Reset to `vault-first` on every SessionStart.

## How to switch modes

### Explicit (ground truth)
```
/mode research            → enters research
/mode outage-silence      → enters outage-silence
/mode vault-first         → exits back to default
/mode status              → prints current mode
```

### Implicit (skill-level routing)
When the user says something that strongly matches a mode's conversational triggers, Claude Code switches behaviorally and should announce the change visibly (e.g., "entering outage-silence — customer-visible issue"). The `.sidekick-mode` file doesn't auto-update on implicit switch unless `/mode` fires — this is intentional: explicit mode is ground truth.

### `/vault <query>` — escape hatch
Works in any mode, including outage-silence. The one sanctioned way to read the vault during an incident. Does not change mode.

---

## `vault-first` — the default

**When you're in it:** every session starts here.

**What changes about Claude's behavior:**
1. **Injected context gets read first.** If `<vault-context>` appears in the conversation, Claude reads those notes before searching again.
2. **Project-scoped prose questions trigger `search_hybrid` automatically.** "How do we deploy?" → Claude searches, reads 2–3 hits, answers with citations.
3. **Every project-question answer cites or deflects.** Cite: "per `runbooks/deploy.md`". Deflect: "not in vault; nearest misses were X.md, Y.md."
4. **Offers to capture when answering from outside the vault.** One-line offer, user decides.

**What it does NOT do:**
- Automatically file notes — the user (or skill description) decides when to call `synthesize_note`.
- Fire on code-symbol lookups (`Grep`/`Glob` territory) or pure external research (that's Flow B of `semantic-first`).

**Stop-hook behavior:** if capture-pending has entries (cue-detected prompts), emits the generic `<vault-capture-prompt>` with `decision: "block"`. Otherwise no-op.

---

## `research` — aggressive vault

**Entry signals (strong):**
- Explicit `/mode research`.
- "I'm researching X", "let's investigate", "do a deep dive", "compare X and Y", "survey", "look into".
- User pastes/links ≥3 external sources in rapid succession.

**Entry signals (too weak, don't fire):**
- Single casual "research" mention.
- One URL pasted without an evaluative question.

**What changes:**
1. **Every introduced source gets filed via `ingest_source`.** Title, URI, and a paragraph-length summary. Don't accumulate URLs in chat.
2. **Proactive `search_hybrid` every non-trivial turn.** Check for prior research notes before web-searching.
3. **Visible `[research]` prefix on every response.**
4. **`synthesize_note` is mandatory on exit.** The Stop hook's transition-capture prompt forces this. Session that ends without synthesis = lost work.

**Stop-hook behavior:**
- If pending > 0 → `<vault-transition-capture mode="research">` with instruction to call `synthesize_note({ dry_run: true, ... })` for preview, then apply. `decision: "block"`.

**Decay:**
- Stays active through topic shifts *within the research arc*.
- Exits on: explicit `/mode` change, session end, or hard topic break (user asks an unrelated operational question — acknowledge the shift visibly and switch).

---

## `outage-silence` — incident mode

**Entry signals (strong):**
- Explicit `/mode outage-silence`.
- "down", "broken", "customers", "production", "rollback", "oncall", "paging", "alert", "incident", "5xx", "timeout".
- User pastes a stack trace or alert timestamp (`2026-04-22T12:34:56Z ERROR ...`).
- Escalating urgency signal — terse imperative turns, no context-setting.

**Asymmetric cost-of-error:** enters on weaker signal than research. False-negative (failing to enter during a real outage) is expensive; false-positive (entering when it's just "my test is broken") is cheap because the user says "ok not actually an outage" and `/mode vault-first` exits.

**What changes:**
1. **No proactive vault search.** UserPromptSubmit hook reads the mode and short-circuits — no `<vault-context>` block injected.
2. **Terse, operational responses.** Match the user's energy.
3. **Visible `[outage]` prefix.**
4. **`/vault` escape hatch remains active.** If the user needs the vault, they ask explicitly.
5. **No capture-cue chatter mid-session.** The Stop hook accumulates pending, but Claude doesn't surface it until exit.
6. **No failure-time fact lookup.** Even with `SEMANTIC_MEMORY_FAILURE_HOOK=1`, the `PostToolUseFailure` hook injects nothing in outage-silence (v1.6+).
7. **No doc-search redirect.** A grep of an indexed docs folder goes straight through: no extra step during an incident (v1.7.2).

**Stop-hook behavior:**
- **Always** fires `<vault-transition-capture mode="outage-silence">` regardless of capture-pending. `decision: "block"` with instruction to draft a postmortem as `synthesize_note({ type: "gotcha" | "decision", ... })`.

**Decay:**
- Stays active until explicit `/mode` change or session end.
- Does NOT decay on silence (20 minutes of log-reading during an outage is still an outage).

---

## Skill-level routing (LLM evaluates descriptions)

Each SKILL.md has a `description:` field that serves as the classifier. Claude reads descriptions on every turn and chooses the matching skill — this is the implicit routing path. Explicit `/mode` bypasses it.

Strong signals in descriptions:
- **`vault-first`**: "project", "how do we", "what's our", "where does", operational nouns.
- **`research-mode`**: "I'm researching", source introductions, comparative/evaluative cues.
- **`outage-silence`**: incident lexicon, pasted stack traces, urgency patterns.

If a mode mis-fires in practice, the fix is in the skill's `description:` field — tune the positive/negative signal vocabulary based on observed misfires. Phase 5's calibration ritual is the formal tuning loop.

---

## Transition capture — the highest-leverage moment

The router's real job isn't picking the current mode. It's *noticing the transition* and forcing capture before context evaporates.

| Exit | Captured as | Why |
|---|---|---|
| `research → anything` | `synthesize_note` with `derived_from: [session's source notes]` | 3 hours of research → 1 principle filed vs. vanished anecdote |
| `outage-silence → anything` | `synthesize_note` with `type: gotcha` or `decision` covering timeline/root cause/fix/prevention | Compresses incident lessons; next outage doesn't repeat |
| `vault-first → outage-silence` | (no synthesis; the mode change itself is logged via `mode_change`) | Nothing to capture yet — session hasn't produced artifacts |

Stop hook emits the prompt automatically. `/mode` command also emits the prompt before writing the new mode. Both paths lead to the same artifact; either is fine.

---

## Mode misroute recovery

If you see `[research]` or `[outage]` on a turn that doesn't fit:

1. `/mode status` — confirm what's set.
2. `/mode vault-first` — override explicitly.
3. If the mode fired via implicit routing, the skill description is too permissive. File a `gotcha` note with the misfiring prompt, so future tuning has data.

Per the plan, misfire data feeds Phase 5 calibration. Every logged misroute is a tightening signal for the skill descriptions.
