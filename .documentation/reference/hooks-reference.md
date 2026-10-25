---
title: Hooks Reference
tier: reference
domains: [reference]
audience: [developers]
tags: [hooks, contracts, state, debugging]
status: active
last_updated: '2026-10-24'
version: '1.6.1'
purpose: SessionStart / UserPromptSubmit / Stop / PostToolUseFailure hook contracts + state files (current to v1.6.1)
load_priority: 8
---

# Hooks reference

> Four Claude Code hook events drive activation, capture and failure lookup. All four are handled by `hooks/vault-context.js`; SessionStart also runs `hooks/session-start.js`, which reconciles `.mcp.json`. `PostToolUseFailure` (v1.6+) does nothing unless `SEMANTIC_MEMORY_FAILURE_HOOK=1`.

## Hook registration

Plugins declare hooks via `hooks/hooks.json`. Installed plugins get merged into the user's `.claude/settings.json`.

Current `hooks/hooks.json`:
```json
{
  "hooks": {
    "SessionStart": [
      { "hooks": [
          { "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/session-start.js\"" },
          { "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/vault-context.js\"" }
      ] }
    ],
    "UserPromptSubmit": [
      { "hooks": [
          { "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/vault-context.js\"" }
      ] }
    ],
    "Stop": [
      { "hooks": [
          { "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/vault-context.js\"" }
      ] }
    ],
    "PostToolUseFailure": [
      { "matcher": "Bash|mcp__.*",
        "hooks": [
          { "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/vault-context.js\"" }
      ] }
    ]
  }
}
```

Composing two SessionStart hooks is safe: Claude Code merges `additionalContext` from multiple handlers.

### Which notes folders the hooks use (v1.5.2+)

Every `semantic-vault`, `semantic-sidekick` and `semantic-memory` entry in `.mcp.json` with an existing `--notes` folder is searched, in parallel, and the hits are merged by score. When more than one folder was searched, each hit is labelled with its server name (`guides/deploy.md (semantic-sidekick, score: 0.76)`). State and writes (log events, dossiers, session digests, the speaker profile) go to the first entry *without* `--read-only`. `SIDEKICK_VAULT_PATH` replaces the lookup with one writable path. Before 1.5.2, only the first entry was searched, so with an empty vault, docs never appeared.

All hook inputs carry `session_id`. Since 1.5.2 it keys capture-pending items, and since 1.6 the failure hook's shown-once list.

---

## SessionStart — `handleSessionStart`

**Input JSON (from stdin):**
```json
{
  "hook_event_name": "SessionStart",
  "session_id": "<id>",
  "cwd": "<project root>"
}
```

**Actions (in order):**
1. Read the current mode from `.claude/.semantic-memory/mode` (legacy `.claude/.sidekick-mode` is read as a fallback).
2. Clear this session's capture-pending items (other sessions' items stay).
3. Write mode to `vault-first`.
4. If prior mode was non-default → log `kind=mode_change` event.
5. Page in a curated digest (v1.5: last session digest, active task, dossiers) if there is one. Otherwise compute a seed query, `"{project basename} {git branch with dashes→spaces}"`, and search every notes folder with it (limit 6).
6. Run `log-query` CLI with `after=(now - 14 days)`, limit 30.
7. Add the speaker profile block (v1.5) if one exists.
8. Format into `<vault-state-since>` + `<vault-context source="sessionstart">` blocks. Emit.

**Output JSON (shape per Claude Code schema):**
```json
{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": "<...>"
  }
}
```

**Fails open.** Any error (no vault, no CLI, search timeout) becomes empty additionalContext — session proceeds without vault preload.

**Latency:** ~0.6 s warm for `vault-context.js` plus ~0.35 s for `session-start.js` (measured in the 1.6.1 audit), ~6 s cold (first run after reindex).

---

## UserPromptSubmit — `handlePrompt`

**Input JSON:**
```json
{
  "hook_event_name": "UserPromptSubmit",
  "prompt": "<user's prompt text>",
  "session_id": "<id>",
  "cwd": "<project root>"
}
```

**Actions:**
1. Bail early if `prompt.length < 8`.
2. Read mode. If `outage-silence` → emit empty context, return (mode contract).
3. Compute prompt fingerprint (sha1 of lowercased + whitespace-normalized, first 16 chars).
4. Read fingerprint ring from `.claude/.semantic-memory/fingerprints.json`. If fingerprint matches any of last 10 → suppress (no re-fire).
5. Search every notes folder with the prompt (lexicon-expanded, v1.4), limit 8 each, merged by score.
6. Append fingerprint to the ring, save.
7. Run capture-cue detection on the prompt. If matched → append `{ts, cue, excerpt, session_id}` to `.claude/.semantic-memory/capture-pending.json`. The excerpt is redacted (broad rules) before the 200-character cut. If the redaction module can't load, it is withheld (v1.5.3+).
8. Score-gate (`SEMANTIC_MEMORY_INJECT_MIN_SCORE`, 0.35), dedupe and keep the top 3, format into a `<vault-context source="prompt">` block. Emit.

**Latency:** ~0.6 s warm (measured in the 1.6.1 audit).

**Output JSON:**
```json
{
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "additionalContext": "<...>"
  }
}
```

**Fingerprint ring size:** 10. Rationale: covers same-question-rephrased-3-turns-later without persisting the full history.

**Capture cues (list):**
- `/\bbecause\b/i`
- `/\bdecided\b|\bwe chose\b|\bthe decision\b/i`
- `/\bturned out to be\b|\bthe bug was\b|\bthe fix was\b/i`
- `/\bgotcha\b|\bworkaround\b|\bhack\b/i`
- `/\bnew convention\b|\bfrom now on\b|\bgoing forward\b/i`

---

## Stop — `handleStop`

**Input JSON:**
```json
{
  "hook_event_name": "Stop",
  "session_id": "<id>",
  "cwd": "<project root>"
}
```

**Actions:**
1. Check `CLAUDE_STOP_HOOK_ACTIVE` env var — if `1`, reset pending + emit no-op `{}` (loop guard).
2. Read the mode and this session's pending items, plus legacy items without a `session_id`. Items older than 7 days are dropped.
3. Branch on mode:

| Mode | Condition | Emits |
|---|---|---|
| `research` | pending > 0 | `{"decision":"block", "reason":"<vault-transition-capture mode=\"research\">..."}` |
| `outage-silence` | always | `{"decision":"block", "reason":"<vault-transition-capture mode=\"outage-silence\">..."}` |
| `vault-first` | pending > 0 | `{"decision":"block", "reason":"<vault-capture-prompt count=\"N\">..."}` |
| any | nothing to capture | `{}` |

4. Clear this session's items after emitting. A concurrent session's items are never shown or cleared here (v1.5.2+). **Latency:** ~30 ms.

**Output shape (CRITICAL):** Stop hook does **NOT** use `hookSpecificOutput`. Stop-mode schema uses top-level fields only: `decision`, `reason`, `continue`, `stopReason`, `suppressOutput`. Emitting `hookSpecificOutput.hookEventName="Stop"` fails schema validation with "(root): Invalid input".

---

## PostToolUseFailure — `handleFailure` (v1.6+, opt-in)

**Input JSON:** `{ hook_event_name, tool_name, tool_input, error, is_interrupt?, session_id, cwd }`.

**Actions:**
1. Return at once (no lookup, ~25 ms) unless `SEMANTIC_MEMORY_FAILURE_HOOK=1`.
2. Skip interrupts, user denials, tools other than Bash and `mcp__*`, and outage-silence mode.
3. Build a normalized query from the error and the command (`failureQuery`: ids, paths, timestamps and hosts stripped, program verbs kept). Search every notes folder (limit 8).
4. Keep only knowledge-base facts (`facts/*.md`). Take the first one scoring at least `SEMANTIC_MEMORY_FAILURE_MIN_SCORE` (0.5).
5. Show each fact at most once per session (`failure-shown.json`). Redact the snippet, then emit a `<vault-fact source="tool-failure" score="…">` block.

**Latency:** ~0.6 s when on. Measured precision is about 6 in 10, which is why it's off by default. See [failure-lookup-guide.md](../operational/failure-lookup-guide.md).

---

## Error handling (Phase 4.5)

Uncaught exceptions in `main()` trigger the global catch block:
1. Log to stderr (visible with `SIDEKICK_DEBUG=1`).
2. Log `kind=error` to log.md with `{ tool: "vault-context-hook", event, stack }` — first 6 stack lines, pipe-joined.
3. Emit empty safe response (`emit(eventName, "")` for SessionStart/UserPromptSubmit; `{}` for Stop).

**Consequence:** crashes are durable. Run `log_query({ kind: "error", limit: 10 })` after weird session behavior to see what failed silently.

---

## Runtime state files

| Path | Owner | Purpose | Gitignored |
|---|---|---|---|
| `.claude/.semantic-memory/mode` | `/mode` + SessionStart hook | Current mode name | Recommended |
| `.claude/.semantic-memory/fingerprints.json` | UserPromptSubmit | Ring buffer of recent prompt sha1s | Yes |
| `.claude/.semantic-memory/capture-pending.json` | UserPromptSubmit + Stop | Captured cues queued for Stop, keyed by `session_id` | Yes |
| `.claude/.semantic-memory/failure-shown.json` (v1.6+) | PostToolUseFailure | Facts already shown this session | Yes |
| `.claude/.semantic-sidekick-update-cache.json` | Plugin runtime | Auto-update policy cache | Yes |
| `.claude/.vault/` | Plugin runtime reconcile | Default vault path (auto-created) | No (user content) |

All project-local. The pre-1.2 `.claude/.sidekick-*` names are still read as a fallback; see [state-migration.md](../operational/state-migration.md). Each session clears only its own capture items.

---

## Disabling / tuning

- **Disable entirely:** remove hook entries from `.claude/settings.json`.
- **Disable just UserPromptSubmit injection:** remove the UserPromptSubmit entry; SessionStart preload still runs at boot.
- **Turn the failure lookup on or off:** set or remove `SEMANTIC_MEMORY_FAILURE_HOOK=1` in `~/.claude/settings.json` → `env` (next session).
- **Force re-injection for a prompt:** `rm .claude/.semantic-memory/fingerprints.json`.
- **Clear mode:** `rm .claude/.semantic-memory/mode` (SessionStart recreates).
- **See what the hook is doing:** `SIDEKICK_DEBUG=1 claude` then expand hook lines with `ctrl+o`.
