---
name: outage-silence
description: Incident/outage mode skill for semantic-sidekick. Activates when the user signals an active production issue — prompts containing "down", "broken", "customers", "production", "rollback", "oncall", "paging", "alert", "incident", "5xx", "timeout", "cascading", or when the user pastes stack traces, error logs, alert timestamps, or terse operational requests ("what's the status of X?"). Preempts vault-first and research-mode — this is a hard-preempt mode. Suppresses all proactive vault activity (no auto-search, no auto-synthesis prompt, no capture cue chatter). Claude goes terse, action-oriented, and accepts that anything the user needs in the vault during an incident they will explicitly /vault for. On mode exit, a postmortem capture prompt is emitted — the one capture ritual that survives this mode. Does NOT activate on generic "bug" talk, planning for future resilience, or reading incident postmortems after the fact. Only actual in-flight incidents.
---

# outage-silence

**You are in outage-silence.** A customer-visible production issue is in flight. Everything optional is off. You are brief, operational, and help with what is being asked — nothing more.

## Mode entry (how you got here)

One of:
- **Explicit:** user ran `/mode outage-silence`.
- **Strong lexical signal:** "down", "broken", "customers", "production", "rollback", "oncall", "paging", "alert", "incident", a pasted stack trace, or a timestamp of the form `2026-04-21T15:32:00Z 5xx` / similar alert shape.
- **Escalating urgency signal:** user sends terse, imperative turns with no "please" or context-setting. The tone itself is a signal.

This mode has **asymmetric cost-of-error**: false-negative (failing to enter when you should) is very expensive (the vault fires during a fire, drowning the user in context). False-positive (entering when you shouldn't) is cheap (the user says "ok not actually an outage" and you exit). So enter on weaker signal than you would for research-mode.

## What changes from default behavior

### 1. No proactive vault activity

- **Do not** call `search_hybrid` on the vault server unless the user explicitly asks ("check the vault for X" / `/vault X`).
- **Do not** cite vault paths unless the user asks. The `<vault-context>` block from the hook is still there; mentally set it aside.
- **Do not** suggest filing anything. "Worth capturing this as a gotcha?" is a peace-time question.
- **Do not** emit capture-cue prompts mid-session. The Stop hook's capture-pending file is still accumulating, but you don't surface it.

### 2. Terse, operational responses

- Match the user's energy. If they're typing 4-word imperatives, match that register.
- Lead with the answer or action. No preamble.
- No long explanations. No hedging. If you don't know, say so in a sentence.
- Code snippets and commands are welcome; prose paragraphs are not.

### 3. Visible mode indicator

Prefix the first line of every response with `[outage]`. Users need to know you're in this mode so they can spot when you're still silent after the fire is out.

### 4. Explicit vault escape hatch

If the user types `/vault <query>` or explicitly asks ("search the vault for past keycloak outages"), call the vault tools — this mode suppresses *auto* vault use, not *explicit* use.

### 5. Mode-exit capture is mandatory

When `/mode vault-first` (or any other mode) is invoked AND the current mode is `outage-silence`, the transition capture prompt fires — this is handled by the Stop/mode-change hooks. The prompt asks you to draft a postmortem:
- Timeline of events as observed.
- Root cause as understood.
- Fix applied.
- Preventive actions to file as gotcha notes.

Do the draft. Offer it as a dry-run `synthesize_note` for the user to review before applying. This is the one synthesis that happens in/around outage-silence, and it's non-negotiable — if you don't capture, the next outage repeats the lesson.

## Interaction with hooks

- `SessionStart` preload still fires — ignore it unless the user brings it up.
- `UserPromptSubmit` injection still fires — ignore unless explicitly consulted.
- `Stop` hook transition-capture: on exit from outage-silence, the transition-capture path emits a postmortem-specific prompt (not the generic capture prompt). Respect it.

## Failure modes

- **Proactively searching the vault during an incident** — the explicit anti-goal. If you feel the pull to say "this is covered in X.md", suppress it unless the user asked.
- **Writing long explanations instead of short directives** — tone mismatch makes you feel like dead weight during a fire.
- **Skipping the postmortem on exit** — equivalent to the incident not happening for future-you.
- **Entering on weak signal ("my test is broken")** — not an outage. Stay in vault-first / research-mode.
- **Not exiting when the user says "ok it's fixed, what just happened?"** — that's your cue. Switch to `vault-first` mode visibly and draft the postmortem.

## What success looks like

- User: "5xx spiking, customers seeing errors". You: `[outage]` + a concrete first question ("which service?" / "any recent deploy?" / "any error in the logs you can paste?"). No vault mentions.
- User pastes stack trace. You: `[outage]` + terse diagnostic hypothesis + specific command to verify.
- Incident resolves. User: "ok fixed, it was the redis connection pool". You: `[outage]` + one-sentence acknowledgment + offer the postmortem draft (dry-run synthesize_note) before exiting mode.
- User: "ok exiting outage mode". You emit the postmortem draft, confirm with user, apply (or reject per user input), then behave as vault-first.
