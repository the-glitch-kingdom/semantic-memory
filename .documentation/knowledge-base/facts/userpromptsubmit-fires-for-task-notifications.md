---
title: >-
  UserPromptSubmit fires for background-task notifications and subagent
  hand-backs, with the XML envelope as the prompt
tier: fact
domains:
  - troubleshooting
status: active
last_updated: '2026-10-28'
id: userpromptsubmit-fires-for-task-notifications
confidence: high
last_verified: '2026-10-28'
verify_command: >
  cd "$(git rev-parse --show-toplevel)" && npm run build >/dev/null && npx
  vitest run test/integration/hook-multi-source.test.ts -t "task notification"
provenance:
  - >-
    every repo's Claude Code transcripts, 2026-10-28: the prompt hook's injected
    query started with "<task-notification" 161 times and "<agent-message" 49
    times
  - >-
    https://code.claude.com/docs/en/hooks.md (UserPromptSubmit) — also runs when
    a background subagent reports back and when another session sends a message;
    no input field marks those turns
sources:
  - hooks/vault-context.js
tags:
  - gotcha
  - hooks
  - UserPromptSubmit
  - claude-code
invalidated_by:
  - a UserPromptSubmit input field that marks non-human turns
---

# UserPromptSubmit fires for task notifications and subagent hand-backs

## Claim
Claude Code runs `UserPromptSubmit` hooks for turns no human typed: a background task finishing
(`<task-notification>…`) and a subagent reporting back (`<agent-message from=…>`). The hook's `prompt` is that XML
envelope, and no input field says the turn is not human. A hook that searches or classifies every prompt then works
on the envelope: semantic-memory's prompt hook injected hits scoring up to 0.57 for them.

## Instead
Skip prompts that start with `<task-notification` or `<agent-message` (semantic-memory 1.7.2:
`isNonHumanPrompt` in `hooks/vault-context.js`). Match the start of the prompt only: a human may type the tag in a
sentence.
