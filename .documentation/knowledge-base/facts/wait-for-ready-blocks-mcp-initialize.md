---
title: --wait-for-ready indexes before answering MCP initialize, so a client needs a longer connect timeout
tier: fact
domains:
  - troubleshooting
  - testing
status: active
last_updated: '2026-11-09'
purpose: Why does an MCP client connecting to `semantic-memory --wait-for-ready` fail with "MCP error -32001 Request timed out" on a slow machine?
symptoms:
  - "MCP error -32001: Request timed out"
  - an e2e test passes locally but times out on the CI runner before any tool call
  - client.connect() fails against a server started with --wait-for-ready on a large tree
id: wait-for-ready-blocks-mcp-initialize
confidence: high
last_verified: '2026-11-09'
verify_command: >
  cd "$(git rev-parse --show-toplevel)" && grep -n "waitForReady" src/mcp/server.ts && grep -n "connect(new StdioClientTransport" test/e2e/abstention-parity.test.ts
provenance:
  - PR #80 CI run 42670779069 (abstention-parity test), fixed in 9c0301b
sources:
  - src/mcp/server.ts
  - test/e2e/abstention-parity.test.ts
  - node_modules/@modelcontextprotocol/sdk/dist/esm/shared/protocol.js
tags:
  - gotcha
  - mcp
  - testing
  - ci
invalidated_by:
  - createServer starts serving stdio before a --wait-for-ready index finishes
  - the MCP SDK default request timeout rises above the cold-index time
---

# --wait-for-ready indexes before answering MCP initialize, so a client needs a longer connect timeout

## Claim
With `--wait-for-ready`, `createServer` in `src/mcp/server.ts` builds (or reconciles) the whole index before the server connects to stdio. The client's `initialize` request is therefore not answered until indexing ends.

The MCP SDK's default request timeout is 60 s (`DEFAULT_REQUEST_TIMEOUT_MSEC`), and it applies to `initialize` as well as tool calls. A cold index of a large tree, such as this repo's `.documentation` plus `src`, can take longer than that on a 4-vCPU CI runner. `client.connect()` then fails with `MCP error -32001: Request timed out`, before any tool call.

A timeout passed only to `callTool` does not cover this.

## Instead
Give the connect its own timeout:

```ts
await client.connect(transport, { timeout: 300_000 });
```

`Client.connect(transport, options)` passes those options to the `initialize` request. Alternatively, start the server without `--wait-for-ready` and retry tool calls while they answer "Indexing in progress… Try again shortly."

## How to verify
`src/mcp/server.ts` awaits `ctx.fullIndex()` / `ctx.reconcileNow()` under `options.waitForReady` before returning the server. `test/e2e/abstention-parity.test.ts` passes `{ timeout: 300_000 }` to `connect`. Without it, the test timed out on CI (PR #80) while passing locally in 58 s.

## Consequences
Any e2e test or script that starts a `--wait-for-ready` server on a non-trivial tree must set the connect timeout as well as the tool-call timeout. Otherwise it passes on a fast machine and fails on CI.

## See also
- [mcp-serves-new-vectors-before-doc-metadata](mcp-serves-new-vectors-before-doc-metadata.md)
