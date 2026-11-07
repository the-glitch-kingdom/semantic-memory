import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ServerContext } from "../context.js";

const types = z.array(z.enum(["link", "wikilink", "related", "cites", "same-incident", "supersedes", "tag"])).optional().describe("Edge types to follow (default link, wikilink, related, cites, same-incident; add 'supersedes' for live->archived copies or 'tag' for shared-topic neighbours)");

const includeExcluded = z.boolean().optional().default(false).describe("Also return notes under path_class.exclude (archive by default). Asking for the 'supersedes' type includes them too");

export function registerGraphTools(server: McpServer, ctx: ServerContext): void {
  const visible = <T extends { path: string }>(nodes: T[], types: string[] | undefined, include?: boolean) =>
    include || types?.includes("supersedes") ? nodes : ctx.filterPathClass(nodes);

  server.tool(
    "backlinks",
    "Find all notes that link TO a given note",
    { path: z.string(), limit: z.coerce.number().optional().default(50), types, include_excluded: includeExcluded },
    async ({ path, limit, types, include_excluded }) => {
      if (ctx.getDocuments().length === 0 && ctx.getIndexState() !== "ready") return ctx.textResponse(ctx.indexingMessage());
      const results = visible(ctx.graph.backlinks(path, types), types, include_excluded).slice(0, limit);
      return ctx.textResponse(JSON.stringify(results, null, 2));
    }
  );

  server.tool(
    "forwardlinks",
    "Find all notes linked FROM a given note",
    { path: z.string(), limit: z.coerce.number().optional().default(50), types, include_excluded: includeExcluded },
    async ({ path, limit, types, include_excluded }) => {
      if (ctx.getDocuments().length === 0 && ctx.getIndexState() !== "ready") return ctx.textResponse(ctx.indexingMessage());
      const results = visible(ctx.graph.forwardlinks(path, types), types, include_excluded).slice(0, limit);
      return ctx.textResponse(JSON.stringify(results, null, 2));
    }
  );

  server.tool(
    "graph_path",
    "Find the shortest path (in either link direction unless `direction` says otherwise) between two notes over link, wikilink, related, cites and same-incident edges (pass types to change)",
    { from: z.string(), to: z.string(), types, direction: z.enum(["out", "in", "any"]).optional().default("any").describe("out: follow links forwards; in: against them; any (default): either way") },
    async ({ from, to, types, direction }) => {
      if (ctx.getDocuments().length === 0 && ctx.getIndexState() !== "ready") return ctx.textResponse(ctx.indexingMessage());
      // archived notes must not bridge two live ones (they link to everything they once superseded)
      const skip = types?.includes("supersedes") ? undefined : (p: string) => ctx.filterPathClass([{ path: p }]).length === 0;
      const path = ctx.graph.findPath(from, to, types, direction, skip);
      if (!path) return ctx.textResponse("No path found");
      return ctx.textResponse(JSON.stringify(path));
    }
  );

  server.tool(
    "graph_statistics",
    "Knowledge graph stats — most connected nodes, orphans, density",
    {},
    async () => {
      if (ctx.getDocuments().length === 0 && ctx.getIndexState() !== "ready") return ctx.textResponse(ctx.indexingMessage());
      const stats = ctx.graph.statistics();
      return ctx.textResponse(JSON.stringify(stats, null, 2));
    }
  );
}
