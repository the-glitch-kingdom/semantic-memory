---
name: research-mode
description: Aggressive-vault mode skill for semantic-sidekick. Activates when the user signals an open-ended research or investigation session — prompts containing "I'm researching", "help me investigate", "look into", "do a deep dive on", "what's the best X for Y", "compare X and Y", "survey the landscape of", "how do other projects solve", or when the user pastes/introduces multiple external sources (URLs, papers, blog posts) in a short span. Unlike vault-first (which nudges toward the vault on project-scoped prose), research-mode treats every turn as vault-eligible and forces synthesis on transition out. Does NOT activate on short project operational questions ("how do we deploy") — those are vault-first territory. Does NOT activate during an active incident (outage-silence preempts). Strong signal beats weak signal; once entered, the mode sticks through topic shifts within the research arc and only exits on explicit /mode change, session end, or a hard topic break (e.g., user asks an unrelated operational question).
---

# research-mode

**You are in research-mode.** The user is doing sustained investigation — not a one-off question. The vault is a *working surface*, not a reference: every turn produces or modifies durable artifacts, every source gets filed, every finding gets synthesized before the session closes.

## Mode entry (how you got here)

One of:
- **Explicit:** user ran `/mode research`.
- **Strong lexical signal:** user said "I'm researching", "let's investigate", "deep dive", "survey", "compare X and Y", "what's the best X for Y", "look into".
- **Sustained source introduction:** user pasted or linked ≥3 external URLs / papers / docs in the last few turns and is asking evaluative questions about them.

Weak single-word hints (e.g., "research" as a noun, "look") are insufficient — the mode is too behavior-altering to enter on ambient signal. If you're unsure whether this is research-mode vs vault-first, default to vault-first.

## What changes from default behavior

### 1. Every source becomes a filed note

Whenever the user introduces an external source you end up relying on — a URL they link, a paper they paste, a doc they point at — **file it via `ingest_source`** on the vault server with:
- `source.source_uri` — the link or path.
- `source.source_title` — the actual title from the source (don't make one up).
- `source.source_summary` — your paragraph-length distillation.
- `units` — one per distinct finding/claim you extract from the source.

The ingest call also writes a `log_event` automatically — session provenance is preserved.

Don't accumulate URLs in the chat and lose them at session end. That's the failure mode this mode exists to prevent.

### 2. Proactive vault checks every non-trivial turn

On each substantive user turn, before answering:
- Call `search_hybrid` on the vault server with the current topic focus.
- If prior research notes exist, read them in full via `read_note` and weave them into your answer — don't re-research ground you've already covered.
- Cite every note you used (paths at end of response).

The "is this already in the vault?" question runs automatically — not just on explicit user ask.

### 3. Synthesis is mandatory on mode exit

Before the session ends — or before `/mode` changes you away from research — you MUST produce a `synthesize_note` that:
- Names the overall topic.
- Summarizes the findings in your own words.
- Cites the source-notes created during the session (`derived_from`).
- Uses confidence=`high` only if you've read multiple corroborating sources, `medium` for single-source claims, `low` for speculation.

This is the highest-leverage moment in the whole system: 3 hours of research with no synthesis → findings evaporate. 3 hours of research + 30 seconds of synthesis → compounding knowledge.

If the Stop hook fires with a `<vault-capture-prompt>` block, treat it as a hard requirement — do the synthesis before closing, or explicitly reject individual items with reasoning ("that one was already in the vault" / "that was a dead end, not worth capturing").

### 4. Relevance decay, not time decay

The mode stays active across short topic shifts within the research arc ("X → Y as a related question" → stay in research). It exits on:
- Explicit `/mode vault-first` or `/mode outage-silence`.
- Session end (SessionStart resets to vault-first).
- A hard topic break — user pivots to an operational question about the current project ("ok now how do we deploy this?"). That's vault-first territory; acknowledge the mode shift visibly and exit.

Do not exit on short silences or tool-use lulls — 20 turns of reading-and-taking-notes is still research.

## Visible mode indicator

Prefix the first sentence of every research-mode response with `[research]`. Users should always be able to see which mode you're operating in so they can override if you've routed wrong.

## Interaction with hooks

- `SessionStart` preload still fires; treat it as seed context like in vault-first.
- `UserPromptSubmit` injection still fires; in research-mode, the hits more strongly influence which vault notes you read before answering.
- `Stop` hook: capture-pending cues accumulated during the session will include research findings; synthesize them before letting Stop close. If the Stop hook's `decision: "block"` fires, don't just emit one synthesize_note to appease it — address each pending item specifically.

## Failure modes

- **Answering without filing sources** — the single biggest failure. If you used a URL in your answer, it gets an `ingest_source` call. No exceptions.
- **Synthesizing at session end with thin provenance** — if `derived_from` on the synthesis-note is empty, you didn't file the sources. Back up, file them, then re-synthesize.
- **Staying in research-mode through an unrelated operational question** — exit visibly ("switching out of research-mode for this operational question") and answer from vault-first.
- **Entering research-mode on a single casual "research" mention** — too aggressive. Prefer vault-first when the signal is weak.

## What success looks like

- Multi-source compare ("what's the best vector DB for <100k docs?") → you search the vault for prior research, do web research as needed, call `ingest_source` per source, then `synthesize_note` before answering. The chat response is a pointer to the synthesis note, not the full answer.
- 2-hour investigation into a new topic → 1 synthesis note + 4-6 source notes in the vault, all linked. Next session's vault-first preload surfaces them automatically.
- User shifts to "ok now let's implement this" → you exit research-mode visibly and switch to operational/implementation behavior (with vault-first still nudging).
