---
title: MCP server internals — composition, context, per-domain tool modules
tier: reference
domains: [architecture]
audience: [developers]
tags: [mcp, server, context, tools, modules, refactor, v1.1]
status: active
last_updated: '2026-10-24'
version: '1.6.1'
purpose: How the MCP server is structured internally — composition root, shared context, per-domain tool modules. Read this if you're adding a new MCP tool or debugging tool registration.
load_priority: 7
---

# MCP server internals

In v1.1, `src/mcp/server.ts` (1039 lines, 33 tools registered inline) split into per-domain modules. The composition root shrank to ~100 lines. This doc explains the structure for anyone adding a tool or debugging registration.

## File layout

```
src/mcp/
  server.ts             # Composition root + lifecycle (~100 lines)
  context.ts            # Shared MCP server context — services, state, helpers (~310 lines)
  tools/
    search.ts           # 4 tools: search_semantic / search_text / search_graph / search_hybrid
    read.ts             # 3 tools: read_note / read_multiple_notes (deprecated) / list_notes
    write.ts            # 4 CRUD tools: create_note / update_note / delete_note / move_note
    metadata.ts         # 4 tools: get_frontmatter / update_frontmatter / manage_tags / rename_tag (deprecated)
    graph.ts            # 4 tools: backlinks / forwardlinks / graph_path / graph_statistics
    patch.ts            # 5 tools: apply_patch / synthesize_note / synthesize_promote / ingest_source / install_schema
    lint.ts             # 5 tools: find_schema_violations (dep) / find_missing_provenance (dep) / find_stale (dep) / find_broken_links (dep) / lint_vault
    log.ts              # 3 tools: log_event / log_query / regenerate_index
    system.ts           # 2 tools: get_stats / reindex
    contract.ts         # 2 tools: regenerate_contract / inspect_contract  (v1.1+)
    session.ts          # 4 tools: session_start / session_run / session_finish / session_status  (v1.1+)
    inventory.ts        # NOT a tool module — it's the canonical CURRENT_TOOL_INVENTORY const used by the AGENTS.md generator
```

Total: 41 tools across 11 tool modules + 1 inventory const.

## Composition root (`server.ts`)

```ts
export async function createServer(notesPath, options) {
  const ctx = await buildContext(notesPath, options);

  const server = new McpServer({ name: "semantic-memory", version: "1.0.0" });

  registerSearchTools(server, ctx);
  registerReadTools(server, ctx);
  registerWriteTools(server, ctx);          // gated: ctx.options.readOnly => no-op
  registerPatchTools(server, ctx);           // gated: ctx.options.readOnly => no-op
  registerLintTools(server, ctx);
  registerLogTools(server, ctx);             // regenerate_index gated by readOnly internally
  registerMetadataTools(server, ctx);        // writes gated, get_frontmatter unconditional
  registerGraphTools(server, ctx);
  registerSystemTools(server, ctx);
  registerContractTools(server, ctx);        // gated: ctx.options.readOnly => no-op
  registerSessionTools(server, ctx);         // gated: ctx.options.readOnly => no-op

  // ... startup (cache load + background index)
  // ... watcher (chokidar)
  // ... return server
}
```

That's effectively the whole composition root. New domain → new `tools/<domain>.ts` + new `register*Tools` call here.

## Shared context (`context.ts`)

Every tool module receives a `ServerContext` with the same shape. State that needs to be mutable across modules is exposed via accessor functions, not direct properties.

```ts
export interface ServerContext {
  notesPath: string;
  indexPath: string;
  options: ServerOptions;

  // Services (instantiated once, shared across tool modules)
  indexer: Indexer;
  embedder: Embedder;
  graph: GraphBuilder;
  textSearch: TextSearch;
  crud: NoteCrud;
  frontmatterManager: FrontmatterManager;
  tagManager: TagManager;
  sessions: SessionManager;        // v1.1+

  // Mutable state — accessor functions so closures stay in context.ts
  getDocuments(): IndexedDocument[];
  getDocByPath(): Map<string, IndexedDocument>;
  getVectorIndex(): VectorIndex | null;
  getIndexState(): IndexState;
  getIndexProgress(): { embedded: number; total: number };

  // Lifecycle hooks
  tryLoadCachedIndex(): Promise<boolean>;
  fullIndex(): Promise<void>;
  backgroundIndex(): void;
  isIndexingInFlight(): boolean;

  // Helpers used by every tool module
  textResponse(text: string): McpToolResponse;
  indexingMessage(): string;
  enrichResult<T>(r: T): T & EnrichedResult;
  applyPriorityBoost(score: number, path: string): number;
  applyDateFilter<T>(results: T[], after?: string, before?: string): T[];
}
```

The accessor pattern (`getDocuments()` instead of `documents`) keeps the actual `let documents = ...` binding inside `buildContext` — tool modules read but can't accidentally mutate the wrong thing.

## Tool module shape

Every `tools/*.ts` module exports a single function:

```ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServerContext } from "../context.js";
import { z } from "zod";

export function registerSearchTools(server: McpServer, ctx: ServerContext): void {
  // Optional: gate on readOnly at module level
  // if (ctx.options.readOnly) return;

  server.tool(
    "search_semantic",
    "Vector similarity search — ...",
    {
      query: z.string(),
      limit: z.coerce.number().optional().default(10),
      // ... zod schema for input
    },
    async ({ query, limit, ... }) => {
      const vectorIndex = ctx.getVectorIndex();
      if (!vectorIndex) return ctx.textResponse(...);
      // ... implementation
      return ctx.textResponse(JSON.stringify(result, null, 2));
    }
  );

  // ... more server.tool() registrations for this domain
}
```

That's the entire pattern. No state owned by the module itself — all state goes through `ctx`.

## Read-only mode

`createServer(notesPath, { readOnly: true })` suppresses every write-mode tool. The pattern is per-module:

```ts
// src/mcp/tools/write.ts
export function registerWriteTools(server, ctx) {
  if (ctx.options.readOnly) return;       // entire module skipped
  server.tool("create_note", ...);
  server.tool("update_note", ...);
  // ...
}

// src/mcp/tools/metadata.ts (mixed read+write module)
export function registerMetadataTools(server, ctx) {
  server.tool("get_frontmatter", ...);    // always registered (read)
  if (ctx.options.readOnly) return;
  server.tool("update_frontmatter", ...); // gated
  server.tool("manage_tags", ...);
  server.tool("rename_tag", ...);
}
```

Final tool surface in read-only mode: 20 tools (search × 4, read × 3, get_frontmatter, `log_query`, lint × 5, graph × 4, system × 2 = 20). `log_event` is write-gated since v1.6.1; before, it made 21 and could append to `log.md` in a read-only folder.

## Adding a new tool

Five-step recipe:

1. **Pick or create a tools module.** If your tool fits an existing domain, add it there. If it's a new domain (e.g. `tools/decay.ts` for v1.3 confidence-decay tools), create the file.

2. **Register the tool.** Use `server.tool(name, description, zodSchema, handler)`. The handler returns `ctx.textResponse(JSON.stringify(...))`.

3. **Wire into the composition root.** Add `registerYourTools(server, ctx)` to `server.ts`.

4. **Add to `inventory.ts`.** The `CURRENT_TOOL_INVENTORY` const is the source of truth for the AGENTS.md tool-list section. Without an entry here, your tool will work but won't appear in the regenerated contract.

5. **Update the regression snapshots.** Run `npx vitest run test/regression -u` to refresh the tool-surface snapshot. Verify the diff is purely additive (new tool added, no existing tools changed shape).

## Tool registration ordering

Tool registration order does not affect MCP semantics — clients see the tools as a Set. But it affects **debugging output**: when stack traces span tool registrations, modules registered earlier appear earlier in the call stack.

Convention in `server.ts`:
1. Read-mode tools first (search, read)
2. Write-mode tools (gated on readOnly)
3. Cross-cutting domains (lint, log, metadata, graph)
4. System (get_stats, reindex)
5. v1.1+ additions (contract, session)

When adding a new module, follow this gradient: read before write, foundational before added-on.

## Conditional registration patterns

Three patterns appear in the codebase:

**1. Whole-module gate** — `tools/write.ts`, `tools/patch.ts`, `tools/contract.ts`, `tools/session.ts`:
```ts
if (ctx.options.readOnly) return;
// ... all registrations
```

**2. Per-tool gate** — `tools/log.ts` (regenerate_index), `tools/metadata.ts`:
```ts
server.tool("log_event", ...);   // unconditional
if (!ctx.options.readOnly) {
  server.tool("regenerate_index", ...); // gated
}
```

**3. Internal feature flag** — none in v1.2, but `decay.hotness_boost.enabled` in v1.3 will use this:
```ts
const config = await loadDecayConfig(ctx);
if (config.hotness_boost.enabled) {
  // ... extended decay calc
}
```

## Tool descriptions and the agent's tool list

Tool descriptions are the agent's primary source of "what does this do?" — they appear in the MCP tool list every time the agent calls `list_tools`. Conventions:

- **First sentence is the elevator pitch** (~20 words). The agent often only reads this before deciding whether to invoke.
- **Second-third sentences** describe non-obvious constraints (e.g. "refused without verification unless...").
- **Deprecation prefix** is `[DEPRECATED — removed in v2.0.0; use ...]`. Always link to the survivor.
- **Mention the side effect** if any — `synthesize_note` writes a file, `verify_note` updates frontmatter, `apply_patch` is atomic-with-rollback.

The descriptions are ALSO what `regenerate_contract` reads to populate the AGENTS.md tool-list section. Sloppy descriptions → sloppy AGENTS.md. Treat them like product copy.

## Lifecycle: server startup

```
createServer(notesPath, options)
  └─ buildContext(notesPath, options)
      └─ instantiate Indexer, Embedder, GraphBuilder, ...
      └─ create indexer-state closures
      └─ return ctx

  └─ new McpServer({ name: "semantic-memory", version: "1.0.0" })
  └─ register all tool modules (in order above)

  └─ startup branch:
      ├─ if (waitForReady): tryLoadCachedIndex(); fullIndex()      // CLI --reindex flag
      └─ else: tryLoadCachedIndex().then(cached => !cached && backgroundIndex())

  └─ if (watch !== false): new Watcher(notesPath); on("changed", backgroundIndex)

  └─ return server
```

Startup return is FAST — model load + cache load happen in the background. Tools that need the vector index (`search_semantic`, `search_hybrid`) return `"Indexing in progress..."` until ready. Tools that don't (`read_note`, `list_notes`) work immediately.

## Lifecycle: server shutdown

`startServer()` (in `src/mcp/server.ts`) wraps `createServer` and adds stdin EOF + signal handlers:

```ts
process.stdin.once("end", () => process.exit(0));
process.stdin.once("close", () => process.exit(0));
process.once("SIGTERM", () => process.exit(0));
process.once("SIGHUP", () => process.exit(0));
```

This is critical. Without these handlers, the chokidar inotify FD and the ONNX inference session keep the event loop alive forever. On Claude Code session end, that produces an orphan process (~180-200 MB RSS) per session — and on low-memory boxes, accumulating orphans exhausts swap and freeze the host.

The MCP SDK does NOT exit the process on transport close. It's the application's responsibility. These four lines are it.

## Common gotchas when adding tools

1. **Don't mutate `ctx.options.readOnly`** — it's used in multiple modules to decide registration. Mutating it after `createServer` returns won't re-register anything.

2. **Don't register from inside tool handlers** — only `register*Tools` functions during `createServer`. The MCP server doesn't support hot-registering tools mid-flight.

3. **Don't capture `ctx.documents` directly** — use `ctx.getDocuments()` every time. Direct capture freezes you to the documents at registration time, missing all subsequent indexer updates.

4. **Logging is fire-and-forget** — `logEvent(...).catch(() => {})` is the pattern. Never let log failure mask the real error.

5. **When in doubt about readOnly behavior, test with `createServer(path, { readOnly: true })`** — `test/regression/tool-surface.test.ts` has separate write-mode and read-only-mode snapshots; both must pass.

## See also

- [architecture-layers.md](./architecture-layers.md) — the substrate the MCP server lives on
- [v1-stack-overview.md](./v1-stack-overview.md) — what v1.0/1.1/1.2 added on top
- [mcp-tools-reference.md](../reference/mcp-tools-reference.md) — every tool catalogued
- [hooks-reference.md](../reference/hooks-reference.md) — what hooks the server cooperates with
