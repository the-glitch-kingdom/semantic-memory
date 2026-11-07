import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServerContext } from "../context.js";
import type { VaultStats } from "../../core/types.js";

export function registerSystemTools(server: McpServer, ctx: ServerContext): void {
  server.tool(
    "get_stats",
    "Vault and index statistics — note count, chunks, embeddings, graph density",
    {},
    async () => {
      const documents = ctx.getDocuments();
      const vectorIndex = ctx.getVectorIndex();
      const indexState = ctx.getIndexState();
      const indexProgress = ctx.getIndexProgress();
      const graphStats = documents.length > 0 ? ctx.graph.statistics() : { totalNodes: 0, totalEdges: 0 };
      const stats: VaultStats = {
        totalNotes: documents.length,
        totalChunks: documents.reduce((n, d) => n + d.chunks.length, 0),
        totalEmbeddings: vectorIndex?.getChunkMeta().length ?? 0,
        embeddingDimensions: ctx.embedder.getDimensions(),
        embeddingModel: ctx.embedder.getModel(),
        embeddingRuntime: ctx.embedder.getRuntime?.() ?? "unknown",
        graphNodes: graphStats.totalNodes,
        graphEdges: graphStats.totalEdges,
        indexSize: 0,
        lastIndexed: indexState === "ready" ? new Date().toISOString() : null,
        ...(ctx.isStale() && { stale: true }),
        indexState,
        indexProgress: indexState === "indexing" ? indexProgress : undefined,
      };
      return ctx.textResponse(JSON.stringify(stats, null, 2));
    }
  );

  server.tool(
    "reindex",
    "Force a full reindex of the vault",
    {},
    async () => {
      if (ctx.isIndexingInFlight()) return ctx.textResponse("Reindex already in progress. " + ctx.indexingMessage());
      await ctx.fullIndex();
      const documents = ctx.getDocuments();
      return ctx.textResponse(
        `Reindexed: ${documents.length} notes, ${documents.reduce((n, d) => n + d.chunks.length, 0)} chunks`
      );
    }
  );
}
