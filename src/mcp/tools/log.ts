import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ServerContext } from "../context.js";
import { logEvent, logQuery } from "../../core/log.js";
import { regenIndexesForPaths, regenDirectoryIndex } from "../../core/index-regen.js";

export function registerLogTools(server: McpServer, ctx: ServerContext): void {
  server.tool(
    "log_query",
    "Read structured log entries filtered by kind and/or date range. Returns parsed entries from log.md.",
    {
      kind: z.string().optional(),
      after: z.string().optional().describe("ISO timestamp (inclusive)"),
      before: z.string().optional().describe("ISO timestamp (inclusive)"),
      limit: z.coerce.number().optional(),
    },
    async (args) => {
      const entries = await logQuery(ctx.notesPath, args);
      return ctx.textResponse(JSON.stringify(entries, null, 2));
    }
  );

  if (!ctx.options.readOnly) {
    server.tool(
      "log_event",
      "Append a structured event to the vault's log.md. Each entry renders as a human line + a machine-readable YAML block for later querying.",
      {
        kind: z.string().describe("Category: ingest, synthesis, decision, incident, etc."),
        summary: z.string().describe("One-line human summary"),
        payload: z.record(z.unknown()).optional().describe("Arbitrary structured data"),
      },
      async (args) => {
        const entry = await logEvent(ctx.notesPath, args);
        return ctx.textResponse(JSON.stringify(entry, null, 2));
      }
    );

    server.tool(
      "regenerate_index",
      "Force regeneration of INDEX.md for one directory (or all affected by a list of paths). Idempotent — skips write if unchanged.",
      {
        directory: z.string().optional().describe("Directory path relative to vault root (mutually exclusive with 'paths')"),
        paths: z.array(z.string()).optional().describe("Files to infer affected directories from"),
      },
      async ({ directory, paths }) => {
        let results;
        if (directory) {
          results = [await regenDirectoryIndex(ctx.notesPath, directory)];
        } else if (paths && paths.length > 0) {
          results = await regenIndexesForPaths(ctx.notesPath, paths);
        } else {
          return ctx.textResponse("Provide either `directory` or `paths`.");
        }
        return ctx.textResponse(JSON.stringify(results, null, 2));
      }
    );
  }
}
