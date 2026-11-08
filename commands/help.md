---
argument-hint: "[topic]"
description: Task-shaped help for semantic-memory. No topic lists them; pass an id or words (e.g. federated search, eval, gaps).
allowed-tools: Bash(npx:*), Bash(node:*)
---

When the user runs `/help [topic]`:

- Run `node ./node_modules/@theglitchking/semantic-memory/bin/semantic-memory help [topic]` (or `npx --no @theglitchking/semantic-memory help [topic]` if no local install) and show the output as is.
- With no topic it lists the topics by task; with an id or a few words it prints the steps, commands and a check for that topic.
- The same topics are served by the `help` MCP tool, so the agent can call `help({ topic })` instead.
